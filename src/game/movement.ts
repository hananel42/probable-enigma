/** Public movement API. Implementations are grouped by collision, smooth steering, and path following. */
export { getSmoothEmbeddedRecoveryTarget, recoverEmbeddedEntity, advanceEmbeddedEntityRecovery, moveWithGridCollision, moveWithGridCollisionSubstepped } from './movement/collision';
export { moveEntityWithDesiredVelocity, moveEntityTowardSmoothly } from './movement/smoothMotion';
export { isEntityPathPending, invalidateEntityPathRequest, moveEntityAlongPath, moveCommanderWithCollision } from './movement/pathMovement';
