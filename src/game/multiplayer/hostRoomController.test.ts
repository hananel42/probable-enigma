import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { HostRoomController } from './HostRoomController';
import { FakeTransport } from './hostRoomControllerTestSupport';
import { MAX_PEERJS_GAME_MESSAGE_BYTES } from './peerJsTransportPolicy';

test('host room protocol assigns unique participants and routes each guest input independently', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-a' });
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-b' });
    const assigned = transport.sent.filter(item => item.message.type === 'game-player-assigned');
    assert.equal(assigned.length, 2);
    assert.notEqual(assigned[0].message.playerId, assigned[1].message.playerId);
    assert.deepEqual(assigned.map(item => item.target), ['peer-a', 'peer-b']);

    const playerA = String(assigned[0].message.playerId);
    const playerB = String(assigned[1].message.playerId);
    assert.equal(assigned[0].message.worldId, null, 'joining the room must not create or announce a world');
    assert.equal(server.getSnapshot().humanPlayers.length, 1, 'remote players enter the authoritative simulation only when a world starts');
    host.startMatch();
    const entityA = server.getSnapshot().entities.find(entity => entity.id === `commander-${playerA}`)!;
    const entityB = server.getSnapshot().entities.find(entity => entity.id === `commander-${playerB}`)!;
    const startA = entityA.x;
    const startB = entityB.x;
    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: 'peer-a', sequence: 1, observedRevision: 0, command: { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: true } });
    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: 'peer-b', sequence: 1, observedRevision: 0, command: { type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true } });
    server.step(0.1);
    assert.ok(entityA.x < startA, 'peer A must control only commander A');
    assert.ok(entityB.x > startB, 'peer B must control only commander B');

    const beforeDuplicate = entityA.x;
    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: 'peer-a', sequence: 1, observedRevision: 0, command: { type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true } });
    server.step(0.1);
    assert.ok(entityA.x < beforeDuplicate, 'duplicate sequence must not replace the accepted input');
    transport.emit({ type: 'game-peer-left', senderPeerId: 'peer-a' });
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerA), false, 'disconnect must remove the participant record');
    assert.equal(server.getSnapshot().entities.some(entity => entity.id === `commander-${playerA}`), false, 'disconnect must remove the commander from the world');
    assert.equal(server.dispatchForPlayer(playerA, { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: true }), false, 'disconnected players must no longer be able to send commands');
  } finally {
    host.stop();
    server.stop();
  }
});


test('a repeated hello replays the same participant assignment without duplicating the participant', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    const hello = { type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'client-session-stable', senderPeerId: 'peer-remounted-client', displayName: 'Remounted Guest' };
    transport.emit(hello);
    const firstAssignment = transport.sent.find(item => item.target === 'peer-remounted-client' && item.message.type === 'game-player-assigned')?.message;
    if (!firstAssignment || typeof firstAssignment.playerId !== 'string') throw new Error('Initial participant assignment was not sent.');
    assert.equal(firstAssignment.worldId, null, 'room membership must be established without creating a game world');
    assert.equal(transport.sent.some(item => item.target === 'peer-remounted-client' && item.message.type === 'game-initial-state'), false,
      'a lobby hello must not publish a game state');
    host.startMatch();

    // Simulate a guest protocol object remounting while the PeerJS connection
    // remains open. Its new instance repeats hello but has not seen the prior
    // assignment packet.
    transport.emit(hello);
    const assignments = transport.sent.filter(item => item.target === 'peer-remounted-client' && item.message.type === 'game-player-assigned');
    assert.equal(assignments.length, 3, 'the host sends one lobby assignment, one world-start assignment, and one repeated-hello replay');
    assert.equal(assignments[2].message.playerId, firstAssignment.playerId, 'a replay must preserve the existing participant identity');
    assert.equal(assignments[2].message.worldId, server.worldId, 'the repeated hello replays the current authoritative world');
    assert.equal(server.getSnapshot().humanPlayers.filter(player => player.playerId === firstAssignment.playerId).length, 1,
      'a repeated hello must not allocate a second participant');
  } finally {
    host.stop();
    server.stop();
  }
});

