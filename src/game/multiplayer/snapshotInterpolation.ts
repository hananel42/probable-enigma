import type { GameEntity, Particle, Projectile, FloatingText, EnemyBase } from '../types';
import type { GameSnapshot } from '../server/protocol';

export interface EntityRenderPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly hp: number;
  readonly angle: number;
  readonly visualAngle?: number;
  readonly isDead?: boolean;
}

export interface ProjectileRenderPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly life: number;
}

export interface ParticleRenderPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly life: number;
  readonly alpha: number;
}

export interface FloatingTextRenderPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vy: number;
  readonly life: number;
}

export interface EnemyBaseRenderPose {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly raidTimer: number;
  readonly buildTimer: number;
}

/** Small, render-only state; deliberately excludes large static arrays like world resources. */
export interface InterpolatedRenderState {
  readonly gameTime: number;
  readonly camera: Readonly<{ x: number; y: number; zoom: number }>;
  readonly entities: readonly EntityRenderPose[];
  readonly projectiles: readonly ProjectileRenderPose[];
  readonly particles: readonly ParticleRenderPose[];
  readonly floatingTexts: readonly FloatingTextRenderPose[];
  readonly enemyBases: readonly EnemyBaseRenderPose[];
}

export interface TimedGameSnapshot {
  readonly receivedAtMs: number;
  readonly snapshot: GameSnapshot;
}

interface TimedRenderState {
  readonly receivedAtMs: number;
  readonly state: InterpolatedRenderState;
}

const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;

function lerpAngle(a: number, b: number, amount: number): number {
  const difference = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + difference * amount;
}

function interpolateRecord<T extends { id: string }>(
  previous: T | undefined,
  current: T,
  amount: number,
  numericFields: readonly (keyof T)[],
  angleFields: readonly (keyof T)[] = []
): T {
  if (!previous) return current;
  const result = { ...current } as T;
  const mutable = result as Record<keyof T, unknown>;
  for (const key of numericFields) {
    const from = previous[key];
    const to = current[key];
    if (typeof from === 'number' && typeof to === 'number' && Number.isFinite(from) && Number.isFinite(to)) {
      mutable[key] = lerp(from, to, amount);
    }
  }
  for (const key of angleFields) {
    const from = previous[key];
    const to = current[key];
    if (typeof from === 'number' && typeof to === 'number' && Number.isFinite(from) && Number.isFinite(to)) {
      mutable[key] = lerpAngle(from, to, amount);
    }
  }
  return result;
}

function interpolateCollection<T extends { id: string }>(
  previous: readonly T[],
  current: readonly T[],
  amount: number,
  numericFields: readonly (keyof T)[],
  angleFields: readonly (keyof T)[] = []
): T[] {
  const previousById = new Map(previous.map(item => [item.id, item]));
  return current.map(item => interpolateRecord(previousById.get(item.id), item, amount, numericFields, angleFields));
}

/** Capture only fields whose visual continuity matters; never retain a full world snapshot. */
export function captureRenderState(snapshot: GameSnapshot): InterpolatedRenderState {
  return {
    gameTime: snapshot.gameTime,
    camera: { x: snapshot.camera.x, y: snapshot.camera.y, zoom: snapshot.camera.zoom },
    entities: snapshot.entities.map((entity: GameEntity) => ({
      id: entity.id, x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy,
      hp: entity.hp, angle: entity.angle, visualAngle: entity.visualAngle, isDead: entity.isDead
    })),
    projectiles: snapshot.projectiles.map((projectile: Projectile) => ({
      id: projectile.id, x: projectile.x, y: projectile.y, vx: projectile.vx, vy: projectile.vy, life: projectile.life
    })),
    particles: snapshot.particles.map((particle: Particle) => ({
      id: particle.id, x: particle.x, y: particle.y, vx: particle.vx, vy: particle.vy, life: particle.life, alpha: particle.alpha
    })),
    floatingTexts: snapshot.floatingTexts.map((floating: FloatingText) => ({
      id: floating.id, x: floating.x, y: floating.y, vy: floating.vy, life: floating.life
    })),
    enemyBases: snapshot.enemyBases.map((base: EnemyBase) => ({
      id: base.id, x: base.x, y: base.y, raidTimer: base.raidTimer, buildTimer: base.buildTimer
    }))
  };
}

