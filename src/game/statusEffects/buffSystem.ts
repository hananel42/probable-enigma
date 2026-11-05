import type { ActiveBuff, BuffDefinition, BuffModifiers, BuffVisualEffect, GameEntity } from '../types';
import { BUFF_DEFINITIONS } from './buffDefinitions';
export { BUFF_DEFINITIONS } from './buffDefinitions';
export interface BuffApplicationOverrides {
  durationSeconds?: number;
  healthPerSecond?: number;
  modifiers?: BuffModifiers;
  effect?: BuffVisualEffect;
}
export interface BuffParticleEvent { color: string; count: number; size: number; }
export interface BuffTickResult { healthDelta: number; particles: BuffParticleEvent[]; expiredIds: string[]; }


function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite; received ${value}.`);
  return value;
}

function requireFiniteNonNegative(value: number, label: string): number {
  requireFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative; received ${value}.`);
  return value;
}

function clampMultiplier(value: number): number {
  requireFinite(value, 'Buff multiplier');
  return Math.max(0.05, Math.min(20, value));
}

export function applyBuff(entity: GameEntity, definition: BuffDefinition, overrides: BuffApplicationOverrides = {}): void {
  const duration = requireFiniteNonNegative(overrides.durationSeconds ?? definition.durationSeconds, `Buff '${definition.id}' duration`);
  const healthPerSecond = overrides.healthPerSecond ?? definition.healthPerSecond;
  if (healthPerSecond !== undefined) requireFinite(healthPerSecond, `Buff '${definition.id}' healthPerSecond`);
  const modifiers = { ...definition.modifiers, ...overrides.modifiers };
  for (const [stat, value] of Object.entries(modifiers)) {
    if (value !== undefined) requireFinite(value, `Buff '${definition.id}' modifier '${stat}'`);
  }
  const effect = { ...definition.effect, ...overrides.effect };
  if (effect.particleRate !== undefined) requireFiniteNonNegative(effect.particleRate, `Buff '${definition.id}' particleRate`);
  if (effect.particleSize !== undefined) requireFiniteNonNegative(effect.particleSize, `Buff '${definition.id}' particleSize`);
  if (duration <= 0) return;
  const incoming: ActiveBuff = {
    id: definition.id,
    remainingSeconds: duration,
    healthPerSecond,
    modifiers,
    effect,
    particleAccumulator: 0,
    stacks: 1
  };
  entity.buffs ??= [];
  const existing = entity.buffs.find(buff => buff.id === definition.id);
  if (!existing) { entity.buffs.push(incoming); return; }

  switch (definition.reapply ?? 'REFRESH') {
    case 'REFRESH':
      existing.remainingSeconds = duration;
      existing.healthPerSecond = incoming.healthPerSecond;
      existing.modifiers = incoming.modifiers;
      existing.effect = incoming.effect;
      break;
    case 'EXTEND':
      existing.remainingSeconds = Math.min(60, existing.remainingSeconds + duration);
      break;
    case 'STRONGEST':
      existing.remainingSeconds = Math.max(existing.remainingSeconds, duration);
      if (Math.abs(incoming.healthPerSecond ?? 0) > Math.abs(existing.healthPerSecond ?? 0)) existing.healthPerSecond = incoming.healthPerSecond;
      existing.modifiers = chooseStrongerModifiers(existing.modifiers, incoming.modifiers);
      existing.effect = incoming.effect ?? existing.effect;
      break;
    case 'STACK': {
      const maxStacks = Math.max(1, definition.maxStacks ?? 3);
      existing.stacks = Math.min(maxStacks, (existing.stacks ?? 1) + 1);
      existing.remainingSeconds = Math.max(existing.remainingSeconds, duration);
      break;
    }
  }
}

function chooseStrongerModifiers(current: BuffModifiers | undefined, incoming: BuffModifiers | undefined): BuffModifiers {
  const result: BuffModifiers = { ...current };
  for (const key of ['healthMultiplier', 'speedMultiplier', 'powerMultiplier', 'fireRateMultiplier', 'armorMultiplier'] as const) {
    const next = incoming?.[key];
    if (next === undefined) continue;
    const previous = current?.[key] ?? 1;
    if (Math.abs(next - 1) >= Math.abs(previous - 1)) result[key] = next;
  }
  return result;
}

