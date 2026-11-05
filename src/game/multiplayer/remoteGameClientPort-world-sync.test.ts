import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteGameClientPort } from './RemoteGameClientPort';
import { TestTransport, makeFrame } from './remoteGameClientPortTestSupport';
import type { GameSnapshot } from '../server/protocol';

test('a changed world without a matching explicit assignment remains a visible protocol error', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    // Older peers may not provide worldId on assignment. In that case the
    // client deliberately preserves the strict same-world invariant.
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: makeFrame('world-1') });
    assert.throws(
      () => transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: makeFrame('world-2') }),
      /cannot be applied before the host announces that world/
    );
    assert.equal(guest.getWorldFrame().worldId, 'world-1', 'an unannounced new world must never silently replace active state');
  } finally {
    guest.disconnect();
  }
});

test('guest session remains in a syncing state until a follow-up authoritative update proves the stream is live', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport, 'Wobble Toaster-42');
  const readiness: boolean[] = [];
  guest.subscribeSessionReadiness(ready => readiness.push(ready));
  assert.equal(guest.isSessionReady(), false);

  transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
  const first = makeFrame();
  transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: first });
  assert.equal(guest.isSessionReady(), false, 'one full state alone is not enough to declare the session stable');

  transport.inject({
    type: 'game-state-delta', protocolVersion: 3, worldId: first.worldId,
    baseRevision: first.revision, revision: first.revision + 1, serverTimeMs: first.serverTimeMs + 50,
    operations: [{ op: 'set', path: ['gameTime'], value: 0.05 }]
  });
  assert.equal(guest.isSessionReady(), true, 'a correctly based follow-up delta proves that the host stream is progressing');
  assert.deepEqual(readiness, [false, true]);
  assert.equal(guest.getSnapshot().gameTime, 0.05);
  guest.disconnect();
});


test('returning to the room clears only world state and keeps the room session usable for a new world', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  const readiness: boolean[] = [];
  guest.subscribeSessionReadiness(ready => readiness.push(ready));
  try {
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      roomSessionId: 'persistent-room', playerId: 'guest-player-1', worldId: 'world-1' });
    const first = makeFrame('world-1');
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, roomSessionId: 'persistent-room', frame: first });
    transport.inject({ type: 'game-state-delta', protocolVersion: 3, roomSessionId: 'persistent-room', worldId: 'world-1',
      baseRevision: 1, revision: 2, serverTimeMs: first.serverTimeMs + 50,
      operations: [{ op: 'set', path: ['gameTime'], value: 0.05 }] });
    assert.equal(guest.isSessionReady(), true);

    // Renderer teardown may release held keys after the host has already cleared
    // the authoritative frame. Such local input is rejected, not escalated into
    // a protocol failure that disconnects the persistent room connection.
    let hadReadyWorld = false;
    const cleanupCommandResults: boolean[] = [];
    guest.subscribeSessionReadiness(ready => {
      if (ready) hadReadyWorld = true;
      else if (hadReadyWorld) {
        cleanupCommandResults.push(guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyD', pressed: false }));
        cleanupCommandResults.push(guest.dispatch({ type: 'POINTER_UP', button: 0 }));
      }
    });
    const sentBeforeWorldEnd = transport.sent.length;
    assert.doesNotThrow(() => transport.inject({ type: 'game-world-ended', protocolVersion: 2, roomSessionId: 'persistent-room',
      worldId: 'world-1', reason: 'host-returned-to-room' }));
    assert.deepEqual(cleanupCommandResults, [false, false], 'teardown input is benign while no world is active');
    assert.equal(transport.sent.slice(sentBeforeWorldEnd).some(message => message.type === 'game-command'), false,
      'cleanup must not send gameplay commands after world state has been cleared');
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      roomSessionId: 'persistent-room', playerId: 'guest-player-1', worldId: null });
    const lobbyStatus = { hasWorld: false, worldId: null, phase: 'lobby' as const, mode: 'TEAM' as const,
      gameTimeSeconds: 0, players: [], updatedAtMs: Date.now() };
    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'persistent-room', statusRevision: 1, status: lobbyStatus });

    assert.equal(guest.isSessionReady(), false, 'world input is disabled while in the persistent room');
    assert.equal(guest.getRoomStatus()?.phase, 'lobby');
    guest.sendChat('Still in the room');
    assert.ok(transport.sent.some(message => message.type === 'game-chat-send'),
      'returning to the room must preserve the same data connection and room membership');

    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      roomSessionId: 'persistent-room', playerId: 'guest-player-1', worldId: 'world-2' });
    const next = makeFrame('world-2');
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, roomSessionId: 'persistent-room', frame: next });
    transport.inject({ type: 'game-state-delta', protocolVersion: 3, roomSessionId: 'persistent-room', worldId: 'world-2',
      baseRevision: 1, revision: 2, serverTimeMs: next.serverTimeMs + 50,
      operations: [{ op: 'set', path: ['gameTime'], value: 0.05 }] });
    assert.equal(guest.getWorldFrame().worldId, 'world-2', 'the existing room session can start a later world');
    assert.equal(guest.isSessionReady(), true);
  } finally {
    guest.disconnect();
  }
});

