import type { Building, GameEntity, PathWaypoint, ResourceNode } from '../../types';
import { AIR_BUILDING_CLEARANCE_CELLS, GRID_SIZE, distance, getBuildingOccupiedCells } from '../../rules';
import { findPath } from '../../pathfinding';
import { requestPathInWorker } from '../../runtime/asyncPathfinding';
import { DRONE_FLIGHT_TUNING } from './DroneFlightTuning';
import { measurePerformance } from '../../performance/PerformanceDiagnostics';
import { parsePathWaypointRoute } from '../../pathWaypointValidation';

/** A* lifecycle and obstacle-aware route cache for the unified drone flight controller. */
interface PendingDronePath {
  token: number;
  requestedX: number;
  requestedY: number;
  invalidated: boolean;
}
const pendingPaths = new WeakMap<GameEntity, PendingDronePath>();
const lastPathDiagnosticByDrone = new WeakMap<GameEntity, { key: string; timestampMs: number }>();
let nextPathToken = 1;
let reportedMissingWorker = false;
const BOUNDED_MAIN_THREAD_ASTAR_BUDGET = 650;

function reportPathProblem(drone: GameEntity, key: string, message: string, details: Record<string, unknown> = {}, error?: unknown): void {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const previous = lastPathDiagnosticByDrone.get(drone);
  if (previous?.key === key && nowMs - previous.timestampMs < 5_000) return;
  lastPathDiagnosticByDrone.set(drone, { key, timestampMs: nowMs });
  const payload = { droneId: drone.id, x: drone.x, y: drone.y, ...details };
  if (error !== undefined) console.error(message, payload, error);
  else console.warn(message, payload);
}

interface AirGridCache {
  length: number;
  expiresAt: number;
  /** Expanded cells used by A* to preserve clearance from structures. */
  cells: Set<string>;
  /** Actual occupied building cells, used to connect a drone already inside the clearance ring to A*. */
  solidCells: Set<string>;
}
const airGridCaches = new WeakMap<Building[], AirGridCache>();

function getAirGridData(buildings: Building[], nowSeconds: number, forceRefresh = false): AirGridCache {
  const cached = airGridCaches.get(buildings);
  if (!forceRefresh && cached && cached.length === buildings.length && nowSeconds < cached.expiresAt) return cached;
  const cells = new Set<string>();
  const solidCells = new Set<string>();
  for (const building of buildings) {
    if (building.hp <= 0) continue;
    for (const cell of getBuildingOccupiedCells(building)) {
      solidCells.add(`${cell.gx},${cell.gy}`);
      for (let dx = -AIR_BUILDING_CLEARANCE_CELLS; dx <= AIR_BUILDING_CLEARANCE_CELLS; dx++) {
        for (let dy = -AIR_BUILDING_CLEARANCE_CELLS; dy <= AIR_BUILDING_CLEARANCE_CELLS; dy++) {
          cells.add(`${cell.gx + dx},${cell.gy + dy}`);
        }
      }
    }
  }
  const result = { length: buildings.length, expiresAt: nowSeconds + 0.4, cells, solidCells };
  airGridCaches.set(buildings, result);
  return result;
}

function getAirGrid(buildings: Building[], nowSeconds: number): Set<string> {
  return getAirGridData(buildings, nowSeconds).cells;
}

interface ClearanceSearchNode { gx: number; gy: number; parentIndex: number; depth: number }

/**
 * Build a physically connected, short escape route when a drone starts within the
 * expanded A* clearance ring but outside the actual building footprint. The generic
 * A* routine relocates blocked start cells to a free cell without connecting that
 * relocation to the drone's real position; steering directly to that cell can push
 * the drone into the intervening wall. This bounded BFS traverses only real free
 * footprint cells until it exits the clearance ring, then ordinary A* can take over.
 */
