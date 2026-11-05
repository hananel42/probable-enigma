import type { BuildingUpgradeEffect, BuildingUpgradeOption, BuildingUpgradeStat } from '../../upgrades/types';

export const add = (stat: BuildingUpgradeStat, value: number): BuildingUpgradeEffect => ({ kind: 'ADD', stat, value });
export const multiply = (stat: BuildingUpgradeStat, value: number): BuildingUpgradeEffect => ({ kind: 'MULTIPLY', stat, value });
export const set = (stat: BuildingUpgradeStat, value: number): BuildingUpgradeEffect => ({ kind: 'SET', stat, value });
export const allStats = (multiplier: number): BuildingUpgradeEffect => ({ kind: 'ALL_STATS', multiplier });

export const universalSystems = (multiplier: number): BuildingUpgradeOption => ({
  id: `system-overhaul-${Math.round((multiplier - 1) * 100)}`,
  name: multiplier >= 1.15 ? 'Masterwork Overhaul' : 'Integrated Systems',
  description: `Improves every applicable structural, combat, or production stat by ${Math.round((multiplier - 1) * 100)}%.`,
  effects: [allStats(multiplier)],
  aiPriority: 10
});

/** Add one composable Effect Tower mode without adding tower-specific branches to the shared engine. */
export const addTowerEffect = (effectId: import('../../types').TowerEffectId): BuildingUpgradeEffect => ({
  kind: 'ADD_TOWER_EFFECT', effectId
});
