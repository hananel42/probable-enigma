import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import { moveEntityTowardSmoothly } from '../../movement';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import { DroneAIFlightExecution } from './DroneAIFlightExecution';

export const DRONE_ORBIT_ENTRY_DISTANCE = 112;
export const DRONE_ORBIT_CAPTURE_DISTANCE = 44;
export const DRONE_ORBIT_STALL_SECONDS = 1.1;
export const DRONE_ORBIT_PENDING_STALL_SECONDS = 3.2;
export const DRONE_ORBIT_RETRY_PHASE_STEP = Math.PI / 3;

/** Shared, low-frequency recovery for drones trapped in the wider air-clearance grid. */
export abstract class DroneAIOrbitRecovery extends DroneAIFlightExecution {
  protected clearDroneSafeHoverRecovery(drone: GameEntity): void {
    drone.droneSafeTargetX = undefined;
    drone.droneSafeTargetY = undefined;
    drone.droneSafeTargetRetryTimer = 0;
    drone.droneSafeTargetRetryCount = 0;
  }

  protected beginDroneSafeHoverRecovery(
    drone: GameEntity,
    buildings: Building[],
    nowSeconds: number
  ): void {
    const blockedCells = this.getAirObstacleCells(buildings, nowSeconds);
    // Search around the aircraft, not the distant orbit waypoint. That gets the
    // unit out of a blocked start cell before asking A* to navigate from it.
    const target = this.findSafeHoverTarget(
      drone.x, drone.y, drone.x, drone.y, blockedCells, buildings
    );
    drone.droneSafeTargetX = target.x;
    drone.droneSafeTargetY = target.y;
    drone.droneSafeTargetRetryTimer = 0;
    drone.droneSafeTargetRetryCount = 0;
  }

  /**
   * Moves a trapped drone into a legal air-grid cell before resuming its route.
   * This uses ordinary collision-aware movement; it never teleports through a
   * structure. Returns true while this recovery movement owns the current tick.
   */
  protected moveDroneTowardSafeHoverTarget(
    drone: GameEntity,
    originalGoal: { x: number; y: number },
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    maxSpeed: number,
    nowSeconds: number
  ): boolean {
    const targetX = drone.droneSafeTargetX;
    const targetY = drone.droneSafeTargetY;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;

    const obstacles = this.getAirObstacleCells(buildings, nowSeconds);
    const gx = Math.floor(drone.x / GRID_SIZE);
    const gy = Math.floor(drone.y / GRID_SIZE);
    const currentCellBlocked = this.isAirCellBlocked(gx, gy, obstacles);
    const targetDistance = distance(drone.x, drone.y, targetX!, targetY!);
    const originalGoalClear = !currentCellBlocked && !this.isDirectAirRouteBlocked(
      drone.x, drone.y, originalGoal.x, originalGoal.y, obstacles
    );
    if (!currentCellBlocked && (targetDistance <= GRID_SIZE * 0.55 || originalGoalClear)) {
      this.clearDroneSafeHoverRecovery(drone);
      return false;
    }

    const beforeX = drone.x;
    const beforeY = drone.y;
    moveEntityTowardSmoothly(
      drone, targetX!, targetY!, buildings, resources, dt, maxSpeed,
      droneStationBehavior.acceleration, droneStationBehavior.arrivalSlowdownDistance
    );
    const progress = distance(beforeX, beforeY, drone.x, drone.y);
    drone.droneSafeTargetRetryTimer = progress > 0.65
      ? 0
      : (drone.droneSafeTargetRetryTimer || 0) + Math.max(0, dt);

    // If a physical obstacle prevents this escape point, sample another nearby
    // point only after sustained failure. A deterministic angular sequence makes
    // retries reproducible and avoids selecting the same blocked cell forever.
    if ((drone.droneSafeTargetRetryTimer || 0) >= DRONE_ORBIT_STALL_SECONDS) {
      const retry = (drone.droneSafeTargetRetryCount || 0) + 1;
      drone.droneSafeTargetRetryCount = retry;
      const angle = retry * 2.399963229728653;
      const searchX = drone.x + Math.cos(angle) * GRID_SIZE * (2 + retry % 3);
      const searchY = drone.y + Math.sin(angle) * GRID_SIZE * (2 + retry % 3);
      const retryTarget = this.findSafeHoverTarget(
        searchX, searchY, drone.x, drone.y, obstacles, buildings
      );
      drone.droneSafeTargetX = retryTarget.x;
      drone.droneSafeTargetY = retryTarget.y;
      drone.droneSafeTargetRetryTimer = 0;
    }
    return true;
  }
}
