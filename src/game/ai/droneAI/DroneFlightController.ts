import type { Building, GameEntity, ResourceNode } from '../../types';
import { maintainDronePath, getNavigationPoint, invalidateDroneFlightPath } from './DroneFlightPathPlanner';
import { DRONE_FLIGHT_TUNING } from './DroneFlightTuning';
export { DRONE_FLIGHT_TUNING } from './DroneFlightTuning';
import { moveWithGridCollisionSubstepped } from '../../movement/collision';
import { measurePerformance } from '../../performance/PerformanceDiagnostics';

export interface DroneFlightCenter {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface DroneFlightPhysicsInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  centerX: number;
  centerY: number;
  centerVx?: number;
  centerVy?: number;
  radius: number;
  orbitSpeed: number;
  orbitDirection: -1 | 1;
  phase: number;
  waypointX: number;
  waypointY: number;
  /** When A* supplied a real waypoint, steer velocity toward it instead of cutting across the orbit. */
  followWaypoint?: boolean;
}

export interface DroneFlightAcceleration { ax: number; ay: number }

/**
 * One second-order steering law used for every drone destination: patrol, escort,
 * target interception, and A* waypoints. The radius term is a radial spring; the
 * tangential term maintains orbit speed; the waypoint term bends that same motion
 * around obstacles. No branch directly assigns position or velocity.
 */
export function calculateDroneFlightAcceleration(input: DroneFlightPhysicsInput): DroneFlightAcceleration {
  const numericInputs = [input.x, input.y, input.vx, input.vy, input.centerX, input.centerY,
    input.centerVx ?? 0, input.centerVy ?? 0, input.radius, input.orbitSpeed, input.phase,
    input.waypointX, input.waypointY];
  if (!numericInputs.every(Number.isFinite)) {
    throw new RangeError('Drone flight acceleration received non-finite state or tuning values.');
  }
  if (input.radius <= 0 || input.orbitSpeed < 0 ||
      (input.orbitDirection !== -1 && input.orbitDirection !== 1)) {
    throw new RangeError('Drone flight acceleration received an invalid radius, speed, or orbit direction.');
  }
  const dx = input.x - input.centerX;
  const dy = input.y - input.centerY;
  const radialDistance = Math.hypot(dx, dy);
  const radialX = radialDistance > 1e-4 ? dx / radialDistance : Math.cos(input.phase);
  const radialY = radialDistance > 1e-4 ? dy / radialDistance : Math.sin(input.phase);
  const tangentX = -radialY * input.orbitDirection;
  const tangentY = radialX * input.orbitDirection;
  const waypointDx = input.waypointX - input.x;
  const waypointDy = input.waypointY - input.y;
  const waypointDistance = Math.hypot(waypointDx, waypointDy);
  let desiredVx = (input.centerVx ?? 0) * DRONE_FLIGHT_TUNING.centerVelocityGain + tangentX * input.orbitSpeed;
  let desiredVy = (input.centerVy ?? 0) * DRONE_FLIGHT_TUNING.centerVelocityGain + tangentY * input.orbitSpeed;
  let radialSpringScale = 1;
  if (input.followWaypoint && waypointDistance > 1e-4) {
    // On a detour, the A* corridor must take priority over the orbit tangent.
    // Otherwise the orbit force pulls through the obstacle while the waypoint
    // only weakly attracts the drone sideways, producing wall-hugging forever.
    desiredVx = (input.centerVx ?? 0) * DRONE_FLIGHT_TUNING.centerVelocityGain
      + waypointDx / waypointDistance * input.orbitSpeed;
    desiredVy = (input.centerVy ?? 0) * DRONE_FLIGHT_TUNING.centerVelocityGain
      + waypointDy / waypointDistance * input.orbitSpeed;
    radialSpringScale = 0.25;
  }

  const ax = (desiredVx - input.vx) * DRONE_FLIGHT_TUNING.tangentVelocityGain
    + radialX * (input.radius - radialDistance) * DRONE_FLIGHT_TUNING.radialSpringGain * radialSpringScale
    + waypointDx * DRONE_FLIGHT_TUNING.waypointAttractionGain
    - input.vx * DRONE_FLIGHT_TUNING.dampingGain;
  const ay = (desiredVy - input.vy) * DRONE_FLIGHT_TUNING.tangentVelocityGain
    + radialY * (input.radius - radialDistance) * DRONE_FLIGHT_TUNING.radialSpringGain * radialSpringScale
    + waypointDy * DRONE_FLIGHT_TUNING.waypointAttractionGain
    - input.vy * DRONE_FLIGHT_TUNING.dampingGain;
  return { ax, ay };
}

