/** A transport-neutral game message. senderPeerId is assigned by the transport, never trusted from payload data. */
export type PeerDataMessage = { type: string; senderPeerId?: string; [key: string]: unknown };

/**
 * Multiplayer snapshots are sent at 30 Hz to reduce visible stepping under
 * remote control. Compact deltas keep this below a full snapshot stream; room
 * status remains coalesced to lifecycle changes and roughly 1 Hz. Commands remain
 * event-driven and are not throttled by this publication clock.
 */
export const MULTIPLAYER_SNAPSHOT_RATE_HZ = 30;
export const MULTIPLAYER_SNAPSHOT_INTERVAL_MS = 1000 / MULTIPLAYER_SNAPSHOT_RATE_HZ;
/** Render about three state intervals behind the host to absorb moderate direct-channel jitter. */
export const MULTIPLAYER_INTERPOLATION_DELAY_MS = 100;

/** Minimal game-data transport contract. The game protocol depends on this interface, not WebSocket/WebRTC. */
export interface GameDataTransport {
  /** Optional diagnostics allow transports to advertise their current data plane without coupling game logic to it. */
  readonly diagnostics?: TransportDiagnostics;
  /** Host sends broadcast when targetPeerId is omitted; guest adapters may default to their host. */
  sendData(message: PeerDataMessage, targetPeerId?: string): boolean;
  subscribeData(listener: (message: PeerDataMessage) => void): () => void;
  /** Reports whether a host-side guest data channel is currently registered and open. */
  hasPeerConnection?(peerId: string): boolean;
  /**
   * Reconcile/close one remote peer. This operation must be idempotent: return
   * true when the peer was closed or is already absent from the transport registry.
   */
  closePeer?(peerId: string, reason?: string): boolean;
  /** Retry the signalling/control plane without closing established peer data channels. */
  retrySignaling?(): void;
}

export interface TransportDiagnostics {
  readonly kind: 'webrtc-data-channel' | 'peerjs-webrtc';
  readonly reliable: boolean;
}
