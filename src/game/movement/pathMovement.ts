import type { Building, GameEntity, PathWaypoint, ResourceNode } from '../types';
import { findPath } from '../pathfinding';
import { requestPathInWorker } from '../runtime/asyncPathfinding';
import { GRID_SIZE, distance } from '../rules';
import { getBuffMultiplier } from '../statusEffects/buffSystem';
import { advanceEmbeddedEntityRecovery, moveWithGridCollisionSubstepped, recoverEmbeddedEntity } from './collision';
import { measurePerformance, recordPerformanceSample } from '../performance/PerformanceDiagnostics';
import { parsePathWaypointRoute } from '../pathWaypointValidation';

interface PendingEntityPath {
  token: number;
  targetX: number;
  targetY: number;
}
const pendingEntityPaths = new WeakMap<GameEntity, PendingEntityPath>();
const lastPathFailureLog = new WeakMap<GameEntity, { message: string; timestampMs: number }>();
let nextPathToken = 1;
const BOUNDED_MAIN_THREAD_PATH_BUDGET = 650;
let reportedMissingPathWorker = false;

/** True while a worker owns the latest path request for this entity. */
export function isEntityPathPending(entity: GameEntity): boolean {
  return pendingEntityPaths.has(entity);
}

/**
 * Invalidate an outstanding path request when its owning AI changes goals or state.
 * The worker may finish its calculation, but its late result must not overwrite a
 * newer route. The generic scheduler still owns and releases the worker slot.
 */
export function invalidateEntityPathRequest(entity: GameEntity): void {
  pendingEntityPaths.delete(entity);
}

function validateWorkerRoute(route: unknown, entity: GameEntity): PathWaypoint[] {
  return parsePathWaypointRoute(route, `A* worker route for entity '${entity.id}'`);
}

function routeReachesGoal(route: PathWaypoint[], targetX: number, targetY: number, targetTolerance: number): boolean {
  const endpoint = route[route.length - 1];
  if (!endpoint) return false;
  return distance(endpoint.x, endpoint.y, targetX, targetY) <= Math.max(88, targetTolerance + GRID_SIZE * 1.5);
}

function recordPathFailure(entity: GameEntity, targetX: number, targetY: number) {
  entity.path = [];
  entity.pathIndex = 0;
  entity.pathTargetX = targetX;
  entity.pathTargetY = targetY;
  entity.pathRecalcTimer = 0;
  entity.stuckTimer = 0;
  entity.pathFailureCount = (entity.pathFailureCount || 0) + 1;
  entity.pathRetryDelay = Math.min(5, 0.7 * (2 ** Math.min(3, entity.pathFailureCount - 1)));
}

function reportPathRequestFailure(entity: GameEntity, reason: unknown): void {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const now = Date.now();
  const previous = lastPathFailureLog.get(entity);
  if (previous?.message === error.message && now - previous.timestampMs < 5_000) return;
  lastPathFailureLog.set(entity, { message: error.message, timestampMs: now });
  console.error(`[navigation] Path request for entity '${entity.id}' failed; bounded retry is scheduled.`, error);
}

function recordPathSuccess(entity: GameEntity, route: PathWaypoint[], targetX: number, targetY: number) {
  entity.path = route;
  entity.pathIndex = 0;
  entity.pathTargetX = targetX;
  entity.pathTargetY = targetY;
  entity.pathRecalcTimer = 0;
  entity.stuckTimer = 0;
  entity.pathFailureCount = 0;
  entity.pathRetryDelay = 0.8;
}

