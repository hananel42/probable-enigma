export type RoomConnectionStatus = 'idle' | 'connecting' | 'waiting' | 'signaling' | 'connected' | 'error';

export interface RoomConnectionView {
  status: RoomConnectionStatus;
  message: string;
  roomCode?: string;
  role?: 'host' | 'guest';
  peerConnected: boolean;
  /** Signalling is unavailable for new negotiations; established data channels remain independent. */
  signalingUnavailable?: boolean;
  signalingRetryAttempts?: number;
}
