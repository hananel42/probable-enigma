import type { Building, GameEntity } from '../types';
import { BUILDING_MODULES } from '../buildings/registry';
import type { BuildingUpgradeOption, BuildingUpgradeStat, CommanderUpgradeStat } from './types';
import type { BuildingStatLine } from '../buildings/types';
import { assertFireTowerBuilding } from '../buildings/fireTower/state';

export type { BuildingStatLine } from '../buildings/types';

const MAX_ARMOR = 0.75;

export function getBuildingUpgradeTier(building: Building) {
  return BUILDING_MODULES[building.type].upgrades.find(tier => tier.targetLevel === building.level + 1);
}

/** The UI and simulation use this exact list, preventing mismatched branches. */
export function getBuildingUpgradeOptions(building: Building): BuildingUpgradeOption[] {
  return getBuildingUpgradeTier(building)?.options ?? [];
}

/** Shared Q/E upgrade keyboard mapping, also used by the HUD and regression tests. */
export function getUpgradeOptionForHotkey(building: Building, key: 'Q' | 'E'): BuildingUpgradeOption | undefined {
  const tier = getBuildingUpgradeTier(building);
  if (!tier) return undefined;
  if (tier.mode === 'CHOICE') return tier.options[key === 'Q' ? 0 : 1];
  return key === 'E' ? tier.options[0] : undefined;
}

export function getRecommendedBuildingUpgradeId(building: Building): string | undefined {
  const options = getBuildingUpgradeOptions(building);
  if (options.length === 0) return undefined;
  return [...options].sort((a, b) => b.aiPriority - a.aiPriority)[0].id;
}

/** Human-readable history is resolved from the module that owns each upgrade. */
export function getAppliedUpgradeNames(building: Building): string[] {
  if (building.upgradeIds.length === 0) return [];
  const nameById = new Map(
    BUILDING_MODULES[building.type].upgrades.flatMap(tier => tier.options.map(option => [option.id, option.name] as const))
  );
  return building.upgradeIds.map(id => nameById.get(id) || id);
}

function applyAllApplicableStats(building: Building, multiplier: number) {
  const profile = BUILDING_MODULES[building.type].upgradeScaling;
  const mutable = building as unknown as Record<BuildingUpgradeStat, number | undefined>;
  for (const stat of profile.multiply) {
    const current = mutable[stat];
    if (current === undefined) continue;
    const updated = current * multiplier;
    mutable[stat] = stat === 'maxHp' || stat === 'maxCapacity' ? Math.round(updated) : updated;
  }
  for (const stat of profile.divide || []) {
    const current = mutable[stat];
    if (current !== undefined && current > 0) mutable[stat] = current / multiplier;
  }
  for (const increment of profile.increments || []) {
    const current = mutable[increment.stat];
    if (current !== undefined) {
      mutable[increment.stat] = Math.min(increment.maximum, Math.round(current + increment.amount));
    }
  }
  if ((building.armor || 0) > 0 && profile.armorBonusFactor) {
    building.armor = Math.min(MAX_ARMOR, (building.armor || 0) + (multiplier - 1) * profile.armorBonusFactor);
  }
}

function applyStatEffect(building: Building, stat: BuildingUpgradeStat, kind: 'ADD' | 'MULTIPLY' | 'SET', value: number) {
  const mutable = building as unknown as Record<BuildingUpgradeStat, number | undefined>;
  const current = mutable[stat];
  if (kind === 'SET') {
    mutable[stat] = value;
  } else if (kind === 'ADD') {
    mutable[stat] = (current ?? 0) + value;
  } else if (current !== undefined) {
    mutable[stat] = current * value;
  } else if (stat.endsWith('Multiplier')) {
    mutable[stat] = value;
  }

  if (stat === 'armor') building.armor = Math.max(0, Math.min(MAX_ARMOR, building.armor || 0));
  if (stat === 'projectileReflectChance') building.projectileReflectChance = Math.max(0, Math.min(0.7, building.projectileReflectChance || 0));
  if (stat === 'projectileHomingStrength') building.projectileHomingStrength = Math.max(0, Math.min(3.2, building.projectileHomingStrength || 0));
  if (stat === 'explosionRadius') building.explosionRadius = Math.max(0, Math.min(120, building.explosionRadius || 0));
  if (stat === 'explosionDamageMultiplier') building.explosionDamageMultiplier = Math.max(0, Math.min(1.5, building.explosionDamageMultiplier || 0));
  if (stat === 'effectDuration') {
    assertFireTowerBuilding(building);
    building.effectDuration = Math.max(0.25, Math.min(8, building.effectDuration));
  }
  if (stat === 'pulseDuration') {
    assertFireTowerBuilding(building);
    building.pulseDuration = Math.max(0.15, Math.min(2, building.pulseDuration));
  }
  if (stat === 'maxBots' || stat === 'maxDrones' || stat === 'maxCapacity' || stat === 'shotsPerAttack') {
    const updated = mutable[stat];
    if (updated !== undefined) mutable[stat] = Math.max(1, Math.round(updated));
  }
}

