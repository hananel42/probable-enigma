import type { BuildingUpgradeScaling } from '../types';
export const upgradeScaling: BuildingUpgradeScaling = {
  multiply: ['maxHp', 'range', 'damage', 'fireRadius', 'burnDamagePerSecond', 'effectDuration', 'pulseDuration'],
  divide: ['fireCooldown'], armorBonusFactor: 0.15
};
