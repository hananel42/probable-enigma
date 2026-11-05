import type { GameWorldFrame } from '../../server/protocol';
import type { GameMode } from '../types';
import type { PeerDataMessage, GameDataTransport } from '../transport';
import type { RoomChatMessage } from '../chat';
import type { RoomManagementStatus, RoomPhase } from '../roomManagement';
import type { PeerReplicationState, PendingRoomRemoval, PeerRoomStatusDelivery, PeerTransportFailureState } from './model';
import type { RoomGameAuthority } from '../RoomGameAuthority';

export abstract class HostRoomControllerState {
  public abstract subscribeRoomStatus(listener: (status: RoomManagementStatus) => void): () => void;
  public abstract getRoomStatus(): RoomManagementStatus;
  public abstract setRoomMode(mode: GameMode): void;
  public abstract startMatch(): void;
  public abstract pauseMatch(): void;
  public abstract resumeMatch(): void;
  public abstract reviveParticipant(playerId: string): void;
  public abstract kickParticipant(playerId: string): void;
  public abstract returnToLobby(): void;
  public abstract start(): void;
  public abstract stop(): void;
  public abstract flushStateUpdates(nowMs?: any): void;
  protected abstract handleMessage(message: PeerDataMessage): void;
  public abstract sendHostChat(rawText: string): RoomChatMessage;
  protected abstract acceptGuestChat(peerId: string, message: PeerDataMessage): void;
  protected abstract publishChatMessage(senderPlayerId: string, senderName: string, text: string): RoomChatMessage;
  protected abstract acceptClientHeartbeat(peerId: string, message: PeerDataMessage): void;
  protected abstract acceptDefeatAcknowledgement(peerId: string, message: PeerDataMessage): void;
  protected abstract updateDefeatNotification(peerId: string, peer: PeerReplicationState, frame: GameWorldFrame, coreId: string, nowMs: number): void;
  protected abstract finishPendingRoomRemoval(peerId: string, pending: PendingRoomRemoval, reason: string, reportRuntimeError?: boolean): unknown | null;
  protected abstract removePeer(peerId: string, reason: string, closeConnection: boolean, publishRoomStatus?: any): void;
  protected abstract removePeerDuringPublication(peerId: string, reason: string, closeConnection: boolean): void;
  protected abstract pruneMissingTransportPeers(nowMs: number): void;
  protected abstract transitionRoomLifecycle(nextPhase: RoomPhase, nextHasWorld: boolean, reason: string): void;
  protected abstract updateMatchPhaseFromWorld(): void;
  protected abstract buildRoomStatus(nowMs: number): RoomManagementStatus;
  protected abstract broadcastRoomStatus(force: boolean, nowMs?: any): void;
  protected abstract sendRoomStatusToPeer(peerId: string, nowMs?: any, existingStatus?: RoomManagementStatus, force?: any): void;
  protected abstract tryQueueTransportMessage(message: PeerDataMessage, peerId: string | undefined, context: string): boolean;
  protected abstract reportTransportQueueFailure(peerId: string, context: string, messageType: string, error: unknown, extraDetails?: Record<string, unknown>): boolean;
  protected abstract resetPeerReplication(peer: PeerReplicationState, nowMs: number, needsFullState?: any): void;
  protected abstract resetAllPeerReplicasForFullState(): void;
  protected abstract sendParticipantAssignment(peerId: string, peer: PeerReplicationState): void;
  protected abstract sendFullState(peerId: string, peer: PeerReplicationState, frame: GameWorldFrame, nowMs: number): void;
  protected abstract acceptStateAcknowledgement(peerId: string, message: PeerDataMessage): void;

  protected readonly playerByPeer = new Map<string, string>();

  /** Display names are room membership, so they also exist before a world is created. */
  protected readonly displayNameByPeer = new Map<string, string>();

  protected readonly lastSequenceByPeer = new Map<string, number>();

  protected readonly replicationByPeer = new Map<string, PeerReplicationState>();

  protected readonly roomStatusListeners = new Set<(status: RoomManagementStatus) => void>();

  protected readonly roomStatusByPeer = new Map<string, PeerRoomStatusDelivery>();

  /** Pending kick handshakes; a room removal notice must be acknowledged before the channel is closed. */
  protected readonly pendingRoomRemovalsByPeer = new Map<string, PendingRoomRemoval>();

  protected readonly transportFailureByContext = new Map<string, PeerTransportFailureState>();

  protected roomPhase: RoomPhase = 'lobby';

  /** The transport room can exist without an active simulation world. */
  protected hasWorld = false;

  /** Rejects delayed control messages from a previous host-controller lifecycle on a reused channel. */
  protected readonly roomSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  protected mode: GameMode;

  protected lastPublishedRoomStatusContent = '';

  protected lastPublishedRoomUrgentContent = '';

  /** Monotonic room-control sequence; unlike world revision it survives world changes. */
  protected roomStatusRevision = 0;

  protected lastRoomStatusPublicationAtMs = 0;

  protected nextGuestSerial = 1;

  protected nextDefeatEventSerial = 1;

  protected nextChatMessageSerial = 1;

  protected nextRoomRemovalSerial = 1;

  protected unsubscribe: (() => void) | null = null;

  protected publicationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    protected readonly server: RoomGameAuthority,
    protected readonly transport: GameDataTransport,
    mode: GameMode,
    protected readonly onGuestJoined?: (playerId: string) => void,
    protected readonly hostDisplayName = 'Host',
    protected readonly onChatMessage?: (message: RoomChatMessage) => void,
    protected readonly onRuntimeError?: (context: string, error: unknown) => void
  ) {
    this.mode = mode;
  }
}