/** Apply one option atomically. A branching tier must identify its option. */
export function applyBuildingUpgrade(building: Building, optionId?: string): Building | undefined {
  const options = getBuildingUpgradeOptions(building);
  if (options.length === 0) return undefined;
  const selected = optionId ? options.find(option => option.id === optionId) : options.length === 1 ? options[0] : undefined;
  if (!selected) return undefined;

  const upgraded: Building = { ...building };
  for (const effect of selected.effects ?? []) {
    if (effect.kind === 'ALL_STATS') applyAllApplicableStats(upgraded, effect.multiplier);
    else if (effect.kind === 'ADD_TOWER_EFFECT') {
      assertFireTowerBuilding(upgraded);
      upgraded.towerEffectIds = [...new Set([...upgraded.towerEffectIds, effect.effectId])];
    } else applyStatEffect(upgraded, effect.stat, effect.kind, effect.value);
  }

  upgraded.level = building.level + 1;
  upgraded.upgradeIds = [...building.upgradeIds, selected.id];
  upgraded.maxHp = Math.max(1, Math.round(upgraded.maxHp));
  // Regular structure upgrades restore the building as before. A Core upgrade only
  // records the Commander specialization, so it must not act as a free Core repair.
  upgraded.hp = building.type === 'CORE' ? Math.min(building.hp, upgraded.maxHp) : upgraded.maxHp;
  return upgraded;
}

/** Runtime values and specialized stat lines are supplied by each building module. */
export function getBuildingStatLines(building: Building, entities: GameEntity[] = []): BuildingStatLine[] {
  const armor = Math.max(0, Math.min(MAX_ARMOR, building.armor || 0));
  const lines: BuildingStatLine[] = [
    { label: 'MAX HP', value: `${Math.ceil(building.maxHp)}`, help: 'The total health pool. Incoming damage is subtracted from this value.' },
    { label: 'DAMAGE REDUCTION', value: `${Math.round(armor * 100)}%`, help: `Reduces every incoming hit by this percentage. Example: 100 raw damage removes ${Math.round(100 * (1 - armor))} HP.` }
  ];
  if ((building.passiveRepairPerSecond || 0) > 0) {
    lines.push({ label: 'SELF-REPAIR', value: `${(building.passiveRepairPerSecond || 0).toFixed(1)} HP/s` });
  }
  lines.push(...BUILDING_MODULES[building.type].getStatLines(building, entities));
  return lines;
}

const BUILDING_STAT_NAMES: Record<BuildingUpgradeStat, string> = {
  maxHp: 'Maximum HP', range: 'Range', damage: 'Damage', fireCooldown: 'Fire interval',
  fireRadius: 'Pulse radius', maxBots: 'Rover capacity', maxCapacity: 'Silo capacity',
  maxDrones: 'Drone capacity', shotsPerAttack: 'Shots per volley', armor: 'Damage reduction',
  passiveRepairPerSecond: 'Self-repair', burnDamagePerSecond: 'Burn damage',
  miningSpeedMultiplier: 'Mining speed', botCargoCapacityMultiplier: 'Rover cargo',
  botProductionMultiplier: 'Rover production', droneProductionMultiplier: 'Drone production',
  droneDamageMultiplier: 'Drone damage', droneHealthMultiplier: 'Drone HP',
  droneSpeedMultiplier: 'Drone speed', droneFireRateMultiplier: 'Drone fire rate',
  projectileSpeed: 'Projectile speed', projectileHomingStrength: 'Projectile guidance',
  explosionRadius: 'Explosion radius', explosionDamageMultiplier: 'Splash damage',
  projectileReflectChance: 'Projectile reflection chance', effectDuration: 'Effect duration',
  pulseDuration: 'Wave travel duration'
};