export function interpolateRenderStates(
  previous: InterpolatedRenderState,
  current: InterpolatedRenderState,
  amount: number
): InterpolatedRenderState {
  if (!Number.isFinite(amount)) throw new RangeError(`Interpolation amount must be finite; received ${amount}.`);
  const t = Math.max(0, Math.min(1, amount));
  return {
    gameTime: lerp(previous.gameTime, current.gameTime, t),
    camera: {
      x: lerp(previous.camera.x, current.camera.x, t),
      y: lerp(previous.camera.y, current.camera.y, t),
      zoom: lerp(previous.camera.zoom, current.camera.zoom, t)
    },
    entities: interpolateCollection(previous.entities, current.entities, t,
      ['x', 'y', 'vx', 'vy', 'hp'], ['angle', 'visualAngle']),
    projectiles: interpolateCollection(previous.projectiles, current.projectiles, t,
      ['x', 'y', 'vx', 'vy', 'life']),
    particles: interpolateCollection(previous.particles, current.particles, t,
      ['x', 'y', 'vx', 'vy', 'life', 'alpha']),
    floatingTexts: interpolateCollection(previous.floatingTexts, current.floatingTexts, t,
      ['x', 'y', 'vy', 'life']),
    enemyBases: interpolateCollection(previous.enemyBases, current.enemyBases, t,
      ['x', 'y', 'raidTimer', 'buildTimer'])
  };
}

/** Time-buffered interpolation over compact render poses, not whole world snapshots. */
export class SnapshotInterpolationBuffer {
  private readonly samples: TimedRenderState[] = [];

  constructor(private readonly maxSamples = 12) {
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 2) {
      throw new RangeError(`Snapshot interpolation buffer requires at least two samples; received ${maxSamples}.`);
    }
  }

  push(sample: TimedGameSnapshot): void {
    if (!Number.isFinite(sample.receivedAtMs)) throw new RangeError('Snapshot receive timestamp must be finite.');
    const last = this.samples[this.samples.length - 1];
    if (last && sample.receivedAtMs < last.receivedAtMs) {
      throw new Error(`Snapshot interpolation samples must be time-ordered (${sample.receivedAtMs} < ${last.receivedAtMs}).`);
    }
    const compact = { receivedAtMs: sample.receivedAtMs, state: captureRenderState(sample.snapshot) };
    if (last && sample.receivedAtMs === last.receivedAtMs) this.samples[this.samples.length - 1] = compact;
    else this.samples.push(compact);
    while (this.samples.length > this.maxSamples) this.samples.shift();
  }

  sampleAt(targetTimeMs: number): InterpolatedRenderState | null {
    if (!Number.isFinite(targetTimeMs)) throw new RangeError(`Interpolation target timestamp must be finite; received ${targetTimeMs}.`);
    if (this.samples.length === 0) return null;
    if (this.samples.length === 1 || targetTimeMs <= this.samples[0].receivedAtMs) return this.samples[0].state;
    const last = this.samples[this.samples.length - 1];
    if (targetTimeMs >= last.receivedAtMs) return last.state;

    while (this.samples.length > 2 && this.samples[1].receivedAtMs <= targetTimeMs) this.samples.shift();
    const previous = this.samples[0];
    const next = this.samples[1];
    if (!next || targetTimeMs >= next.receivedAtMs) return previous.state;
    const span = next.receivedAtMs - previous.receivedAtMs;
    if (span <= 0) throw new Error(`Snapshot interpolation timestamps are not strictly increasing (${previous.receivedAtMs}, ${next.receivedAtMs}).`);
    return interpolateRenderStates(previous.state, next.state, (targetTimeMs - previous.receivedAtMs) / span);
  }

  clear(): void {
    this.samples.length = 0;
  }
}
