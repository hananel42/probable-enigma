import type { Building, BuildingBlueprint, BuildingType, GameEntity, Projectile, ResourceNode } from '../types';
import type { GameEngineState } from '../engine';
import type { BuildingUpgradeTier, BuildingUpgradeStat } from '../upgrades/types';
import type { BuildingNeighborhood } from './neighbors';

export type BuildingCategory = 'COMMAND' | 'DEFENSE' | 'ECONOMY' | 'SUPPORT' | 'FORTIFICATION';
export type BuildingCombatRole = 'NONE' | 'WEAPON' | 'SPAWN' | 'SUPPORT' | 'FORTIFICATION';

export interface BuildingPresentation {
  category: BuildingCategory;
  combatRole: BuildingCombatRole;
  accentColor: string;
  glyph: string;
}

export interface BuildingDefinition extends BuildingBlueprint, BuildingPresentation {}

export interface BuildingStatLine {
  label: string;
  value: string;
  /** Optional plain-English tooltip that explains a non-obvious stat. */
  help?: string;
}

export interface BuildingDrawContext {
  ctx: CanvasRenderingContext2D;
  building: Building;
  left: number;
  top: number;
  width: number;
  height: number;
  accentColor: string;
  /** Simulation time in seconds for deterministic procedural animation. */
  timeSeconds: number;
  /** Cardinal neighbor data, computed once per render pass for all building modules. */
  neighbors: BuildingNeighborhood;
}

/** Fixed, compile-time behavior descriptors for the built-in building types. */
export type BuildingBehavior =
  | { kind: 'CORE' }
  | { kind: 'FORTIFICATION'; blocksGround: true; blocksAir: true }
  | {
      kind: 'PROJECTILE_WEAPON';
      scanInterval: number;
      defaultCooldown: number;
      projectileSpeed: number;
      projectileRadius: number;
      muzzleOffset: number;
      defaultDamage: number;
    }
  | {
      kind: 'EFFECT_WAVE';
      scanInterval: number;
      pulseDuration: number;
      defaultInterval: number;
      defaultRadius: number;
    }
  | {
      kind: 'HARVESTER_STATION';
      baseProductionInterval: number;
      defaultCapacity: number;
    }
  | {
      kind: 'DRONE_STATION';
      baseProductionInterval: number;
      defaultCapacity: number;
      baseDroneSpeed: number;
      maximumDroneSpeed: number;
      acceleration: number;
      arrivalSlowdownDistance: number;
      formationSpeed: number;
    };

/** Attributes affected by that structure's universal upgrade tier. */
export interface BuildingUpgradeScaling {
  multiply: BuildingUpgradeStat[];
  divide?: BuildingUpgradeStat[];
  increments?: Array<{ stat: BuildingUpgradeStat; amount: number; maximum: number }>;
  /** If armor already exists, universal systems add this factor times the upgrade bonus. */
  armorBonusFactor?: number;
}

/** Runtime services supplied by the engine. A module can implement a new mechanic without teaching the engine about its building type.
 * The context is deliberately world-oriented: human and AI-owned structures receive the same state and tick contract.
 */
export interface BuildingRuntimeContext {
  state: GameEngineState;
  dt: number;
  spawnEntity(entity: GameEntity): void;
  spawnProjectile(projectile: Projectile): void;
  damageEntity(entity: GameEntity, amount: number): void;
  damageBuilding(building: Building, amount: number, source?: Building): void;
  createSparks(x: number, y: number, color: string, count: number): void;
  playSound(sound: 'shoot' | 'build' | 'pulse' | 'explosion' | 'mine'): void;
  distance(ax: number, ay: number, bx: number, by: number): number;
  resourceNodes: ResourceNode[];
  /** Full shared threat-priority scan. Call only on the module's target-scan interval. */
  findPriorityTarget(building: Building, range: number):
    | { kind: 'ENTITY'; entity: GameEntity; distance: number }
    | { kind: 'BUILDING'; building: Building; distance: number }
    | undefined;
  /** Resolve the IDs selected by the most recent scan, checking current health, hostility and range. */
  resolveCachedTarget(building: Building, range: number):
    | { kind: 'ENTITY'; entity: GameEntity; distance: number }
    | { kind: 'BUILDING'; building: Building; distance: number }
    | undefined;
  triggerStateChange(): void;
}

export interface BuildingModule {
  definition: BuildingDefinition;
  behavior: BuildingBehavior;
  upgrades: BuildingUpgradeTier[];
  upgradeScaling: BuildingUpgradeScaling;
  draw: (context: BuildingDrawContext) => void;
  getStatLines: (building: Building, entities: GameEntity[]) => BuildingStatLine[];
  /** Optional behavior update for this built-in type; dispatched by the shared runtime. */
  update?: (building: Building, context: BuildingRuntimeContext) => void;
}
