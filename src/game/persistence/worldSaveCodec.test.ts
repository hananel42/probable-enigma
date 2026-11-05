import assert from 'node:assert/strict';
import test from 'node:test';
import { GameEngine } from '../engine';
import { createBuildingInstance } from '../rules/entities';
import {
  createPersistableSnapshot,
  createWorldExport,
  parseWorldExport,
  validatePersistedWorldState,
  type PersistedWorldState
} from './worldSaveCodec';

function createTestState(): { worldSeed: number; state: PersistedWorldState } {
  const worldSeed = 0x1234abcd;
  const engine = new GameEngine(worldSeed);
  return {
    worldSeed,
    state: {
      schemaVersion: 3,
      worldSeed,
      savedAtMs: 1_800_000_000_000,
      activeChunkKeys: engine.getLoadedChunkKeys(),
      snapshot: createPersistableSnapshot(engine.state)
    }
  };
}

test('world-save codec removes transient visual and combat arrays before cloning durable state', () => {
  const engine = new GameEngine(42);
  engine.state.projectiles.push({
    id: 'test-projectile', x: 1, y: 2, vx: 3, vy: 4, damage: 5, rangeOriginX: 1, rangeOriginY: 2, maxRange: 1000,
    faction: 'player', color: '#ffffff', radius: 2, life: 1, maxLife: 1
  });
  engine.state.particles.push({
    id: 'test-particle', x: 1, y: 2, vx: 0, vy: 0, color: '#fff', size: 1, alpha: 1, life: 1, maxLife: 1
  });
  engine.state.floatingTexts.push({ id: 'test-text', x: 1, y: 2, text: '1', color: '#fff', life: 1, vy: 0 });

  const saved = createPersistableSnapshot(engine.state);
  assert.deepEqual(saved.projectiles, []);
  assert.deepEqual(saved.particles, []);
  assert.deepEqual(saved.floatingTexts, []);
  assert.equal(saved.entities.length, engine.state.entities.length);
  assert.equal(saved.buildings.length, engine.state.buildings.length);
});

test('world export/import round-trips a valid world and preserves seed, simulation time and economy', () => {
  const { worldSeed, state } = createTestState();
  state.snapshot.gameTime = 321.5;
  state.snapshot.resources.wood = 88;
  state.snapshot.humanPlayers[0].resources.wood = 88;
  const document = createWorldExport({ worldName: 'Test Base', worldSeed, state });
  const imported = parseWorldExport(JSON.stringify(document));

  assert.equal(imported.worldName, 'Test Base');
  assert.equal(imported.worldSeed, worldSeed);
  assert.equal(imported.state.snapshot.gameTime, 321.5);
  assert.equal(imported.state.snapshot.resources.wood, 88);
  assert.deepEqual(imported.state.activeChunkKeys, state.activeChunkKeys);
});

test('world import rejects unsupported formats, incomplete states, and mismatched seeds', () => {
  const { worldSeed, state } = createTestState();
  const validDocument = createWorldExport({ worldName: 'Test Base', worldSeed, state });

  assert.throws(() => parseWorldExport(JSON.stringify({ ...validDocument, format: 'other' })), /not a supported/);
  assert.throws(() => parseWorldExport(JSON.stringify({ ...validDocument, schemaVersion: 2, state: { ...validDocument.state, schemaVersion: 2 } })), /not a supported/);
  assert.throws(() => parseWorldExport(JSON.stringify({ ...validDocument, worldSeed: worldSeed + 1 })), /seed does not match/);

  const malformedState = structuredClone(state) as PersistedWorldState;
  const firstEntity = malformedState.snapshot.entities[0] as unknown as Record<string, unknown>;
  delete firstEntity.vx;
  assert.throws(() => validatePersistedWorldState(malformedState, worldSeed), /entities\[0\]\.vx must be a finite number/);

  const missingUpgradeHistory = structuredClone(state) as PersistedWorldState;
  delete (missingUpgradeHistory.snapshot.buildings[0] as unknown as Record<string, unknown>).upgradeIds;
  assert.throws(() => validatePersistedWorldState(missingUpgradeHistory, worldSeed), /upgrade-history values/);
});

test('world import rejects incomplete current Effect Tower state without applying defaults', () => {
  const { worldSeed, state } = createTestState();
  const invalid = structuredClone(state) as PersistedWorldState;
  const tower = createBuildingInstance('FIRE_TOWER', 'player', 3, 3);
  invalid.snapshot.buildings.push(tower);
  delete (invalid.snapshot.buildings[invalid.snapshot.buildings.length - 1] as unknown as Record<string, unknown>).effectDuration;
  assert.throws(() => validatePersistedWorldState(invalid, worldSeed), /incomplete or invalid Effect Tower runtime state/);
});

test('world import rejects duplicate IDs and resource nodes assigned to an unloaded chunk', () => {
  const { worldSeed, state } = createTestState();
  const duplicateIds = structuredClone(state) as PersistedWorldState;
  duplicateIds.snapshot.entities.push({ ...duplicateIds.snapshot.entities[0] });
  assert.throws(() => validatePersistedWorldState(duplicateIds, worldSeed), /duplicate id/);

  const missingChunk = structuredClone(state) as PersistedWorldState;
  missingChunk.snapshot.resourceNodes[0].chunkKey = '9000,9000';
  assert.throws(() => validatePersistedWorldState(missingChunk, worldSeed), /not marked as loaded/);
});

test('single-player restore rebuilds host control state and rebinds the primary entity after JSON import', () => {
  const { worldSeed, state } = createTestState();
  const snapshotAfterJson = JSON.parse(JSON.stringify(state.snapshot)) as typeof state.snapshot;
  const restored = new GameEngine(worldSeed);
  restored.restoreSinglePlayerState(snapshotAfterJson, state.activeChunkKeys);

  assert.equal(restored.state.multiplayerMode, 'TEAM');
  assert.equal(restored.state.humanPlayers.length, 1);
  assert.equal(restored.state.player, restored.state.entities.find(entity => entity.id === restored.state.player.id));
  assert.deepEqual(restored.getLoadedChunkKeys(), [...state.activeChunkKeys].sort());
  assert.deepEqual(restored.state.projectiles, []);
  assert.equal(restored.state.resources.wood, restored.state.humanPlayers[0].resources.wood);
  assert.throws(() => restored.restoreSinglePlayerState({ ...snapshotAfterJson, multiplayerMode: 'FREE_FOR_ALL' }, state.activeChunkKeys), /TEAM-mode host participant/);
});
