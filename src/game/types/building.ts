import type { BuildingType, DroneStationMode, Faction, Resources, TowerEffectId } from './ownership';

/** Mutable simulation representation of a placed structure. */
export interface Building {
  id: string;
  /** Stable human-player ownership, distinct from faction/alliance access. */
  ownerPlayerId?: string;
  /** Core whose survival gates this structure's operation. */
  coreId?: string;
  type: BuildingType;
  faction: Faction;
  /** Ownership/group identity. Members of other groups may still be allied. */
  teamId?: string;
  /** Groups sharing an alliance are friendly and may support one another's defenses. */
  allianceId?: string;
  gx: number;
  gy: number;
  widthInCells: number;
  heightInCells: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  lastActionTime: number;
  range: number;
  /** Ordered upgrade option IDs; defines the building's installed branch history and visual state. */
  upgradeIds: string[];
  /** Weapon stats are live runtime values modified by data-driven upgrade effects. */
  damage?: number;
  shotsPerAttack?: number;
  armor?: number;
  passiveRepairPerSecond?: number;
  burnDamagePerSecond?: number;
  // Harvester Station properties
  spawnTimer?: number;
  storedWood?: number;
  storedStone?: number;
  maxCapacity?: number;
  maxBots?: number;
  miningSpeedMultiplier?: number;
  botCargoCapacityMultiplier?: number;
  botProductionMultiplier?: number;
  // Drone Station properties
  droneMode?: DroneStationMode;
  /** Commander explicitly assigned to escort by the participant who last selected ESCORT. */
  escortCommanderId?: string;
  maxDrones?: number;
  droneProductionMultiplier?: number;
  droneDamageMultiplier?: number;
  droneHealthMultiplier?: number;
  droneSpeedMultiplier?: number;
  droneFireRateMultiplier?: number;
  // Fire Tower properties
  fireTimer?: number;
  fireRadius?: number;
  isPulsing?: boolean;
  pulseProgress?: number;
  /** Duration in seconds for an Effect Tower wave to travel from center to edge. */
  pulseDuration?: number;
  // Auto-Turret projectile modules; unset values use the documented module defaults.
  projectileSpeed?: number;
  projectileHomingStrength?: number;
  explosionRadius?: number;
  explosionDamageMultiplier?: number;
  // Wall defensive modules. Chance is clamped to [0, 1] by the runtime.
  projectileReflectChance?: number;
  // Effect Tower data: a structure may combine multiple effects through independent upgrades.
  towerEffectIds?: TowerEffectId[];
  effectDuration?: number;
  /** Entity IDs already affected during the current pulse; cleared when a new wave starts. */
  pulseAffectedIds?: string[];
  // Auto-Turret properties
  targetEntityId?: string | null;
  targetBuildingId?: string | null;
  targetScanTimer?: number;
  barrelAngle?: number;
  fireCooldown?: number;
}
