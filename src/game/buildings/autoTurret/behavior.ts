import type { BuildingBehavior, BuildingRuntimeContext } from '../types';
import { getCombatTeamId } from '../../combat';
import { BASE_WEAPON_TUNING } from '../../combatTuning';
/** Projectile weapon tuning. Upgrade-modified stats live on the Building instance. */
export const behavior: BuildingBehavior = {
  kind: 'PROJECTILE_WEAPON', scanInterval: 0.14, defaultCooldown: BASE_WEAPON_TUNING.fireCooldown,
  projectileSpeed: BASE_WEAPON_TUNING.projectileSpeed, projectileRadius: BASE_WEAPON_TUNING.projectileRadius,
  muzzleOffset: BASE_WEAPON_TUNING.muzzleOffset, defaultDamage: BASE_WEAPON_TUNING.damage
};

export function update(building: import('../../types').Building, context: BuildingRuntimeContext): void {
  if (behavior.kind !== 'PROJECTILE_WEAPON') return;
  building.targetScanTimer = Math.max(0, (building.targetScanTimer || 0) - context.dt);
  if (building.targetScanTimer <= 0) {
    const target = context.findPriorityTarget(building, building.range);
    building.targetEntityId = target?.kind === 'ENTITY' ? target.entity.id : null;
    building.targetBuildingId = target?.kind === 'BUILDING' ? target.building.id : null;
    building.targetScanTimer = behavior.scanInterval;
  }
  const target = context.resolveCachedTarget(building, building.range);
  building.lastActionTime = (building.lastActionTime || 0) + context.dt;
  if (!target) return;
  const tx = target.kind === 'ENTITY' ? target.entity.x : target.building.x;
  const ty = target.kind === 'ENTITY' ? target.entity.y : target.building.y;
  const angle = Math.atan2(ty - building.y, tx - building.x);
  building.barrelAngle = angle;
  if (building.lastActionTime < (building.fireCooldown || behavior.defaultCooldown)) return;
  building.lastActionTime = 0;
  const count = Math.max(1, Math.min(3, Math.round(building.shotsPerAttack || 1)));
  const projectileSpeed = Math.max(80, building.projectileSpeed || behavior.projectileSpeed);
  const projectileLife = Math.max(0.12, Math.min(1.2, (building.range || 320) / projectileSpeed));
  for (let i = 0; i < count; i++) {
    const shotAngle = angle + (i - (count - 1) / 2) * 0.055;
    context.spawnProjectile({
      id: `turret-${building.id}-${context.state.gameTime}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      ownerPlayerId: building.ownerPlayerId,
      x: building.x + Math.cos(shotAngle) * behavior.muzzleOffset,
      y: building.y + Math.sin(shotAngle) * behavior.muzzleOffset,
      rangeOriginX: building.x, rangeOriginY: building.y, maxRange: building.range,
      vx: Math.cos(shotAngle) * projectileSpeed,
      vy: Math.sin(shotAngle) * projectileSpeed,
      damage: building.damage ?? behavior.defaultDamage,
      faction: building.faction, teamId: getCombatTeamId(building),
      allianceId: building.allianceId || getCombatTeamId(building),
      color: building.faction === 'player' ? '#38bdf8' : '#f43f5e',
      radius: behavior.projectileRadius, life: projectileLife, maxLife: projectileLife,
      targetEntityId: building.targetEntityId, targetBuildingId: building.targetBuildingId,
      homingStrength: building.projectileHomingStrength || undefined,
      explosionRadius: building.explosionRadius || undefined,
      explosionDamageMultiplier: building.explosionDamageMultiplier || undefined
    });
  }
  context.playSound('shoot');
}