/** One flight tick. The center position is consumed fresh every call, not cached. */
export function updateDroneFlight(
  drone: GameEntity,
  center: DroneFlightCenter,
  radius: number,
  orbitSpeed: number,
  maxSpeed: number,
  maxAcceleration: number,
  dt: number,
  buildings: Building[],
  resources: ResourceNode[],
  nowSeconds = 0
): { ax: number; ay: number; waypointX: number; waypointY: number; phase: number } {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError(`Drone '${drone.id}' received invalid flight delta: ${dt}.`);
  }
  if (![drone.x, drone.y, drone.vx, drone.vy, center.x, center.y].every(Number.isFinite)) {
    throw new RangeError(`Drone '${drone.id}' has non-finite position, velocity, or centre coordinates.`);
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`Drone '${drone.id}' received invalid orbit radius: ${radius}.`);
  }
  if (!Number.isFinite(orbitSpeed) || orbitSpeed < 0 || !Number.isFinite(maxSpeed) || maxSpeed < 0 ||
      !Number.isFinite(maxAcceleration) || maxAcceleration < 0) {
    throw new RangeError(`Drone '${drone.id}' received invalid flight tuning values.`);
  }
  const centerVx = center.vx ?? 0;
  const centerVy = center.vy ?? 0;
  if (!Number.isFinite(centerVx) || !Number.isFinite(centerVy)) {
    throw new RangeError(`Drone '${drone.id}' has non-finite centre velocity.`);
  }
  // Do not silently discard elapsed simulation time. The authoritative engine
  // normally supplies <= 1/30 s; unusual callers still receive the full delta.
  const storedRefreshTimer = drone.droneFlightPathRefreshTimer ?? 0;
  if (!Number.isFinite(storedRefreshTimer) || storedRefreshTimer < 0) {
    throw new RangeError(`Drone '${drone.id}' has an invalid flight path refresh timer: ${storedRefreshTimer}.`);
  }
  const safeDt = dt;
  drone.droneFlightPathRefreshTimer = storedRefreshTimer + safeDt;
  if (drone.droneFlightCenterId !== center.id) {
    invalidateDroneFlightPath(drone);
    drone.droneFlightCenterId = center.id;
    drone.droneFlightPlannedX = undefined;
    drone.droneFlightPlannedY = undefined;
    drone.path = [];
    drone.pathIndex = 0;
    drone.flightPathActive = false;
    drone.droneFlightPathRefreshTimer = DRONE_FLIGHT_TUNING.routeRefreshSeconds;
    drone.droneFlightPathNeedsAStar = undefined;
    drone.droneFlightEscapingClearance = false;
    drone.droneFlightPathNoProgressSeconds = 0;
    drone.droneFlightPhase = undefined;
  }
  const storedPhase = drone.droneFlightPhase;
  let phase = typeof storedPhase === 'number' && Number.isFinite(storedPhase)
    ? storedPhase
    : Math.atan2(drone.y - center.y, drone.x - center.x);
  let direction = drone.droneFlightOrbitDirection;
  if (direction !== -1 && direction !== 1) {
    let hash = 0;
    for (let i = 0; i < drone.id.length; i++) hash = (hash * 31 + drone.id.charCodeAt(i)) >>> 0;
    direction = (hash & 1) === 0 ? 1 : -1;
    drone.droneFlightOrbitDirection = direction;
  }
  const safeRadius = Math.max(36, radius);
  const safeSpeed = Math.max(0, Math.min(orbitSpeed, maxSpeed));
  phase = (phase + direction * safeSpeed / safeRadius * safeDt) % (Math.PI * 2);
  if (phase < 0) phase += Math.PI * 2;
  drone.droneFlightPhase = phase;

  const targetPhase = phase + direction * DRONE_FLIGHT_TUNING.routeLookAheadRadians;
  const goalX = center.x + Math.cos(targetPhase) * safeRadius;
  const goalY = center.y + Math.sin(targetPhase) * safeRadius;
  drone.droneFlightGoalX = goalX;
  drone.droneFlightGoalY = goalY;
  measurePerformance('drone.pathPlanner.maintain', () =>
    maintainDronePath(drone, goalX, goalY, buildings, resources, nowSeconds),
    { droneId: drone.id, buildingCount: buildings.length }
  );
  const waypoint = getNavigationPoint(drone, goalX, goalY);
  const pathIndex = drone.pathIndex ?? 0;
  const hasUsablePath = Boolean(drone.path?.length && pathIndex < drone.path.length);
  const waitingForPath = drone.droneFlightPathNeedsAStar === true && !hasUsablePath;
  // A missing/pending/failed route must not keep applying orbit thrust toward a
  // blocked target. Preserve the exact radial distance as the temporary hold
  // radius, zero the centre feed-forward, and let the same damped controller brake.
  const controllerRadius = waitingForPath
    ? Math.max(0.001, Math.hypot(drone.x - center.x, drone.y - center.y))
    : safeRadius;
  const acceleration = calculateDroneFlightAcceleration({
    x: drone.x, y: drone.y, vx: drone.vx, vy: drone.vy,
    centerX: center.x, centerY: center.y,
    centerVx: waitingForPath ? 0 : (center.vx ?? 0),
    centerVy: waitingForPath ? 0 : (center.vy ?? 0),
    radius: controllerRadius, orbitSpeed: waitingForPath ? 0 : safeSpeed,
    orbitDirection: direction, phase,
    waypointX: waitingForPath ? drone.x : waypoint.x,
    waypointY: waitingForPath ? drone.y : waypoint.y,
    followWaypoint: hasUsablePath
  });
  const accelerationLength = Math.hypot(acceleration.ax, acceleration.ay);
  const accelerationScale = accelerationLength > maxAcceleration && accelerationLength > 0
    ? maxAcceleration / accelerationLength : 1;
  const ax = acceleration.ax * accelerationScale;
  const ay = acceleration.ay * accelerationScale;
  let nextVx = drone.vx + ax * safeDt;
  let nextVy = drone.vy + ay * safeDt;
  const currentSpeed = Math.hypot(nextVx, nextVy);
  const speedLimit = Math.max(0, maxSpeed);
  if (currentSpeed > speedLimit && currentSpeed > 0) {
    nextVx *= speedLimit / currentSpeed;
    nextVy *= speedLimit / currentSpeed;
  }
  if (safeDt > 0) {
    const beforeX = drone.x;
    const beforeY = drone.y;
    measurePerformance('drone.flight.collisionIntegration', () =>
      moveWithGridCollisionSubstepped(drone, beforeX + nextVx * safeDt, beforeY + nextVy * safeDt, buildings, resources),
      { droneId: drone.id, buildingCount: buildings.length }
    );
    drone.vx = (drone.x - beforeX) / safeDt;
    drone.vy = (drone.y - beforeY) / safeDt;
    if (Math.hypot(drone.vx, drone.vy) > 1) drone.angle = Math.atan2(drone.vy, drone.vx);

    if (hasUsablePath) {
      const beforeWaypointDistance = Math.hypot(waypoint.x - beforeX, waypoint.y - beforeY);
      const afterWaypointDistance = Math.hypot(waypoint.x - drone.x, waypoint.y - drone.y);
      const madeRouteProgress = beforeWaypointDistance - afterWaypointDistance > 0.25;
      const noProgressSeconds = madeRouteProgress
        ? 0
        : (drone.droneFlightPathNoProgressSeconds ?? 0) + safeDt;
      if (!Number.isFinite(noProgressSeconds) || noProgressSeconds < 0) {
        throw new RangeError(`Drone '${drone.id}' has an invalid path-progress timer: ${noProgressSeconds}.`);
      }
      drone.droneFlightPathNoProgressSeconds = noProgressSeconds;
      // A valid route should keep reducing distance to its next waypoint. A short
      // grace period allows turns and momentum to settle; after that, stop pushing
      // against a blocked/mismatched segment and request a fresh route.
      if (noProgressSeconds >= 0.65) {
        invalidateDroneFlightPath(drone);
        drone.path = [];
        drone.pathIndex = 0;
        drone.flightPathActive = false;
        drone.droneFlightEscapingClearance = false;
        drone.droneFlightPlannedX = undefined;
        drone.droneFlightPlannedY = undefined;
        drone.droneFlightPathRefreshTimer = Math.max(
          drone.droneFlightPathRefreshTimer ?? 0,
          DRONE_FLIGHT_TUNING.routeRefreshSeconds
        );
        drone.droneFlightPathNoProgressSeconds = 0;
        const diagnosticNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const lastWarning = drone.droneFlightStallWarningAtMs ?? Number.NEGATIVE_INFINITY;
        if (diagnosticNow - lastWarning >= 5_000) {
          drone.droneFlightStallWarningAtMs = diagnosticNow;
          console.warn('[navigation] Drone stopped making physical progress toward an A* waypoint; the route was invalidated for replanning.', {
            droneId: drone.id,
            x: drone.x,
            y: drone.y,
            waypointX: waypoint.x,
            waypointY: waypoint.y,
            waypointDistance: afterWaypointDistance,
            noProgressSeconds
          });
        }
      }
    } else {
      drone.droneFlightPathNoProgressSeconds = 0;
    }
  }
  return { ax, ay, waypointX: waypoint.x, waypointY: waypoint.y, phase };
}

