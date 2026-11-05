import type { RemoteConnectionHealth } from './model';
import { notifyListeners } from './model';
import { RemoteGameClientPortNotices } from './RemoteGameClientPortNotices';

export abstract class RemoteGameClientPortSessionLifecycle extends RemoteGameClientPortNotices {

  protected override updateConnectionHealth(health: RemoteConnectionHealth, message?: string): void {
    if (health === this.connectionHealth) return;
    const previous = this.connectionHealth;
    this.connectionHealth = health;
    if (health === 'degraded') {
      const error = new Error(message ?? 'Room host heartbeat timed out.');
      console.error('[multiplayer guest] Host heartbeat timed out; the current replica is stale until the host responds again.', { previous, health, error });
    } else {
      console.info('[multiplayer guest] Host heartbeat resumed.', { previous, health });
    }
    notifyListeners('connection-health', this.healthListeners, health, message);
  }

  /** Reset all room/world cursors when a different host-controller session is explicitly assigned. */
  protected override resetForRoomSessionChange(nextRoomSessionId: string): void {
    const previousRoomSessionId = this.announcedRoomSessionId;
    console.info('[multiplayer guest] Room authority session changed; resetting room and world cursors.', {
      previousRoomSessionId, nextRoomSessionId
    });
    if (this.announcedWorldId) this.rememberRetiredWorldId(this.announcedWorldId);
    this.announcedRoomSessionId = nextRoomSessionId;
    this.announcedWorldId = null;
    this.retiredWorldIds.clear();
    this.pendingInitialStateBeforeAssignment = null;
    this.pendingInitialStateForUnannouncedWorld = null;
    this.endActiveWorld('room-session-changed');
    this.sequence = 0;
    this.heartbeatSequence = 0;
    this.lastHostHeartbeatSequence = 0;
    this.lastHostHeartbeatAtMs = Date.now();
    this.currentRoomStatus = null;
    this.currentRoomStatusRevision = -1;
    this.lastDiscardedStaleWorldStatusSignature = null;
    this.lastDiscardedOutOfOrderStatusSignature = null;
    this.lastDiscardedRoomSessionSignature = null;
    this.lastDiscardedHeartbeatSignature = null;
    this.receivedChatMessageIds.clear();
  }

  /** Clear world-scoped replica state without changing persistent room membership or liveness. */
  protected override endActiveWorld(reason: string): void {
    const previousWorldId = this.authoritativeFrame?.worldId ?? this.announcedWorldId;
    if (previousWorldId) this.rememberRetiredWorldId(previousWorldId);
    this.announcedWorldId = null;
    this.authoritativeFrame = null;
    this.receivedAuthoritativeFrame = false;
    this.revision = 0;
    this.awaitingAuthorityBaseline = false;
    this.awaitingAuthorityAnnouncement = false;
    this.resyncPending = false;
    this.pendingInitialStateBeforeAssignment = null;
    this.pendingInitialStateForUnannouncedWorld = null;
    this.pendingDefeatNotice = null;
    this.currentSession = null;
    this.sequence = 0;
    this.receivedDefeatEventIds.clear();
    this.presentationBuffer.clear();
    this.predictionKeys.clear();
    this.predictedCommander = null;
    this.predictedAimPoint = null;
    this.lastRenderTimeMs = null;
    this.markSessionNotReady();
    console.info('[multiplayer guest] Authoritative world ended; retaining the room connection for the next host action.', {
      previousWorldId, reason
    });
  }

  /**
   * A changed world ID is valid only after a participant assignment explicitly
   * announces it. Preserve the last rendered snapshot while the new baseline is
   * pending, but invalidate input, interpolation and per-world event cursors.
   */
  protected override beginAuthorityWorldChange(nextWorldId: string, previousPlayerId: string, nextPlayerId: string): void {
    this.lastDiscardedStaleWorldStatusSignature = null;
    this.lastDiscardedOutOfOrderStatusSignature = null;
    const previousWorldId = this.authoritativeFrame?.worldId ?? this.announcedWorldId;
    console.info('[multiplayer guest] Host announced a new authoritative world; resetting world-scoped replication state.', {
      previousWorldId,
      nextWorldId,
      previousPlayerId: this.playerAssigned ? previousPlayerId : null,
      nextPlayerId
    });
    if (previousWorldId && previousWorldId !== nextWorldId) this.rememberRetiredWorldId(previousWorldId);
    this.awaitingAuthorityBaseline = true;
    this.resyncPending = false;
    this.sequence = 0;
    this.lastRenderTimeMs = null;
    this.pendingDefeatNotice = null;
    this.receivedDefeatEventIds.clear();
    this.presentationBuffer.clear();
    this.predictionKeys.clear();
    this.predictedCommander = null;
    this.predictedAimPoint = null;
    this.markSessionNotReady();
    // authoritativeFrame/snapshot are intentionally retained as a last-known
    // visual until the newly announced world supplies a valid full baseline.
  }

  protected override rememberRetiredWorldId(worldId: string): void {
    this.retiredWorldIds.add(worldId);
    while (this.retiredWorldIds.size > 8) {
      const oldestWorldId = this.retiredWorldIds.values().next().value as string | undefined;
      if (!oldestWorldId) throw new Error('Retired-world history is non-empty but has no first key.');
      this.retiredWorldIds.delete(oldestWorldId);
    }
  }

  protected override markSessionNotReady(): void {
    if (!this.sessionReady) return;
    this.sessionReady = false;
    notifyListeners('session-readiness', this.readinessListeners, false);
  }

  protected override markSessionReady(): void {
    if (this.sessionReady) return;
    this.sessionReady = true;
    notifyListeners('session-readiness', this.readinessListeners, true);
  }
}
