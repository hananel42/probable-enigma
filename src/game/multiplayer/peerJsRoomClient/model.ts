import type { RoomConnectionView } from '../roomView';
import type { PeerDataMessage } from '../transport';
import { describePeerConnectionError } from '../connectionErrors';
import { MAX_PEERJS_GAME_MESSAGE_BYTES, getPeerJsDebugLevel } from '../peerJsTransportPolicy';
import { validatePeerDataMessage } from '../peerMessageEnvelope';

export const APPLICATION_ID = 'craftbound-survival-outpost';

export const APPLICATION_PROTOCOL_VERSION = 2;

export const MAX_ROOM_GUESTS = 7;

export const PEER_OPEN_TIMEOUT_MS = 15_000;

export const CONNECTION_OPEN_TIMEOUT_MS = 20_000;

export const MAX_BUFFERED_BYTES = 1024 * 1024;

export const SEND_FAILURE_LOG_INTERVAL_MS = 2_000;

/** ICE 'disconnected' can be transient; allow path checks to recover before closing a room peer. */
export const DATA_PATH_RECOVERY_GRACE_MS = 12_000;

/** PeerJS Cloud is the free signalling/broker service; game data travels peer-to-peer. */
export const PEERJS_CLOUD_OPTIONS = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  // Keep PeerJS internals quiet in production; application-owned diagnostics remain explicit.
  debug: getPeerJsDebugLevel(import.meta.env.DEV),
  config: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  }
};

export type RoomViewListener = (view: RoomConnectionView) => void;

export type DataListener = (message: PeerDataMessage) => void;

export type RoomRole = 'host' | 'guest';

export type PeerErrorLike = Error & { type?: string };

export interface PeerSendFailureState {
  attempts: number;
  lastLoggedAtMs: number;
  lastError: string;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Convert common PeerJS/WebRTC failures into actionable lobby messages. */
export function userFacingError(error: unknown): string {
  return describePeerConnectionError(peerErrorType(error), describeError(error));
}

export function peerErrorType(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'type' in error && typeof error.type === 'string'
    ? error.type
    : undefined;
}

export function validatePeerData(value: unknown, peerId: string): PeerDataMessage {
  return validatePeerDataMessage(value, {
    transportName: 'PeerJS',
    peerId,
    maxBytes: MAX_PEERJS_GAME_MESSAGE_BYTES
  });
}
