import type { BuildingType, Resources, TowerEffectId } from '../types';

/** Numeric properties that may be changed by an upgrade definition. */
export type BuildingUpgradeStat =
  | 'maxHp'
  | 'range'
  | 'damage'
  | 'fireCooldown'
  | 'fireRadius'
  | 'maxBots'
  | 'maxCapacity'
  | 'maxDrones'
  | 'shotsPerAttack'
  | 'armor'
  | 'passiveRepairPerSecond'
  | 'burnDamagePerSecond'
  | 'miningSpeedMultiplier'
  | 'botCargoCapacityMultiplier'
  | 'botProductionMultiplier'
  | 'droneProductionMultiplier'
  | 'droneDamageMultiplier'
  | 'droneHealthMultiplier'
  | 'droneSpeedMultiplier'
  | 'droneFireRateMultiplier'
  | 'projectileSpeed'
  | 'projectileHomingStrength'
  | 'explosionRadius'
  | 'explosionDamageMultiplier'
  | 'projectileReflectChance'
  | 'effectDuration'
  | 'pulseDuration';

export type BuildingUpgradeEffect =
  | { kind: 'ADD'; stat: BuildingUpgradeStat; value: number }
  | { kind: 'MULTIPLY'; stat: BuildingUpgradeStat; value: number }
  | { kind: 'SET'; stat: BuildingUpgradeStat; value: number }
  | { kind: 'ALL_STATS'; multiplier: number }
  | { kind: 'ADD_TOWER_EFFECT'; effectId: TowerEffectId };

/** Commander attributes unlocked by upgrading a Core. Effects are applied to the living Commander entity, not to the Core's combat stats. */
export type CommanderUpgradeStat =
  | 'speed'
  | 'damage'
  | 'range'
  | 'fireCooldown'
  | 'maxHp'
  | 'armor'
  | 'miningSpeedMultiplier'
  | 'miningYieldMultiplier';

export type CommanderUpgradeEffect =
  | { kind: 'ADD' | 'MULTIPLY' | 'SET'; stat: CommanderUpgradeStat; value: number };

export interface BuildingUpgradeOption {
  /** Internal progression ID. Rename it directly across code, tests, and current save schema while the project is in development. */
  id: string;
  name: string;
  description: string;
  /** Structure effects; Core branches may instead contain Commander-only effects. */
  effects?: BuildingUpgradeEffect[];
  /** Optional Core-specific effects applied to the friendly/enemy Commander owned by this Core. */
  commanderEffects?: CommanderUpgradeEffect[];
  /** Optional exact per-branch cost. Omitted resources use the normal tier cost; Core options always cost at least one diamond. */
  cost?: Partial<Resources>;
  /** Higher values are preferred by autonomous commanders when options are otherwise comparable. */
  aiPriority: number;
}

export interface BuildingUpgradeTier {
  /** The building level after this upgrade is completed. */
  targetLevel: number;
  title: string;
  mode: 'CHOICE' | 'LINEAR';
  options: BuildingUpgradeOption[];
}

export type UpgradeableBuildingType = BuildingType;
