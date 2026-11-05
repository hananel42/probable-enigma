import type { Building, GameEntity } from '../../types';
import { AIR_BUILDING_CLEARANCE_CELLS, getBuildingOccupiedCells, GRID_SIZE } from '../../rules';
import { invalidateEntityPathRequest } from '../../movement';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import type { DefenseOrbitRoute } from './model';
import { DroneAIIndexing } from './DroneAIIndexing';

export abstract class DroneAIFlightPlanning extends DroneAIIndexing {

  /** Cached air collision map shared by every drone for the same simulation step. */
  protected override getAirObstacleCells(buildings: Building[], nowSeconds: number): Set<string> {
    const cache = this.airObstacleCache;
    if (cache && cache.buildings === buildings && cache.buildingCount === buildings.length && nowSeconds < cache.expiresAt) {
      return cache.blockedCells;
    }

    const blockedCells = new Set<string>();
    const keyOf = (gx: number, gy: number) => `${gx},${gy}`;
    const clearance = 2;
    for (const building of buildings) {
      if (building.hp <= 0) continue;
      for (const cell of getBuildingOccupiedCells(building)) {
        for (let dx = -clearance; dx <= clearance; dx++) {
          for (let dy = -clearance; dy <= clearance; dy++) {
            blockedCells.add(keyOf(cell.gx + dx, cell.gy + dy));
          }
        }
      }
    }
    this.airObstacleCache = {
      expiresAt: nowSeconds + 0.75,
      buildings,
      buildingCount: buildings.length,
      blockedCells
    };
    return blockedCells;
  }

  protected override isAirCellBlocked(gx: number, gy: number, blockedCells: Set<string>): boolean {
    return blockedCells.has(`${gx},${gy}`);
  }

  /**
   * Compute the defence ellipse once per connected-base footprint. The orbit's
   * boundary must enclose the whole expanded rectangular compound: multiplying
   * each radius by a small random scale used to shrink the ellipse into walls,
   * which forced repeated A* routes and visible stop/start motion.
   */
  protected override getDefenseOrbitRoute(station: Building, allBuildings: Building[], cluster: Building[]): DefenseOrbitRoute {
    const geometryOf = (building: Building) =>
      `${building.id}:${building.x}:${building.y}:${building.widthInCells}x${building.heightInCells}:${building.hp > 0 ? 1 : 0}`;
    const signatureParts = cluster.filter(building => building.hp > 0).map(geometryOf).sort();
    const compoundSignature = signatureParts.join('|');
    const cachedRoute = this.defenseOrbitRoutes.get(station.id);

    const obstacleGeometry = (building: Building) =>
      `${building.x}:${building.y}:${building.widthInCells}x${building.heightInCells}:${building.hp > 0 ? 1 : 0}`;
    const ellipseIntersectsBuilding = (
      centerX: number, centerY: number, radiusX: number, radiusY: number, obstacle: Building
    ) => {
      if (obstacle.hp <= 0) return false;
      const physicalClearance = (AIR_BUILDING_CLEARANCE_CELLS + 1) * GRID_SIZE + 18;
      const obstacleHalfW = ((obstacle.widthInCells || 1) * GRID_SIZE) * 0.5 + physicalClearance;
      const obstacleHalfH = ((obstacle.heightInCells || 1) * GRID_SIZE) * 0.5 + physicalClearance;
      if (Math.abs(obstacle.x - centerX) > radiusX + obstacleHalfW ||
          Math.abs(obstacle.y - centerY) > radiusY + obstacleHalfH) return false;
      // Sampling is done only when the compound changes or a structure's
      // geometry is new/changed. It never runs once per movement frame.
      const samples = 144;
      for (let sample = 0; sample < samples; sample++) {
        const phase = sample / samples * Math.PI * 2;
        const x = centerX + Math.cos(phase) * radiusX;
        const y = centerY + Math.sin(phase) * radiusY;
        if (Math.abs(x - obstacle.x) < obstacleHalfW && Math.abs(y - obstacle.y) < obstacleHalfH) return true;
      }
      return false;
    };

    if (cachedRoute && cachedRoute.compoundSignature === compoundSignature) {
      let changedObstacleIntersectsRing = false;
      const currentGeometry = new Map<string, string>();
      for (const building of allBuildings) {
        if (building.hp <= 0) continue;
        const geometry = obstacleGeometry(building);
        currentGeometry.set(building.id, geometry);
        if (cachedRoute.knownBuildingGeometry.get(building.id) === geometry) continue;
        if (ellipseIntersectsBuilding(cachedRoute.centerX, cachedRoute.centerY,
          cachedRoute.radiusX, cachedRoute.radiusY, building)) {
          changedObstacleIntersectsRing = true;
          break;
        }
      }
      if (!changedObstacleIntersectsRing) {
        // A distant outpost/building should not reset every patrol route. Keep
        // the same ellipse when only unrelated world geometry has changed.
        cachedRoute.knownBuildingGeometry = currentGeometry;
        return cachedRoute;
      }
    }

    let minX = station.x;
    let maxX = station.x;
    let minY = station.y;
    let maxY = station.y;
    for (const building of cluster) {
      if (building.hp <= 0) continue;
      const halfW = ((building.widthInCells || 1) * GRID_SIZE) / 2;
      const halfH = ((building.heightInCells || 1) * GRID_SIZE) / 2;
      minX = Math.min(minX, building.x - halfW);
      maxX = Math.max(maxX, building.x + halfW);
      minY = Math.min(minY, building.y - halfH);
      maxY = Math.max(maxY, building.y + halfH);
    }

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const halfWidth = (maxX - minX) * 0.5;
    const halfHeight = (maxY - minY) * 0.5;
    const physicalClearance = (AIR_BUILDING_CLEARANCE_CELLS + 1) * GRID_SIZE + 18;
    const safeHalfWidth = halfWidth + Math.max(droneStationBehavior.defenseOrbitPaddingX, physicalClearance);
    const safeHalfHeight = halfHeight + Math.max(droneStationBehavior.defenseOrbitPaddingY, physicalClearance);
    let radiusX = Math.max(265, safeHalfWidth * 1.68);
    let radiusY = Math.max(238, safeHalfHeight * 1.68);

    const routeIsClear = () => allBuildings.every(obstacle =>
      !ellipseIntersectsBuilding(centerX, centerY, radiusX, radiusY, obstacle));
    for (let attempt = 0; attempt < 40 && !routeIsClear(); attempt++) {
      radiusX += 22;
      radiusY += 22;
    }

    const route: DefenseOrbitRoute = {
      // Only actual flight geometry participates in the route version. Changes
      // to non-intersecting buildings or harmless IDs do not trigger a reset.
      signature: `${centerX.toFixed(2)}:${centerY.toFixed(2)}:${radiusX.toFixed(1)}:${radiusY.toFixed(1)}`,
      compoundSignature,
      knownBuildingGeometry: new Map(allBuildings.filter(building => building.hp > 0).map(building => [building.id, obstacleGeometry(building)])),
      centerX,
      centerY,
      radiusX,
      radiusY,
      angularSpeed: droneStationBehavior.formationSpeed / Math.max(265, (radiusX + radiusY) * 0.5)
    };
    this.defenseOrbitRoutes.set(station.id, route);
    return route;
  }

