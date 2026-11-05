import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import { isEntityPathPending, moveEntityAlongPath, moveEntityTowardSmoothly } from '../../movement';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import type { DroneFlightCurve } from './model';
import {
  DRONE_ORBIT_CAPTURE_DISTANCE,
  DRONE_ORBIT_ENTRY_DISTANCE,
  DRONE_ORBIT_PENDING_STALL_SECONDS,
  DRONE_ORBIT_RETRY_PHASE_STEP,
  DRONE_ORBIT_STALL_SECONDS,
  DroneAIOrbitRecovery
} from './DroneAIOrbitRecovery';

/** Owns orbit capture, obstacle-aware entry and recovery from stalled approaches. */
export abstract class DroneAIOrbitNavigation extends DroneAIOrbitRecovery {
  protected updateDroneOrbitNavigation(
    drone: GameEntity,
    flightCurve: DroneFlightCurve,
    mode: 'COMBAT' | 'ESCORT',
    targetKey: string,
    orbitPhase: number,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    maxSpeed: number,
    nowSeconds: number
  ): { x: number; y: number } {
    let desiredX = drone.x;
    let desiredY = drone.y;
    const proposedTarget = this.pointOnCurve(flightCurve, flightCurve.phase);
    let obstacles = this.getAirObstacleCells(buildings, nowSeconds);
    let currentCellBlocked = this.isAirCellBlocked(
      Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), obstacles
    );
    let enteringOrbit = Boolean(drone.droneOrbitApproachActive &&
      drone.droneOrbitApproachMode === mode && drone.droneOrbitApproachTargetId === targetKey);

    if (drone.droneOrbitApproachActive && !enteringOrbit) {
      drone.droneOrbitApproachActive = false;
      drone.droneOrbitApproachTargetId = null;
      drone.droneOrbitApproachStallTimer = 0;
      this.clearDroneSafeHoverRecovery(drone);
      this.clearDroneNavigation(drone);
    }

    const proposedTargetDistance = distance(drone.x, drone.y, proposedTarget.x, proposedTarget.y);
    const proposedRouteBlocked = currentCellBlocked || this.isDirectAirRouteBlocked(
      drone.x, drone.y, proposedTarget.x, proposedTarget.y, obstacles
    );
    if (!enteringOrbit && (proposedRouteBlocked || proposedTargetDistance > DRONE_ORBIT_ENTRY_DISTANCE)) {
      // Capture one stable point on the ellipse. Holding its phase prevents a
      // moving waypoint from creating abrupt turns or making the destination recede.
      enteringOrbit = true;
      drone.droneOrbitApproachActive = true;
      drone.droneOrbitApproachMode = mode;
      drone.droneOrbitApproachTargetId = targetKey;
      drone.droneOrbitApproachPhase = orbitPhase;
      drone.droneOrbitApproachStallTimer = 0;
      this.clearDroneSafeHoverRecovery(drone);
      this.clearDroneNavigation(drone);
    }

    if (!enteringOrbit) {
      const curveResult = this.moveDroneOnCurve(drone, flightCurve, dt, buildings, resources, maxSpeed);
      drone.stuckTimer = curveResult.moved ? 0 : (drone.stuckTimer || 0) + dt;
      return curveResult.target;
    }

    const fixedPhase = drone.droneOrbitApproachPhase ?? orbitPhase;
    const approachCurve = { ...flightCurve, phase: fixedPhase };
    const approachTarget = this.pointOnCurve(approachCurve, fixedPhase);
    desiredX = approachTarget.x;
    desiredY = approachTarget.y;
    const beforeX = drone.x;
    const beforeY = drone.y;
    const recoveryOwnsMovement = this.moveDroneTowardSafeHoverTarget(
      drone, approachTarget, buildings, resources, dt, maxSpeed, nowSeconds
    );

    if (recoveryOwnsMovement) {
      desiredX = drone.droneSafeTargetX ?? drone.x;
      desiredY = drone.droneSafeTargetY ?? drone.y;
      drone.droneOrbitApproachStallTimer = 0;
      return { x: desiredX, y: desiredY };
    }

