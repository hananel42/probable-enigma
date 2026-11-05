import type { Faction, ResourceType, Resources } from './ownership';

/** Resource deposits, projectiles, effects, and enemy-outpost runtime shapes. */
export interface ResourceNode {
  id: string;
  type: ResourceType;
  gx: number;
  gy: number;
  x: number;
  y: number;
  amount: number;
  maxAmount: number;
  radius: number;
  seed: number;
  chunkKey?: string;
}

export interface Projectile {
  id: string;
  /** Source owner for personal reward attribution after a hostile Core is destroyed. */
  ownerPlayerId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  faction: Faction;
  teamId?: string;
  allianceId?: string;
  color: string;
  radius: number;
  life: number;
  maxLife: number;
  /** World-space weapon origin and center-to-center range boundary. Required for every projectile. */
  rangeOriginX: number;
  rangeOriginY: number;
  maxRange: number;
  /** Optional guided-shot target selected when the turret fired. */
  targetEntityId?: string | null;
  targetBuildingId?: string | null;
  /** Maximum projectile turn rate in radians per second; deliberately bounded for dodgability. */
  homingStrength?: number;
  /** Splash is applied on direct impact to nearby hostiles, excluding the direct target. */
  explosionRadius?: number;
  explosionDamageMultiplier?: number;
}

export interface FloatingText {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
}

export interface Particle {
  /** Stable identity lets multiplayer deltas update only changed particle fields. */
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export type EnemyBaseStance = 'FORTIFYING' | 'DEFENDING' | 'ASSAULT';

export interface EnemyBase {
  id: string;
  teamId?: string;
  allianceId?: string;
  groupName?: string;
  commanderName?: string;
  groupColor?: string;
  gx: number;
  gy: number;
  x: number;
  y: number;
  coreId: string;
  commanderId: string; // The Enemy Commander Robot!
  level: number;
  raidTimer: number;
  raidInterval: number;
  isDestroyed: boolean;
  resources: Resources; // Symmetrical enemy economy
  buildTimer: number;
  repairTimer: number;
  stance?: EnemyBaseStance;
  stanceTimer?: number;
}
