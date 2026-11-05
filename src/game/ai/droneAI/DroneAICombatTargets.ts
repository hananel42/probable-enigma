import type { Building, GameEntity } from '../../types';
import { distance } from '../../rules';
import { areHostile, getCombatTeamId, isAliveEntity } from '../../combat';
import { isBuildingOperational } from '../../coreStatus';
import { DroneAIUpdate } from './DroneAIUpdate';

export abstract class DroneAICombatTargets extends DroneAIUpdate {

  protected override resolveStoredCombatTarget(
    drone: GameEntity,
    entities: GameEntity[],
    buildings: Building[],
    maxRange: number
  ): import('../../combat').PrioritizedCombatTarget | undefined {
    const entity = drone.droneTargetEntityId
      ? this.getEntityIndex(entities).byId.get(drone.droneTargetEntityId)
      : undefined;
    const validEntity = entity && isAliveEntity(entity) && areHostile(drone, entity) ? entity : undefined;
    if (validEntity) {
      const d = distance(drone.x, drone.y, validEntity.x, validEntity.y);
      if (d <= maxRange) return { kind: 'ENTITY', entity: validEntity, distance: d };
    }
    const building = drone.droneTargetBuildingId
      ? this.getBuildingIndex(buildings).byId.get(drone.droneTargetBuildingId)
      : undefined;
    if (building && building.hp > 0 && isBuildingOperational(building, buildings) && areHostile(drone, building)) {
      const d = distance(drone.x, drone.y, building.x, building.y);
      if (d <= maxRange) return { kind: 'BUILDING', building, distance: d };
    }
    return undefined;
  }

  protected override resolveAlertTarget(
    drone: GameEntity,
    entities: GameEntity[],
    buildings: Building[]
  ): import('../../combat').PrioritizedCombatTarget | undefined {
    if ((drone.combatAlertTimer || 0) <= 0) return undefined;
    const entity = drone.combatAlertEntityId
      ? this.getEntityIndex(entities).byId.get(drone.combatAlertEntityId)
      : undefined;
    if (entity && isAliveEntity(entity) && areHostile(drone, entity)) {
      return { kind: 'ENTITY', entity, distance: distance(drone.x, drone.y, entity.x, entity.y) };
    }
    const building = drone.combatAlertBuildingId
      ? this.getBuildingIndex(buildings).byId.get(drone.combatAlertBuildingId)
      : undefined;
    if (building && building.hp > 0 && isBuildingOperational(building, buildings) && areHostile(drone, building)) {
      return { kind: 'BUILDING', building, distance: distance(drone.x, drone.y, building.x, building.y) };
    }
    return undefined;
  }

  /** Notify allied drones and idle enemy commanders, without stealing an existing fight. */
  protected override broadcastDefenseAlert(
    source: GameEntity,
    target: import('../../combat').PrioritizedCombatTarget,
    entities: GameEntity[],
    buildings: Building[],
    nowSeconds: number
  ) {
    const targetEntityId = target.kind === 'ENTITY' ? target.entity.id : null;
    const targetBuildingId = target.kind === 'BUILDING' ? target.building.id : null;
    const teamId = getCombatTeamId(source);
    const alertKey = `${source.allianceId || teamId}:${targetEntityId || targetBuildingId || 'none'}`;
    const lastBroadcast = this.lastBroadcastByTeamTarget.get(alertKey);
    if (lastBroadcast !== undefined && nowSeconds - lastBroadcast < 0.75) return;
    this.lastBroadcastByTeamTarget.set(alertKey, nowSeconds);
    if (this.lastBroadcastByTeamTarget.size > 256) {
      for (const [key, timestamp] of this.lastBroadcastByTeamTarget) {
        if (nowSeconds - timestamp > 12) this.lastBroadcastByTeamTarget.delete(key);
      }
    }

    const entityIndex = this.getEntityIndex(entities);
    const buildingIndex = this.getBuildingIndex(buildings);
    for (const ally of entities) {
      if (ally.id === source.id || !isAliveEntity(ally) || areHostile(source, ally)) continue;

      // Drones already store their current local engagement. Respect it without
      // rescanning the entire battlefield once for every reserve in the alert.
      const localDroneFight = ally.kind === 'DRONE'
        ? this.resolveStoredCombatTarget(ally, entities, buildings, Number.POSITIVE_INFINITY)
        : undefined;
      const commanderHasFight = ally.kind === 'COMMANDER' && ally.aiGoal === 'ATTACK_TARGET' && Boolean(
        (ally.aiTargetEntityId && entityIndex.byId.get(ally.aiTargetEntityId) && isAliveEntity(entityIndex.byId.get(ally.aiTargetEntityId)!)) ||
        (ally.aiTargetBuildingId && (() => {
          const target = buildingIndex.byId.get(ally.aiTargetBuildingId);
          return Boolean(target && target.hp > 0 && isBuildingOperational(target, buildings));
        })())
      );
      if (localDroneFight || commanderHasFight) continue;

      if (ally.kind === 'DRONE') {
        // Keep a still-valid existing call to avoid allies flapping between alerts.
        if (this.resolveAlertTarget(ally, entities, buildings)) continue;
        ally.combatAlertEntityId = targetEntityId;
        ally.combatAlertBuildingId = targetBuildingId;
        ally.combatAlertTimer = 4.5;
        continue;
      }

      if (ally.kind === 'COMMANDER' && ally.faction === 'enemy') {
        const currentEntityCandidate = ally.aiTargetEntityId ? entityIndex.byId.get(ally.aiTargetEntityId) : undefined;
        const currentEntityTarget = currentEntityCandidate && isAliveEntity(currentEntityCandidate) && areHostile(ally, currentEntityCandidate)
          ? currentEntityCandidate : undefined;
        const currentBuildingCandidate = ally.aiTargetBuildingId ? buildingIndex.byId.get(ally.aiTargetBuildingId) : undefined;
        const currentBuildingTarget = currentBuildingCandidate && currentBuildingCandidate.hp > 0 &&
          isBuildingOperational(currentBuildingCandidate, buildings) && areHostile(ally, currentBuildingCandidate)
          ? currentBuildingCandidate : undefined;
        if (ally.aiGoal === 'ATTACK_TARGET' && (currentEntityTarget || currentBuildingTarget)) continue;
        ally.aiGoal = 'ATTACK_TARGET';
        ally.aiTargetEntityId = targetEntityId;
        ally.aiTargetBuildingId = targetBuildingId;
        ally.aiTargetResourceId = null;
        ally.aiBuildType = null;
        ally.isActivelyMining = false;
        ally.miningProgress = 0;
      }
    }
  }
}
