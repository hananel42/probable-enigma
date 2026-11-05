import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { HostRoomController } from './HostRoomController';
import { FakeTransport } from './hostRoomControllerTestSupport';
import { MAX_PEERJS_GAME_MESSAGE_BYTES } from './peerJsTransportPolicy';

test('room status omits disconnected participants but retains defeated participants whose peer is still connected', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session',
      senderPeerId: 'peer-roster-connected', displayName: 'Still Here' });
    host.startMatch();
    const participant = server.getSnapshot().humanPlayers.find(player => player.playerId !== 'player-host');
    if (!participant) throw new Error('Expected a connected guest for roster assertions.');
    const core = server.getSnapshot().buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
    if (!core) throw new Error('Expected a guest Core for defeat assertions.');
    core.hp = 0;
    const status = host.getRoomStatus();
    assert.ok(status.players.some(player => player.playerId === participant.playerId && player.connected && player.phase === 'defeated'));

    transport.unavailablePeers.add('peer-roster-connected');
    host.flushStateUpdates(Date.now() + 100);
    const disconnectedStatus = host.getRoomStatus();
    assert.equal(disconnectedStatus.players.some(player => player.playerId === participant.playerId), false,
      'a participant whose transport connection disappeared is removed from the live roster');
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === participant.playerId), false,
      'connection reconciliation removes the disconnected participant from the authoritative simulation');
    assert.equal(host.getRoomStatus().hasWorld, true, 'removing the last connected guest must not destroy the host room or active world');
    assert.equal(host.getRoomStatus().phase, 'playing', 'the host can continue the world alone after the guest disconnects');
  } finally {
    host.stop();
    server.stop();
  }
});

test('host retries a core-defeat notification until the matching participant acknowledgement arrives', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-death' });
    host.startMatch();
    const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
    const playerId = assignment.playerId;
    const participant = server.getSnapshot().humanPlayers.find(player => player.playerId === playerId);
    if (!participant) throw new Error('Host must register the player before gameplay starts.');
    const core = server.getSnapshot().buildings.find(building => building.id === participant.coreId && building.type === 'CORE');
    if (!core) throw new Error('Assigned participant must have a Core.');

    core.hp = 0;
    server.step(1 / 60);
    assert.equal(server.getSnapshot().entities.some(entity => entity.id === participant.commanderId), false, 'the destroyed Core must retire its commander');

    const fakeNow = Date.now() + 1_000;
    host.flushStateUpdates(fakeNow);
    const firstNoticeEntry = transport.sent.find(item => item.message.type === 'game-player-defeated');
    if (!firstNoticeEntry) throw new Error('Host did not send an explicit defeat message independent of state deltas.');
    const firstNotice = firstNoticeEntry.message;
    assert.equal(firstNoticeEntry.target, 'peer-death');
    assert.equal(firstNotice.playerId, playerId);
    assert.equal(firstNotice.coreId, participant.coreId);
    assert.equal(firstNotice.reason, 'core-destroyed');
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), true,
      'Core defeat alone must not disconnect or remove a guest from the room');
    assert.equal(transport.closedPeers.some(entry => entry.peerId === 'peer-death'), false,
      'a defeated guest keeps its room connection until it disconnects or the host closes the room');

    host.flushStateUpdates(fakeNow + 751);
    const notices = transport.sent.filter(item => item.message.type === 'game-player-defeated');
    assert.equal(notices.length, 2, 'an unacknowledged defeat notification must be retried');
    assert.equal(notices[0].message.eventId, notices[1].message.eventId, 'retries must keep the same idempotency key');

    transport.emit({
      type: 'game-player-defeated-ack', senderPeerId: 'peer-death', protocolVersion: 2,
      stateSyncProtocolVersion: 3, eventId: String(firstNotice.eventId), playerId,
      coreId: participant.coreId, worldId: String(firstNotice.worldId)
    });
    host.flushStateUpdates(fakeNow + 1_600);
    assert.equal(transport.sent.filter(item => item.message.type === 'game-player-defeated').length, 2,
      'after a matching acknowledgement, the host must stop retransmitting that defeat event');
  } finally {
    host.stop();
    server.stop();
  }
});