export function getBuffMultiplier(entity: Pick<GameEntity, 'buffs'>, stat: keyof BuffModifiers): number {
  let multiplier = 1;
  for (const buff of entity.buffs ?? []) {
    if (buff.remainingSeconds <= 0) continue;
    const value = buff.modifiers?.[stat];
    if (value !== undefined) multiplier *= clampMultiplier(value) ** Math.max(1, Math.floor(buff.stacks ?? 1));
  }
  return clampMultiplier(multiplier);
}

/** Advances buff timers and returns effects for the engine to apply through its normal damage/particle paths. */
export function tickBuffs(entity: GameEntity, dt: number): BuffTickResult {
  requireFiniteNonNegative(dt, 'Buff tick delta');
  const result: BuffTickResult = { healthDelta: 0, particles: [], expiredIds: [] };
  if (dt === 0) return result;


  const before = entity.buffs ?? [];
  const alive: ActiveBuff[] = [];
  for (const buff of before) {
    requireFiniteNonNegative(buff.remainingSeconds, `Buff '${buff.id}' remaining duration`);
    const stacksValue = buff.stacks ?? 1;
    requireFiniteNonNegative(stacksValue, `Buff '${buff.id}' stacks`);
    if (buff.healthPerSecond !== undefined) requireFinite(buff.healthPerSecond, `Buff '${buff.id}' healthPerSecond`);
    if (buff.remainingSeconds <= 0) {
      result.expiredIds.push(buff.id);
      continue;
    }
    const activeDt = Math.min(dt, buff.remainingSeconds);
    const stacks = Math.max(1, Math.floor(stacksValue));
    if (buff.healthPerSecond !== undefined) result.healthDelta += buff.healthPerSecond * activeDt * stacks;
    const rate = requireFiniteNonNegative(buff.effect?.particleRate ?? 0, `Buff '${buff.id}' particleRate`);
    if (rate > 0 && buff.effect?.particleColor) {
      const previousAccumulator = requireFiniteNonNegative(buff.particleAccumulator ?? 0, `Buff '${buff.id}' particle accumulator`);
      buff.particleAccumulator = previousAccumulator + activeDt * rate;
      const count = Math.floor(buff.particleAccumulator);
      if (count > 0) {
        buff.particleAccumulator -= count;
        result.particles.push({ color: buff.effect.particleColor, count: Math.min(20, count), size: requireFiniteNonNegative(buff.effect.particleSize ?? 2, `Buff '${buff.id}' particleSize`) });
      }
    }
    buff.remainingSeconds = Math.max(0, buff.remainingSeconds - dt);
    if (buff.remainingSeconds > 0) alive.push(buff);
    else result.expiredIds.push(buff.id);
  }
  entity.buffs = alive;

  // Apply health modifiers only when the aggregate multiplier changes. Scaling current HP
  // proportionally avoids free healing/damage when a temporary max-health buff expires.
  const previousMultiplier = clampMultiplier(entity.appliedBuffHealthMultiplier ?? 1);
  const nextMultiplier = getBuffMultiplier(entity, 'healthMultiplier');
  if (Math.abs(previousMultiplier - nextMultiplier) > 1e-6) {
    const ratio = nextMultiplier / previousMultiplier;
    entity.maxHp = Math.max(1, entity.maxHp * ratio);
    entity.hp = Math.max(0, Math.min(entity.maxHp, entity.hp * ratio));
    entity.appliedBuffHealthMultiplier = nextMultiplier;
  }
  return result;
}

export function getActiveBuffDefinitions(entity: Pick<GameEntity, 'buffs'>): readonly ActiveBuff[] {
  return (entity.buffs ?? []).filter(buff => buff.remainingSeconds > 0);
}

/** Removes all active effects and restores the unmodified health capacity. Used on death/reset. */
export function clearBuffs(entity: GameEntity): void {
  const applied = clampMultiplier(entity.appliedBuffHealthMultiplier ?? 1);
  if (Math.abs(applied - 1) > 1e-6) {
    entity.maxHp = Math.max(1, entity.maxHp / applied);
    entity.hp = Math.max(0, Math.min(entity.maxHp, entity.hp / applied));
  }
  entity.appliedBuffHealthMultiplier = 1;
  entity.buffs = [];
}
