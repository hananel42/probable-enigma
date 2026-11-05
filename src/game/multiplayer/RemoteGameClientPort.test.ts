import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteGameClientPort } from './RemoteGameClientPort';
import { TestTransport, makeFrame } from './remoteGameClientPortTestSupport';

test('guest prediction moves only the render view while the authoritative snapshot remains server-owned', async () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
  transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: makeFrame() });

  const authoritativeX = guest.getSnapshot().player.x;
  const initialRenderX = guest.getRenderSnapshot().player.x;
  guest.setPredictedInputKey('KeyD', true);
  await new Promise(resolve => setTimeout(resolve, 35));
  const predictedX = guest.getRenderSnapshot().player.x;

  assert.ok(predictedX > initialRenderX, `expected local presentation to predict rightward movement (${predictedX} > ${initialRenderX})`);
  assert.equal(guest.getSnapshot().player.x, authoritativeX, 'render prediction must not mutate authoritative state');
  assert.ok(transport.sent.some(message => message.type === 'game-state-ack'));
  guest.setPredictedInputKey('KeyD', false);
  guest.disconnect();
});

test('a delayed host heartbeat from a previous client lifecycle does not terminate the new session', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    // The prior RemoteGameClientPort may have already sent heartbeat 1 before
    // its React effect was cleaned up. Its queued reply can arrive when this
    // new instance has not issued any heartbeat yet.
    assert.doesNotThrow(() => transport.inject({
      type: 'game-host-heartbeat', protocolVersion: 2, clientSessionId: 'previous-client-session', sequence: 1, serverTimeMs: Date.now()
    }));

    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: makeFrame() });
    assert.equal(guest.getWorldFrame().worldId, 'world-test', 'the valid handshake must continue after ignoring the stale heartbeat');
  } finally {
    guest.disconnect();
  }
});

test('a heartbeat tagged for a different client session is ignored', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    const hello = transport.sent.find(message => message.type === 'game-hello');
    assert.equal(typeof hello?.clientSessionId, 'string', 'each client-port lifecycle should advertise a session token');
    assert.doesNotThrow(() => transport.inject({
      type: 'game-host-heartbeat', protocolVersion: 2, clientSessionId: 'obsolete-client-session',
      sequence: 1, serverTimeMs: Date.now()
    }));
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3, playerId: 'guest-player-1' });
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: makeFrame() });
    assert.equal(guest.getWorldFrame().worldId, 'world-test');
  } finally {
    guest.disconnect();
  }
});

test('a new authoritative world is accepted only after an explicit assignment and stale old-world packets are ignored', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  const readiness: boolean[] = [];
  guest.subscribeSessionReadiness(ready => readiness.push(ready));
  try {
    transport.inject({
      type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      playerId: 'guest-player-1', worldId: 'world-1'
    });
    const firstWorld = makeFrame('world-1', 'guest-player-1');
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: firstWorld });
    transport.inject({
      type: 'game-state-delta', protocolVersion: 3, worldId: 'world-1',
      baseRevision: 1, revision: 2, serverTimeMs: firstWorld.serverTimeMs + 50,
      operations: [{ op: 'set', path: ['gameTime'], value: 0.05 }]
    });
    assert.equal(guest.isSessionReady(), true, 'the original world is ready after its first delta');

    // Some full-state messages can already be queued when the host runtime is
    // replaced. The new world must not be applied until its assignment arrives.
    const secondWorld = makeFrame('world-2', 'guest-player-2');
    assert.doesNotThrow(() => transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: secondWorld }));
    assert.equal(guest.getWorldFrame().worldId, 'world-1', 'an unannounced world must not replace the current authoritative frame');
    assert.equal(guest.isSessionReady(), false, 'input readiness is revoked while the handoff is unresolved');
    assert.equal(guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true }), false,
      'gameplay commands must not be sent while a new authority is unresolved');

    transport.inject({
      type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      playerId: 'guest-player-2', worldId: 'world-2'
    });
    assert.equal(guest.getWorldFrame().worldId, 'world-2', 'the matching assignment authorizes the buffered full baseline');
    assert.equal(guest.getWorldFrame().snapshot.humanPlayers[0].playerId, 'guest-player-2',
      'a new world may explicitly assign a new participant identity');
    assert.equal(guest.session.worldId, 'world-2', 'session metadata must track the accepted world');
    assert.equal(guest.isSessionReady(), false, 'a full baseline alone does not enable input before the next delta');

    const staleWorld = makeFrame('world-1', 'guest-player-1', 99);
    assert.doesNotThrow(() => transport.inject({ type: 'game-initial-state', protocolVersion: 3, frame: staleWorld }));
    assert.doesNotThrow(() => transport.inject({
      type: 'game-state-delta', protocolVersion: 3, worldId: 'world-1',
      baseRevision: 2, revision: 100, serverTimeMs: staleWorld.serverTimeMs + 50,
      operations: [{ op: 'set', path: ['gameTime'], value: 9 }]
    }));
    assert.equal(guest.getWorldFrame().worldId, 'world-2', 'late packets from the retired world must not roll the guest back');

    transport.inject({
      type: 'game-state-delta', protocolVersion: 3, worldId: 'world-2',
      baseRevision: 1, revision: 2, serverTimeMs: secondWorld.serverTimeMs + 50,
      operations: [{ op: 'set', path: ['gameTime'], value: 0.05 }]
    });
    assert.equal(guest.isSessionReady(), true, 'the new world becomes ready after its own follow-up delta');
    assert.equal(guest.getSnapshot().gameTime, 0.05);
    assert.deepEqual(readiness, [false, true, false, true]);
  } finally {
    guest.disconnect();
  }
});