test('invalid display-name handshake returns a readable error and closes an unregistered peer', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-invalid-name', displayName: '<script>' });
    const rejection = transport.sent.find(item => item.message.type === 'game-connection-error');
    assert.equal(rejection?.message.code, 'INVALID_DISPLAY_NAME');
    assert.match(String(rejection?.message.message), /1 and 24 characters/);
    assert.ok(transport.closedPeers.some(item => item.peerId === 'peer-invalid-name' && item.reason === 'invalid-display-name'),
      'validation before participant assignment must still close the underlying transport connection');
    assert.deepEqual(server.getSnapshot().humanPlayers.map(player => player.playerId), ['player-host'],
      'rejected handshakes must not create a partial participant');
  } finally {
    host.stop();
    server.stop();
  }
});

test('a defeated guest may wait in the room; a later connection receives a fresh, alive participant', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-first-life', displayName: 'Glitch Ferret' });
    host.startMatch();
    const firstAssignment = transport.sent.find(item => item.target === 'peer-first-life' && item.message.type === 'game-player-assigned')?.message;
    if (!firstAssignment || typeof firstAssignment.playerId !== 'string') throw new Error('Initial participant assignment was not sent.');
    const firstId = firstAssignment.playerId;
    const firstParticipant = server.getSnapshot().humanPlayers.find(player => player.playerId === firstId);
    if (!firstParticipant) throw new Error('Initial participant was not created.');
    const firstCore = server.getSnapshot().buildings.find(building => building.id === firstParticipant.coreId);
    if (!firstCore) throw new Error('Initial participant Core was not created.');

    firstCore.hp = 0;
    server.step(1 / 60);
    host.flushStateUpdates(Date.now() + 1_000);
    assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === firstId), 'death must not remove the guest participant from the room');
    assert.equal(transport.closedPeers.some(entry => entry.peerId === 'peer-first-life'), false, 'death alone must not close the guest connection');
    assert.ok(transport.sent.some(item => item.target === 'peer-first-life' && item.message.type === 'game-player-defeated'));

    // A real disconnect removes that participant. Rejoining with the same name
    // creates a new participant/Core rather than inheriting a previous death.
    transport.emit({ type: 'game-peer-left', senderPeerId: 'peer-first-life' });
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === firstId), false);
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-rejoined', displayName: 'Glitch Ferret' });
    const secondAssignment = transport.sent.find(item => item.target === 'peer-rejoined' && item.message.type === 'game-player-assigned')?.message;
    if (!secondAssignment || typeof secondAssignment.playerId !== 'string') throw new Error('Rejoined participant assignment was not sent.');
    const second = server.getSnapshot().humanPlayers.find(player => player.playerId === secondAssignment.playerId);
    if (!second) throw new Error('Rejoined participant was not created.');
    assert.notEqual(second.playerId, firstId);
    assert.equal(second.displayName, 'Glitch Ferret');
    assert.equal(second.defeatedAtGameTime, null);
    assert.ok(server.getSnapshot().buildings.some(building => building.id === second.coreId && building.hp > 0));
    assert.ok(server.getSnapshot().entities.some(entity => entity.id === second.commanderId));
  } finally {
    host.stop();
    server.stop();
  }
});

test('host and guests use canonical, rate-limited room chat instead of trusting guest-supplied names', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const receivedByLocalHud: Array<{ senderName: string; text: string }> = [];
  const host = new HostRoomController(server, transport, 'TEAM', undefined, 'Wobble Toaster-42', message => {
    receivedByLocalHud.push({ senderName: message.senderName, text: message.text });
  });
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-chat', displayName: 'Rustbucket Ferret' });
    const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the chat guest.');
    const guest = host.getRoomStatus().players.find(player => player.playerId === assignment.playerId);
    assert.equal(guest?.displayName, 'Rustbucket Ferret', 'display identity belongs to room membership before a world exists');

    transport.emit({ type: 'game-chat-send', protocolVersion: 2, senderPeerId: 'peer-chat', senderName: 'Forged Admin', text: '  hello room  ' });
    const guestBroadcast = transport.sent.find(item => item.message.type === 'game-chat-broadcast');
    const guestMessage = guestBroadcast?.message.message as { senderName?: string; text?: string } | undefined;
    assert.equal(guestMessage?.senderName, 'Rustbucket Ferret', 'the room derives chat sender names from host-owned participant state');
    assert.equal(guestMessage?.text, 'hello room');
    assert.deepEqual(receivedByLocalHud.map(item => item.text), ['hello room']);

    host.sendHostChat('  host online  ');
    assert.deepEqual(receivedByLocalHud.map(item => item.text), ['hello room', 'host online']);
    assert.equal(receivedByLocalHud[1]?.senderName, 'Wobble Toaster-42');
  } finally {
    host.stop();
    server.stop();
  }
});


