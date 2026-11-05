import type { Building, GameEntity, ResourceNode } from '../types';
import { GRID_SIZE, distance, getBuildingOccupiedCells, getBuildingCandidatesInCellBounds, getResourceNodeAtCell, isCellInsideBuildingFootprint, isCellBlockedForGround } from '../rules';
import { recordPerformanceSample } from '../performance/PerformanceDiagnostics';

interface SmoothEmbeddedRecoveryTarget { x: number; y: number }

const smoothEmbeddedRecoveryTargets = new WeakMap<GameEntity, SmoothEmbeddedRecoveryTarget>();
const recoverySearchRetryAfterMs = new WeakMap<GameEntity, number>();
const recoverySearchFailureLoggedAtMs = new WeakMap<GameEntity, number>();

/** Exposes a temporary nearby escape point for any unit overlapped by a new structure. */
export function getSmoothEmbeddedRecoveryTarget(entity: GameEntity): SmoothEmbeddedRecoveryTarget | null {
  const target = smoothEmbeddedRecoveryTargets.get(entity);
  return target ? { ...target } : null;
}

function cellBlocked(x: number, y: number, isFlying: boolean, buildings: Building[], resources: ResourceNode[]) {
  const gx = Math.floor(x / GRID_SIZE);
  const gy = Math.floor(y / GRID_SIZE);
  // Air path-planning uses a wider safety ring, but physical collision and
  // embedded-unit recovery must only treat the structure footprint as solid.
  // Otherwise a drone merely entering the safety ring would be incorrectly treated as embedded.
  return isFlying
    ? isCellInsideBuildingFootprint(gx, gy, buildings)
    : isCellBlockedForGround(gx, gy, buildings, resources);
}

/** Move an entity out of terrain/building geometry if a build or destroyed obstacle left it embedded. */
export function recoverEmbeddedEntity(
  entity: GameEntity,
  buildings: Building[],
  resources: ResourceNode[]
): boolean {
  if (!cellBlocked(entity.x, entity.y, entity.isFlying, buildings, resources)) {
    smoothEmbeddedRecoveryTargets.delete(entity);
    return false;
  }
  const existingSmoothTarget = smoothEmbeddedRecoveryTargets.get(entity);
  if (existingSmoothTarget) return true;

  const nowMs = performance.now();
  const retryAfterMs = recoverySearchRetryAfterMs.get(entity) ?? 0;
  if (nowMs < retryAfterMs) return false;

  // Construct an obstacle lookup only around the embedded entity. A newly
  // generated base must not make every recovery attempt rescan every historic
  // building in the world.
  const blockedCells = new Set<string>();
  const keyOf = (gx: number, gy: number) => `${gx},${gy}`;
  const originGx = Math.floor(entity.x / GRID_SIZE);
  const originGy = Math.floor(entity.y / GRID_SIZE);
  const searchRadius = 48;
  const nearbyBuildings = getBuildingCandidatesInCellBounds(
    buildings, originGx - searchRadius - 1, originGy - searchRadius - 1,
    originGx + searchRadius + 1, originGy + searchRadius + 1
  );
  for (const building of nearbyBuildings) {
    if (building.hp <= 0) continue;
    for (const cell of getBuildingOccupiedCells(building)) {
      blockedCells.add(keyOf(cell.gx, cell.gy));
    }
  }
  const isBlockedCell = (gx: number, gy: number) =>
    blockedCells.has(keyOf(gx, gy)) || (!entity.isFlying && Boolean(getResourceNodeAtCell(resources, gx, gy)));

  const recoverySearchStartedAtMs = performance.now();
  for (let radius = 1; radius <= searchRadius; radius++) {
    let best: { x: number; y: number; score: number } | undefined;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const gx = originGx + dx;
        const gy = originGy + dy;
        if (isBlockedCell(gx, gy)) continue;
        const x = gx * GRID_SIZE + GRID_SIZE / 2;
        const y = gy * GRID_SIZE + GRID_SIZE / 2;
        const score = Math.hypot(x - entity.x, y - entity.y);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    if (best) {
      // Every entity type uses non-teleporting recovery. The next bounded movement
      // integration carries the unit to this free cell over multiple simulation ticks.
      smoothEmbeddedRecoveryTargets.set(entity, { x: best.x, y: best.y });
      recoverySearchRetryAfterMs.delete(entity);
      recoverySearchFailureLoggedAtMs.delete(entity);
      entity.vx = 0;
      entity.vy = 0;
      entity.path = [];
      entity.pathIndex = 0;
      entity.pathRecalcTimer = 2;
      entity.stuckTimer = 0;
      entity.flightPathActive = false;
      recordPerformanceSample('movement.embeddedRecovery.search', performance.now() - recoverySearchStartedAtMs, {
        entityId: entity.id, buildingCount: nearbyBuildings.length, resourceCount: resources.length, searchRadius: radius
      });
      return true;
    }
  }
  const searchDurationMs = performance.now() - recoverySearchStartedAtMs;
  recordPerformanceSample('movement.embeddedRecovery.failedSearch', searchDurationMs, {
    entityId: entity.id, buildingCount: nearbyBuildings.length, resourceCount: resources.length, searchRadius
  });
  recoverySearchRetryAfterMs.set(entity, nowMs + 1_000);
  const lastLoggedAtMs = recoverySearchFailureLoggedAtMs.get(entity) ?? Number.NEGATIVE_INFINITY;
  if (nowMs - lastLoggedAtMs >= 5_000) {
    recoverySearchFailureLoggedAtMs.set(entity, nowMs);
    console.error('[movement] Embedded entity could not find a free recovery cell; no position snap was applied.', {
      entityId: entity.id, x: entity.x, y: entity.y, searchRadius, nearbyBuildingCount: nearbyBuildings.length
    });
  }
  return false;
}

