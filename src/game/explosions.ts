/** Shared radial-explosion math used by projectile payloads and kamikaze drones. */
export type ExplosionFalloff = 'flat' | 'linear' | 'quadratic';

export interface RadialExplosionTarget {
  id: string;
  x: number;
  y: number;
}

export interface RadialExplosionOptions<T extends RadialExplosionTarget> {
  origin: { x: number; y: number };
  radius: number;
  baseDamage: number;
  falloff?: ExplosionFalloff;
  targets: readonly T[];
  /** Optional collision radius; projectile blasts historically include target size. */
  getCollisionRadius?: (target: T) => number;
  /** Optional direct-hit or other exclusions. */
  excludeIds?: ReadonlySet<string>;
  canDamage: (target: T) => boolean;
  applyDamage: (target: T, damage: number) => void;
}

/**
 * Applies radial damage through a caller-supplied damage function so entity and
 * building armour, rewards, visuals, and ownership rules remain authoritative.
 * Quadratic falloff sharply reduces damage toward the edge; the edge receives 0.
 */
export function applyRadialExplosion<T extends RadialExplosionTarget>(options: RadialExplosionOptions<T>): void {
  const { origin, targets, canDamage, applyDamage } = options;
  const radius = Math.max(0, options.radius);
  const baseDamage = Math.max(0, options.baseDamage);
  if (!Number.isFinite(radius) || !Number.isFinite(baseDamage)) {
    throw new RangeError('Explosion radius and damage must be finite numbers.');
  }
  if (radius === 0 || baseDamage === 0) return;

  const radiusSquared = radius * radius;
  const falloff = options.falloff ?? 'flat';
  for (const target of targets) {
    if (options.excludeIds?.has(target.id) || !canDamage(target)) continue;
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const centerDistance = Math.hypot(dx, dy);
    const collisionRadius = Math.max(0, options.getCollisionRadius?.(target) ?? 0);
    // Subtracting collision radius preserves the projectile blast's prior
    // radius + target-size behavior while allowing point-based drone blasts.
    const effectiveDistance = Math.max(0, centerDistance - collisionRadius);
    if (effectiveDistance * effectiveDistance > radiusSquared) continue;

    const normalizedDistance = Math.min(1, effectiveDistance / radius);
    let scale = 1;
    if (falloff === 'linear') scale = 1 - normalizedDistance;
    else if (falloff === 'quadratic') scale = (1 - normalizedDistance) ** 2;
    const damage = baseDamage * scale;
    if (damage > 0) applyDamage(target, damage);
  }
}
