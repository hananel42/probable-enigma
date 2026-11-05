import type { GameEntity, Projectile } from '../../types';
import type { PrioritizedCombatTarget } from '../../combat';
import { distance } from '../../rules';
import { sound } from '../../audio';
import { getBuffMultiplier } from '../../statusEffects/buffSystem';
import { BASE_WEAPON_TUNING } from '../../combatTuning';

/** Keeps target lead, facing and projectile creation together as one combat phase. */
export function updateDroneWeapons(
  drone: GameEntity,
  target: PrioritizedCombatTarget | undefined,
  weaponRange: number,
  teamId: string,
  projectiles: Projectile[],
  dt: number
): void {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError(`Drone '${drone.id}' received invalid weapon delta: ${dt}.`);
  }
  const lastFireTime = drone.lastFireTime;
  if (typeof lastFireTime !== 'number' || !Number.isFinite(lastFireTime) || lastFireTime < 0) {
    throw new RangeError(`Drone '${drone.id}' has invalid last-fire time: ${String(lastFireTime)}.`);
  }
  drone.lastFireTime = lastFireTime + dt;
  if (!target) return;

  const targetX = target.kind === 'ENTITY' ? target.entity.x : target.building.x;
  const targetY = target.kind === 'ENTITY' ? target.entity.y : target.building.y;
  if (![drone.x, drone.y, targetX, targetY, weaponRange].every(Number.isFinite) || weaponRange < 0) {
    throw new RangeError(`Drone '${drone.id}' or its target has invalid position/range data.`);
  }
  let targetVx = 0;
  let targetVy = 0;
  if (target.kind === 'ENTITY') {
    targetVx = target.entity.vx;
    targetVy = target.entity.vy;
    if (!Number.isFinite(targetVx) || !Number.isFinite(targetVy)) {
      throw new RangeError(`Drone '${drone.id}' target '${target.entity.id}' has invalid velocity.`);
    }
  }
  const targetDistance = distance(drone.x, drone.y, targetX, targetY);
  if (!Number.isFinite(targetDistance)) {
    throw new RangeError(`Drone '${drone.id}' produced a non-finite target distance.`);
  }
  const leadTime = Math.min(0.18, targetDistance / 450);
  const angle = Math.atan2(targetY + targetVy * leadTime - drone.y, targetX + targetVx * leadTime - drone.x);
  if (!Number.isFinite(angle)) throw new RangeError(`Drone '${drone.id}' produced a non-finite firing angle.`);
  drone.angle = angle;

  const fireCooldown = drone.fireCooldown;
  if (typeof fireCooldown !== 'number' || !Number.isFinite(fireCooldown) || fireCooldown < 0) {
    throw new RangeError(`Drone '${drone.id}' has invalid weapon cooldown: ${String(fireCooldown)}.`);
  }
  const fireRateMultiplier = getBuffMultiplier(drone, 'fireRateMultiplier');
  if (!Number.isFinite(fireRateMultiplier) || fireRateMultiplier <= 0) {
    throw new RangeError(`Drone '${drone.id}' has invalid fire-rate multiplier: ${fireRateMultiplier}.`);
  }
  const fireInterval = fireCooldown / fireRateMultiplier;
  if (drone.lastFireTime < fireInterval || targetDistance > weaponRange) return;

  // Drone entities must be created with explicit weapon damage. Do not mask a
  // broken spawn/upgrade invariant with the baseline weapon value.
  const droneDamage = drone.damage;
  if (typeof droneDamage !== 'number' || !Number.isFinite(droneDamage) || droneDamage < 0) {
    throw new RangeError(`Drone '${drone.id}' has invalid weapon damage: ${String(droneDamage)}.`);
  }
  const powerMultiplier = getBuffMultiplier(drone, 'powerMultiplier');
  if (!Number.isFinite(powerMultiplier) || powerMultiplier < 0) {
    throw new RangeError(`Drone '${drone.id}' has invalid power multiplier: ${powerMultiplier}.`);
  }
  const projectileDamage = droneDamage * powerMultiplier;
  if (!Number.isFinite(projectileDamage) || projectileDamage < 0) {
    throw new RangeError(`Drone '${drone.id}' produced invalid projectile damage: ${projectileDamage}.`);
  }

  drone.lastFireTime = 0;
  const projectileSpeed = BASE_WEAPON_TUNING.projectileSpeed;
  const projectileLifetime = Math.min(1.2, weaponRange / projectileSpeed);
  projectiles.push({
    id: `drone-proj-${Date.now()}-${Math.random()}`,
    ownerPlayerId: drone.ownerPlayerId,
    x: drone.x,
    y: drone.y,
    rangeOriginX: drone.x,
    rangeOriginY: drone.y,
    maxRange: weaponRange,
    vx: Math.cos(angle) * projectileSpeed,
    vy: Math.sin(angle) * projectileSpeed,
    damage: projectileDamage,
    faction: drone.faction,
    teamId,
    allianceId: drone.allianceId ?? teamId,
    color: drone.faction === 'player' ? '#38bdf8' : '#f43f5e',
    radius: 3.5,
    life: projectileLifetime,
    maxLife: projectileLifetime
  });
  sound.playLaser();
}
