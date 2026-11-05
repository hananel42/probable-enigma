import test from 'node:test';
import assert from 'node:assert/strict';
import { clearRoomFromUrl, createRoomJoinUrl, parseRoomLink } from './roomLink';

test('direct room link parser normalizes valid lower-case codes', () => {
  assert.deepEqual(parseRoomLink('https://example.test/game?room=abcde'), { roomCode: 'ABCDE', error: null });
});

test('direct room link parser distinguishes no room from an invalid room parameter', () => {
  assert.deepEqual(parseRoomLink('https://example.test/game'), { roomCode: null, error: null });
  assert.match(parseRoomLink('https://example.test/game?room=ABIO1').error ?? '', /invalid room code/i);
  assert.match(parseRoomLink('https://example.test/game?room=ABCD').error ?? '', /invalid room code/i);
});

test('room share link contains only the app URL and validated room code', () => {
  assert.equal(createRoomJoinUrl('https://example.test/game?utm_source=private#old', 'abcde'), 'https://example.test/game?room=ABCDE');
  assert.throws(() => createRoomJoinUrl('https://example.test/game', 'ABCDE1'), /invalid room code/i);
});

test('leaving clears the direct-join parameter without discarding other URL state', () => {
  assert.equal(clearRoomFromUrl('https://example.test/game?room=ABCDE&lang=en#section'), 'https://example.test/game?lang=en#section');
});


test('rejects room links containing duplicate room parameters', () => {
  assert.match(parseRoomLink('https://example.test/game?room=ABCDE&room=FGHJK').error ?? '', /ambiguous/i);
});
