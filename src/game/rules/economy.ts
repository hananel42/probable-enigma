import type { Building, BuildingType, GameEntity, Resources } from '../types';
import { BUILDING_CATALOG, BUILDING_BLUEPRINTS } from '../content/buildingCatalog';
import { applyBuildingUpgrade, getBuildingUpgradeOptions } from '../upgrades/upgradeSystem';
import { MAX_BUILDING_LEVEL } from './constants';

/** A dead/respawning commander has no authority to issue build or interaction actions. */
export function isCommanderOperational(commander: Pick<GameEntity, 'hp' | 'isDead'>): boolean {
  return commander.hp > 0 && commander.isDead !== true;
}

function requireNonNegativeEconomyValue(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative; received ${value}.`);
  return value;
}

/** Return false only for a legitimate insufficient balance; malformed economy state is an error. */
export function canAfford(wallet: Resources, cost: Resources): boolean {
  requireNonNegativeEconomyValue(wallet.wood, 'Wallet wood');
  requireNonNegativeEconomyValue(wallet.stone, 'Wallet stone');
  requireNonNegativeEconomyValue(wallet.diamonds, 'Wallet diamonds');
  requireNonNegativeEconomyValue(cost.wood, 'Cost wood');
  requireNonNegativeEconomyValue(cost.stone, 'Cost stone');
  requireNonNegativeEconomyValue(cost.diamonds, 'Cost diamonds');
  return wallet.wood >= cost.wood && wallet.stone >= cost.stone && wallet.diamonds >= cost.diamonds;
}

/** Deduct a validated cost. Invalid economy state must fail loudly rather than become zero. */
export function deductCost(wallet: Resources, cost: Resources): Resources {
  const walletWood = requireNonNegativeEconomyValue(wallet.wood, 'Wallet wood');
  const walletStone = requireNonNegativeEconomyValue(wallet.stone, 'Wallet stone');
  const walletDiamonds = requireNonNegativeEconomyValue(wallet.diamonds, 'Wallet diamonds');
  const costWood = requireNonNegativeEconomyValue(cost.wood, 'Cost wood');
  const costStone = requireNonNegativeEconomyValue(cost.stone, 'Cost stone');
  const costDiamonds = requireNonNegativeEconomyValue(cost.diamonds, 'Cost diamonds');
  return {
    wood: Math.max(0, walletWood - costWood),
    stone: Math.max(0, walletStone - costStone),
    diamonds: Math.max(0, walletDiamonds - costDiamonds)
  };
}

export function getBaseCost(type: BuildingType): Resources {
  if (type === 'CORE') {
    return { ...BUILDING_CATALOG.CORE.cost };
  }
  return BUILDING_BLUEPRINTS[type].cost;
}

export function getBuildingBlueprint(type: BuildingType) {
  return BUILDING_CATALOG[type];
}

/**
 * Returns all discrete grid cells occupied by a building based on its footprint.
 */
export function getBuildingOccupiedCells(building: Building): Array<{ gx: number; gy: number }> {
  const cells: Array<{ gx: number; gy: number }> = [];
  const w = building.widthInCells || 1;
  const h = building.heightInCells || 1;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      cells.push({ gx: building.gx + dx, gy: building.gy + dy });
    }
  }
  return cells;
}

/**
 * Calculates strictly proportional repair cost based on missing HP fraction.
 */
export function getRepairCost(building: Building): Resources {
  if (!Number.isFinite(building.maxHp) || building.maxHp <= 0) throw new RangeError(`Building '${building.id}' has invalid maximum HP: ${building.maxHp}.`);
  if (!Number.isFinite(building.hp) || building.hp < 0 || building.hp > building.maxHp) {
    throw new RangeError(`Building '${building.id}' has invalid HP ${building.hp} for maximum ${building.maxHp}.`);
  }
  const currentHp = Math.max(0, Math.min(building.maxHp, building.hp));
  const missingHp = building.maxHp - currentHp;
  if (missingHp <= 1) return { wood: 0, stone: 0, diamonds: 0 };

  const damageRatio = Math.min(1, Math.max(0, missingHp / building.maxHp));
  const baseCost = getBaseCost(building.type);

  return {
    wood: baseCost.wood > 0 ? Math.max(1, Math.round(baseCost.wood * damageRatio)) : 0,
    stone: baseCost.stone > 0 ? Math.max(1, Math.round(baseCost.stone * damageRatio)) : 0,
    diamonds: 0
  };
}

export function repairBuilding(
  building: Building,
  wallet: Resources
): { building: Building; wallet: Resources; healed: number } {
  const cost = getRepairCost(building);
  // A destroyed structure is removed by the engine and cannot be revived by a
  // stale repair command racing the destruction tick.
  if (building.hp <= 0 || building.hp >= building.maxHp || !canAfford(wallet, cost)) {
    return { building, wallet, healed: 0 };
  }

  const updatedWallet = deductCost(wallet, cost);
  const healed = building.maxHp - building.hp;
  const updatedBuilding: Building = { ...building, hp: building.maxHp };

  return {
    building: updatedBuilding,
    wallet: updatedWallet,
    healed
  };
}

export function getBuildingUpgradeCost(building: Building, optionId?: string): Resources {
  if (building.level >= MAX_BUILDING_LEVEL) {
    return { wood: 999999, stone: 999999, diamonds: 999999 };
  }
  const base = getBaseCost(building.type);
  const multiplier = 1 + building.level * 0.75;
  const option = optionId
    ? getBuildingUpgradeOptions(building).find(candidate => candidate.id === optionId)
    : undefined;
  const cost: Resources = {
    wood: option?.cost?.wood ?? Math.round(base.wood * multiplier),
    stone: option?.cost?.stone ?? Math.round(base.stone * multiplier),
    diamonds: building.type === 'CORE' ? Math.max(1, option?.cost?.diamonds ?? 1) : 0
  };
  if (building.type !== 'CORE' && (option?.cost?.diamonds ?? 0) > 0) {
    throw new Error(`Upgrade '${option?.id ?? optionId ?? 'unknown'}' on ${building.type} cannot spend Diamonds; Diamonds are reserved for Core upgrades.`);
  }
  return cost;
}

/**
 * Salvage returns half of the resources invested in a structure, prorated by
 * its remaining HP. Investment includes every completed upgrade, using the same
 * upgrade-cost curve charged by the game. Core structures are intentionally not
 * dismantleable and should be filtered by the caller.
 */
export function getBuildingSalvageRefund(building: Building): Resources {
  if (!Number.isFinite(building.level) || building.level < 1) throw new RangeError(`Building '${building.id}' has invalid upgrade level: ${building.level}.`);
  if (!Number.isFinite(building.hp) || !Number.isFinite(building.maxHp) || building.maxHp <= 0 || building.hp < 0 || building.hp > building.maxHp) {
    throw new RangeError(`Building '${building.id}' has invalid HP ${building.hp} / ${building.maxHp} while calculating salvage.`);
  }
  const base = getBaseCost(building.type);
  let investedWood = base.wood;
  let investedStone = base.stone;
  const levelCount = Math.max(1, Math.floor(building.level));
  for (let level = 1; level < levelCount; level++) {
    const multiplier = 1 + level * 0.75;
    investedWood += Math.round(base.wood * multiplier);
    investedStone += Math.round(base.stone * multiplier);
  }
  const healthRatio = Math.max(0, Math.min(1, building.hp / building.maxHp));
  return {
    wood: Math.floor(investedWood * 0.5 * healthRatio),
    stone: Math.floor(investedStone * 0.5 * healthRatio),
    diamonds: 0
  };
}

/**
 * Applies a data-driven option from the current tier. Linear tiers can omit the
 * option id; branching tiers require an explicit id and otherwise remain unchanged.
 */
export function upgradeBuildingStats(building: Building, upgradeId?: string): Building {
  return applyBuildingUpgrade(building, upgradeId) ?? building;
}
