/** Data-driven status definitions and active runtime copies. */
export type BuffStat = 'healthMultiplier' | 'speedMultiplier' | 'powerMultiplier' | 'fireRateMultiplier' | 'armorMultiplier';
export interface BuffModifiers {
  /** Multiplies maximum/current health proportionally while active. */
  healthMultiplier?: number;
  speedMultiplier?: number;
  powerMultiplier?: number;
  fireRateMultiplier?: number;
  /** Multiplies effective armor while a debuff is active. Values below 1 reduce armor. */
  armorMultiplier?: number;
}
export interface BuffVisualEffect {
  particleColor?: string;
  particleRate?: number;
  particleSize?: number;
  markerColor?: string;
  markerShape?: 'dot' | 'ring' | 'flame';
}
export type BuffReapplyPolicy = 'REFRESH' | 'EXTEND' | 'STRONGEST' | 'STACK';
export interface BuffDefinition {
  readonly id: string;
  readonly name: string;
  readonly durationSeconds: number;
  /** Positive heals, negative damages per second. Omit for buffs without periodic health change. */
  readonly healthPerSecond?: number;
  readonly modifiers?: Readonly<BuffModifiers>;
  readonly effect?: Readonly<BuffVisualEffect>;
  readonly reapply?: BuffReapplyPolicy;
  readonly maxStacks?: number;
}
/** Runtime copy of a data-defined buff; optional fields keep buffs lightweight. */
export interface ActiveBuff {
  id: string;
  remainingSeconds: number;
  healthPerSecond?: number;
  modifiers?: BuffModifiers;
  effect?: BuffVisualEffect;
  particleAccumulator?: number;
  stacks?: number;
}
