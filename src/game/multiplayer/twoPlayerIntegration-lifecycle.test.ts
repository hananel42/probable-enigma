import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { RemoteGameClientPort } from './RemoteGameClientPort';
import { HostRoomController } from './HostRoomController';
import type { GameCommand, GameWorldFrame } from '../server/protocol';
import { BUILDING_BLUEPRINTS, GRID_SIZE, isAreaBuildable } from '../rules';
import { InMemoryRoomRelay } from './twoPlayerIntegrationTestSupport';

test('remote guest sees defeat when their own Core is destroyed while host continues', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const hostRelay = new InMemoryRoomRelay('host-peer-core-defeat');
  const guestRelay = new InMemoryRoomRelay('guest-peer-core-defeat');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const unsubscribeFrames = server.subscribeWorldFrames(() => hostProtocol.flushStateUpdates());
  const guest = new RemoteGameClientPort(guestRelay);
  try {
    hostProtocol.startMatch();
    const snapshot = server.getSnapshot();
    const guestParticipant = snapshot.humanPlayers.find(player => player.playerId === 'guest-player-1')!;
    const guestCore = snapshot.buildings.find(building => building.id === guestParticipant.coreId)!;
    const commanderBeforeDefeat = snapshot.entities.find(entity => entity.id === guestParticipant.commanderId)!;
    const defeatedPosition = { x: commanderBeforeDefeat.x, y: commanderBeforeDefeat.y };
    guestCore.hp = 0;
    server.step(0.05);
    assert.equal(server.getSnapshot().isGameOver, false, 'host must not lose when only guest Core is destroyed');
    assert.equal(guest.getSnapshot().isGameOver, true, 'guest view must use the guest Core, not commander HP or host Core');
    assert.equal(server.getSnapshot().entities.some(entity => entity.id === guestParticipant.commanderId), false,
      'the authoritative world must remove the eliminated guest Commander');
    assert.equal(guest.getSnapshot().entities.some(entity => entity.id === guestParticipant.commanderId), false,
      'the remote render projection must not keep drawing the eliminated Commander');
    guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true });
    server.step(0.05);
    assert.equal(server.getSnapshot().entities.some(entity => entity.id === guestParticipant.commanderId), false,
      'a defeated Commander must not return after subsequent input or simulation ticks');
    assert.deepEqual({ x: guest.getSnapshot().player.x, y: guest.getSnapshot().player.y }, defeatedPosition,
      'the remote view keeps the final loss location without rendering an entity');
  } finally {
    guest.disconnect();
    unsubscribeFrames();
    hostProtocol.stop();
    server.stop();
  }
});

test('full TEAM room defeat and restart preserves the live remote session and both Core identities', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const hostRelay = new InMemoryRoomRelay('host-peer-restart');
  const guestRelay = new InMemoryRoomRelay('guest-peer-restart');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const unsubscribeFrames = server.subscribeWorldFrames(() => hostProtocol.flushStateUpdates());
  const guest = new RemoteGameClientPort(guestRelay);
  try {
    hostProtocol.startMatch();
    const hostParticipant = server.getSnapshot().humanPlayers.find(player => player.playerId === 'player-host')!;
    const guestParticipant = server.getSnapshot().humanPlayers.find(player => player.playerId === 'guest-player-1')!;
    const originalGuestCommanderId = guestParticipant.commanderId;
    const originalGuestCoreId = guestParticipant.coreId;

    server.getSnapshot().buildings.find(building => building.id === hostParticipant.coreId)!.hp = 0;
    server.step(0.05);
    assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), false,
      'the host must not reset the match while the guest still has a live Core');
    assert.equal(guest.getSnapshot().isGameOver, false, 'the surviving guest keeps playing');

    server.getSnapshot().buildings.find(building => building.id === guestParticipant.coreId)!.hp = 0;
    server.step(0.05);
    assert.equal(guest.getSnapshot().isGameOver, true, 'the guest receives their defeat frame');
    assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), true,
      'the host may redeploy only after every connected participant has been defeated');

    const restarted = server.getSnapshot();
    assert.equal(restarted.multiplayerMode, 'TEAM');
    assert.equal(restarted.humanPlayers.length, 2);
    assert.equal(restarted.humanPlayers.find(player => player.playerId === guestParticipant.playerId)?.commanderId, originalGuestCommanderId);
    assert.equal(restarted.humanPlayers.find(player => player.playerId === guestParticipant.playerId)?.coreId, originalGuestCoreId);
    assert.equal(restarted.humanPlayers.find(player => player.playerId === guestParticipant.playerId)?.defeatedAtGameTime, null,
      'room restart clears the guest defeat timestamp');
    assert.equal(restarted.humanPlayers.find(player => player.playerId === guestParticipant.playerId)?.displayName, guestParticipant.displayName,
      'room restart preserves the chosen display name');
    assert.equal(restarted.buildings.find(building => building.id === originalGuestCoreId)?.hp! > 0, true);
    assert.equal(guest.getSnapshot().player.id, originalGuestCommanderId, 'the same remote client remains assigned to its Commander');
    assert.equal(guest.getSnapshot().isGameOver, false, 'the remote view returns to a live match after room-wide restart');
  } finally {
    guest.disconnect();
    unsubscribeFrames();
    hostProtocol.stop();
    server.stop();
  }
});

