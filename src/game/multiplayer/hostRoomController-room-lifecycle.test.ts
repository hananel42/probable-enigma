import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { HostRoomController } from './HostRoomController';
import { FakeTransport } from './hostRoomControllerTestSupport';
import { MAX_PEERJS_GAME_MESSAGE_BYTES } from './peerJsTransportPolicy';

test('host pauses and resumes the same world, then revives a defeated guest with a fresh Core', async () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session',
      senderPeerId: 'peer-world-admin', displayName: 'World Admin Test' });
    const assignment = transport.sent.find(item => item.target === 'peer-world-admin' && item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Expected a guest assignment in the room.');
    const guestId = assignment.playerId;

    assert.equal(host.getRoomStatus().hasWorld, false, 'room creation alone must not start a world');
    assert.throws(() => host.pauseMatch(), /Cannot pause a world while room phase is 'lobby'/,
      'pause is invalid until the host creates a world');
    assert.throws(() => host.resumeMatch(), /Cannot resume a world while room phase is 'lobby'/,
      'resume is invalid until a world is paused');
    host.startMatch();
    const activeWorldId = server.worldId;
    const initialState = [...transport.sent].reverse().find(entry =>
      entry.target === 'peer-world-admin' && entry.message.type === 'game-initial-state'
    )?.message;
    if (!initialState) throw new Error('Expected a full authoritative state after starting the world.');
    const initialStateEnvelopeBytes = new TextEncoder().encode(JSON.stringify(initialState)).byteLength;
    assert.ok(initialStateEnvelopeBytes <= MAX_PEERJS_GAME_MESSAGE_BYTES,
      `Generated world snapshot envelope (${initialStateEnvelopeBytes} bytes) must fit the transport's explicit limit.`);
    assert.throws(() => host.startMatch(), /Cannot start a world while room phase is 'playing'/,
      'starting twice must not silently replace a live world');
    assert.equal(host.getRoomStatus().hasWorld, true);
    assert.equal(server.isRunning, true);

    host.pauseMatch();
    const pausedGameTime = server.getSnapshot().gameTime;
    assert.equal(host.getRoomStatus().phase, 'paused');
    assert.equal(host.getRoomStatus().worldId, activeWorldId, 'pause must not replace world identity');
    assert.equal(server.isRunning, false);
    assert.throws(() => host.pauseMatch(), /Cannot pause a world while room phase is 'paused'/,
      'a second pause must be rejected instead of producing a phase mismatch');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(server.getSnapshot().gameTime, pausedGameTime, 'the authoritative simulation must not advance while paused');

    host.resumeMatch();
    assert.equal(host.getRoomStatus().phase, 'playing');
    assert.equal(host.getRoomStatus().worldId, activeWorldId, 'resume must continue the same world');
    assert.equal(server.isRunning, true);
    assert.throws(() => host.resumeMatch(), /Cannot resume a world while room phase is 'playing'/,
      'resume is valid only from paused state');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(server.getSnapshot().gameTime > pausedGameTime, 'the simulation clock must resume after unpausing');

    const participantBefore = server.getSnapshot().humanPlayers.find(player => player.playerId === guestId);
    if (!participantBefore) throw new Error('Expected the guest in the active world.');
    const oldCoreId = participantBefore.coreId;
    const oldCore = server.getSnapshot().buildings.find(building => building.id === oldCoreId);
    if (!oldCore) throw new Error('Expected the guest Core in the active world.');
    oldCore.hp = 0;
    server.step(1 / 60);
    assert.equal(typeof server.getSnapshot().humanPlayers.find(player => player.playerId === guestId)?.defeatedAtGameTime, 'number',
      'destroying the Core should record an actual defeat timestamp');

    host.reviveParticipant(guestId);
    const revived = server.getSnapshot().humanPlayers.find(player => player.playerId === guestId);
    if (!revived) throw new Error('Revival removed the room participant unexpectedly.');
    assert.equal(revived.defeatedAtGameTime, null);
    assert.notEqual(revived.coreId, oldCoreId, 'revival creates a distinct Core rather than reviving a destroyed entity in place');
    assert.ok(server.getSnapshot().buildings.some(building => building.id === revived.coreId && building.hp > 0));
    assert.equal(server.worldId, activeWorldId, 'revival does not create or replace the world');
    assert.equal(host.getRoomStatus().phase, 'playing');
  } finally {
    host.stop();
    server.stop();
  }
});

