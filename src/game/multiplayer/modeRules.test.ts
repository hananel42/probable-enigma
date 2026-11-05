import test from 'node:test';
import assert from 'node:assert/strict';
import { chargeResources, getGameModeRules } from './modeRules';
import { createMultiplayerWorld, getParticipant, setParticipantConnected } from './worldModel';
import type { MultiplayerParticipantInput } from './types';

const participants: MultiplayerParticipantInput[] = [
  { playerId: 'p1', groupId: 'g1', commanderId: 'cmd1' },
  { playerId: 'p2', groupId: 'g2', commanderId: 'cmd2' },
  { playerId: 'p3', groupId: 'g3', commanderId: 'cmd3' }
];

test('Free-for-all creates a separate core, alliance and private ledger for every participant', () => {
  const world = createMultiplayerWorld('FREE_FOR_ALL', participants, { wood: 20, stone: 12, diamonds: 0 });
  assert.equal(world.cores.length, 3);
  assert.equal(new Set(world.players.map(player => player.allianceId)).size, 3);
  assert.deepEqual(world.players.map(player => player.resources), [
    { wood: 20, stone: 12, diamonds: 0 }, { wood: 20, stone: 12, diamonds: 0 }, { wood: 20, stone: 12, diamonds: 0 }
  ]);
  const rules = getGameModeRules(world.mode);
  assert.equal(rules.canDamagePlayer('p1', 'p2'), true);
  assert.equal(rules.canDamagePlayer('p1', 'p1'), false);
  assert.deepEqual(rules.getSpawnAnchors(world.players).map(anchor => anchor.playerId), ['p1', 'p2', 'p3']);
  assert.equal(rules.corePolicy, 'one-per-player');
});

test('Team mode blocks human friendly fire, preserves separate cores and ledgers, and denies access to other players buildings', () => {
  const world = createMultiplayerWorld('TEAM', participants, { wood: 15, stone: 8, diamonds: 0 });
  const p1 = getParticipant(world, 'p1');
  const p2 = getParticipant(world, 'p2');
  const rules = getGameModeRules(world.mode);
  assert.equal(world.cores.length, 3);
  assert.equal(rules.canDamagePlayer('p1', 'p2'), false);
  assert.equal(rules.canAccessStructure(p2, { ownerPlayerId: 'p1', ownerAllianceId: p1.allianceId }), false);
  assert.equal(rules.canUseCore(p2, world.cores[0]), false);
  assert.equal(rules.canAccessStructure(p2, { ownerPlayerId: 'p1', ownerAllianceId: p1.allianceId, coreId: 'core:p1' }), false);
  assert.equal(chargeResources(p1, { wood: 4, stone: 2, diamonds: 0 }), true);
  assert.deepEqual(p1.resources, { wood: 11, stone: 6, diamonds: 0 });
  assert.deepEqual(p2.resources, { wood: 15, stone: 8, diamonds: 0 }, 'Spending must never affect an ally wallet');
});

test('Co-op has exactly one shared core while every participant keeps a separate resource ledger', () => {
  const world = createMultiplayerWorld('COOPERATIVE', participants, { wood: 10, stone: 10, diamonds: 0 });
  const p1 = getParticipant(world, 'p1');
  const p2 = getParticipant(world, 'p2');
  const rules = getGameModeRules(world.mode);
  assert.equal(world.cores.length, 1);
  assert.equal(world.players.every(player => player.coreId === world.cores[0].id), true);
  assert.equal(world.cores[0].ownerPlayerId, null);
  assert.equal(world.cores[0].shared, true);
  assert.equal(rules.canUseCore(p1, world.cores[0]), true);
  assert.equal(rules.canUseCore(p2, world.cores[0]), true);
  assert.equal(rules.canAccessStructure(p2, { ownerPlayerId: 'p1' }), true);
  assert.equal(rules.canDamagePlayer('p1', 'p2'), false);
  assert.equal(chargeResources(p2, { wood: 3, stone: 2, diamonds: 0 }), true);
  assert.deepEqual(p1.resources, { wood: 10, stone: 10, diamonds: 0 });
  assert.deepEqual(p2.resources, { wood: 7, stone: 8, diamonds: 0 });
});

test('Participant validation rejects empty worlds, duplicate IDs, and invalid starting resources', () => {
  assert.throws(() => createMultiplayerWorld('TEAM', []), /At least one participant/);
  assert.throws(() => createMultiplayerWorld('TEAM', [participants[0], participants[0]]), /Duplicate player ID/);
  assert.throws(() => createMultiplayerWorld('TEAM', [participants[0], { ...participants[1], commanderId: participants[0].commanderId }]), /Duplicate commander ID/);
  assert.throws(() => createMultiplayerWorld('TEAM', participants, { wood: -1, stone: 0, diamonds: 0 }), /non-negative/);
});

test('Disconnected participants stop being spawn anchors without losing identity or inventory', () => {
  const world = createMultiplayerWorld('TEAM', participants, { wood: 5, stone: 2, diamonds: 0 });
  const rules = getGameModeRules(world.mode);
  setParticipantConnected(world, 'p2', false);
  assert.deepEqual(rules.getSpawnAnchors(world.players).map(anchor => anchor.playerId), ['p1', 'p3']);
  assert.deepEqual(getParticipant(world, 'p2').resources, { wood: 5, stone: 2, diamonds: 0 });
  assert.equal(getParticipant(world, 'p2').coreId, 'core:p2');
});