function requestPathAsync(
  entity: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[],
  targetTolerance: number
): boolean {
  let request: Promise<PathWaypoint[]> | null;
  try {
    request = requestPathInWorker(
      entity.x, entity.y, targetX, targetY, entity.isFlying, buildings, resources
    );
  } catch (error) {
    // Worker creation/task-type errors can be synchronous. Record a bounded retry
    // rather than allowing one navigation failure to abort the whole simulation tick.
    recordPathFailure(entity, targetX, targetY);
    reportPathRequestFailure(entity, error);
    return true;
  }
  if (!request) return false;

  const pending: PendingEntityPath = { token: nextPathToken++, targetX, targetY };
  pendingEntityPaths.set(entity, pending);
  // Use separate fulfillment/rejection handlers. A catch chained after fulfillment
  // used to miss errors thrown while validating/installing a route because the
  // pending slot had already been deleted; malformed results then failed silently.
  request.then(workerRoute => {
    if (pendingEntityPaths.get(entity) !== pending) return;
    try {
      const route = validateWorkerRoute(workerRoute, entity);
      if (entity.hp <= 0 || entity.isDead) return;
      if (routeReachesGoal(route, pending.targetX, pending.targetY, targetTolerance)) {
        recordPathSuccess(entity, route, pending.targetX, pending.targetY);
      } else {
        recordPathFailure(entity, pending.targetX, pending.targetY);
        reportPathRequestFailure(entity, new Error(
          `A* worker returned no complete route to (${pending.targetX}, ${pending.targetY}) for entity '${entity.id}'.`
        ));
      }
    } catch (error) {
      if (entity.hp > 0 && !entity.isDead) {
        recordPathFailure(entity, pending.targetX, pending.targetY);
        reportPathRequestFailure(entity, error);
      }
    } finally {
      if (pendingEntityPaths.get(entity) === pending) pendingEntityPaths.delete(entity);
    }
  }, error => {
    // A rejected worker Promise must release the entity's pending lock. Leaving it
    // in the WeakMap makes watchdogs pause forever after a worker crashes or times out.
    if (pendingEntityPaths.get(entity) !== pending) return;
    pendingEntityPaths.delete(entity);
    if (entity.hp <= 0 || entity.isDead) return;
    recordPathFailure(entity, pending.targetX, pending.targetY);
    reportPathRequestFailure(entity, error);
  });
  return true;
}

/**
 * Shared obstacle-aware navigation. Browser workers handle A* asynchronously.
 * A synchronous path is calculated only when the Worker API itself is unavailable;
 * worker runtime failures remain rejected and are never converted into a retry/fallback.
 */
