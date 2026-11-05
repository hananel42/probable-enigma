import type { GameClientSessionInfo, GameCommand, GameSnapshot, GameWorldFrame } from '../../server/protocol';
import { type PeerDataMessage, MULTIPLAYER_INTERPOLATION_DELAY_MS, type GameDataTransport } from '../transport';
import type { RoomChatMessage } from '../chat';
import type { RoomManagementStatus } from '../roomManagement';
import { type InitialStateEnvelope, type PlayerDefeatNotice, type RemoteConnectionHealth, type RoomRemovalNotice, COMMAND_PROTOCOL_VERSION, HEARTBEAT_INTERVAL_MS, HOST_LIVENESS_TIMEOUT_MS, STATE_SYNC_PROTOCOL_VERSION, createClientSessionId } from './model';
import { SnapshotInterpolationBuffer } from '../snapshotInterpolation';
import type { GameEntity } from '../../types';
import { normalizeDisplayName, resolveDisplayName } from '../displayName';

export abstract class RemoteGameClientPortState {
  public abstract get session(): GameClientSessionInfo;
  public abstract get assignedPlayerId(): string | null;
  public abstract subscribeRoomStatus(listener: (status: RoomManagementStatus) => void): () => void;
  public abstract getRoomStatus(): RoomManagementStatus | null;
  public abstract hasAuthoritativeState(): boolean;
  public abstract getSnapshot(): GameSnapshot;
  public abstract getWorldFrame(): GameWorldFrame;
  public abstract getRenderSnapshot(): GameSnapshot;
  public abstract setPredictedInputKey(code: string, pressed: boolean): void;
  public abstract setPredictedAimPoint(worldX: number, worldY: number): void;
  public abstract subscribe(listener: (snapshot: GameSnapshot) => void): () => void;
  public abstract subscribeWorldFrames(listener: (frame: GameWorldFrame) => void): () => void;
  public abstract subscribeConnectionHealth(listener: (health: RemoteConnectionHealth, message?: string) => void): () => void;
  public abstract subscribePlayerDefeated(listener: (notice: PlayerDefeatNotice) => void): () => void;
  public abstract subscribeRoomRemoval(listener: (notice: RoomRemovalNotice) => void): () => void;
  public abstract dispatch(command: GameCommand): boolean;
  public abstract isSessionReady(): boolean;
  public abstract subscribeSessionReadiness(listener: (ready: boolean) => void): () => void;
  public abstract subscribeChat(listener: (message: RoomChatMessage) => void): () => void;
  public abstract sendChat(rawText: string): void;
  public abstract disconnect(): void;
  protected abstract fail(message: string, details?: unknown): never;
  protected abstract projectFrame(authoritative: GameWorldFrame): GameWorldFrame;
  protected abstract onMessage(message: PeerDataMessage): void;
  protected abstract acceptInitialStateEnvelope(message: PeerDataMessage): void;
  protected abstract isValidFrame(frame: unknown): frame is GameWorldFrame;
  protected abstract acceptFullState(envelope: InitialStateEnvelope): void;
  protected abstract acceptDeltaEnvelope(message: PeerDataMessage): void;
  protected abstract acceptHostHeartbeat(message: PeerDataMessage): void;
  protected abstract acceptDefeatNoticeEnvelope(message: PeerDataMessage): void;
  protected abstract flushPendingDefeatNotice(): void;
  protected abstract sendDefeatAcknowledgement(notice: PlayerDefeatNotice): void;
  protected abstract updateConnectionHealth(health: RemoteConnectionHealth, message?: string): void;
  protected abstract resetForRoomSessionChange(nextRoomSessionId: string): void;
  protected abstract endActiveWorld(reason: string): void;
  protected abstract beginAuthorityWorldChange(nextWorldId: string, previousPlayerId: string, nextPlayerId: string): void;
  protected abstract rememberRetiredWorldId(worldId: string): void;
  protected abstract markSessionNotReady(): void;
  protected abstract markSessionReady(): void;
  protected abstract requestFullResync(reason: string, worldId?: string, receivedBaseRevision?: number): void;
  protected abstract sendStateAck(frame: GameWorldFrame): void;
  protected abstract acceptAuthoritativeFrame(frame: GameWorldFrame): void;

  protected currentSession: GameClientSessionInfo | null = null;

  /** Distinguishes a fresh client-port lifecycle on a still-open PeerJS connection. */
  protected readonly clientSessionId = createClientSessionId();

  protected snapshot!: GameSnapshot;

  /** Guest-projected frame exposed to renderers and UI. */
  protected frame!: GameWorldFrame;

  /** Unprojected host snapshot; deltas must be applied to this exact authoritative baseline. */
  protected authoritativeFrame: GameWorldFrame | null = null;

  /** Room-controller identity; changes only when the room authority lifecycle is replaced. */
  protected announcedRoomSessionId: string | null = null;

  /** World identity explicitly announced by the latest participant assignment. */
  protected announcedWorldId: string | null = null;

  /**
   * A full frame from an unannounced world can race ahead of its assignment.
   * Keep one bounded candidate until the host explicitly identifies that world.
   */
  protected pendingInitialStateForUnannouncedWorld: InitialStateEnvelope | null = null;

