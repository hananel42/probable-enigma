import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRtcDataChannelTransport } from './WebRtcDataChannelTransport';
import type { PeerDataMessage } from './transport';

class FakeDataChannel extends EventTarget {
  readonly label = 'craftbound-game';
  readyState: RTCDataChannelState = 'open';
  ordered = true;
  maxRetransmits: number | null = null;
  maxPacketLifeTime: number | null = null;
  bufferedAmount = 0;
  readonly sent: string[] = [];

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('Fake channel is not open.');
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }

  receive(data: string): void {
    const event = new MessageEvent('message', { data });
    this.dispatchEvent(event);
  }
}

function channel(fake: FakeDataChannel): RTCDataChannel {
  return fake as unknown as RTCDataChannel;
}

test('WebRTC transport overwrites forged sender identity and routes validated messages', () => {
  const transport = new WebRtcDataChannelTransport();
  const fake = new FakeDataChannel();
  transport.attachPeer('peer-1', channel(fake));
  let received: PeerDataMessage | undefined;
  transport.subscribeData(message => { received = message; });

  fake.receive(JSON.stringify({ type: 'game-command', senderPeerId: 'forged-peer', command: { type: 'MOVE' } }));
  assert.equal(received?.type, 'game-command');
  assert.equal(received?.senderPeerId, 'peer-1');
  assert.equal(transport.diagnostics.kind, 'webrtc-data-channel');
  assert.equal(transport.diagnostics.reliable, true);
});

test('WebRTC transport preserves reliable deltas and applies bounded backpressure to reliable traffic', () => {
  const transport = new WebRtcDataChannelTransport();
  const fake = new FakeDataChannel();
  transport.attachPeer('peer-1', channel(fake));
  fake.bufferedAmount = 600 * 1024;

  assert.equal(transport.sendData({ type: 'game-state-delta', protocolVersion: 3 }, 'peer-1'), true);
  assert.equal(fake.sent.length, 1, 'a delta below the reliable backlog limit must be queued');
  fake.bufferedAmount = 1100 * 1024;
  assert.equal(transport.sendData({ type: 'game-command', command: { type: 'MOVE' } }, 'peer-1'), false);
  assert.equal(fake.sent.length, 1);

  fake.bufferedAmount = 0;
  assert.equal(transport.sendData({ type: 'game-command', command: { type: 'MOVE' } }, 'peer-1'), true);
  assert.equal(JSON.parse(fake.sent[1]).type, 'game-command');
});

test('WebRTC transport rejects duplicate peers and unexpected labels', () => {
  const transport = new WebRtcDataChannelTransport();
  const first = new FakeDataChannel();
  transport.attachPeer('peer-1', channel(first));
  assert.throws(() => transport.attachPeer('peer-1', channel(new FakeDataChannel())), /already attached/);

  const unexpected = new FakeDataChannel();
  Object.defineProperty(unexpected, 'label', { value: 'unrelated-data' });
  assert.throws(() => transport.attachPeer('peer-2', channel(unexpected)), /Unexpected WebRTC data channel label/);
});

test('WebRTC transport removes closed channels before subsequent sends', () => {
  const transport = new WebRtcDataChannelTransport();
  const fake = new FakeDataChannel();
  transport.attachPeer('peer-1', channel(fake));
  fake.close();
  assert.equal(transport.sendData({ type: 'game-command' }, 'peer-1'), false);
});

test('a raced RTCDataChannel send failure is isolated to that peer and does not stop fan-out', () => {
  class ThrowingDataChannel extends FakeDataChannel {
    override send(_data: string): void {
      throw new DOMException('The data channel closed between the ready-state check and send.', 'InvalidStateError');
    }
  }

  const transport = new WebRtcDataChannelTransport();
  const broken = new ThrowingDataChannel();
  const healthy = new FakeDataChannel();
  transport.attachPeer('peer-raced-close', channel(broken));
  transport.attachPeer('peer-healthy', channel(healthy));

  assert.equal(transport.sendData({ type: 'game-state-delta', revision: 2 }), true,
    'a send failure from one peer must not hide successful queueing to another peer');
  assert.equal(broken.sent.length, 0);
  assert.equal(healthy.sent.length, 1);
  assert.equal(JSON.parse(healthy.sent[0]).type, 'game-state-delta');
});

test('WebRTC peer close is idempotent when the channel was already removed', () => {
  const transport = new WebRtcDataChannelTransport();
  const fake = new FakeDataChannel();
  transport.attachPeer('peer-closed-race', channel(fake));
  assert.equal(transport.hasPeerConnection('peer-closed-race'), true);

  // PeerJS/browser close events can remove a channel before the room liveness
  // timer attempts the same cleanup. That second close is successful, not an error.
  fake.close();
  assert.equal(transport.hasPeerConnection('peer-closed-race'), false);
  assert.equal(transport.closePeer('peer-closed-race', 'liveness-expired'), true);
  assert.equal(transport.closePeer('never-attached', 'duplicate-cleanup'), true);
});


test('WebRTC transport isolates malformed JSON to one peer without throwing into the global event loop', () => {
  const transport = new WebRtcDataChannelTransport();
  const bad = new FakeDataChannel();
  const healthy = new FakeDataChannel();
  transport.attachPeer('peer-bad-json', channel(bad));
  transport.attachPeer('peer-healthy-json', channel(healthy));

  assert.doesNotThrow(() => bad.receive('{not-json'));
  assert.equal(bad.readyState, 'closed');
  assert.equal(transport.hasPeerConnection('peer-bad-json'), false);
  assert.equal(transport.hasPeerConnection('peer-healthy-json'), true);
  assert.equal(transport.sendData({ type: 'game-ping' }, 'peer-healthy-json'), true);
});

test('WebRTC transport closes only the peer whose protocol listener throws', () => {
  const transport = new WebRtcDataChannelTransport();
  const bad = new FakeDataChannel();
  const healthy = new FakeDataChannel();
  transport.attachPeer('peer-listener-error', channel(bad));
  transport.attachPeer('peer-listener-healthy', channel(healthy));
  transport.subscribeData(message => {
    if (message.senderPeerId === 'peer-listener-error') throw new Error('simulated protocol violation');
  });

  assert.doesNotThrow(() => bad.receive(JSON.stringify({ type: 'game-command' })));
  assert.equal(bad.readyState, 'closed');
  assert.equal(transport.hasPeerConnection('peer-listener-healthy'), true);
});

test('WebRTC transport rejects outbound type-less and oversized envelopes before sending', () => {
  const transport = new WebRtcDataChannelTransport();
  const fake = new FakeDataChannel();
  transport.attachPeer('peer-bounded', channel(fake));

  assert.throws(() => transport.sendData({ type: '' }), /invalid game-message type/);
  assert.throws(() => transport.sendData({ type: 'game-command', payload: 'x'.repeat(1_500_000) }), /protocol limit/);
  assert.equal(fake.sent.length, 0);
});
