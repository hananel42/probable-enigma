import type { Building, DroneAIState, DroneStationMode, GameEntity, Projectile, ResourceNode } from '../../types';
import { resolveDroneAIState } from '../droneStateMachine';
import { distance, GRID_SIZE } from '../../rules';
import { findPriorityHostileTarget, getCombatTeamId } from '../../combat';
import { recoverEmbeddedEntity } from '../../movement';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import { BASE_DRONE_TUNING } from '../../combatTuning';
import { isBuildingOperational } from '../../coreStatus';
import type { DefenseOrbitRoute } from './model';
import { DroneAIStateTransitions } from './DroneAIStateTransitions';
import { updateDroneFlight } from './DroneFlightController';
import { updateDroneWeapons } from './DroneAIWeapons';
import { measurePerformance } from '../../performance/PerformanceDiagnostics';

/** Drone targeting policy and the single, second-order flight loop. */
export abstract class DroneAIUpdate extends DroneAIStateTransitions {
  private readonly flightHomeRouteCache = new Map<string, {
    buildings: Building[]; length: number; expiresAt: number; createdAt: number; route: DefenseOrbitRoute
  }>();

  public override invalidateGroupRelations(): void {
    this.flightHomeRouteCache.clear();
    super.invalidateGroupRelations();
  }
  public override updateDrone(
    drone: GameEntity,
    player: GameEntity,
    buildings: Building[],
    entities: GameEntity[],
    projectiles: Projectile[],
    dt: number,
    resourceNodes: ResourceNode[] = [],
    gameTimeSeconds = performance.now() / 1000
  ) {
    const nowSeconds = gameTimeSeconds;
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(`Drone '${drone.id}' received invalid simulation delta: ${dt}.`);
    }
    if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
      throw new RangeError(`Drone '${drone.id}' received invalid simulation time: ${nowSeconds}.`);
    }
    if (![drone.x, drone.y, drone.vx, drone.vy, drone.hp, drone.maxHp].every(Number.isFinite)) {
      throw new RangeError(`Drone '${drone.id}' has non-finite position, velocity, or health values.`);
    }
    if (drone.visualAngle !== undefined && !Number.isFinite(drone.visualAngle)) {
      throw new RangeError(`Drone '${drone.id}' has invalid visual angle: ${drone.visualAngle}.`);
    }
    if (!Number.isFinite(drone.angle)) throw new RangeError(`Drone '${drone.id}' has invalid angle: ${drone.angle}.`);

    const entityIndex = measurePerformance('ai.drone.entityIndex', () => this.getEntityIndex(entities), {
      entityCount: entities.length, droneId: drone.id
    });
    const buildingIndex = measurePerformance('ai.drone.buildingIndex', () => this.getBuildingIndex(buildings), {
      buildingCount: buildings.length, droneId: drone.id
    });
    const station = drone.parentStationId ? buildingIndex.byId.get(drone.parentStationId) : undefined;
    if (!station || !isBuildingOperational(station, buildings)) {
      drone.hp = 0;
      return;
    }

    drone.teamId = getCombatTeamId(station);
    drone.allianceId = station.allianceId ?? getCombatTeamId(station);
    const teamId = getCombatTeamId(drone);
    const healthMultiplier = station.droneHealthMultiplier ?? 1;
    const speedMultiplier = station.droneSpeedMultiplier ?? 1;
    const damageMultiplier = station.droneDamageMultiplier ?? 1;
    const fireRateMultiplier = station.droneFireRateMultiplier ?? 1;
    for (const [name, value] of [
      ['health', healthMultiplier], ['speed', speedMultiplier], ['damage', damageMultiplier], ['fire rate', fireRateMultiplier]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`Drone Station '${station.id}' has an invalid ${name} multiplier: ${value}.`);
      }
    }
    const maxHp = Math.max(1, Math.round(70 * healthMultiplier));
    if (drone.maxHp !== maxHp) {
      const hpRatio = Math.max(0, Math.min(1, drone.hp / Math.max(1, drone.maxHp)));
      drone.maxHp = maxHp;
      drone.hp = Math.min(maxHp, maxHp * hpRatio);
    }

    const tuning = droneStationBehavior;
    if (tuning.kind !== 'DRONE_STATION') {
      throw new TypeError(`Drone AI requires DRONE_STATION behavior, received '${String(tuning.kind)}'.`);
    }
    drone.speed = tuning.baseDroneSpeed * speedMultiplier;
    drone.damage = BASE_DRONE_TUNING.damage * damageMultiplier;
    drone.fireCooldown = BASE_DRONE_TUNING.fireCooldown / fireRateMultiplier;
    drone.range = GRID_SIZE * BASE_DRONE_TUNING.weaponRangeInGridCells;
    if (this.updateKamikazeDrone(drone, entities, buildings, dt, nowSeconds)) return;

    const requestedMode = station.droneMode;
    if (requestedMode !== 'DEFENSE' && requestedMode !== 'ESCORT') {
      throw new RangeError(`Drone Station '${station.id}' has an unsupported mode: ${String(requestedMode)}.`);
    }
    let possibleEscort: GameEntity | undefined;
    if (requestedMode === 'ESCORT') {
      if (drone.faction === 'player') {
        const assignedCommanderId = station.escortCommanderId;
        if (!assignedCommanderId) {
          throw new Error(`Drone Station '${station.id}' is in ESCORT mode without an assigned commander ID.`);
        }
        possibleEscort = entityIndex.byId.get(assignedCommanderId);
      } else {
        possibleEscort = entityIndex.commandersByTeam.get(getCombatTeamId(drone));
      }
    }
    const escort = possibleEscort && !possibleEscort.isDead && possibleEscort.hp > 0 ? possibleEscort : undefined;
    const mode: DroneStationMode = escort ? 'ESCORT' : 'DEFENSE';

    // Resolve the home centre first. Defense uses one cached geometry envelope around
    // the connected structure cluster; escort uses the commander's live position/velocity.
    let homeX = station.x;
    let homeY = station.y;
    let homeVx = 0;
    let homeVy = 0;
    let homeId = `station:${station.id}`;
    let homeRadius = Math.max(tuning.defenseOrbitPaddingX, tuning.defenseOrbitPaddingY, 265);
    if (escort) {
      homeX = escort.x;
      homeY = escort.y;
      homeVx = escort.vx ?? 0;
      homeVy = escort.vy ?? 0;
      homeId = `escort:${escort.id}`;
      const formation = entityIndex.escortFormationById.get(drone.id);
      homeRadius = 122 + ((formation?.index || 0) % 4) * 16;
    } else {
      const cachedHome = this.flightHomeRouteCache.get(station.id);
      let route: DefenseOrbitRoute;
      if (cachedHome && cachedHome.buildings === buildings && cachedHome.length === buildings.length
        && nowSeconds >= cachedHome.createdAt && nowSeconds < cachedHome.expiresAt) {
        route = cachedHome.route;
      } else {
        const cluster = measurePerformance('ai.drone.resolveHomeCluster', () =>
          this.getConnectedBuildingCluster(station, buildings, nowSeconds),
          { stationId: station.id, buildingCount: buildings.length }
        );
        route = measurePerformance('ai.drone.buildDefenseOrbitRoute', () =>
          this.getDefenseOrbitRoute(station, buildings, cluster),
          { stationId: station.id, clusterBuildingCount: cluster.length }
        );
        this.flightHomeRouteCache.set(station.id, {
          buildings, length: buildings.length, createdAt: nowSeconds, expiresAt: nowSeconds + 0.35, route
        });
      }
      homeX = route.centerX;
      homeY = route.centerY;
      homeRadius = Math.max(route.radiusX, route.radiusY);
    }

    drone.combatAlertTimer = Math.max(0, (drone.combatAlertTimer || 0) - Math.max(0, dt));
    drone.droneAlertBroadcastCooldown = Math.max(0, (drone.droneAlertBroadcastCooldown || 0) - Math.max(0, dt));
    if (drone.combatAlertTimer <= 0) {
      drone.combatAlertEntityId = null;
      drone.combatAlertBuildingId = null;
    }

    const getTargetPoint = (target: import('../../combat').PrioritizedCombatTarget) => target.kind === 'ENTITY'
      ? { id: target.entity.id, x: target.entity.x, y: target.entity.y, vx: target.entity.vx ?? 0, vy: target.entity.vy ?? 0 }
      : { id: target.building.id, x: target.building.x, y: target.building.y, vx: 0, vy: 0 };
    const getCombatRadius = (target: import('../../combat').PrioritizedCombatTarget) => {
      if (target.kind === 'ENTITY') return Math.max(tuning.combatOrbitRadiusX, tuning.combatOrbitRadiusY);
      return Math.max(
        tuning.combatOrbitRadiusX, tuning.combatOrbitRadiusY,
        (target.building.widthInCells || 1) * GRID_SIZE * 0.5 + GRID_SIZE * 1.5,
        (target.building.heightInCells || 1) * GRID_SIZE * 0.5 + GRID_SIZE * 1.5
      );
    };
    const isInCombatEnvelope = (target: import('../../combat').PrioritizedCombatTarget | undefined): boolean => {
      if (!target) return false;
      const point = getTargetPoint(target);
      const orbitRadius = getCombatRadius(target);
      const gap = distance(homeX, homeY, point.x, point.y);
      if (mode === 'ESCORT') {
        const leash = tuning.escortTetherBlocks * GRID_SIZE;
        return gap + orbitRadius <= leash;
      }
      return gap <= Math.max(GRID_SIZE * 10, homeRadius + GRID_SIZE * 5);
    };

    // A target is retained only while alive, hostile and inside the envelope around
    // the home centre. This validation runs each tick, unlike the lower-rate new-target scan.
    if (drone.droneCombatCheckTimer === undefined) {
      let hash = 0;
      for (let i = 0; i < drone.id.length; i++) hash = (hash * 31 + drone.id.charCodeAt(i)) >>> 0;
      drone.droneCombatCheckTimer = ((hash % 1000) / 1000) * 0.18;
    }
    drone.droneCombatCheckTimer = Math.max(0, (drone.droneCombatCheckTimer || 0) - Math.max(0, dt));
    const stored = measurePerformance('ai.drone.resolveStoredTarget', () =>
      this.resolveStoredCombatTarget(drone, entities, buildings, Number.POSITIVE_INFINITY),
      { droneId: drone.id, entityCount: entities.length, buildingCount: buildings.length }
    );
    let combatTarget = isInCombatEnvelope(stored) ? stored : undefined;
    if (!combatTarget) {
      const hadStoredTarget = Boolean(drone.droneTargetEntityId || drone.droneTargetBuildingId);
      if (hadStoredTarget) {
        drone.droneTargetEntityId = null;
        drone.droneTargetBuildingId = null;
        drone.droneCombatCheckTimer = 0;
      }
      const alert = mode === 'DEFENSE' ? this.resolveAlertTarget(drone, entities, buildings) : undefined;
      if (isInCombatEnvelope(alert)) combatTarget = alert;
      if (!combatTarget && drone.droneCombatCheckTimer <= 0) {
        // Reuse the common priority tiers, but measure radius from the home centre,
        // not the drone's current position. Flying around does not expand its aggro range.
        const source = { ...drone, x: homeX, y: homeY };
        const radius = mode === 'ESCORT'
          ? Math.max(0, tuning.escortTetherBlocks * GRID_SIZE - Math.max(tuning.combatOrbitRadiusX, tuning.combatOrbitRadiusY))
          : Math.max(GRID_SIZE * 10, homeRadius + GRID_SIZE * 5);
        const candidate = measurePerformance('ai.drone.scanHostileTargets', () =>
          findPriorityHostileTarget(source, entities, buildings, radius),
          { droneId: drone.id, entityCount: entities.length, buildingCount: buildings.length, radius }
        );
        if (isInCombatEnvelope(candidate)) combatTarget = candidate;
        drone.droneCombatCheckTimer = 0.22;
      }
      drone.droneTargetEntityId = combatTarget?.kind === 'ENTITY' ? combatTarget.entity.id : null;
      drone.droneTargetBuildingId = combatTarget?.kind === 'BUILDING' ? combatTarget.building.id : null;
    }

    if (mode === 'DEFENSE' && combatTarget) {
      const entityId = combatTarget.kind === 'ENTITY' ? combatTarget.entity.id : null;
      const buildingId = combatTarget.kind === 'BUILDING' ? combatTarget.building.id : null;
      const changed = drone.combatAlertEntityId !== entityId || drone.combatAlertBuildingId !== buildingId;
      drone.combatAlertEntityId = entityId;
      drone.combatAlertBuildingId = buildingId;
      drone.combatAlertTimer = 4.5;
      if (changed || drone.droneAlertBroadcastCooldown <= 0) {
        measurePerformance('ai.drone.broadcastDefenseAlert', () =>
          this.broadcastDefenseAlert(drone, combatTarget!, entities, buildings, nowSeconds),
          { droneId: drone.id, entityCount: entities.length, buildingCount: buildings.length }
        );
        drone.droneAlertBroadcastCooldown = 1.6;
      }
    }

    const nextState: DroneAIState = resolveDroneAIState(combatTarget?.kind === 'ENTITY'
      ? combatTarget.entity.id
      : combatTarget?.kind === 'BUILDING' ? combatTarget.building.id : null);
    const activeCenter = combatTarget ? getTargetPoint(combatTarget) : {
      id: homeId, x: homeX, y: homeY, vx: homeVx, vy: homeVy
    };
    const centerId = combatTarget ? `combat:${activeCenter.id}` : homeId;
    if (drone.droneAIState !== nextState || drone.droneFlightCenterId !== centerId) {
      this.clearDroneNavigation(drone);
      drone.droneOrbitApproachActive = false;
      drone.droneOrbitApproachTargetId = null;
      drone.droneCombatOrbitTargetId = null;
    }
    drone.droneAIState = nextState;

    // This is the only ordinary-flight path. It always derives acceleration from the
    // current centre, radius, velocity and route point, then integrates and collides.
    measurePerformance('ai.drone.embeddedRecovery', () =>
      recoverEmbeddedEntity(drone, buildings, resourceNodes),
      { droneId: drone.id, buildingCount: buildings.length, resourceNodeCount: resourceNodes.length }
    );
    const radius = combatTarget ? getCombatRadius(combatTarget) : homeRadius;
    const maxSpeed = Math.min(Math.max(0, drone.speed), tuning.maximumDroneSpeed);
    const orbitSpeed = combatTarget ? tuning.combatOrbitSpeed : mode === 'ESCORT' ? tuning.escortOrbitSpeed : tuning.formationSpeed;
    updateDroneFlight(
      drone,
      { id: centerId, x: activeCenter.x, y: activeCenter.y, vx: activeCenter.vx, vy: activeCenter.vy },
      radius,
      Math.min(orbitSpeed, maxSpeed),
      maxSpeed,
      tuning.acceleration,
      dt,
      buildings,
      resourceNodes,
      nowSeconds
    );
    drone.droneCombatOrbitTargetId = combatTarget ? activeCenter.id : null;

    updateDroneWeapons(
      drone, combatTarget, drone.range,
      teamId, projectiles, dt
    );

    const previousVisualAngle = drone.visualAngle ?? drone.angle;
    const desiredHullAngle = drone.angle;
    const angleDelta = ((desiredHullAngle - previousVisualAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    drone.visualAngle = previousVisualAngle + angleDelta * (1 - Math.exp(-Math.max(0, dt) / 0.11));
  }
}