test('a new client-port session on the same peer receives a fresh assignment and state baseline', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    const peerId = 'peer-session-refresh';
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3,
      clientSessionId: 'session-before-remount', senderPeerId: peerId, displayName: 'Session Refresh' });
    const firstAssignment = transport.sent.find(item => item.target === peerId && item.message.type === 'game-player-assigned')?.message;
    if (!firstAssignment || typeof firstAssignment.playerId !== 'string') throw new Error('Initial participant assignment was not sent.');
    const playerId = firstAssignment.playerId;
    assert.equal(firstAssignment.worldId, null, 'the first assignment in the persistent room has no world');
    assert.equal(transport.sent.filter(item => item.target === peerId && item.message.type === 'game-initial-state').length, 0);
    host.startMatch();
    const initialFullStateCount = transport.sent.filter(item => item.target === peerId && item.message.type === 'game-initial-state').length;
    assert.equal(initialFullStateCount, 1);

    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: peerId, sequence: 9, observedRevision: 0,
      command: { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: true } });
    server.step(0.1);
    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: peerId, sequence: 10, observedRevision: 0,
      command: { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: false } });
    server.step(0.1);

    // Simulate a host runtime/world replacement while the direct peer link is
    // still present. The guest's next hello must explicitly announce the new
    // world before its full state, rather than relying on frame arrival order.
    Object.defineProperty(server, 'worldId', {
      value: 'world-host-runtime-replaced', configurable: true, writable: true
    });
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3,
      clientSessionId: 'session-after-remount', senderPeerId: peerId, displayName: 'Session Refresh' });
    const assignments = transport.sent.filter(item => item.target === peerId && item.message.type === 'game-player-assigned');
    const fullStates = transport.sent.filter(item => item.target === peerId && item.message.type === 'game-initial-state');
    assert.equal(assignments.length, 3, 'the guest receives a lobby assignment, a world-start assignment, and a refresh assignment');
    assert.equal(assignments[2].message.playerId, playerId, 'refresh must preserve the existing player identity');
    assert.equal(assignments[2].message.worldId, 'world-host-runtime-replaced',
      'replayed assignment must explicitly authorize the host world handoff');
    assert.equal(fullStates.length, 2, 'new client session must receive a fresh authoritative baseline');
    assert.equal((fullStates[1].message.frame as { worldId: string }).worldId, 'world-host-runtime-replaced',
      'the state baseline must belong to the world declared by the preceding assignment');
    const refreshMessages = transport.sent.filter(item => item.target === peerId &&
      (item.message.type === 'game-player-assigned' || item.message.type === 'game-initial-state')).slice(-2);
    assert.deepEqual(refreshMessages.map(item => item.message.type), ['game-player-assigned', 'game-initial-state'],
      'world authority must be declared before the corresponding full baseline');
    assert.equal(server.getSnapshot().humanPlayers.filter(player => player.playerId === playerId).length, 1,
      'session refresh must not duplicate the human participant');

    const xBefore = server.getSnapshot().entities.find(entity => entity.id === `commander-${playerId}`)!.x;
    transport.emit({ type: 'game-command', protocolVersion: 2, senderPeerId: peerId, sequence: 1, observedRevision: 0,
      command: { type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true } });
    server.step(0.1);
    const xAfter = server.getSnapshot().entities.find(entity => entity.id === `commander-${playerId}`)!.x;
    assert.ok(xAfter > xBefore, 'new session sequence numbers must be accepted rather than treated as stale');
  } finally {
    host.stop();
    server.stop();
  }
});

test('host state replication clock runs independently of render and resize callbacks', async () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  let publicationTicks = 0;
  let resolveThreeTicks: (() => void) | undefined;
  const threeTicksPublished = new Promise<void>(resolve => { resolveThreeTicks = resolve; });
  const realFlush = host.flushStateUpdates.bind(host);
  host.flushStateUpdates = ((nowMs?: number) => {
    publicationTicks += 1;
    if (publicationTicks >= 3) resolveThreeTicks?.();
    realFlush(nowMs);
  }) as typeof host.flushStateUpdates;

  host.start();
  try {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([threeTicksPublished, new Promise<void>(resolve => {
      timeoutHandle = setTimeout(resolve, 1_500);
    })]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    assert.ok(publicationTicks >= 3, `the host replication timer should run without render/resize events; ticks=${publicationTicks}`);
  } finally {
    host.stop();
    server.stop();
  }
});