  /** Recently replaced world identities, used to reject late packets from an old authority. */
  protected readonly retiredWorldIds = new Set<string>();

  /** Disable command delivery while a new authority has been announced but has not supplied its baseline. */
  protected awaitingAuthorityBaseline = false;

  /** A foreign full frame arrived before the new world's assignment. */
  protected awaitingAuthorityAnnouncement = false;

  protected revision = 0;

  protected playerId = 'guest-player';

  protected playerAssigned = false;

  protected receivedAuthoritativeFrame = false;

  protected pendingInitialStateBeforeAssignment: InitialStateEnvelope | null = null;

  protected sequence = 0;

  protected snapshotListeners = new Set<(snapshot: GameSnapshot) => void>();

  protected frameListeners = new Set<(frame: GameWorldFrame) => void>();

  protected active = true;

  protected resyncPending = false;

  protected helloRetry: ReturnType<typeof setInterval> | null = null;

  protected heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  protected heartbeatSequence = 0;

  protected lastHostHeartbeatSequence = 0;

  protected lastHostHeartbeatAtMs = Date.now();

  protected connectionHealth: RemoteConnectionHealth = 'connected';

  protected readonly healthListeners = new Set<(health: RemoteConnectionHealth, message?: string) => void>();

  protected readonly defeatListeners = new Set<(notice: PlayerDefeatNotice) => void>();

  protected readonly roomRemovalListeners = new Set<(notice: RoomRemovalNotice) => void>();

  protected readonly chatListeners = new Set<(message: RoomChatMessage) => void>();

  protected readonly readinessListeners = new Set<(ready: boolean) => void>();

  protected readonly roomStatusListeners = new Set<(status: RoomManagementStatus) => void>();

  protected currentRoomStatus: RoomManagementStatus | null = null;

  /** Room-control ordering survives world changes and resets only on a new room session. */
  protected currentRoomStatusRevision = -1;


  /** Deduplicate expected stale traffic until room/world identity changes. */
  protected lastDiscardedStaleWorldStatusSignature: string | null = null;

  protected lastDiscardedOutOfOrderStatusSignature: string | null = null;

  protected lastDiscardedRoomSessionSignature: string | null = null;

  protected lastDiscardedHeartbeatSignature: string | null = null;

  protected sessionReady = false;

  protected readonly receivedChatMessageIds = new Set<string>();

  protected readonly displayName: string;

  protected readonly receivedDefeatEventIds = new Set<string>();

  protected readonly receivedRoomRemovalIds = new Set<string>();

  protected pendingDefeatNotice: PlayerDefeatNotice | null = null;

  protected unsubscribeData: () => void;

  // At 30 Hz, 18 samples retain about 600 ms of short-term history for jitter recovery.
  protected readonly presentationBuffer = new SnapshotInterpolationBuffer(18);

  protected readonly interpolationDelayMs = MULTIPLAYER_INTERPOLATION_DELAY_MS;

  protected readonly predictionKeys = new Set<string>();

  protected predictedAimPoint: { x: number; y: number } | null = null;

  protected predictedCommander: GameEntity | null = null;

  protected lastRenderTimeMs: number | null = null;

  constructor(protected readonly transport: GameDataTransport, displayName = resolveDisplayName('')) {
    this.displayName = normalizeDisplayName(displayName);
    this.unsubscribeData = transport.subscribeData(message => this.onMessage(message));

    // Retry the identity handshake until the host has acknowledged this connection.
    const sendHello = () => {
      if (!this.active || this.playerAssigned) {
        if (this.helloRetry) clearInterval(this.helloRetry);
        this.helloRetry = null;
        return;
      }
      const sent = transport.sendData({ type: 'game-hello', protocolVersion: COMMAND_PROTOCOL_VERSION, stateSyncProtocolVersion: STATE_SYNC_PROTOCOL_VERSION, clientSessionId: this.clientSessionId, displayName: this.displayName });
      if (!sent) {
        console.error('[multiplayer guest] Unable to queue the multiplayer hello; the transport is not accepting messages.');
      }
    };
    sendHello();
    this.helloRetry = setInterval(sendHello, 500);
    this.heartbeatTimer = setInterval(() => {
      if (!this.active) return;
      if (this.playerAssigned) {
        const sequence = ++this.heartbeatSequence;
        const sent = this.transport.sendData({ type: 'game-client-heartbeat', protocolVersion: COMMAND_PROTOCOL_VERSION, roomSessionId: this.announcedRoomSessionId, clientSessionId: this.clientSessionId, sequence, lastHostSequence: this.lastHostHeartbeatSequence });
        if (!sent) console.error('[multiplayer guest] Client heartbeat could not be queued; the host may expire this connection.', { sequence });
      }
      if (this.receivedAuthoritativeFrame && Date.now() - this.lastHostHeartbeatAtMs >= HOST_LIVENESS_TIMEOUT_MS) {
        this.updateConnectionHealth('degraded', `No response from the room host for ${HOST_LIVENESS_TIMEOUT_MS} ms. The connection may be lost.`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}
