import type { PeerDataMessage } from '../transport';
import type { PlayerDefeatNotice } from './model';
import { COMMAND_PROTOCOL_VERSION, STATE_SYNC_PROTOCOL_VERSION, notifyListeners } from './model';
import { RemoteGameClientPortFrameSync } from './RemoteGameClientPortFrameSync';

export abstract class RemoteGameClientPortNotices extends RemoteGameClientPortFrameSync {

  protected override acceptHostHeartbeat(message: PeerDataMessage): void {
    const sequence = message.sequence;
    const serverTimeMs = message.serverTimeMs;
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION ||
        typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1 ||
        typeof serverTimeMs !== 'number' || !Number.isFinite(serverTimeMs) ||
        typeof message.clientSessionId !== 'string' || message.clientSessionId.length < 1 || message.clientSessionId.length > 128) {
      this.fail('Host sent a malformed heartbeat response.', message);
    }
    if (message.clientSessionId !== this.clientSessionId) {
      const signature = `heartbeat-session:${message.clientSessionId}->${this.clientSessionId}`;
      if (signature !== this.lastDiscardedHeartbeatSignature) {
        console.debug('[multiplayer guest] Ignored host heartbeat responses from an earlier client session.', {
          receivedSessionId: message.clientSessionId,
          currentSessionId: this.clientSessionId,
          sequence: message.sequence
        });
        this.lastDiscardedHeartbeatSignature = signature;
      }
      return;
    }
    if (sequence <= this.lastHostHeartbeatSequence) {
      console.debug('[multiplayer guest] Ignored a duplicate or stale host heartbeat.', { sequence, lastHostHeartbeatSequence: this.lastHostHeartbeatSequence });
      return;
    }
    this.lastHostHeartbeatSequence = sequence;
    this.lastHostHeartbeatAtMs = Date.now();
    this.updateConnectionHealth('connected');
  }

  protected override acceptDefeatNoticeEnvelope(message: PeerDataMessage): void {
    const revision = message.revision;
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || message.stateSyncProtocolVersion !== STATE_SYNC_PROTOCOL_VERSION ||
        typeof message.eventId !== 'string' || !message.eventId || typeof message.playerId !== 'string' ||
        typeof message.coreId !== 'string' || typeof message.worldId !== 'string' || !message.worldId ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || message.reason !== 'core-destroyed') {
      this.fail('Host sent a malformed player-defeat notification.', message);
    }
    const notice = message as unknown as PlayerDefeatNotice;
    if (this.announcedWorldId && notice.worldId !== this.announcedWorldId) {
      console.debug('[multiplayer guest] Ignored a defeat notice from a previous or unannounced host world.', {
        noticeWorldId: notice.worldId, announcedWorldId: this.announcedWorldId,
        eventId: notice.eventId
      });
      return;
    }
    if (this.playerAssigned && notice.playerId !== this.playerId) {
      this.fail(`Host sent defeat notification for '${notice.playerId}' to guest '${this.playerId}'.`, notice);
    }
    if (this.pendingDefeatNotice && this.pendingDefeatNotice.eventId !== notice.eventId &&
        this.pendingDefeatNotice.worldId === notice.worldId && this.pendingDefeatNotice.revision > notice.revision) {
      // Keep the newest event when a delayed retransmission races with a later room lifecycle.
      this.sendDefeatAcknowledgement(notice);
      return;
    }
    this.pendingDefeatNotice = notice;
    this.flushPendingDefeatNotice();
  }

  protected override flushPendingDefeatNotice(): void {
    const notice = this.pendingDefeatNotice;
    if (!notice || !this.playerAssigned || !this.receivedAuthoritativeFrame || !this.authoritativeFrame) return;
    if (notice.playerId !== this.playerId) this.fail('Pending defeat notice does not match the assigned participant.', notice);
    if (notice.worldId !== this.authoritativeFrame.worldId) this.fail('Defeat notice belongs to a different authoritative world.', {
      noticeWorldId: notice.worldId, currentWorldId: this.authoritativeFrame.worldId, notice
    });
    if (this.revision < notice.revision) return;

    const participant = this.authoritativeFrame.snapshot.humanPlayers.find(candidate => candidate.playerId === this.playerId);
    if (!participant || participant.coreId !== notice.coreId) {
      this.fail('Defeat notice references a missing participant or a Core not owned by the assigned participant.', { participant, notice });
    }

    const matchingCore = this.authoritativeFrame.snapshot.buildings.find(building => building.type === 'CORE' && building.id === notice.coreId);
    const coreIsOperational = Boolean(matchingCore && matchingCore.hp > 0);
    // If a restart already rebuilt the Core at a revision newer than the event,
    // acknowledge the old event without showing an obsolete defeat banner.
    const eventIsStaleAfterRestart = coreIsOperational && this.revision > notice.revision;
    if (!coreIsOperational && !eventIsStaleAfterRestart && !this.receivedDefeatEventIds.has(notice.eventId)) {
      this.receivedDefeatEventIds.add(notice.eventId);
      if (this.receivedDefeatEventIds.size > 32) {
        const oldestEventId = this.receivedDefeatEventIds.values().next().value as string | undefined;
        if (!oldestEventId) throw new Error('Defeat-notification deduplication set is non-empty but has no first key.');
        this.receivedDefeatEventIds.delete(oldestEventId);
      }
      notifyListeners('defeat-notice', this.defeatListeners, notice);
    }
    this.sendDefeatAcknowledgement(notice);
    this.pendingDefeatNotice = null;
  }

  protected override sendDefeatAcknowledgement(notice: PlayerDefeatNotice): void {
    const sent = this.transport.sendData({
      type: 'game-player-defeated-ack', protocolVersion: COMMAND_PROTOCOL_VERSION,
      stateSyncProtocolVersion: STATE_SYNC_PROTOCOL_VERSION,
      eventId: notice.eventId, playerId: notice.playerId, coreId: notice.coreId, worldId: notice.worldId
    });
    if (!sent) console.error('[multiplayer guest] Defeat notification acknowledgement could not be queued; the host will retransmit the event.', { eventId: notice.eventId, playerId: notice.playerId });
  }
}
