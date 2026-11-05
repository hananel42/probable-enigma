import type { Building, GameEntity, ResourceNode } from '../types';
import { distance } from '../rules';
import { getBuffMultiplier } from '../statusEffects/buffSystem';
import { moveWithGridCollisionSubstepped } from './collision';

/**
 * Acceleration-limited velocity steering for continuously moving flight paths.
 * Unlike moveEntityTowardSmoothly, this does not brake just because a moving
 * waypoint is nearby. The caller supplies feed-forward curve velocity plus a
 * correction toward the curve, which avoids the stop/start behaviour produced
 * by chasing a waypoint that is itself moving every frame.
 */
export function moveEntityWithDesiredVelocity(
  entity: GameEntity,
  desiredVx: number,
  desiredVy: number,
  buildings: Building[],
  resources: ResourceNode[],
  dt: number,
  maxSpeed: number,
  acceleration: number
): boolean {
  if (dt <= 0) return false;
  const speedMultiplier = getBuffMultiplier(entity, 'speedMultiplier');
  const speedCap = Math.max(0, maxSpeed * speedMultiplier);
  desiredVx *= speedMultiplier;
  desiredVy *= speedMultiplier;
  const desiredLength = Math.hypot(desiredVx, desiredVy);
  if (desiredLength > speedCap && desiredLength > 0) {
    const scale = speedCap / desiredLength;
    desiredVx *= scale;
    desiredVy *= scale;
  }

  if (!Number.isFinite(entity.vx) || !Number.isFinite(entity.vy)) {
    throw new RangeError(`Entity '${entity.id}' has invalid velocity (${entity.vx}, ${entity.vy}).`);
  }
  const currentVx = entity.vx;
  const currentVy = entity.vy;
  let deltaVx = desiredVx - currentVx;
  let deltaVy = desiredVy - currentVy;
  const deltaSpeed = Math.hypot(deltaVx, deltaVy);
  const maxDelta = Math.max(0, acceleration) * dt;
  if (deltaSpeed > maxDelta && deltaSpeed > 0) {
    const scale = maxDelta / deltaSpeed;
    deltaVx *= scale;
    deltaVy *= scale;
  }

  let nextVx = currentVx + deltaVx;
  let nextVy = currentVy + deltaVy;
  const nextSpeed = Math.hypot(nextVx, nextVy);
  if (nextSpeed > speedCap && nextSpeed > 0) {
    const scale = speedCap / nextSpeed;
    nextVx *= scale;
    nextVy *= scale;
  }

  const oldX = entity.x;
  const oldY = entity.y;
  moveWithGridCollisionSubstepped(entity, oldX + nextVx * dt, oldY + nextVy * dt, buildings, resources);
  const movedX = entity.x - oldX;
  const movedY = entity.y - oldY;
  entity.vx = movedX / dt;
  entity.vy = movedY / dt;
  if (Math.hypot(entity.vx, entity.vy) > 1) entity.angle = Math.atan2(entity.vy, entity.vx);
  return Math.hypot(movedX, movedY) > 0.01;
}

/**
 * Acceleration-limited direct flight for drones. Unlike instant constant-speed
 * stepping, this keeps inertia through turns and actively brakes before a hover
 * point. Use only when the direct segment has already been checked as clear.
 */
export function moveEntityTowardSmoothly(
  entity: GameEntity,
  targetX: number,
  targetY: number,
  buildings: Building[],
  resources: ResourceNode[],
  dt: number,
  maxSpeed: number,
  acceleration: number,
  arrivalSlowdownDistance: number
): boolean {
  if (dt <= 0) return false;
  const dx = targetX - entity.x;
  const dy = targetY - entity.y;
  const targetDistance = Math.hypot(dx, dy);
  const maxVelocity = Math.max(0, maxSpeed * getBuffMultiplier(entity, 'speedMultiplier'));
  let desiredVx = 0;
  let desiredVy = 0;
  if (targetDistance > 1) {
    const arrivalFactor = Math.min(1, targetDistance / Math.max(1, arrivalSlowdownDistance));
    const desiredSpeed = Math.min(maxVelocity, maxVelocity * arrivalFactor);
    desiredVx = (dx / targetDistance) * desiredSpeed;
    desiredVy = (dy / targetDistance) * desiredSpeed;
  }

  if (!Number.isFinite(entity.vx) || !Number.isFinite(entity.vy)) {
    throw new RangeError(`Entity '${entity.id}' has invalid velocity (${entity.vx}, ${entity.vy}).`);
  }
  const currentVx = entity.vx;
  const currentVy = entity.vy;
  let changeX = desiredVx - currentVx;
  let changeY = desiredVy - currentVy;
  const changeLength = Math.hypot(changeX, changeY);
  const maxChange = Math.max(0, acceleration) * dt;
  if (changeLength > maxChange && changeLength > 0) {
    const scale = maxChange / changeLength;
    changeX *= scale;
    changeY *= scale;
  }
  let nextVx = currentVx + changeX;
  let nextVy = currentVy + changeY;
  const velocityLength = Math.hypot(nextVx, nextVy);
  if (velocityLength > maxVelocity && velocityLength > 0) {
    const scale = maxVelocity / velocityLength;
    nextVx *= scale;
    nextVy *= scale;
  }

  // If the target is very close, avoid a full-frame overshoot and settle on it.
  const proposedLength = Math.hypot(nextVx, nextVy) * dt;
  if (targetDistance <= Math.max(1, proposedLength) && targetDistance < arrivalSlowdownDistance * 0.22) {
    nextVx = (dx / Math.max(1, targetDistance)) * (targetDistance / dt);
    nextVy = (dy / Math.max(1, targetDistance)) * (targetDistance / dt);
  }
  const beforeX = entity.x;
  const beforeY = entity.y;
  entity.angle = Math.atan2(dy, dx);
  moveWithGridCollisionSubstepped(entity, entity.x + nextVx * dt, entity.y + nextVy * dt, buildings, resources);
  const movedX = entity.x - beforeX;
  const movedY = entity.y - beforeY;
  // Track achieved velocity rather than intended velocity, so collision sliding
  // never stores hidden momentum into a wall or building.
  entity.vx = movedX / dt;
  entity.vy = movedY / dt;
  return Math.hypot(movedX, movedY) > 0.01;
}

/**
 * Pending routes are keyed by entity identity. A newer goal supersedes an older
 * worker request; its late result is ignored instead of steering the unit toward
 * stale coordinates. This keeps async work out of the simulation frame loop.
 */