function findClearanceEscapePath(
  drone: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  nowSeconds: number
): PathWaypoint[] | null {
  const grid = getAirGridData(buildings, nowSeconds);
  const startGx = Math.floor(drone.x / GRID_SIZE);
  const startGy = Math.floor(drone.y / GRID_SIZE);
  const keyOf = (gx: number, gy: number) => `${gx},${gy}`;
  const startKey = keyOf(startGx, startGy);
  if (!grid.cells.has(startKey)) return [];
  if (grid.solidCells.has(startKey)) return null; // Embedded recovery owns this case.

  const targetGx = Math.floor(targetX / GRID_SIZE);
  const targetGy = Math.floor(targetY / GRID_SIZE);
  const directions: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  directions.sort((a, b) => {
    const da = Math.abs(startGx + a[0] - targetGx) + Math.abs(startGy + a[1] - targetGy);
    const db = Math.abs(startGx + b[0] - targetGx) + Math.abs(startGy + b[1] - targetGy);
    return da - db;
  });

  const maxDepth = 32;
  const maxVisitedCells = 2_500;
  const nodes: ClearanceSearchNode[] = [{ gx: startGx, gy: startGy, parentIndex: -1, depth: 0 }];
  const visited = new Set<string>([startKey]);
  let exitIndex = -1;
  for (let head = 0; head < nodes.length && head < maxVisitedCells; head++) {
    const current = nodes[head];
    if (current.depth > 0 && !grid.cells.has(keyOf(current.gx, current.gy))) {
      exitIndex = head;
      break;
    }
    if (current.depth >= maxDepth) continue;
    for (const [dx, dy] of directions) {
      const gx = current.gx + dx;
      const gy = current.gy + dy;
      const key = keyOf(gx, gy);
      if (visited.has(key) || grid.solidCells.has(key)) continue;
      visited.add(key);
      nodes.push({ gx, gy, parentIndex: head, depth: current.depth + 1 });
      if (nodes.length >= maxVisitedCells) break;
    }
  }
  if (exitIndex < 0) return null;

  const reversed: PathWaypoint[] = [];
  let index = exitIndex;
  while (index >= 0) {
    const node = nodes[index];
    if (node.parentIndex < 0) break; // The drone's current cell is not a route target.
    reversed.push({
      gx: node.gx,
      gy: node.gy,
      x: node.gx * GRID_SIZE + GRID_SIZE / 2,
      y: node.gy * GRID_SIZE + GRID_SIZE / 2
    });
    index = node.parentIndex;
  }
  reversed.reverse();
  return reversed;
}

/** Use a cached grid corridor test to avoid scheduling A* for clear open-air travel. */
function isDroneAirSegmentBlocked(
  startX: number, startY: number, endX: number, endY: number,
  buildings: Building[], nowSeconds: number
): boolean {
  const cells = getAirGrid(buildings, nowSeconds);
  const dx = endX - startX;
  const dy = endY - startY;
  const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (GRID_SIZE * 0.35)));
  for (let step = 0; step <= samples; step++) {
    const t = step / samples;
    const gx = Math.floor((startX + dx * t) / GRID_SIZE);
    const gy = Math.floor((startY + dy * t) / GRID_SIZE);
    if (cells.has(`${gx},${gy}`)) return true;
  }
  return false;
}

function setDronePath(drone: GameEntity, route: PathWaypoint[], x: number, y: number): void {
  drone.path = route;
  drone.pathIndex = 0;
  drone.pathTargetX = x;
  drone.pathTargetY = y;
  drone.pathRecalcTimer = 0;
  drone.stuckTimer = 0;
  drone.pathRetryDelay = 0.8;
  drone.pathFailureCount = 0;
  drone.droneFlightPathNoProgressSeconds = 0;
  drone.flightPathActive = route.length > 0;
}

