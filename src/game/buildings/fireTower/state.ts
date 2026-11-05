import type { Building, TowerEffectId } from '../../types';

const EFFECT_IDS = new Set<TowerEffectId>([
  'burning',
  'slowing',
  'signal-suppression',
  'weakened-shots',
  'radio-jamming',
  'corrosion'
]);

export type FireTowerBuilding = Building & Required<Pick<Building,
  | 'fireTimer'
  | 'fireRadius'
  | 'damage'
  | 'fireCooldown'
  | 'burnDamagePerSecond'
  | 'effectDuration'
  | 'towerEffectIds'
  | 'pulseDuration'
  | 'isPulsing'
  | 'pulseProgress'
  | 'pulseAffectedIds'
>>;

/** Reject an incomplete Fire Tower state instead of inventing missing gameplay values. */
export function assertFireTowerBuilding(building: Building): asserts building is FireTowerBuilding {
  if (building.type !== 'FIRE_TOWER') {
    throw new TypeError(`Expected FIRE_TOWER, received '${building.type}'.`);
  }

  function requireFiniteNumber(value: number | undefined, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`Effect Tower '${building.id}' requires a finite '${field}' value.`);
    }
  }
  requireFiniteNumber(building.fireTimer, 'fireTimer');
  requireFiniteNumber(building.fireRadius, 'fireRadius');
  requireFiniteNumber(building.damage, 'damage');
  requireFiniteNumber(building.fireCooldown, 'fireCooldown');
  requireFiniteNumber(building.burnDamagePerSecond, 'burnDamagePerSecond');
  requireFiniteNumber(building.effectDuration, 'effectDuration');
  requireFiniteNumber(building.pulseDuration, 'pulseDuration');
  requireFiniteNumber(building.pulseProgress, 'pulseProgress');
  if (building.fireRadius <= 0 || building.damage < 0 || building.fireCooldown <= 0 ||
      building.burnDamagePerSecond < 0 || building.effectDuration <= 0 || building.pulseDuration <= 0 ||
      building.pulseProgress < 0 || building.pulseProgress > 1) {
    throw new RangeError(`Effect Tower '${building.id}' has out-of-range runtime stats.`);
  }
  if (typeof building.isPulsing !== 'boolean' || !Array.isArray(building.pulseAffectedIds)) {
    throw new TypeError(`Effect Tower '${building.id}' requires pulse state.`);
  }
  if (!Array.isArray(building.towerEffectIds) || building.towerEffectIds.length === 0 ||
      building.towerEffectIds.some(id => !EFFECT_IDS.has(id))) {
    throw new TypeError(`Effect Tower '${building.id}' requires at least one valid tower effect ID.`);
  }
}
