import { BUILDING_MODULES } from '../buildings/registry';
import type { UpgradeableBuildingType, BuildingUpgradeTier } from './types';

export type { BuildingUpgradeStat, BuildingUpgradeEffect, BuildingUpgradeOption, BuildingUpgradeTier } from './types';

/**
 * Upgrade trees are authored beside the building they belong to and collected
 * here for the simulation. No upgrade descriptions/effects need to be edited in
 * the HUD or global controller when adding a building.
 */
export const BUILDING_UPGRADE_TREES = Object.fromEntries(
  (Object.keys(BUILDING_MODULES) as Array<keyof typeof BUILDING_MODULES>)
    .map(type => [type, BUILDING_MODULES[type].upgrades])
) as Record<UpgradeableBuildingType, BuildingUpgradeTier[]>;
