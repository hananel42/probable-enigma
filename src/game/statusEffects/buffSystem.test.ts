import test from 'node:test';
import assert from 'node:assert/strict';
import type { BuffDefinition, GameEntity } from '../types';
import { applyBuff, BUFF_DEFINITIONS, getBuffMultiplier, tickBuffs } from './buffSystem';

function entity(): GameEntity {
  return { id: 'buff-target', kind: 'COMMANDER', faction: 'player', x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, speed: 100, radius: 10, isFlying: false };
}

test('burning is a data-driven damage-over-time buff with red particle events', () => {
  const target = entity();
  applyBuff(target, BUFF_DEFINITIONS.burning);
  const tick = tickBuffs(target, 1);
  assert.equal(tick.healthDelta, -14);
  assert.equal(tick.particles.reduce((sum, item) => sum + item.count, 0), 7);
  assert.equal(tick.particles[0].color, '#ef4444');
  assert.equal(target.buffs?.[0].remainingSeconds, 2);
});

test('buffs can define only the stats they need and can apply positive or negative modifiers', () => {
  const target = entity();
  const haste: BuffDefinition = { id: 'haste', name: 'Haste', durationSeconds: 2, modifiers: { speedMultiplier: 1.5, fireRateMultiplier: 1.2 } };
  const slow: BuffDefinition = { id: 'slow', name: 'Slow', durationSeconds: 2, modifiers: { speedMultiplier: 0.5 } };
  applyBuff(target, haste);
  applyBuff(target, slow);
  assert.equal(getBuffMultiplier(target, 'speedMultiplier'), 0.75);
  assert.equal(getBuffMultiplier(target, 'fireRateMultiplier'), 1.2);
  assert.equal(getBuffMultiplier(target, 'powerMultiplier'), 1);
});

test('health multiplier scales current and maximum health once, then restores on expiry', () => {
  const target = entity();
  target.hp = 50;
  applyBuff(target, { id: 'fortified', name: 'Fortified', durationSeconds: 1, modifiers: { healthMultiplier: 2 } });
  tickBuffs(target, 0.25);
  assert.equal(target.maxHp, 200);
  assert.equal(target.hp, 100);
  tickBuffs(target, 1);
  assert.equal(target.maxHp, 100);
  assert.equal(target.hp, 50);
});

test('expired buffs stop periodic effects and malformed dt fails loudly without mutating them', () => {
  const target = entity();
  applyBuff(target, BUFF_DEFINITIONS.burning);
  const before = target.buffs![0].remainingSeconds;
  assert.throws(() => tickBuffs(target, Number.NaN), /Buff tick delta must be finite/);
  assert.equal(target.buffs![0].remainingSeconds, before);
  const final = tickBuffs(target, 4);
  assert.equal(final.healthDelta, -42);
  assert.deepEqual(target.buffs, []);
  assert.deepEqual(final.expiredIds, ['burning']);
});

test('speed buffs affect the shared collision-aware commander movement primitive', async () => {
  const { moveCommanderWithCollision } = await import('../movement');
  const target = entity();
  applyBuff(target, { id: 'haste-move', name: 'Haste', durationSeconds: 2, modifiers: { speedMultiplier: 1.5 } });
  moveCommanderWithCollision(target, 1, 0, 1, [], []);
  assert.ok(Math.abs(target.x - 150) < 1e-9, `Haste should move the commander 150 px; received ${target.x}.`);
});

test('fire-rate and power buffs are consumed by the real player firing path', () => {
  // Importing the engine here exercises the same path the HUD uses, not just a helper.
  const engineModulePromise = import('../engine');
  return engineModulePromise.then(({ GameEngine }) => {
    const engine = new GameEngine();
    const player = engine.state.player;
    applyBuff(player, {
      id: 'overclock', name: 'Overclock', durationSeconds: 2,
      modifiers: { powerMultiplier: 2, fireRateMultiplier: 2 }
    });
    player.lastFireTime = 0.1;
    engine.setInputKey('Space', true);
    engine.step(0.01);
    engine.setInputKey('Space', false);
    assert.ok(engine.state.projectiles.length > 0, 'fire-rate multiplier should shorten the firing interval');
    assert.equal(engine.state.projectiles[0].damage, (player.damage || 30) * 2, 'power multiplier should scale projectile damage');
  });
});
