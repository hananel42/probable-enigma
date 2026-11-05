import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';
export function getStatLines(building: Building, _entities: GameEntity[]): BuildingStatLine[] {
  const cooldown = Math.max(0.01, building.fireCooldown || 0.32);
  const shots = Math.max(1, building.shotsPerAttack || 1);
  return [
    { label: 'WEAPON RANGE', value: `${Math.round(building.range)}` },
    { label: 'DAMAGE / SHOT', value: `${(building.damage ?? 22).toFixed(1)}` },
    { label: 'SHOTS / VOLLEY', value: `${shots}` },
    { label: 'FIRE INTERVAL', value: `${cooldown.toFixed(2)} s` },
    { label: 'SUSTAINED DPS', value: `${((building.damage ?? 30) * shots / cooldown).toFixed(1)}` },
    { label: 'PROJECTILE SPEED', value: `${Math.round(building.projectileSpeed || 450)} px/s` },
    ...(building.projectileHomingStrength ? [{ label: 'GUIDANCE', value: 'ACTIVE · LIMITED TURN RATE' }] : []),
    ...((building.explosionRadius || 0) > 0 ? [{ label: 'SPLASH RADIUS', value: `${Math.round(building.explosionRadius || 0)}` }] : [])
  ];
}
