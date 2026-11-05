import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRadialExplosion } from './explosions';

test('shared radial explosion applies quadratic falloff and zero damage at the edge', () => {
  const targets = [
    { id: 'center', x: 0, y: 0 },
    { id: 'half', x: 50, y: 0 },
    { id: 'edge', x: 100, y: 0 },
    { id: 'outside', x: 101, y: 0 }
  ];
  const damage = new Map<string, number>();
  applyRadialExplosion({
    origin: { x: 0, y: 0 }, radius: 100, baseDamage: 200,
    falloff: 'quadratic', targets, canDamage: () => true,
    applyDamage: (target, amount) => damage.set(target.id, amount)
  });
  assert.strictEqual(damage.get('center'), 200);
  assert.strictEqual(damage.get('half'), 50);
  assert.strictEqual(damage.has('edge'), false);
  assert.strictEqual(damage.has('outside'), false);
});

test('shared radial explosion preserves flat projectile damage and target-radius reach', () => {
  const target = { id: 'target', x: 115, y: 0, radius: 20 };
  let applied = 0;
  applyRadialExplosion({
    origin: { x: 0, y: 0 }, radius: 100, baseDamage: 40,
    falloff: 'flat', targets: [target], getCollisionRadius: item => item.radius,
    canDamage: () => true, applyDamage: (_item, amount) => { applied = amount; }
  });
  assert.strictEqual(applied, 40);
});