test('guest follows the host lobby-to-playing transition and receives live world updates without a render trigger', async () => {
  const server = new LocalGameServer();
  const hostRelay = new InMemoryRoomRelay('host-peer-start-match');
  const guestRelay = new InMemoryRoomRelay('guest-peer-start-match');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const guest = new RemoteGameClientPort(guestRelay, 'Lobby Guest');
  const statuses: string[] = [];
  const unsubscribeRoomStatus = guest.subscribeRoomStatus(status => statuses.push(status.phase));
  try {
    assert.equal(guest.getRoomStatus()?.phase, 'lobby', 'the guest should begin in the room-management phase');
    assert.equal(guest.getRoomStatus()?.hasWorld, false, 'joining a room must not create a hidden simulation');
    assert.equal(guest.hasAuthoritativeState(), false, 'no world snapshot exists before explicit host start');
    assert.equal(guest.isSessionReady(), false, 'the guest is not ready while the room is in lobby');

    hostProtocol.startMatch();
    const initialRevision = guest.getWorldFrame().revision;
    const initialGameTime = guest.getSnapshot().gameTime;
    assert.equal(guest.getRoomStatus()?.phase, 'playing', 'the playing room-status transition is delivered to the guest');
    assert.ok(statuses.includes('playing'), 'the room-status subscription observed the transition');

    // Neither React rendering nor canvas callbacks drive replication. Wait for
    // the protocol condition, rather than assuming a fixed number of timer turns
    // elapsed on a loaded CI worker. The deadline still catches a stalled clock.
    const synchronizationDeadlineMs = Date.now() + 2_000;
    while ((!guest.isSessionReady() || guest.getWorldFrame().revision <= initialRevision) &&
           Date.now() < synchronizationDeadlineMs) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(guest.isSessionReady(), true, 'the guest receives the initial state and at least one subsequent delta');
    assert.ok(guest.getWorldFrame().revision > initialRevision, 'the guest receives a newer authoritative world frame');
    assert.ok(guest.getSnapshot().gameTime > initialGameTime, 'the simulation world advances after host start');
    assert.equal(guest.getRoomStatus()?.phase, 'playing', 'later status updates must not revert the guest to lobby');
  } finally {
    unsubscribeRoomStatus();
    guest.disconnect();
    hostProtocol.stop();
    server.stop();
  }
});

test('host deltas reach a guest on the protocol clock without renderer, resize, or React publication callbacks', async () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const hostRelay = new InMemoryRoomRelay('host-peer-clock');
  const guestRelay = new InMemoryRoomRelay('guest-peer-clock');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const guest = new RemoteGameClientPort(guestRelay);
  try {
    assert.equal(guest.hasAuthoritativeState(), false, 'room connection alone must not expose a dormant engine snapshot');
    hostProtocol.startMatch();
    const initialGameTime = guest.getSnapshot().gameTime;
    // No frame subscription manually flushes the protocol: the host controller
    // must publish changes from its own timer without canvas/resize callbacks.
    await new Promise(resolve => setTimeout(resolve, 190));
    assert.ok(guest.getSnapshot().gameTime > initialGameTime,
      `guest should receive live state deltas independently of rendering; initial=${initialGameTime}, received=${guest.getSnapshot().gameTime}`);
  } finally {
    guest.disconnect();
    hostProtocol.stop();
    server.stop();
  }
});
