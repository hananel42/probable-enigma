import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';
import { TOWER_EFFECTS } from '../../statusEffects/towerEffects';
import { assertFireTowerBuilding } from './state';

export function getStatLines(building: Building, _entities: GameEntity[]): BuildingStatLine[] {
  assertFireTowerBuilding(building);
  const effects = building.towerEffectIds;
  return [
    { label: 'ACTIVE MODES', value: effects.map(id => TOWER_EFFECTS[id].name).join(' + ') },
    { label: 'WAVE RADIUS', value: `${Math.round(building.fireRadius)}` },
    { label: 'IMPACT DAMAGE', value: `${building.damage.toFixed(1)}` },
    { label: 'WAVE INTERVAL', value: `${Math.max(0.01, building.fireCooldown).toFixed(2)} s` },
    { label: 'WAVE TRAVEL', value: `${building.pulseDuration.toFixed(2)} s` },
    { label: 'EFFECT DURATION', value: `${building.effectDuration.toFixed(1)} s` },
    ...(effects.includes('burning') ? [{ label: 'BURN DAMAGE', value: `${building.burnDamagePerSecond.toFixed(1)} HP/s` }] : [])
  ];
}
