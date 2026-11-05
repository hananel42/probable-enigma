import type { BuildingUpgradeScaling } from '../types';
export const upgradeScaling: BuildingUpgradeScaling = {
  multiply: ['maxHp', 'maxCapacity', 'miningSpeedMultiplier', 'botCargoCapacityMultiplier', 'botProductionMultiplier'],
  increments: [{ stat: 'maxBots', amount: 1, maximum: 8 }]
};