test('room status cannot establish room identity before participant assignment', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    const lobbyStatus = {
      hasWorld: false,
      worldId: null,
      phase: 'lobby' as const,
      mode: 'TEAM' as const,
      gameTimeSeconds: 0,
      players: [],
      updatedAtMs: 1000
    };
    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'previous-room', statusRevision: 100,
      status: lobbyStatus });
    assert.equal(guest.getRoomStatus(), null, 'a delayed room status must not establish the room-session identity');

    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      playerId: 'guest-player-1', worldId: null, roomSessionId: 'current-room' });
    assert.equal(guest.getRoomStatus(), null, 'assignment establishes membership but does not manufacture a status message');
    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'current-room', statusRevision: 1,
      status: lobbyStatus });
    assert.equal(guest.getRoomStatus()?.phase, 'lobby');
  } finally {
    guest.disconnect();
  }
});

test('delayed room statuses from an old world cannot revert the current world or room phase', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      playerId: 'guest-player-1', worldId: 'world-2', roomSessionId: 'room-stable' });
    transport.inject({ type: 'game-initial-state', protocolVersion: 3, roomSessionId: 'room-stable', frame: makeFrame('world-2') });

    const status = (phase: 'playing' | 'paused', worldId: string, updatedAtMs: number) => ({
      hasWorld: true,
      worldId,
      phase,
      mode: 'TEAM' as const,
      gameTimeSeconds: 0,
      players: [{ playerId: 'player-host', displayName: 'Host', isHost: true, connected: true, phase: 'alive' as const, survivalSeconds: 0 }],
      updatedAtMs
    });
    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'room-stable', statusRevision: 5,
      status: status('playing', 'world-2', 1000) });
    assert.equal(guest.getRoomStatus()?.worldId, 'world-2');

    // Even a late envelope with a numerically newer status sequence is not
    // allowed to describe a different world. It does not advance the cursor,
    // so the valid current-world status can still use that sequence.
    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'room-stable', statusRevision: 6,
      status: status('playing', 'world-1', 1100) });
    assert.equal(guest.getRoomStatus()?.worldId, 'world-2', 'a stale world status must not roll the room backwards');
    assert.equal(guest.getRoomStatus()?.phase, 'playing');

    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'room-stable', statusRevision: 6,
      status: status('paused', 'world-2', 1101) });
    assert.equal(guest.getRoomStatus()?.worldId, 'world-2');
    assert.equal(guest.getRoomStatus()?.phase, 'paused', 'the same next sequence remains available for the correct room state');

    transport.inject({ type: 'game-room-status', protocolVersion: 2, roomSessionId: 'room-stable', statusRevision: 5,
      status: { ...status('playing', 'world-2', 900), hasWorld: false, worldId: null, phase: 'lobby' } });
    assert.equal(guest.getRoomStatus()?.phase, 'paused', 'a delayed lobby status cannot end a newer active world');
    assert.equal(guest.getWorldFrame().worldId, 'world-2');
  } finally {
    guest.disconnect();
  }
});


test('guest rejects the previous state-sync protocol during assignment', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    assert.throws(() => transport.inject({
      type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 2,
      playerId: 'guest-player-1'
    }), /malformed multiplayer participant assignment/);
  } finally {
    guest.disconnect();
  }
});

test('guest rejects a frame from the previous world-state protocol', () => {
  const transport = new TestTransport();
  const guest = new RemoteGameClientPort(transport);
  try {
    transport.inject({ type: 'game-player-assigned', protocolVersion: 2, stateSyncProtocolVersion: 3,
      playerId: 'guest-player-1' });
    const previousFrame = { ...makeFrame(), protocolVersion: 2 };
    assert.throws(() => transport.inject({
      type: 'game-initial-state', protocolVersion: 3, frame: previousFrame
    }), /malformed initial-state envelope or frame/);
  } finally {
    guest.disconnect();
  }
});
