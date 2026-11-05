import { Peer, type DataConnection } from 'peerjs';
import type { RoomConnectionView } from '../roomView';
import type { PeerDataMessage, TransportDiagnostics } from '../transport';
import type { DataListener, RoomRole, RoomViewListener, PeerSendFailureState } from './model';

export abstract class PeerJsRoomClientState {
  public abstract subscribe(listener: RoomViewListener): () => void;
  public abstract subscribeData(listener: DataListener): () => void;
  public abstract getView(): RoomConnectionView;
  public abstract createRoom(): Promise<void>;
  public abstract joinRoom(roomCodeInput: string): Promise<void>;
  public abstract closePeer(peerId: string, reason?: any): boolean;
  public abstract hasPeerConnection(peerId: string): boolean;
  public abstract sendData(message: PeerDataMessage, targetPeerId?: string): boolean;
  public abstract leaveRoom(): void;
  public abstract retrySignaling(): void;
  public abstract disconnect(update?: any): void;
  protected abstract assertNoActivePeer(action: string): void;
  protected abstract waitForPeerOpen(peer: Peer, expectedId?: string): Promise<string>;
  protected abstract attachPeerLifecycle(peer: Peer): void;
  protected abstract scheduleSignalingReconnect(peer: Peer): void;
  protected abstract scheduleSignalingReconnectAfterAttempt(peer: Peer): void;
  protected abstract acceptGuestConnection(connection: DataConnection): void;
  protected abstract bindConnection(connection: DataConnection, connectionRole: RoomRole): Promise<void>;
  protected abstract handleWebRtcConnectionState(connection: DataConnection, connectionRole: RoomRole): void;
  protected abstract dispatchDataMessage(message: PeerDataMessage, connection: DataConnection, connectionRole: RoomRole): void;
  protected abstract isDirectConnectionLive(connection: DataConnection): boolean;
  protected abstract reportSendFailure(peerId: string, messageType: string, lastError: string): void;
  protected abstract clearPeerSendFailures(peerId: string): void;
  protected abstract scheduleConnectionRecoveryClose(connection: DataConnection, connectionRole: RoomRole): void;
  protected abstract clearConnectionRecoveryTimer(connection: DataConnection): void;
  protected abstract destroyPeerAndConnections(): void;
  protected abstract update(patch: Partial<RoomConnectionView>): void;

  protected peer: Peer | null = null;

  protected role: RoomRole | undefined;

  protected roomCode: string | undefined;

  protected hostConnection: DataConnection | null = null;

  protected readonly connections = new Map<string, DataConnection>();

  protected readonly allConnections = new Set<DataConnection>();

  protected readonly intentionallyClosingConnections = new WeakSet<DataConnection>();

  protected readonly pendingConnectionPeerIds = new Set<string>();

  /** Suppress duplicate diagnostics for a known disconnect race until the peer reconnects. */
  protected readonly reportedMissingTargetPeerIds = new Set<string>();

  protected readonly reportedSendFailures = new Map<string, PeerSendFailureState>();

  protected readonly connectionRecoveryTimers = new Map<DataConnection, number>();

  protected readonly viewListeners = new Set<RoomViewListener>();

  protected readonly dataListeners = new Set<DataListener>();

  protected intentionalClose = false;

  protected signalingReconnectTimer: number | null = null;

  protected signalingReconnectAttempts = 0;

  protected signalingConnected = false;

  protected view: RoomConnectionView = { status: 'idle', message: 'Not connected', peerConnected: false };

  readonly diagnostics: TransportDiagnostics = { kind: 'peerjs-webrtc', reliable: true };
}
