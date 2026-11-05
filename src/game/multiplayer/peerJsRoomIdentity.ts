/**
 * Stable application namespace for PeerJS Cloud room IDs.
 * Only the five-letter suffix is shown to players. The prefix is intentionally
 * fixed in source so every installation can derive the same host peer ID.
 */
export const PEERJS_APP_ID_PREFIX = 'sderg44g4n5g45jg459gm495g495j49kt54ktk945jter_';
export const PEERJS_ROOM_CODE_LENGTH = 5;
export const PEERJS_ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const ACCEPTED_RANDOM_BYTE_LIMIT = Math.floor(256 / PEERJS_ROOM_CODE_ALPHABET.length) * PEERJS_ROOM_CODE_ALPHABET.length;

export type RandomByteSource = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generation is unavailable. PeerJS room IDs require crypto.getRandomValues().');
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Generates an unbiased five-letter room suffix using cryptographic randomness. */
export function createPeerJsRoomCode(randomBytes: RandomByteSource = secureRandomBytes): string {
  const code: string[] = [];
  while (code.length < PEERJS_ROOM_CODE_LENGTH) {
    const bytes = randomBytes(Math.max(8, PEERJS_ROOM_CODE_LENGTH - code.length));
    if (!(bytes instanceof Uint8Array)) throw new TypeError('PeerJS room-code random source must return Uint8Array.');
    for (const byte of bytes) {
      if (byte >= ACCEPTED_RANDOM_BYTE_LIMIT) continue;
      code.push(PEERJS_ROOM_CODE_ALPHABET[byte % PEERJS_ROOM_CODE_ALPHABET.length]);
      if (code.length === PEERJS_ROOM_CODE_LENGTH) break;
    }
  }
  return code.join('');
}

export function isValidPeerJsRoomCode(value: string): boolean {
  return new RegExp(`^[${PEERJS_ROOM_CODE_ALPHABET}]{${PEERJS_ROOM_CODE_LENGTH}}$`).test(value);
}

/** Derives the globally registered PeerJS host ID from the only value shared with guests. */
export function getPeerJsHostId(roomCode: string): string {
  const normalized = roomCode.trim().toUpperCase();
  if (!isValidPeerJsRoomCode(normalized)) {
    throw new RangeError(`PeerJS room code must contain exactly ${PEERJS_ROOM_CODE_LENGTH} letters from ${PEERJS_ROOM_CODE_ALPHABET}.`);
  }
  return `${PEERJS_APP_ID_PREFIX}${normalized}`;
}
