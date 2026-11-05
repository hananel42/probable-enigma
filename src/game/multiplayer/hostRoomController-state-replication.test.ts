import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { HostRoomController } from './HostRoomController';
import { FakeTransport } from './hostRoomControllerTestSupport';
import { MAX_PEERJS_GAME_MESSAGE_BYTES } from './peerJsTransportPolicy';

test('full-state retries keep the same baseline until ACK so slow guests can synchronize while the world advances', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-slow-sync' });
    host.startMatch();
    const initialState = transport.sent.find(item => item.target === 'peer-slow-sync' && item.message.type === 'game-initial-state')?.message;
    if (!initialState || !initialState.frame || typeof initialState.frame !== 'object') throw new Error('Host did not send the initial full state.');
    const initialFrame = initialState.frame as { worldId: string; revision: number };
    const virtualStart = Date.now() + 5_000;

    // Simulate a slow guest: the world advances several revisions while its ACK
    // is delayed beyond several retransmission intervals.
    server.step(0.25);
    host.flushStateUpdates(virtualStart + 1_500);
    server.step(0.25);
    host.flushStateUpdates(virtualStart + 3_000);
    server.step(0.25);
    host.flushStateUpdates(virtualStart + 4_500);

    const retries = transport.sent.filter(item => item.target === 'peer-slow-sync' && item.message.type === 'game-initial-state');
    assert.ok(retries.length >= 4, 'the host should retry a full state during delayed acknowledgement');
    for (const retry of retries) {
      const frame = retry.message.frame as { worldId: string; revision: number };
      assert.equal(frame.worldId, initialFrame.worldId);
      assert.equal(frame.revision, initialFrame.revision, 'a retry must preserve the same synchronization baseline');
    }

    transport.emit({
      type: 'game-state-ack', senderPeerId: 'peer-slow-sync', protocolVersion: 3,
      worldId: initialFrame.worldId, revision: initialFrame.revision
    });
    host.flushStateUpdates(virtualStart + 6_000);

    const deltas = transport.sent.filter(item => item.target === 'peer-slow-sync' && item.message.type === 'game-state-delta');
    assert.ok(deltas.length >= 1, 'after the pending baseline is acknowledged, the host should deliver accumulated changes as deltas');
    assert.equal(server.getSnapshot().humanPlayers.length, 2, 'a slow but responsive guest must remain registered');
    assert.equal(transport.closedPeers.some(entry => entry.peerId === 'peer-slow-sync'), false, 'delayed state ACK must not cause guest eviction');
  } finally {
    host.stop();
    server.stop();
  }
});


test('host terminates a guest whose full-state synchronization never receives an ACK', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-no-state-ack' });
    host.startMatch();
    const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
    const playerId = assignment.playerId;
    const virtualStart = Date.now() + 100;
    for (let attempt = 1; attempt <= 20; attempt++) host.flushStateUpdates(virtualStart + attempt * 1_500);

    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false,
      'a responsive but permanently unsynchronized guest must not remain in the room forever');
    assert.ok(transport.closedPeers.some(entry => entry.peerId === 'peer-no-state-ack' && entry.reason === 'state-sync-timeout'));
  } finally {
    host.stop();
    server.stop();
  }
});


test('host disconnects a peer that exceeds the bounded command-rate budget', () => {
  const server = new LocalGameServer();
  const transport = new FakeTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  try {
    transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-spam' });
    host.startMatch();
    const assignment = transport.sent.find(item => item.message.type === 'game-player-assigned')?.message;
    if (!assignment || typeof assignment.playerId !== 'string') throw new Error('Host did not assign the new guest.');
    const playerId = assignment.playerId;

    for (let sequence = 1; sequence <= 121; sequence += 1) {
      transport.emit({
        type: 'game-command', senderPeerId: 'peer-spam', protocolVersion: 2, sequence,
        observedRevision: 0, command: { type: 'SET_INPUT_KEY', code: 'KeyD', pressed: true }
      });
    }

    assert.equal(server.getSnapshot().humanPlayers.some(player => player.playerId === playerId), false,
      'rate-limited guest must be removed rather than allowed to flood the authoritative main thread');
    assert.ok(transport.closedPeers.some(entry => entry.peerId === 'peer-spam' && entry.reason === 'command-rate-limit'));
  } finally {
    host.stop();
    server.stop();
  }
});

test('host shutdown attempts every peer cleanup even when one transport close fails', () => {
  class OneCloseFailureTransport extends FakeTransport {
    override closePeer(peerId: string, reason?: string): boolean {
      this.closedPeers.push({ peerId, reason });
      return peerId !== 'peer-a';
    }
  }

  const server = new LocalGameServer();
  const transport = new OneCloseFailureTransport();
  const host = new HostRoomController(server, transport, 'TEAM');
  host.start();
  transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-a' });
  transport.emit({ type: 'game-hello', protocolVersion: 2, stateSyncProtocolVersion: 3, clientSessionId: 'test-client-session', senderPeerId: 'peer-b' });

  assert.throws(() => host.stop(), AggregateError, 'cleanup failures must remain visible');
  assert.deepEqual(transport.closedPeers.map(peer => peer.peerId), ['peer-a', 'peer-b'],
    'one failed close must not prevent the remaining peers from being cleaned up');
  assert.deepEqual(server.getSnapshot().humanPlayers.map(player => player.playerId), ['player-host'],
    'all remote participants must be removed even if a transport refuses to close');
  assert.doesNotThrow(() => host.stop(), 'a second shutdown after cleanup must be idempotent');
  server.stop();
});
