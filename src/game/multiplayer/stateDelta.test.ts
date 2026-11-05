import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStateDelta, diffState, type JsonValue } from './stateDelta';

test('state delta sends only changed fields and entity collection operations', () => {
  const before = {
    gameTime: 12,
    resources: { wood: 25, stone: 50 , diamonds: 0 },
    entities: [
      { id: 'commander-a', x: 100, y: 200, hp: 80 },
      ...Array.from({ length: 48 }, (_, index) => ({ id: `drone-${index}`, x: index * 5, y: index * 7, hp: 30, vx: 0, vy: 0, faction: 'player', ownerPlayerId: 'host' }))
    ],
    buildings: Array.from({ length: 24 }, (_, index) => ({ id: `building-${index}`, hp: 500, x: index * 48, y: index * 48, level: 1 })),
    selectedStationId: null
  };
  const after = {
    gameTime: 12.1,
    resources: { wood: 20, stone: 50 , diamonds: 0 },
    entities: [
      { id: 'commander-a', x: 104, y: 200, hp: 80 },
      ...Array.from({ length: 47 }, (_, index) => ({ id: `drone-${index}`, x: index === 10 ? 123 : index * 5, y: index === 10 ? 144 : index * 7, hp: 30, vx: 0, vy: 0, faction: 'player', ownerPlayerId: 'host' })),
      { id: 'drone-new', x: 400, y: 450, hp: 28, vx: 0, vy: 0, faction: 'player', ownerPlayerId: 'host' }
    ],
    buildings: Array.from({ length: 24 }, (_, index) => ({ id: `building-${index}`, hp: index === 5 ? 499 : 500, x: index * 48, y: index * 48, level: 1 })),
    selectedStationId: 'station-1'
  };
  const delta = diffState(before, after);
  const serialized = JSON.stringify(delta);
  assert.ok(serialized.length < JSON.stringify(after).length, 'delta should be smaller than the full state fixture');
  const entitiesPatch = delta.find(operation => operation.op === 'collection' && operation.path.join('.') === 'entities');
  if (!entitiesPatch || entitiesPatch.op !== 'collection') throw new Error('Expected an entity collection delta.');
  assert.equal(entitiesPatch.order, undefined, 'a remove plus an end-append must not resend the collection order');
  assert.equal(entitiesPatch.added[0]?.index, 48);
  assert.deepEqual(applyStateDelta(before, delta), after);
});

test('state delta preserves collection ordering when entities move in the array', () => {
  const before = { entities: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'c', x: 3 }] };
  const after = { entities: [{ id: 'c', x: 4 }, { id: 'a', x: 1 }, { id: 'b', x: 2 }] };
  assert.deepEqual(applyStateDelta(before, diffState(before, after)), after);
});

test('state delta supports nested object keys, removals, and additions', () => {
  const before = { camera: { x: 1, y: 2, zoom: 1 }, obsolete: true, groups: [] as Array<{ id: string; name: string }> };
  const after = { camera: { x: 1, y: 3, zoom: 1.2 }, groups: [{ id: 'g1', name: 'Alpha' }] };
  assert.deepEqual(applyStateDelta(before, diffState(before, after)), after);
});

test('malformed collection removal is rejected instead of repaired silently', () => {
  const base = { entities: [{ id: 'existing', x: 1 }] } as { entities: JsonValue[] };
  const malformed = [{ op: 'collection', path: ['entities'], keyField: 'id', removed: ['missing'], added: [], updated: [] }] as const;
  assert.throws(() => applyStateDelta(base, malformed as never), /remove missing collection key/);
});


test('indexed collection insertion preserves order without transmitting every existing key', () => {
  const before = { entities: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'c', x: 3 }] };
  const after = { entities: [{ id: 'new', x: 0 }, { id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'c', x: 3 }] };
  const delta = diffState(before, after);
  const patch = delta.find(operation => operation.op === 'collection');
  if (!patch || patch.op !== 'collection') throw new Error('Expected an entity collection delta.');
  assert.equal(patch.order, undefined, 'a simple insertion must use its index instead of a full ordering list');
  assert.deepEqual(patch.added.map(item => item.index), [0]);
  assert.deepEqual(applyStateDelta(before, delta), after);
});
