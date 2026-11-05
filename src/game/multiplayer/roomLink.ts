import { isValidPeerJsRoomCode } from './peerJsRoomIdentity';

export interface RoomLinkParseResult {
  readonly roomCode: string | null;
  readonly error: string | null;
}

/** Reads the optional direct-join room code from a share URL. */
export function parseRoomLink(href: string): RoomLinkParseResult {
  const url = new URL(href);
  const roomParameters = url.searchParams.getAll('room');
  if (roomParameters.length === 0) return { roomCode: null, error: null };
  if (roomParameters.length !== 1) {
    return { roomCode: null, error: 'This room link is ambiguous. It must contain exactly one room code.' };
  }

  const roomCode = roomParameters[0].trim().toUpperCase();
  if (!isValidPeerJsRoomCode(roomCode)) {
    return {
      roomCode: null,
      error: `This room link contains an invalid room code. Room codes must contain exactly five letters (I and O are not used).`
    };
  }
  return { roomCode, error: null };
}

/** Builds a clean shareable room URL, without copying unrelated query parameters or fragments. */
export function createRoomJoinUrl(href: string, roomCodeInput: string): string {
  const roomCode = roomCodeInput.trim().toUpperCase();
  if (!isValidPeerJsRoomCode(roomCode)) {
    throw new RangeError(`Cannot create a room link for invalid room code '${roomCodeInput}'.`);
  }
  const url = new URL(href);
  url.search = '';
  url.searchParams.set('room', roomCode);
  url.hash = '';
  return url.toString();
}

/** Removes a room query parameter after leaving, so reloading does not unexpectedly rejoin. */
export function clearRoomFromUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('room');
  return url.toString();
}