test('a host removal notice is shown once and acknowledged so the host can close the removed participant', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  const notices: Array<{ removalId: string; message: string }> = [];
  guest.subscribeRoomRemoval(notice => notices.push(notice));
  try {
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      roomSessionId: 'removal-room', playerId: 'guest-player-1', worldId: null });
    const removal = { type: 'game-room-removed', protocolVersion: 2, roomSessionId: 'removal-room',
      removalId: 'removal-1', code: 'HOST_REMOVED' };
    transport.inject(removal);
    assert.deepEqual(notices, [{ removalId: 'removal-1', message: 'The host removed you from this room.' }]);
    assert.deepEqual(transport.sent.filter(message => message.type === 'game-room-removal-ack').map(message => message.removalId), ['removal-1']);

    // Reliable transports can retransmit around a lost application ACK. The UI
    // shows the removal once, but every delivery is acknowledged.
    transport.inject(removal);
    assert.equal(notices.length, 1, 'duplicate removal packets must not create duplicate user notices');
    assert.deepEqual(transport.sent.filter(message => message.type === 'game-room-removal-ack').map(message => message.removalId), ['removal-1', 'removal-1']);
  } finally {
    guest.disconnect();
  }
});

test('a valid defeated-player frame removes the Commander without triggering a false protocol failure', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
  const first = makeFrame();
  transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: first });

  const defeatedSnapshot = {
    ...first.snapshot,
    buildings: first.snapshot.buildings.map(building => ({ ...building, hp: 0 })),
    entities: first.snapshot.entities.filter(entity => entity.id !== 'guest-commander')
  } as GameSnapshot;
  transport.inject({
    type: 'game-initial-state', protocolVersion: 3,
    frame: { ...first, revision: first.revision + 1, serverTimeMs: first.serverTimeMs + 50, snapshot: defeatedSnapshot }
  });

  assert.equal(guest.getSnapshot().isGameOver, true);
  assert.equal(guest.getSnapshot().entities.some(entity => entity.id === 'guest-commander'), false);
  assert.equal(guest.getSnapshot().player.isDead, true);
  assert.equal(guest.getSnapshot().player.hp, 0);
  guest.disconnect();
});


test('guest receives and acknowledges a reliable explicit Core-defeat notification exactly once', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  const defeatedNotices: string[] = [];
  guest.subscribePlayerDefeated(notice => defeatedNotices.push(notice.eventId));
  transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
  const first = makeFrame();
  transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: first });

  const notice = {
    type: 'game-player-defeated', protocolVersion: 2, stateSyncProtocolVersion: 3,
    eventId: 'world-test:guest-player-1:guest-core:defeat-1', playerId: 'guest-player-1',
    coreId: 'guest-core', worldId: 'world-test', revision: 2, reason: 'core-destroyed'
  };
  transport.inject(notice);
  assert.equal(defeatedNotices.length, 0, 'do not show defeat before its authoritative revision has arrived');

  const defeatedSnapshot = {
    ...first.snapshot,
    buildings: first.snapshot.buildings.map(building => ({ ...building, hp: 0 })),
    entities: first.snapshot.entities.filter(entity => entity.id !== 'guest-commander')
  } as GameSnapshot;
  transport.inject({
    type: 'game-initial-state', protocolVersion: 3,
    frame: { ...first, revision: 2, serverTimeMs: first.serverTimeMs + 50, snapshot: defeatedSnapshot }
  });
  assert.deepEqual(defeatedNotices, [notice.eventId]);
  assert.equal(transport.sent.filter(message => message.type === 'game-player-defeated-ack').length, 1);

  transport.inject(notice);
  assert.deepEqual(defeatedNotices, [notice.eventId], 'a retransmitted defeat event must not duplicate the UI notification');
  assert.equal(transport.sent.filter(message => message.type === 'game-player-defeated-ack').length, 2,
    'duplicate events must still be acknowledged so the host can stop retrying');
  guest.disconnect();
});