const COMMANDER_STAT_NAMES: Record<CommanderUpgradeStat, string> = {
  speed: 'Commander movement speed', damage: 'Commander weapon damage', range: 'Commander weapon range',
  fireCooldown: 'Commander fire rate', maxHp: 'Commander max HP', armor: 'Commander damage reduction',
  miningSpeedMultiplier: 'Commander mining speed', miningYieldMultiplier: 'Commander mining yield'
};

function describeEffect(stat: string, kind: 'ADD' | 'MULTIPLY' | 'SET', value: number, names: Record<string, string>) {
  const label = names[stat] || stat;
  if (kind === 'SET') return `${label} = ${value}`;
  if (kind === 'ADD' && stat === 'armor') return `${label} +${Math.round(value * 100)} percentage points`;
  if (kind === 'MULTIPLY' && stat === 'fireCooldown') {
    const rateChange = value > 0 ? Math.round((1 / value - 1) * 100) : 0;
    return `Fire rate ${rateChange >= 0 ? '+' : ''}${rateChange}%`;
  }
  if (kind === 'MULTIPLY' && stat === 'maxHp') return `${label} +${Math.round((value - 1) * 100)}%`;
  if (kind === 'MULTIPLY') {
    const percent = Math.round((value - 1) * 100);
    return `${label} ${percent >= 0 ? '+' : ''}${percent}%`;
  }
  const sign = value > 0 ? '+' : '';
  if (stat === 'armor') return `${label} ${sign}${Math.round(value * 100)} percentage points`;
  return `${label} ${sign}${value}`;
}

export function describeUpgradeEffects(option: BuildingUpgradeOption): string[] {
  const buildingEffects = (option.effects ?? []).map(effect => {
    if (effect.kind === 'ALL_STATS') return `All applicable structure stats +${Math.round((effect.multiplier - 1) * 100)}%`;
    if (effect.kind === 'ADD_TOWER_EFFECT') return `Adds ${effect.effectId.replaceAll('-', ' ')} effect`;
    return describeEffect(effect.stat, effect.kind, effect.value, BUILDING_STAT_NAMES);
  });
  const commanderEffects = (option.commanderEffects || []).map(effect =>
    describeEffect(effect.stat, effect.kind, effect.value, COMMANDER_STAT_NAMES)
  );
  return [...buildingEffects, ...commanderEffects];
}

/** Applies Core-selected upgrades to the Commander controlled by that Core. */
export function applyCommanderUpgradeEffects(commander: GameEntity, option: BuildingUpgradeOption): void {
  const previousMaxHp = commander.maxHp;
  const previousHp = commander.hp;
  const mutable = commander as unknown as Record<CommanderUpgradeStat, number | undefined>;

  for (const effect of option.commanderEffects || []) {
    const fallback = effect.stat === 'armor' ? 0
      : effect.stat === 'miningSpeedMultiplier' || effect.stat === 'miningYieldMultiplier' ? 1
      : 0;
    const current = mutable[effect.stat] ?? fallback;
    if (effect.kind === 'SET') mutable[effect.stat] = effect.value;
    else if (effect.kind === 'ADD') mutable[effect.stat] = current + effect.value;
    else mutable[effect.stat] = current * effect.value;
  }

  commander.armor = Math.max(0, Math.min(MAX_ARMOR, commander.armor || 0));
  commander.speed = Math.max(1, commander.speed);
  commander.damage = Math.max(1, commander.damage || 1);
  commander.fireCooldown = Math.max(0.045, commander.fireCooldown || 0.18);
  commander.miningSpeedMultiplier = Math.max(0.25, commander.miningSpeedMultiplier || 1);
  commander.miningYieldMultiplier = Math.max(0.25, commander.miningYieldMultiplier || 1);
  commander.range = Math.max(80, commander.range || 320);
  commander.maxHp = Math.max(1, Math.round(commander.maxHp));
  if (commander.maxHp !== previousMaxHp) {
    // HP-capacity upgrades also grant the newly added capacity immediately.
    commander.hp = Math.max(0, Math.min(commander.maxHp, previousHp + (commander.maxHp - previousMaxHp)));
  } else {
    commander.hp = Math.max(0, Math.min(commander.maxHp, commander.hp));
  }
}
