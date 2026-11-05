import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../engine';
import { BUILDING_MODULES } from './registry';
import type { BuildingRuntimeContext } from './types';

 test('engine dispatches module-owned behavior generically through the same world context', () => {
  const engine = new GameEngine();
  const module = BUILDING_MODULES.CORE;
  const previousUpdate = module.update;
  let calls = 0;
  let receivedContext: BuildingRuntimeContext | null = null;
  try {
    module.update = (_building, context) => {
      calls++;
      receivedContext = context;
    };
    engine.step(1 / 60);
    assert.ok(calls > 0, 'module-owned update should be called by the simulation');
    const context = receivedContext as BuildingRuntimeContext | null;
    if (!context) throw new Error('module should receive runtime services');
    assert.equal(context.state, engine.state, 'module receives the authoritative world rather than a player-only world');
    assert.equal(typeof context.spawnEntity, 'function');
    assert.equal(typeof context.damageBuilding, 'function');
    assert.equal(typeof context.spawnProjectile, 'function');
    assert.equal(module.behavior.kind, 'CORE', 'the module retains its fixed built-in behavior descriptor');
  } finally {
    module.update = previousUpdate;
  }
});

test('all active built-in mechanics are registered by their owning module, not by the generic runtime', () => {
  for (const type of ['AUTO_TURRET', 'FIRE_TOWER', 'HARVESTER_STATION', 'DRONE_STATION'] as const) {
    assert.equal(typeof BUILDING_MODULES[type].update, 'function', `${type} must own its update callback`);
  }
  assert.equal(BUILDING_MODULES.CORE.update, undefined, 'static Core objective lifecycle does not need a per-frame behavior callback');
  assert.equal(BUILDING_MODULES.WALL.update, undefined, 'static fortification does not need a per-frame behavior callback');
});

test('building registry is a closed list of built-in building types', () => {
  assert.deepEqual(Object.keys(BUILDING_MODULES).sort(), [
    'AUTO_TURRET', 'CORE', 'DRONE_STATION', 'FIRE_TOWER', 'HARVESTER_STATION', 'WALL'
  ].sort());
  for (const module of Object.values(BUILDING_MODULES)) {
    assert.notEqual(module.behavior.kind, 'CUSTOM');
  }
});
