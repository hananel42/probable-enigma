import test from 'node:test';
import assert from 'node:assert/strict';
import { canManagePlayerStructure } from './structureAccess';

const own = { faction: 'player' as const, ownerPlayerId: 'player-a' };
const other = { faction: 'player' as const, ownerPlayerId: 'player-b' };
const unowned = { faction: 'player' as const };
const hostile = { faction: 'enemy' as const, ownerPlayerId: 'player-a' };

test('management actions are private to the owner outside cooperative mode', () => {
  assert.equal(canManagePlayerStructure('player-a', 'TEAM', own), true);
  assert.equal(canManagePlayerStructure('player-a', 'FREE_FOR_ALL', other), false);
  assert.equal(canManagePlayerStructure('player-a', 'TEAM', unowned), false);
  assert.equal(canManagePlayerStructure('player-a', 'TEAM', hostile), false);
});

test('cooperative mode allows shared player structures but never hostile structures', () => {
  assert.equal(canManagePlayerStructure('player-a', 'COOPERATIVE', other), true);
  assert.equal(canManagePlayerStructure('player-a', 'COOPERATIVE', unowned), true);
  assert.equal(canManagePlayerStructure('player-a', 'COOPERATIVE', hostile), false);
});