test('host evicts a guest with no completed heartbeat round-trip and closes the stale peer', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-stale' });
    host.startMatch();
    const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
    const playerId = assignment.playerId;
    assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId));

    transport.emit({ type: 'game-client-heartbeat', senderPeerId: 'peer-stale', protocolVersion: 2, clientSessionId: 'test-client-session', sequence: 1, lastHostSequence: 0 });
    const heartbeatResponse = transport.sent.find(item => item.message.type === 'game-host-heartbeat')?.message;
    if (!heartbeatResponse || !Number.isSafeInteger(heartbeatResponse.sequence)) throw new Error('Host did not send a heartbeat response.');
    transport.emit({ type: 'game-client-heartbeat', senderPeerId: 'peer-stale', protocolVersion: 2, clientSessionId: 'test-client-session', sequence: 2, lastHostSequence: heartbeatResponse.sequence });

    const livenessBase = Date.now();
    host.flushStateUpdates(livenessBase + 59_000);
    assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), 'a peer within the expanded heartbeat lease must remain connected');
    host.flushStateUpdates(livenessBase + 61_000);
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false, 'expired peers must be removed from the authoritative world');
    assert.equal(server.getSnapshot().entities.some(entity => entity.id === `commander-${playerId}`), false, 'timed-out commander must not remain in the world');
    assert.ok(transport.closedPeers.some(entry => entry.peerId === 'peer-stale' && entry.reason === 'heartbeat-timeout'), 'the stale direct connection must be explicitly closed');
  } finally {
    host.stop();
    server.stop();
  }
});

test('repeated stale heartbeat acknowledgements do not renew the peer liveness lease', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-stale-ack' });
    host.startMatch();
    const assignment = transport.sent.find(item => item.target === 'peer-stale-ack' && item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
    const playerId = assignment.playerId;

    transport.emit({ type: 'game-client-heartbeat', senderPeerId: 'peer-stale-ack', protocolVersion: 2, clientSessionId: 'test-client-session', sequence: 1, lastHostSequence: 0 });
    const response = transport.sent.find(item => item.target === 'peer-stale-ack' && item.message.type === 'game-host-heartbeat')?.message;
    if (!response || !Number.isSafeInteger(response.sequence)) throw new Error('Host did not respond to the first heartbeat.');
    transport.emit({ type: 'game-client-heartbeat', senderPeerId: 'peer-stale-ack', protocolVersion: 2, clientSessionId: 'test-client-session', sequence: 2, lastHostSequence: response.sequence });
    const leaseStart = Date.now();

    // Incoming heartbeats continue, but they acknowledge only the already-seen
    // response. This is not proof of a fresh round trip from host to guest.
    for (let sequence = 3; sequence <= 15; sequence += 1) {
      transport.emit({ type: 'game-client-heartbeat', senderPeerId: 'peer-stale-ack', protocolVersion: 2, clientSessionId: 'test-client-session', sequence, lastHostSequence: response.sequence });
    }
    host.flushStateUpdates(leaseStart + 59_000);
    assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), 'the peer remains connected inside the liveness lease');
    host.flushStateUpdates(leaseStart + 61_000);
    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false, 'stale ACKs must not renew liveness forever');
    assert.ok(transport.closedPeers.some(entry => entry.peerId === 'peer-stale-ack' && entry.reason === 'heartbeat-timeout'));
  } finally {
    host.stop();
    server.stop();
  }
});


test('stopping a hosted room removes every guest and closes their transport connection', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-room-close' });
  const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
  if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
  const playerId = assignment.playerId;

  host.stop();
  assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false);
  assert.ok(transport.closedPeers.some(entry => entry.peerId === 'peer-room-close' && entry.reason === 'host-room-stopped'));
  server.stop();
});