/**
 * Advance an embedded unit toward its remembered free cell using bounded physical
 * movement. Returns true while recovery owns this tick, even if dt is zero.
 */
export function advanceEmbeddedEntityRecovery(
  entity: GameEntity,
  buildings: Building[],
  resources: ResourceNode[],
  dt: number,
  maxSpeed: number
): boolean {
  const target = smoothEmbeddedRecoveryTargets.get(entity);
  if (!target) return false;
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(maxSpeed) || maxSpeed < 0) {
    throw new RangeError(`Entity '${entity.id}' has invalid embedded recovery timing/speed (${dt}, ${maxSpeed}).`);
  }
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const remaining = Math.hypot(dx, dy);
  if (remaining <= 0.001) {
    smoothEmbeddedRecoveryTargets.delete(entity);
    return true;
  }
  if (dt <= 0 || maxSpeed <= 0) return true;

  const step = Math.min(remaining, maxSpeed * dt);
  const beforeX = entity.x;
  const beforeY = entity.y;
  const requestedX = entity.x + dx / remaining * step;
  const requestedY = entity.y + dy / remaining * step;
  moveWithGridCollisionSubstepped(entity, requestedX, requestedY, buildings, resources);
  entity.vx = (entity.x - beforeX) / dt;
  entity.vy = (entity.y - beforeY) / dt;
  return true;
}

/** Grid-aware sliding motion shared by AI-controlled ground units and flyers. */
/**
 * Move a flying/ground entity along a continuous segment using short collision-tested
 * steps. `moveWithGridCollision` is a single-cell endpoint test; callers with larger
 * time deltas must subdivide to prevent tunnelling through a wall when both endpoints
 * happen to be in free cells. The bound is explicit: invalidly large moves fail loudly
 * rather than skipping collision checks or snapping the entity to a destination.
 */
export function moveWithGridCollisionSubstepped(
  entity: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[],
  maxSegmentLength = GRID_SIZE * 0.25,
  maxSegments = 64
): boolean {
  if (![entity.x, entity.y, targetX, targetY].every(Number.isFinite)) {
    throw new RangeError(`Entity '${entity.id}' cannot move through collisions with non-finite coordinates.`);
  }
  if (!Number.isFinite(maxSegmentLength) || maxSegmentLength <= 0 || !Number.isInteger(maxSegments) || maxSegments < 1) {
    throw new RangeError('Substepped collision movement requires a positive finite segment length and a positive integer segment limit.');
  }
  const startX = entity.x;
  const startY = entity.y;
  const deltaX = targetX - startX;
  const deltaY = targetY - startY;
  const distance = Math.hypot(deltaX, deltaY);
  if (!Number.isFinite(distance)) throw new RangeError(`Entity '${entity.id}' produced a non-finite movement distance.`);
  const segmentCount = Math.max(1, Math.ceil(distance / maxSegmentLength));
  if (segmentCount > maxSegments) {
    throw new RangeError(`Entity '${entity.id}' requested ${segmentCount} collision substeps; the safe limit is ${maxSegments}.`);
  }

  let moved = false;
  const stepX = deltaX / segmentCount;
  const stepY = deltaY / segmentCount;
  for (let index = 0; index < segmentCount; index++) {
    // Rebase each micro-step on the actual position. If X is blocked, the shared
    // collision resolver can still accept Y (and vice versa), sliding along the
    // wall. Continuing the remaining bounded micro-steps is safe: every axis move
    // is collision-tested, and the next step starts at the corrected position.
    const nextX = entity.x + stepX;
    const nextY = entity.y + stepY;
    moved = moveWithGridCollision(entity, nextX, nextY, buildings, resources) || moved;
  }
  return moved;
}

export function moveWithGridCollision(
  entity: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[]
): boolean {
  const recoveryTarget = smoothEmbeddedRecoveryTargets.get(entity);
  if (recoveryTarget) {
    const beforeDistance = distance(entity.x, entity.y, recoveryTarget.x, recoveryTarget.y);
    const requestedStep = distance(entity.x, entity.y, targetX, targetY);
    if (beforeDistance > 0.001 && requestedStep > 0.001) {
      // The origin is inside solid geometry, so ordinary collision checks cannot
      // make progress. Permit only a bounded step toward the nearest free cell;
      // never permit motion away from the recovery target or a positional snap.
      const step = Math.min(requestedStep, beforeDistance);
      const dx = (recoveryTarget.x - entity.x) / beforeDistance;
      const dy = (recoveryTarget.y - entity.y) / beforeDistance;
      const oldX = entity.x;
      const oldY = entity.y;
      entity.x += dx * step;
      entity.y += dy * step;
      if (!cellBlocked(entity.x, entity.y, entity.isFlying, buildings, resources)) {
        smoothEmbeddedRecoveryTargets.delete(entity);
      }
      return distance(oldX, oldY, entity.x, entity.y) > 0.001;
    }
    if (!cellBlocked(entity.x, entity.y, entity.isFlying, buildings, resources)) smoothEmbeddedRecoveryTargets.delete(entity);
    return false;
  }
  let moved = false;
  if (!cellBlocked(targetX, entity.y, entity.isFlying, buildings, resources)) {
    moved ||= Math.abs(targetX - entity.x) > 0.001;
    entity.x = targetX;
  }
  if (!cellBlocked(entity.x, targetY, entity.isFlying, buildings, resources)) {
    moved ||= Math.abs(targetY - entity.y) > 0.001;
    entity.y = targetY;
  }
  return moved;
}