test('host kick waits for the guest to acknowledge a clear removal notice before cleanup', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-kick', displayName: 'Kick Bot' });
    const assigned = transport.sent.find(item => item.target === 'peer-kick' && item.message.type === 'game-player-assigned')?.message;
    if (!assigned || typeof assigned.playerId !== 'string' || typeof assigned.roomSessionId !== 'string') {
      throw new Error('Expected guest assignment before kick.');
    }
    const playerId = assigned.playerId;
    host.kickParticipant(playerId);
    const notice = transport.sent.find(item => item.target === 'peer-kick' && item.message.type === 'game-room-removed')?.message;
    assert.ok(notice, 'the host sends an explicit removal notice before closing the connection');
    assert.equal(notice.code, 'HOST_REMOVED');
    assert.equal(typeof notice.removalId, 'string');
    assert.equal(host.getRoomStatus().players.some(player => player.playerId === playerId), true,
      'the participant remains in the room roster during the short notice/acknowledgement window');
    assert.equal(transport.closedPeers.some(peer => peer.peerId === 'peer-kick'), false);

    transport.emit({ type: 'game-room-removal-ack', protocolVersion: 2,
      roomSessionId: assigned.roomSessionId, removalId: notice.removalId, senderPeerId: 'peer-kick' });

    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false);
    assert.ok(transport.closedPeers.some(peer => peer.peerId === 'peer-kick' && peer.reason === 'host-kicked'));
    assert.equal(host.getRoomStatus().players.some(player => player.playerId === playerId), false,
      'removed players must not remain in the active room roster');
  } finally {
    host.stop();
    server.stop();
  }
});

test('room status transition is retried after a temporary send-queue failure', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-status-retry', displayName: 'Status Retry' });
    transport.failNextRoomStatusForPeer = 'peer-status-retry';
    host.startMatch();
    assert.equal(transport.sent.some(entry => entry.target === 'peer-status-retry' && entry.message.type === 'game-room-status' &&
      (entry.message.status as { phase?: string }).phase === 'playing'), false,
    'the simulated first send must fail');

    host.flushStateUpdates(Date.now() + 200);
    assert.equal(transport.sent.some(entry => entry.target === 'peer-status-retry' && entry.message.type === 'game-room-status' &&
      (entry.message.status as { phase?: string }).phase === 'playing'), true,
    'the host must retry a room-status payload that was not queued');
  } finally {
    host.stop();
    server.stop();
  }
});

test('stale connection cleanup is idempotent when the transport already removed the peer', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  let runtimeErrors = 0;
  const host = new HostRoomController(server, transport, 'TEAM', undefined, 'Host', undefined, () => { runtimeErrors++; });
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-close-race', displayName: 'Close Race' });
    const assignment = transport.sent.find(entry => entry.target === 'peer-close-race' && entry.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Expected an assigned participant before simulating an out-of-order close event.');
    const playerId = assignment.playerId;
    // Simulate PeerJS removing its DataConnection before the host's liveness
    // timer gets a chance to clean up the participant record.
    transport.unavailablePeers.add('peer-close-race');
    assert.doesNotThrow(() => host.kickParticipant(playerId), 'a stale/absent connection is already closed and must not raise an AggregateError');
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false);
    assert.equal(host.getRoomStatus().players.some(player => player.playerId === playerId), false);
    assert.equal(runtimeErrors, 0, 'a disconnected guest that cannot acknowledge a removal notice must not produce a user-facing room error');
    assert.equal(host.getRoomStatus().hasWorld, false, 'the room itself remains in its lobby state after removing a stale participant');
  } finally {
    host.stop();
    server.stop();
  }
});

test('room-status transport exceptions are reported but do not escape or block later delivery', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  let runtimeErrors = 0;
  const original = host as unknown as { onRuntimeError?: (context: string, error: unknown) => void };
  original.onRuntimeError = () => { runtimeErrors += 1; };
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-status-throw', displayName: 'Status Throw' });
    transport.throwNextRoomStatusForPeer = 'peer-status-throw';
    assert.doesNotThrow(() => host.startMatch(), 'a room-status send exception must not escape the room lifecycle operation');
    assert.ok(runtimeErrors >= 1, 'the unexpected transport exception must be surfaced to diagnostics');
    host.flushStateUpdates(Date.now() + 250);
    assert.equal(transport.sent.some(entry => entry.target === 'peer-status-throw' && entry.message.type === 'game-room-status' &&
      (entry.message.status as { phase?: string }).phase === 'playing'), true,
    'the target-specific room status must retry after the temporary exception');
  } finally {
    host.stop();
    server.stop();
  }
});

