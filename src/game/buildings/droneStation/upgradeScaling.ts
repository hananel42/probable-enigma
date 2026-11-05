import type { BuildingUpgradeScaling } from '../types';
export const upgradeScaling: BuildingUpgradeScaling = {
  multiply: ['maxHp', 'range', 'droneProductionMultiplier', 'droneDamageMultiplier', 'droneHealthMultiplier', 'droneSpeedMultiplier', 'droneFireRateMultiplier'],
  increments: [{ stat: 'maxDrones', amount: 1, maximum: 10 }]
};