    obstacles = this.getAirObstacleCells(buildings, nowSeconds);
    currentCellBlocked = this.isAirCellBlocked(
      Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), obstacles
    );
    const targetIsReachableDirectly = !currentCellBlocked && !this.isDirectAirRouteBlocked(
      drone.x, drone.y, approachTarget.x, approachTarget.y, obstacles
    );
    const distanceToEntry = distance(drone.x, drone.y, approachTarget.x, approachTarget.y);
    if (targetIsReachableDirectly && distanceToEntry <= DRONE_ORBIT_CAPTURE_DISTANCE) {
      // Join close to the exact curve point. Curve tangent velocity and normal
      // acceleration blend the entry into orbit without snapping or full stops.
      drone.droneOrbitApproachActive = false;
      drone.droneOrbitApproachTargetId = null;
      drone.droneOrbitApproachMode = undefined;
      drone.droneOrbitApproachPhase = undefined;
      drone.droneOrbitApproachStallTimer = 0;
      this.clearDroneSafeHoverRecovery(drone);
      this.clearDroneNavigation(drone);
      const curveResult = this.moveDroneOnCurve(drone, flightCurve, dt, buildings, resources, maxSpeed);
      return curveResult.target;
    }

    if (targetIsReachableDirectly) {
      // When the corridor is clear, fly directly using acceleration-limited
      // steering instead of paying for A* or braking at intermediate waypoints.
      moveEntityTowardSmoothly(
        drone, approachTarget.x, approachTarget.y, buildings, resources, dt, maxSpeed,
        droneStationBehavior.acceleration, droneStationBehavior.arrivalSlowdownDistance
      );
    } else {
      moveEntityAlongPath(drone, approachTarget.x, approachTarget.y, buildings, resources, dt, 12, maxSpeed, 'smooth');
      if (dt > 0) {
        drone.vx = (drone.x - beforeX) / dt;
        drone.vy = (drone.y - beforeY) / dt;
      }
      if (Math.hypot(drone.vx, drone.vy) > 1) drone.angle = Math.atan2(drone.vy, drone.vx);
    }

    if (drone.droneOrbitApproachActive) {
      const progress = Math.hypot(drone.x - beforeX, drone.y - beforeY);
      const pathPending = !targetIsReachableDirectly && isEntityPathPending(drone);
      const remainingGap = distance(drone.x, drone.y, approachTarget.x, approachTarget.y);
      if (progress > 0.65 || remainingGap <= DRONE_ORBIT_CAPTURE_DISTANCE) {
        drone.droneOrbitApproachStallTimer = 0;
      } else {
        drone.droneOrbitApproachStallTimer = (drone.droneOrbitApproachStallTimer || 0) + Math.max(0, dt);
      }
      const stallLimit = pathPending ? DRONE_ORBIT_PENDING_STALL_SECONDS : DRONE_ORBIT_STALL_SECONDS;
      if ((drone.droneOrbitApproachStallTimer || 0) >= stallLimit) {
        if (currentCellBlocked) {
          // A* cannot reliably begin inside the expanded clearance grid.
          this.beginDroneSafeHoverRecovery(drone, buildings, nowSeconds);
        } else {
          // Retry a different phase to avoid hammering the same inaccessible point.
          const nextPhase = ((drone.droneOrbitApproachPhase ?? orbitPhase) + DRONE_ORBIT_RETRY_PHASE_STEP) % (Math.PI * 2);
          drone.droneOrbitApproachPhase = nextPhase;
          if (mode === 'COMBAT') drone.droneCombatOrbitAngle = nextPhase;
          else drone.patrolAngle = nextPhase;
        }
        this.clearDroneNavigation(drone);
        drone.stuckTimer = 0;
        drone.droneOrbitApproachStallTimer = 0;
      }
    }

    return { x: desiredX, y: desiredY };
  }
}
