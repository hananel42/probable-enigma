import test from 'node:test';
import assert from 'node:assert/strict';
import { getPeerJsDebugLevel, MAX_PEERJS_GAME_MESSAGE_BYTES, PEERJS_GAME_DATA_SERIALIZATION } from './peerJsTransportPolicy';
import { encodePeerDataMessage, validateOutboundPeerDataMessage, validatePeerDataMessage } from './peerMessageEnvelope';
import type { PeerDataMessage } from './transport';

const baseContext = { transportName: 'TestTransport', peerId: 'peer-authoritative', maxBytes: 128 } as const;

test('PeerJS multiplayer data uses chunk-capable binary serialization for world snapshots', () => {
  assert.equal(PEERJS_GAME_DATA_SERIALIZATION, 'binary');
  assert.ok(MAX_PEERJS_GAME_MESSAGE_BYTES >= 16 * 1024 * 1024);
});

test('PeerJS internal tracing is disabled in production and enabled in development', () => {
  assert.equal(getPeerJsDebugLevel(false), 0);
  assert.equal(getPeerJsDebugLevel(true), 1);
});


test('PeerJS outbound validation preserves the object for BinaryPack instead of forcing JSON text', () => {
  const message = { type: 'game-initial-state', frame: { revision: 8 } } as PeerDataMessage;
  assert.doesNotThrow(() => validateOutboundPeerDataMessage(message, { ...baseContext, maxBytes: 1024 }));
  assert.equal(typeof message, 'object');
  assert.equal(message.type, 'game-initial-state');
});

test('shared envelope validation replaces caller-supplied sender identity', () => {
  const encoded = encodePeerDataMessage({ type: 'game-command', senderPeerId: 'forged-peer', command: { type: 'MOVE' } }, baseContext);
  const decoded = validatePeerDataMessage(JSON.parse(encoded), baseContext);
  assert.equal(decoded.type, 'game-command');
  assert.equal(decoded.senderPeerId, 'peer-authoritative');
});


test('shared envelope validation rejects arrays, custom prototypes and missing or oversized types', () => {
  assert.throws(() => validatePeerDataMessage([], baseContext), /plain object/);
  assert.throws(() => validatePeerDataMessage(Object.assign(Object.create({ inherited: true }), { type: 'game-command' }), baseContext), /plain object/);
  assert.throws(() => validatePeerDataMessage({}, baseContext), /invalid game-message type/);
  assert.throws(() => validatePeerDataMessage({ type: 'x'.repeat(97) }, baseContext), /invalid game-message type/);
});


test('shared envelope validation enforces UTF-8 byte limits for outgoing and incoming messages', () => {
  const message = { type: 'payload', content: 'é'.repeat(80) };
  assert.throws(() => encodePeerDataMessage(message, baseContext), /protocol limit is 128 bytes/);
  assert.throws(() => validatePeerDataMessage(message, baseContext), /protocol limit is 128 bytes/);
});


test('shared envelope validation reports non-JSON payloads instead of swallowing them', () => {
  assert.throws(() => encodePeerDataMessage({ type: 'game-command', value: 1n }, baseContext), /cannot be serialized/);
  assert.throws(() => validateOutboundPeerDataMessage({ type: 'game-command' }, { ...baseContext, maxBytes: 0 }), /positive safe integer/);
});