  protected override advanceEllipsePhase(phase: number, radiusX: number, radiusY: number, linearSpeed: number, dt: number) {
    const tangentLength = Math.hypot(radiusX * Math.sin(phase), radiusY * Math.cos(phase));
    return phase + (Math.max(0, linearSpeed) / Math.max(1, tangentLength)) * Math.max(0, dt);
  }

  /** Smooth diagnostic/steering waypoint output independently from physical motion. */
  protected override updateSmoothedFlightGoal(drone: GameEntity, targetX: number, targetY: number, dt: number, goalSpeed: number) {
    if (!Number.isFinite(drone.droneFlightGoalX) || !Number.isFinite(drone.droneFlightGoalY)) {
      drone.droneFlightGoalX = drone.x;
      drone.droneFlightGoalY = drone.y;
    }
    const currentX = drone.droneFlightGoalX!;
    const currentY = drone.droneFlightGoalY!;
    const dx = targetX - currentX;
    const dy = targetY - currentY;
    const gap = Math.hypot(dx, dy);
    const maxStep = Math.max(0, goalSpeed) * Math.max(0, dt);
    if (gap <= maxStep || gap < 0.001) {
      drone.droneFlightGoalX = targetX;
      drone.droneFlightGoalY = targetY;
      return;
    }
    const blend = maxStep / gap;
    drone.droneFlightGoalX = currentX + dx * blend;
    drone.droneFlightGoalY = currentY + dy * blend;
  }

  protected override clearDroneNavigation(drone: GameEntity) {
    // A late worker result from a previous AI state must never restore its stale
    // waypoint after this drone has switched between patrol and attack.
    invalidateEntityPathRequest(drone);
    drone.flightPathActive = false;
    drone.droneFlightEscapingClearance = false;
    drone.droneFlightPathNoProgressSeconds = 0;
    drone.path = [];
    drone.pathIndex = 0;
    drone.pathTargetX = undefined;
    drone.pathTargetY = undefined;
    drone.pathRecalcTimer = 0;
    drone.stuckTimer = 0;
  }

  /**
   * Computes an orbit that avoids physical building footprints. The check is
   * sampled around the entire orbit and only called when a target/geometry changes,
   * not once per frame. Increasing both radii keeps the path smooth and simple.
   */
  protected override getClearCombatOrbit(
    centerX: number,
    centerY: number,
    baseRadiusX: number,
    baseRadiusY: number,
    buildings: Building[],
    maxRadius = Number.POSITIVE_INFINITY
  ): { radiusX: number; radiusY: number } | undefined {
    let radiusX = Math.max(36, baseRadiusX);
    let radiusY = Math.max(32, baseRadiusY);
    const samples = 96;
    const isClear = () => {
      for (const building of buildings) {
        if (building.hp <= 0) continue;
        const flightClearance = AIR_BUILDING_CLEARANCE_CELLS * GRID_SIZE + GRID_SIZE / 2 + 12;
        const halfW = ((building.widthInCells || 1) * GRID_SIZE) * 0.5 + flightClearance;
        const halfH = ((building.heightInCells || 1) * GRID_SIZE) * 0.5 + flightClearance;
        // Quickly skip structures that cannot intersect the orbit's bounding box.
        if (Math.abs(building.x - centerX) > radiusX + halfW || Math.abs(building.y - centerY) > radiusY + halfH) continue;
        for (let sample = 0; sample < samples; sample++) {
          const phase = (sample / samples) * Math.PI * 2;
          const x = centerX + Math.cos(phase) * radiusX;
          const y = centerY + Math.sin(phase) * radiusY;
          if (Math.abs(x - building.x) < halfW && Math.abs(y - building.y) < halfH) return false;
        }
      }
      return true;
    };

    for (let attempt = 0; attempt < 32; attempt++) {
      if (Math.max(radiusX, radiusY) > maxRadius) return undefined;
      if (isClear()) return { radiusX, radiusY };
      radiusX += 18;
      radiusY += 18;
    }
    return undefined;
  }
}
