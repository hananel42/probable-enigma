import test from 'node:test';
import assert from 'node:assert/strict';
import { isRoomChatMessage, normalizeChatText } from './chat';

test('chat input is trimmed, control characters are removed, and length is bounded', () => {
  assert.equal(normalizeChatText('  hello\u0000 world  '), 'hello world');
  assert.throws(() => normalizeChatText(' \n '), /cannot be empty/);
  assert.throws(() => normalizeChatText('x'.repeat(281)), /280 characters/);
});

test('room chat event validator rejects missing identity, invalid timestamps and oversized text', () => {
  const message = { messageId: 'world:chat:1', senderPlayerId: 'p1', senderName: 'Rusty Bot', text: 'hi', sentAtMs: 10 };
  assert.equal(isRoomChatMessage(message), true);
  assert.equal(isRoomChatMessage({ ...message, senderPlayerId: '' }), false);
  assert.equal(isRoomChatMessage({ ...message, sentAtMs: Number.NaN }), false);
  assert.equal(isRoomChatMessage({ ...message, text: 'x'.repeat(281) }), false);
});
