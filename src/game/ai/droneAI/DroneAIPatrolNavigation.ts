import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import { isEntityPathPending, moveEntityAlongPath, moveEntityTowardSmoothly } from '../../movement';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import type { DefenseOrbitRoute } from './model';
import {
  DRONE_ORBIT_PENDING_STALL_SECONDS,
  DRONE_ORBIT_RETRY_PHASE_STEP,
  DRONE_ORBIT_STALL_SECONDS
} from './DroneAIOrbitRecovery';
import { DroneAIOrbitNavigation } from './DroneAIOrbitNavigation';

/** Handles the one-time return from combat/embedded positions to the defense ellipse. */
export abstract class DroneAIPatrolNavigation extends DroneAIOrbitNavigation {
  protected updateDronePatrolEntry(
    drone: GameEntity,
    route: DefenseOrbitRoute,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    maxSpeed: number,
    nowSeconds: number
  ): { x: number; y: number } {
    const phase = drone.patrolAngle || 0;
    const target = {
      x: route.centerX + Math.cos(phase) * route.radiusX,
      y: route.centerY + Math.sin(phase) * route.radiusY
    };
    const gapBeforePath = distance(drone.x, drone.y, target.x, target.y);
    let movementGoal = target;
    const xBeforePath = drone.x;
    const yBeforePath = drone.y;
    const obstacles = this.getAirObstacleCells(buildings, nowSeconds);
    const currentCellBlocked = this.isAirCellBlocked(
      Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), obstacles
    );
    const directEntryIsClear = !currentCellBlocked && !this.isDirectAirRouteBlocked(
      drone.x, drone.y, target.x, target.y, obstacles
    );
    const recoveryOwnsMovement = this.moveDroneTowardSafeHoverTarget(
      drone, target, buildings, resources, dt, maxSpeed, nowSeconds
    );

    if (recoveryOwnsMovement) {
      movementGoal = {
        x: drone.droneSafeTargetX ?? drone.x,
        y: drone.droneSafeTargetY ?? drone.y
      };
    } else if (!directEntryIsClear) {
      moveEntityAlongPath(drone, target.x, target.y, buildings, resources, dt, 12, maxSpeed, 'smooth');
    } else {
      // Direct movement is safe after checking the whole corridor. It also avoids
      // worker latency for far-away but unobstructed return-to-patrol routes.
      moveEntityTowardSmoothly(
        drone, target.x, target.y, buildings, resources, dt, maxSpeed,
        droneStationBehavior.acceleration, droneStationBehavior.arrivalSlowdownDistance
      );
    }

    const progress = Math.hypot(drone.x - xBeforePath, drone.y - yBeforePath);
    const pathPending = !directEntryIsClear && isEntityPathPending(drone);
    if (progress > 0.65) {
      drone.stuckTimer = 0;
      drone.dronePatrolEntryStallTimer = 0;
    } else if (gapBeforePath > 5) {
      drone.dronePatrolEntryStallTimer = (drone.dronePatrolEntryStallTimer || 0) + Math.max(0, dt);
      if (directEntryIsClear) drone.stuckTimer = (drone.stuckTimer || 0) + dt;
    }

    const stallLimit = pathPending ? DRONE_ORBIT_PENDING_STALL_SECONDS : DRONE_ORBIT_STALL_SECONDS;
    if ((drone.dronePatrolEntryStallTimer || 0) >= stallLimit && gapBeforePath > 5) {
      if (currentCellBlocked) {
        this.beginDroneSafeHoverRecovery(drone, buildings, nowSeconds);
      } else {
        // Rephase so a failed route point cannot become a permanent destination.
        drone.patrolAngle = ((drone.patrolAngle || 0) + DRONE_ORBIT_RETRY_PHASE_STEP) % (Math.PI * 2);
        drone.dronePatrolOrbitInitialized = false;
      }
      this.clearDroneNavigation(drone);
      drone.stuckTimer = 0;
      drone.dronePatrolEntryStallTimer = 0;
    }

    if (distance(drone.x, drone.y, target.x, target.y) <= 5) {
      drone.dronePatrolOrbitInitialized = true;
      drone.flightPathActive = false;
      drone.path = [];
      drone.pathIndex = 0;
      drone.pathRecalcTimer = 0;
      drone.stuckTimer = 0;
      drone.dronePatrolEntryStallTimer = 0;
      this.clearDroneSafeHoverRecovery(drone);
      drone.patrolAngle = Math.atan2(
        (drone.y - route.centerY) / Math.max(1, route.radiusY),
        (drone.x - route.centerX) / Math.max(1, route.radiusX)
      );
    }

    return movementGoal;
  }
}