function validateWorkerRoute(route: unknown, drone: GameEntity): PathWaypoint[] {
  const waypoints = parsePathWaypointRoute(route, `A* worker route for drone '${drone.id}'`);
  let previous: PathWaypoint | undefined;

  for (const [index, waypoint] of waypoints.entries()) {
    const expectedX = waypoint.gx * GRID_SIZE + GRID_SIZE / 2;
    const expectedY = waypoint.gy * GRID_SIZE + GRID_SIZE / 2;
    if (Math.abs(waypoint.x - expectedX) > 0.01 || Math.abs(waypoint.y - expectedY) > 0.01) {
      throw new TypeError(`A* worker returned non-cell-centred waypoint ${index} for drone '${drone.id}'.`);
    }
    if (previous) {
      const gridDistance = Math.abs(waypoint.gx - previous.gx) + Math.abs(waypoint.gy - previous.gy);
      if (gridDistance !== 1) {
        throw new TypeError(`A* worker returned a discontinuous route at index ${index} for drone '${drone.id}'.`);
      }
    }
    previous = waypoint;
  }

  return waypoints;
}

function routeReachesTarget(
  route: PathWaypoint[], x: number, y: number, buildings: Building[], nowSeconds: number
): boolean {
  const last = route[route.length - 1];
  if (!last) return false;
  if (distance(last.x, last.y, x, y) <= GRID_SIZE * 2.25) return true;

  // findPath intentionally ends at the nearest open approach tile when a goal is
  // inside a building's inflated clearance ring. That is a complete route, not a
  // partial path; rejecting it leaves the drone repeatedly trying to reach the
  // physically impossible target point inside the wall/structure footprint.
  const grid = getAirGridData(buildings, nowSeconds, true);
  const targetKey = `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;
  const endKey = `${last.gx},${last.gy}`;
  if (!grid.cells.has(targetKey) || grid.cells.has(endKey)) return false;
  return distance(last.x, last.y, x, y) <= GRID_SIZE * (12 * Math.SQRT2 + 1);
}

function routeAvoidsCurrentObstacles(
  route: PathWaypoint[], buildings: Building[], nowSeconds: number, forceRefresh = false
): boolean {
  const blockedCells = getAirGridData(buildings, nowSeconds, forceRefresh).cells;
  return route.every(waypoint => !blockedCells.has(`${waypoint.gx},${waypoint.gy}`));
}

function increasePathRetryDelay(drone: GameEntity): void {
  const currentDelay = drone.pathRetryDelay ?? 0.8;
  if (!Number.isFinite(currentDelay) || currentDelay < 0) {
    throw new RangeError(`Drone '${drone.id}' has an invalid path retry delay: ${currentDelay}.`);
  }
  drone.pathRetryDelay = Math.min(3.5, Math.max(0.7, currentDelay * 1.4));
}

/**
 * Maintain a cached A* route. Browsers use the bounded worker scheduler; environments
 * without Worker use an explicit, tightly bounded synchronous search only on refresh.
 * At most one request per drone can be outstanding, preventing path queue flooding.
 */
export function maintainDronePath(
  drone: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[],
  nowSeconds: number
): void {
  const elapsed = drone.droneFlightPathRefreshTimer ?? 0;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    throw new RangeError(`Drone '${drone.id}' has an invalid path refresh timer: ${elapsed}.`);
  }

  const grid = getAirGridData(buildings, nowSeconds);
  const startGx = Math.floor(drone.x / GRID_SIZE);
  const startGy = Math.floor(drone.y / GRID_SIZE);
  const startKey = `${startGx},${startGy}`;
  const startInsideClearance = grid.cells.has(startKey);

  // Clearance escapes are their own short, physically connected route. Do not
  // replace them with a distant A* route until the drone actually leaves the ring.
  if (drone.droneFlightEscapingClearance) {
    const escapeIndex = drone.pathIndex ?? 0;
    if (drone.path?.length && escapeIndex < drone.path.length) {
      drone.droneFlightPathNeedsAStar = true;
      return;
    }
    drone.droneFlightEscapingClearance = false;
    drone.path = [];
    drone.pathIndex = 0;
    drone.flightPathActive = false;
    drone.droneFlightPlannedX = undefined;
    drone.droneFlightPlannedY = undefined;
    drone.droneFlightPathRefreshTimer = DRONE_FLIGHT_TUNING.routeRefreshSeconds;
  }

  const directIsBlocked = isDroneAirSegmentBlocked(drone.x, drone.y, targetX, targetY, buildings, nowSeconds);
  drone.droneFlightPathNeedsAStar = directIsBlocked;
  if (!directIsBlocked) {
    // A* is reserved for blocked corridors. Direct flight uses the exact same
    // acceleration/spring controller but avoids generating worker tasks in open air.
    drone.path = [];
    drone.pathIndex = 0;
    drone.flightPathActive = false;
    drone.droneFlightEscapingClearance = false;
    return;
  }

  // A physically embedded unit is moved by the shared, bounded recovery system.
  // Never ask A* to relocate its start cell across a wall and then steer directly there.
  if (grid.solidCells.has(startKey)) {
    drone.path = [];
    drone.pathIndex = 0;
    drone.flightPathActive = false;
    drone.droneFlightEscapingClearance = false;
    return;
  }

  if (startInsideClearance) {
    const escapePath = findClearanceEscapePath(drone, targetX, targetY, buildings, nowSeconds);
    if (escapePath?.length) {
      // An older long-range result must never replace this local connected route.
      // Keep its pending slot until it settles, but mark its result obsolete.
      invalidateDroneFlightPath(drone);
      setDronePath(drone, escapePath, targetX, targetY);
      drone.droneFlightEscapingClearance = true;
      drone.droneFlightPathNeedsAStar = true;
      drone.droneFlightPlannedX = undefined;
      drone.droneFlightPlannedY = undefined;
      return;
    }
    setDronePath(drone, [], targetX, targetY);
    drone.droneFlightEscapingClearance = false;
    drone.droneFlightPathRefreshTimer = 0;
    drone.droneFlightPlannedX = targetX;
    drone.droneFlightPlannedY = targetY;
    increasePathRetryDelay(drone);
    reportPathProblem(drone, 'clearance-escape-unavailable', `[navigation] Drone '${drone.id}' could not find a physically connected route out of the air-clearance ring; it will brake and retry.`, { targetX, targetY, visitedCellBudget: 2_500 });
    return;
  }

  if (drone.path?.length && !drone.droneFlightEscapingClearance &&
      !routeAvoidsCurrentObstacles(drone.path, buildings, nowSeconds)) {
    reportPathProblem(drone, 'cached-route-obstructed', `[navigation] Drone '${drone.id}' discarded an A* route intersecting the current obstacle grid.`, {
      targetX, targetY, pathLength: drone.path.length, buildingCount: buildings.length
    });
    drone.path = [];
    drone.pathIndex = 0;
    drone.flightPathActive = false;
    drone.droneFlightPlannedX = undefined;
    drone.droneFlightPlannedY = undefined;
    drone.droneFlightPathRefreshTimer = Math.max(elapsed, DRONE_FLIGHT_TUNING.routeRefreshSeconds);
  }

  const pathIndex = drone.pathIndex ?? 0;
  if (!Number.isInteger(pathIndex) || pathIndex < 0) throw new RangeError(`Drone '${drone.id}' has an invalid path index: ${pathIndex}.`);
  const hasPath = Boolean(drone.path?.length && pathIndex < drone.path.length);
  const completedRoute = Boolean(drone.path?.length && pathIndex >= drone.path.length);
  const targetMoved = drone.droneFlightPlannedX === undefined || drone.droneFlightPlannedY === undefined
    || distance(drone.droneFlightPlannedX, drone.droneFlightPlannedY, targetX, targetY) >= DRONE_FLIGHT_TUNING.routeGoalMoveThreshold;
  const pending = pendingPaths.get(drone);
  if (pending) {
    // A stale result is discarded by the promise handler if the requested goal no longer matches.
    return;
  }
  // A route consumed to a valid approach tile is complete for this unchanged
  // goal. Replanning it every retry interval makes drones orbit/press against the
  // same inaccessible destination instead of waiting for the goal to move.
  if (!targetMoved && (hasPath || completedRoute)) return;
  const configuredRetryDelay = drone.pathRetryDelay ?? 0;
  if (!Number.isFinite(configuredRetryDelay) || configuredRetryDelay < 0) {
    throw new RangeError(`Drone '${drone.id}' has an invalid path retry delay: ${configuredRetryDelay}.`);
  }
  const retryDelay = Math.max(DRONE_FLIGHT_TUNING.routeRefreshSeconds, configuredRetryDelay);
  if (elapsed < retryDelay) return;

  drone.droneFlightPathRefreshTimer = 0;
  drone.droneFlightPlannedX = targetX;
  drone.droneFlightPlannedY = targetY;
  const request: PendingDronePath = {
    token: nextPathToken++, requestedX: targetX, requestedY: targetY, invalidated: false
  };
  let promise: Promise<PathWaypoint[]> | null;
  try {
    promise = measurePerformance('drone.pathPlanner.workerSubmit', () =>
      requestPathInWorker(drone.x, drone.y, targetX, targetY, true, buildings, resources),
      { droneId: drone.id, buildingCount: buildings.length }
    );
  } catch (error) {
    // Worker startup/serialization errors are not converted into a silent empty route.
    setDronePath(drone, [], targetX, targetY);
    increasePathRetryDelay(drone);
    reportPathProblem(drone, 'worker-submit-failed', `[navigation] Drone '${drone.id}' could not submit its A* request; a bounded retry is scheduled.`, { targetX, targetY }, error);
    return;
  }

  if (!promise) {
    // Non-browser environments deliberately use a tightly bounded synchronous
    // search. Never allow the normal 6k-40k expansion budget to block a frame.
    if (!reportedMissingWorker) {
      reportedMissingWorker = true;
      console.warn('[navigation] Worker is unavailable; drone A* is using an explicit bounded main-thread search.', { maxExpandedNodes: BOUNDED_MAIN_THREAD_ASTAR_BUDGET });
    }
    const route = measurePerformance('drone.pathPlanner.boundedSynchronousAStar', () =>
      findPath(drone.x, drone.y, targetX, targetY, true, buildings, resources, BOUNDED_MAIN_THREAD_ASTAR_BUDGET),
      { droneId: drone.id, buildingCount: buildings.length, maxExpandedNodes: BOUNDED_MAIN_THREAD_ASTAR_BUDGET }
    );
    if (routeReachesTarget(route, targetX, targetY, buildings, nowSeconds) &&
        routeAvoidsCurrentObstacles(route, buildings, nowSeconds, true)) {
      setDronePath(drone, route, targetX, targetY);
    } else {
      setDronePath(drone, [], targetX, targetY);
      increasePathRetryDelay(drone);
      reportPathProblem(drone, 'bounded-search-no-route', `[navigation] Bounded A* did not find a complete route for drone '${drone.id}'; retry is scheduled without accepting a partial path.`, { targetX, targetY, maxExpandedNodes: BOUNDED_MAIN_THREAD_ASTAR_BUDGET });
    }
    return;
  }

  pendingPaths.set(drone, request);
  // Use an explicit fulfillment/rejection pair. A chained catch after the success
  // handler used to see the pending lock already deleted and quietly return if result
  // processing itself threw. That concealed malformed worker responses and invariant bugs.
  void promise.then(workerRoute => {
    const currentRequest = pendingPaths.get(drone);
    if (currentRequest?.token !== request.token) return;
    if (currentRequest.invalidated) {
      pendingPaths.delete(drone);
      return;
    }

    try {
      const route = validateWorkerRoute(workerRoute, drone);
      if (!routeAvoidsCurrentObstacles(route, buildings, nowSeconds, true)) {
        throw new RangeError(`A* worker route for drone '${drone.id}' intersects a currently blocked air-clearance cell.`);
      }
      const goalStillRelevant = distance(request.requestedX, request.requestedY,
        drone.droneFlightGoalX ?? request.requestedX, drone.droneFlightGoalY ?? request.requestedY)
        < DRONE_FLIGHT_TUNING.routeGoalMoveThreshold * 2.5;
      pendingPaths.delete(drone);
      if (!goalStillRelevant || drone.droneFlightPathNeedsAStar === false || drone.hp <= 0 || drone.isDead) return;
      if (routeReachesTarget(route, request.requestedX, request.requestedY, buildings, nowSeconds)) {
        setDronePath(drone, route, request.requestedX, request.requestedY);
      } else {
        setDronePath(drone, [], request.requestedX, request.requestedY);
        increasePathRetryDelay(drone);
        reportPathProblem(drone, 'worker-no-complete-route', `[navigation] A* worker returned no complete route for drone '${drone.id}'; retry is scheduled.`, { targetX: request.requestedX, targetY: request.requestedY });
      }
    } catch (error) {
      pendingPaths.delete(drone);
      setDronePath(drone, [], request.requestedX, request.requestedY);
      increasePathRetryDelay(drone);
      reportPathProblem(drone, 'worker-result-invalid', `[navigation] A* result processing failed for drone '${drone.id}'; the invalid result was rejected and a bounded retry is scheduled.`, { targetX: request.requestedX, targetY: request.requestedY }, error);
    }
  }, error => {
    const currentRequest = pendingPaths.get(drone);
    if (currentRequest?.token !== request.token) return;
    pendingPaths.delete(drone);
    if (currentRequest.invalidated) return;
    setDronePath(drone, [], request.requestedX, request.requestedY);
    increasePathRetryDelay(drone);
    reportPathProblem(drone, 'worker-async-failed', `[navigation] Drone '${drone.id}' A* worker failed; a bounded retry is scheduled.`, { targetX: request.requestedX, targetY: request.requestedY }, error);
  });
}

export function getNavigationPoint(drone: GameEntity, fallbackX: number, fallbackY: number): { x: number; y: number } {
  const path = drone.path;
  if (!path?.length) {
    // When the direct corridor is blocked, never silently steer at the blocked
    // destination while A* is pending or has failed. Hold this tick's waypoint at
    // the current position; the ordinary acceleration law and visible retry state
    // remain active, and a successful A* result resumes movement automatically.
    return drone.droneFlightPathNeedsAStar
      ? { x: drone.x, y: drone.y }
      : { x: fallbackX, y: fallbackY };
  }
  let index = drone.pathIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || index > path.length) {
    throw new RangeError(`Drone '${drone.id}' has an invalid navigation path index: ${index} for ${path.length} waypoints.`);
  }
  if (index === path.length) {
    drone.flightPathActive = false;
    return drone.droneFlightPathNeedsAStar
      ? { x: drone.x, y: drone.y }
      : { x: fallbackX, y: fallbackY };
  }
  while (index < path.length - 1 && distance(drone.x, drone.y, path[index].x, path[index].y) <= DRONE_FLIGHT_TUNING.routeWaypointTolerance) index++;
  drone.pathIndex = index;
  const point = path[index];
  if (distance(drone.x, drone.y, point.x, point.y) <= DRONE_FLIGHT_TUNING.routeWaypointTolerance && index === path.length - 1) {
    drone.pathIndex = path.length;
    drone.flightPathActive = false;
    return drone.droneFlightPathNeedsAStar
      ? { x: drone.x, y: drone.y }
      : { x: fallbackX, y: fallbackY };
  }
  return { x: point.x, y: point.y };
}


/** Mark a previous-centre request stale but keep its pending slot until the worker settles. */
export function invalidateDroneFlightPath(drone: GameEntity): void {
  const pending = pendingPaths.get(drone);
  if (pending) pending.invalidated = true;
}

