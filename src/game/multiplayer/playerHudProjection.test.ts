import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameSnapshot } from '../server/protocol';
import { resolveHudCore, resolveHudParticipant, resolveHudSurvivalTime } from './playerHudProjection';

function makeSnapshot(): GameSnapshot {
  const hostCore = { id: 'player-core', type: 'CORE', faction: 'player', hp: 90, maxHp: 100 } as never;
  const guestCore = { id: 'core-guest', type: 'CORE', faction: 'player', hp: 40, maxHp: 100 } as never;
  const player = { id: 'commander-guest', ownerPlayerId: 'guest-player', hp: 100, maxHp: 100 } as never;
  return {
    player,
    humanPlayers: [
      { playerId: 'player-host', commanderId: 'player-commander', coreId: 'player-core', connected: true, defeatedAtGameTime: null },
      { playerId: 'guest-player', commanderId: 'commander-guest', coreId: 'core-guest', connected: true, defeatedAtGameTime: 12.5 }
    ],
    buildings: [hostCore, guestCore],
    multiplayerMode: 'TEAM',
    gameTime: 98,
  } as unknown as GameSnapshot;
}

test('multiplayer HUD resolves the local player Core by participant identity, not first Core in the array', () => {
  const snapshot = makeSnapshot();
  assert.equal(resolveHudParticipant(snapshot)?.playerId, 'guest-player');
  assert.equal(resolveHudCore(snapshot)?.id, 'core-guest');
  assert.equal(resolveHudCore(snapshot)?.hp, 40);
});

test('survival clock freezes at the participant-specific defeat time and resets for a fresh run', () => {
  const defeated = makeSnapshot();
  assert.equal(resolveHudSurvivalTime(defeated), 12.5, 'later global simulation time must not add to the eliminated guest survival time');
  const restarted = {
    ...defeated,
    gameTime: 0,
    humanPlayers: defeated.humanPlayers.map(participant => ({ ...participant, defeatedAtGameTime: null }))
  } as GameSnapshot;
  assert.equal(resolveHudSurvivalTime(restarted), 0, 'room redeployment must not preserve a previous death timestamp');
});


test('HUD refuses to substitute the host Core when the local participant identity is not present', () => {
  const snapshot = makeSnapshot();
  snapshot.player.id = 'unknown-commander';
  snapshot.player.ownerPlayerId = 'unknown-player';
  assert.equal(resolveHudParticipant(snapshot), undefined);
  assert.equal(resolveHudCore(snapshot), undefined, 'showing no Core is safer than showing another player’s health');
});