export function moveEntityAlongPath(
  entity: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[],
  dt: number,
  targetTolerance = 18,
  maxMovementSpeed = Number.POSITIVE_INFINITY,
  embeddedRecoveryMode: 'smooth' = 'smooth'
): boolean {
  recoverEmbeddedEntity(entity, buildings, resources);
  const recoverySpeed = Number.isFinite(maxMovementSpeed) ? maxMovementSpeed : entity.speed;
  if (advanceEmbeddedEntityRecovery(entity, buildings, resources, dt, recoverySpeed)) return true;
  entity.pathRecalcTimer = (entity.pathRecalcTimer || 0) + dt;

  const repathThreshold = GRID_SIZE * 1.5;
  const pending = pendingEntityPaths.get(entity);
  const pendingSameGoal = Boolean(pending && distance(pending.targetX, pending.targetY, targetX, targetY) <= repathThreshold);
  const goalMoved = entity.pathTargetX === undefined || entity.pathTargetY === undefined ||
    distance(entity.pathTargetX, entity.pathTargetY, targetX, targetY) > repathThreshold;
  const hasPath = Boolean(entity.path?.length);
  const retryDelay = Math.max(0.6, Math.min(5, entity.pathRetryDelay || 0.8));
  const retryFailedPath = !hasPath && !pendingSameGoal && (entity.pathRecalcTimer || 0) >= retryDelay;
  const shouldRepath = goalMoved || (hasPath && ((entity.pathRecalcTimer || 0) >= 1.6 || (entity.stuckTimer || 0) >= 0.35)) || retryFailedPath;

  if (shouldRepath && !pendingSameGoal) {
    const startedAsyncRequest = requestPathAsync(entity, targetX, targetY, buildings, resources, targetTolerance);
    if (!startedAsyncRequest) {
      if (!reportedMissingPathWorker) {
        reportedMissingPathWorker = true;
        console.warn('[navigation] Worker is unavailable; entity pathfinding uses an explicit bounded main-thread search.', { maxExpandedNodes: BOUNDED_MAIN_THREAD_PATH_BUDGET });
      }
      const route = measurePerformance('navigation.boundedSynchronousAStar', () =>
        findPath(entity.x, entity.y, targetX, targetY, entity.isFlying, buildings, resources, BOUNDED_MAIN_THREAD_PATH_BUDGET),
        { entityId: entity.id, buildingCount: buildings.length, resourceCount: resources.length, maxExpandedNodes: BOUNDED_MAIN_THREAD_PATH_BUDGET }
      );
      if (routeReachesGoal(route, targetX, targetY, targetTolerance)) {
        recordPathSuccess(entity, route, targetX, targetY);
      } else {
        recordPathFailure(entity, targetX, targetY);
        reportPathRequestFailure(entity, new Error(`Bounded main-thread A* did not find a complete route within ${BOUNDED_MAIN_THREAD_PATH_BUDGET} expansions; retry is scheduled without installing a partial path.`));
      }
    } else {
      // No old path? The unit waits without stalling the main thread while A* runs.
      // If it has a valid prior route, it can continue along it until replacement.
      entity.stuckTimer = 0;
    }
  }

  if (!entity.path?.length) {
    entity.stuckTimer = (entity.stuckTimer || 0) + dt;
    return false;
  }

  let index = Math.max(0, Math.min(entity.pathIndex || 0, entity.path.length - 1));
  while (index < entity.path.length - 1 && distance(entity.x, entity.y, entity.path[index].x, entity.path[index].y) <= targetTolerance) index++;
  entity.pathIndex = index;
  const waypoint = entity.path[index];
  const dx = waypoint.x - entity.x;
  const dy = waypoint.y - entity.y;
  const d = Math.hypot(dx, dy);
  if (d <= 0.001) return true;

  const effectiveSpeed = Math.min(Math.max(0, (entity.speed || 0) * getBuffMultiplier(entity, 'speedMultiplier')), Math.max(0, maxMovementSpeed * getBuffMultiplier(entity, 'speedMultiplier')));
  const step = Math.min(d, effectiveSpeed * Math.max(0, dt));
  const beforeX = entity.x;
  const beforeY = entity.y;
  const distanceBefore = d;
  entity.angle = Math.atan2(dy, dx);
  moveWithGridCollisionSubstepped(
    entity,
    entity.x + (dx / d) * step,
    entity.y + (dy / d) * step,
    buildings,
    resources
  );

  const moved = distance(beforeX, beforeY, entity.x, entity.y);
  const remainingDistance = distance(entity.x, entity.y, waypoint.x, waypoint.y);
  const madeProgress = distanceBefore - remainingDistance > 0.2;
  entity.stuckTimer = madeProgress ? 0 : (entity.stuckTimer || 0) + dt;
  if ((entity.stuckTimer || 0) >= 0.35) {
    entity.path = [];
    entity.pathRecalcTimer = 2;
    entity.pathFailureCount = (entity.pathFailureCount || 0) + 1;
    entity.pathRetryDelay = Math.min(5, 0.7 * (2 ** Math.min(3, entity.pathFailureCount - 1)));
  }
  return moved > 0;
}

/** Shared direct movement for the locally controlled commander. */
export function moveCommanderWithCollision(
  entity: GameEntity,
  dx: number,
  dy: number,
  dt: number,
  buildings: Building[],
  resources: ResourceNode[]
) {
  recoverEmbeddedEntity(entity, buildings, resources);
  const speed = entity.speed * getBuffMultiplier(entity, 'speedMultiplier');
  if (advanceEmbeddedEntityRecovery(entity, buildings, resources, dt, speed)) return;
  const step = speed * dt;
  const beforeX = entity.x;
  const beforeY = entity.y;
  moveWithGridCollisionSubstepped(entity, entity.x + dx * step, entity.y + dy * step, buildings, resources);
  if (dt > 0) {
    entity.vx = (entity.x - beforeX) / dt;
    entity.vy = (entity.y - beforeY) / dt;
  }
}
