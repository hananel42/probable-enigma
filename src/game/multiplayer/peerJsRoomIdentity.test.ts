import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PEERJS_APP_ID_PREFIX,
  PEERJS_ROOM_CODE_ALPHABET,
  createPeerJsRoomCode,
  getPeerJsHostId,
  isValidPeerJsRoomCode
} from './peerJsRoomIdentity';

test('PeerJS host ID consists of the fixed application prefix plus exactly five code letters', () => {
  assert.equal(getPeerJsHostId('ABCDE'), `${PEERJS_APP_ID_PREFIX}ABCDE`);
  assert.equal(getPeerJsHostId('abcde'), `${PEERJS_APP_ID_PREFIX}ABCDE`);
  assert.throws(() => getPeerJsHostId('ABCD'), /exactly 5 letters/);
  assert.throws(() => getPeerJsHostId('ABCD1'), /exactly 5 letters/);
  assert.throws(() => getPeerJsHostId('ABCDE_'), /exactly 5 letters/);
});

test('PeerJS room-code validation accepts five unambiguous letters only', () => {
  assert.equal(isValidPeerJsRoomCode('ABCDE'), true);
  assert.equal(isValidPeerJsRoomCode('JAMXZ'), true);
  assert.equal(isValidPeerJsRoomCode('ABIOZ'), false);
  assert.equal(isValidPeerJsRoomCode('ABCD2'), false);
  assert.equal(isValidPeerJsRoomCode('abcdz'), false);
});

test('PeerJS room codes use secure unbiased sampling from the supported alphabet', () => {
  let offset = 0;
  const code = createPeerJsRoomCode(length => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) bytes[index] = offset++;
    return bytes;
  });
  assert.equal(code, 'ABCDE');
  assert.equal(code.length, 5);
  for (const letter of code) assert.ok(PEERJS_ROOM_CODE_ALPHABET.includes(letter));
});