test('a peer missing from the transport registry is removed promptly and omitted from the live roster', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-stale-map', displayName: 'Stale Peer' });
    const assignment = transport.sent.find(entry => entry.target === 'peer-stale-map' && entry.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Expected a guest assignment before simulating a vanished transport connection.');
    const playerId = assignment.playerId;
    const sentBeforeDisconnect = transport.sent.length;
    transport.unavailablePeers.add('peer-stale-map');

    assert.doesNotThrow(() => host.flushStateUpdates(Date.now() + 100));
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false,
      'an unregistered transport peer must not linger in the authoritative world');
    assert.equal(host.getRoomStatus().players.some(player => player.playerId === playerId), false,
      'only active participants are listed in room status');
    assert.ok(transport.closeAttempts.some(attempt => attempt.peerId === 'peer-stale-map' && attempt.reason === 'transport-connection-missing'),
      'stale registry cleanup still calls the idempotent transport close to remove any closed-but-registered channel');
    assert.equal(transport.sent.slice(sentBeforeDisconnect).some(entry => entry.target === 'peer-stale-map' && entry.message.type === 'game-room-status' &&
      (entry.message.status as { players?: Array<{ playerId: string }> }).players?.some(player => player.playerId === playerId)), false,
    'room status must not be enqueued for a transport peer that no longer exists');
  } finally {
    host.stop();
    server.stop();
  }
});

test('cleanup repairs a participant mapping that disappeared before replication cleanup and stays idempotent', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const runtimeErrors: Array<{ context: string; error: unknown }> = [];
  const host = new HostRoomController(server, transport, 'TEAM', undefined, 'Host', undefined,
    (context, error) => runtimeErrors.push({ context, error }));
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session',
      senderPeerId: 'peer-orphaned-replication', displayName: 'Orphaned Map' });
    const assignment = transport.sent.find(entry => entry.target === 'peer-orphaned-replication' && entry.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Expected an assigned guest before corrupting the participant map.');
    const playerId = assignment.playerId;
    const internals = host as unknown as {
      playerByPeer: Map<string, string>;
      lastSequenceByPeer: Map<string, number>;
      replicationByPeer: Map<string, { playerId: string }>;
      roomStatusByPeer: Map<string, unknown>;
    };

    // Reproduce the exact race: transport/participant mapping is gone while
    // replication state remains. Cleanup must use the replication player ID.
    internals.playerByPeer.delete('peer-orphaned-replication');
    transport.unavailablePeers.add('peer-orphaned-replication');
    assert.doesNotThrow(() => host.flushStateUpdates(Date.now() + 100),
      'a peer-map invariant failure must be diagnosed without escaping the publication tick');
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false);
    assert.equal(internals.playerByPeer.has('peer-orphaned-replication'), false);
    assert.equal(internals.replicationByPeer.has('peer-orphaned-replication'), false);
    assert.equal(internals.lastSequenceByPeer.has('peer-orphaned-replication'), false);
    assert.equal(internals.roomStatusByPeer.has('peer-orphaned-replication'), false);
    assert.ok(transport.closeAttempts.some(entry => entry.peerId === 'peer-orphaned-replication'),
      'transport close is attempted even when one of the host maps has already lost the peer');
    assert.ok(runtimeErrors.some(entry => entry.context.includes('peer-cleanup')),
      'the bookkeeping invariant remains observable through room diagnostics');

    // The transport close and host cleanup may each report the same lifecycle
    // transition. The second notification is a no-op and cannot affect the host.
    assert.doesNotThrow(() => transport.emit({ type: 'game-peer-left', senderPeerId: 'peer-orphaned-replication' }));
    assert.deepEqual(server.getSnapshot().humanPlayers.map(player => player.playerId), ['player-host']);
    assert.doesNotThrow(() => host.flushStateUpdates(Date.now() + 200), 'the next tick must not retry a ghost map entry');
  } finally {
    host.stop();
    server.stop();
  }
});

test('cleanup removes an authoritative participant even when only its participant mapping survives', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session',
      senderPeerId: 'peer-orphaned-participant', displayName: 'Participant Only' });
    const assignment = transport.sent.find(entry => entry.target === 'peer-orphaned-participant' && entry.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Expected an assigned guest before corrupting replication state.');
    const playerId = assignment.playerId;
    const internals = host as unknown as { replicationByPeer: Map<string, unknown> };
    internals.replicationByPeer.delete('peer-orphaned-participant');
    transport.unavailablePeers.add('peer-orphaned-participant');

    assert.doesNotThrow(() => host.flushStateUpdates(Date.now() + 100));
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false,
      'a participant mapping by itself still owns a cleanup obligation');
    assert.equal(host.getRoomStatus().players.some(player => player.playerId === playerId), false);
    assert.equal(internals.replicationByPeer.has('peer-orphaned-participant'), false);
  } finally {
    host.stop();
    server.stop();
  }
});