test('room roster updates are immediate but steady room status does not flood the data channel', async () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-room-status', displayName: 'Status Bot' });
    // Force the first status publication for the new roster so subsequent packets
    // can be measured without depending on timer scheduling at test startup.
    host.flushStateUpdates();
    const initialCount = transport.sent.filter(item => item.message.type === 'game-room-status').length;
    assert.ok(initialCount >= 1, 'a connected peer receives room status after joining');
    await new Promise(resolve => setTimeout(resolve, 180));
    const steadyCount = transport.sent.filter(item => item.message.type === 'game-room-status').length;
    assert.equal(steadyCount, initialCount, 'the stopped lobby clock must not create 20 room-status messages per second');

    // A roster change is not delayed behind the 1 Hz survival clock.
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-room-status-2', displayName: 'New Bot' });
    host.flushStateUpdates();
    const afterJoinCount = transport.sent.filter(item => item.message.type === 'game-room-status').length;
    assert.ok(afterJoinCount > steadyCount, 'a new participant triggers an immediate room-status update');
  } finally {
    host.stop();
    server.stop();
  }
});

test('host manages lobby, live match, results, and a fresh lobby without dropping connected guests', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-room-phase', displayName: 'Phase Bot' });
    const assigned = transport.sent.find(item => item.target === 'peer-room-phase' && item.message.type === 'game-player-assigned')?.message;
    if (!assigned || typeof assigned.playerId !== 'string') throw new Error('Expected a connected guest before match start.');
    const guestId = assigned.playerId;
    host.setRoomMode('FREE_FOR_ALL');
    assert.equal(host.getRoomStatus().mode, 'FREE_FOR_ALL');
    host.startMatch();
    assert.equal(host.getRoomStatus().phase, 'playing');
    assert.equal(server.isRunning, true);

    for (const building of server.getSnapshot().buildings) if (building.type === 'CORE') building.hp = 0;
    server.step(1 / 60);
    host.flushStateUpdates();
    assert.equal(host.getRoomStatus().phase, 'results', 'all connected defeated participants should freeze the match into results');
    assert.equal(server.isRunning, false);
    assert.ok(host.getRoomStatus().players.some(player => player.playerId === guestId && player.phase === 'defeated'));

    const closedPeersBeforeReturn = transport.closedPeers.length;
    host.returnToLobby();
    assert.equal(transport.closedPeers.length, closedPeersBeforeReturn,
      'returning to the room ends the world but must not close the participant data connections');
    assert.ok(transport.sent.some(item => item.target === 'peer-room-phase' && item.message.type === 'game-world-ended' &&
      item.message.reason === 'host-returned-to-room'), 'the host explicitly tells the guest the world ended');
    const lobbyAssignment = transport.sent.filter(item => item.target === 'peer-room-phase' && item.message.type === 'game-player-assigned').at(-1)?.message;
    assert.equal(lobbyAssignment?.worldId, null, 'the same connected guest is explicitly reassigned to the persistent room with no active world');
    const status = host.getRoomStatus();
    assert.equal(status.phase, 'lobby');
    assert.equal(server.isRunning, false);
    assert.equal(status.hasWorld, false, 'returning to the room removes the active world instead of leaving a hidden simulation');
    assert.equal(status.worldId, null);
    assert.ok(status.players.some(player => player.playerId === guestId && player.connected),
      'returning to the room retains room membership without keeping world entities alive');
    assert.equal(server.isRunning, false, 'returning to room stops the old simulation clock');
    assert.equal(transport.sent.some(item => item.message.type === 'game-state-delta' && item.message.worldId === status.worldId), false,
      'the ended world is no longer published while participants remain in the room');
    host.startMatch();
    assert.equal(host.getRoomStatus().phase, 'playing');
    assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === guestId && player.defeatedAtGameTime === null),
      'starting the next world creates a fresh live participant for the still-connected guest');
  } finally {
    host.stop();
    server.stop();
  }
});


test('host rejects the previous state-sync protocol without registering the guest', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({
      type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 2,
      clientSessionId: 'old-sync-client', senderPeerId: 'peer-old-sync'
    });
    assert.equal(server.getSnapshot().humanPlayers.length, 1,
      'a peer using the previous state-sync contract must not be added to the authoritative world');
    assert.equal(transport.sent.some(item => item.target === 'peer-old-sync' && item.message.type === 'game-player-assigned'), false);
  } finally {
    host.stop();
    server.stop();
  }
});

test('host rejects hello messages that omit the mandatory client-session token', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({
      type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3,
      senderPeerId: 'peer-without-session-token'
    });
    assert.equal(server.getSnapshot().humanPlayers.length, 1);
    assert.equal(transport.sent.some(item => item.target === 'peer-without-session-token' && item.message.type === 'game-player-assigned'), false);
  } finally {
    host.stop();
    server.stop();
  }
});
