import type { GameWorldFrame } from '../../server/protocol';
import type { PeerDataMessage } from '../transport';
import { diffState } from '../stateDelta';
import type { PeerReplicationState } from './model';
import { ACK_STALE_RESYNC_MS, COMMAND_PROTOCOL_VERSION, FULL_STATE_RETRY_MS, MAX_FULL_STATE_ATTEMPTS, PEER_LIVENESS_TIMEOUT_MS, STATE_SYNC_PROTOCOL_VERSION } from './model';
import { HostRoomLifecycle } from './HostRoomLifecycle';

export abstract class HostRoomReplication extends HostRoomLifecycle {

  /** Called by the host publication clock (30 Hz), not by rendering callbacks. */
  public override flushStateUpdates(nowMs = Date.now()): void {
    this.pruneMissingTransportPeers(nowMs);
    this.updateMatchPhaseFromWorld();
    this.broadcastRoomStatus(false, nowMs);
    if (!this.hasWorld || this.replicationByPeer.size === 0) return;
    const currentFrame = this.server.captureWorldFrame();

    for (const [peerId, peer] of [...this.replicationByPeer.entries()]) {
      if (this.transport.hasPeerConnection && !this.transport.hasPeerConnection(peerId)) {
        // The transport may have already removed the DataConnection before its
        // close notification reached this controller. Reconcile membership now
        // instead of repeatedly trying to send to a ghost peer for 60 seconds.
        this.removePeerDuringPublication(peerId, 'transport-connection-missing', true);
        continue;
      }

      if (nowMs - peer.lastRoundTripAtMs >= PEER_LIVENESS_TIMEOUT_MS) {
        console.warn('[multiplayer host] Guest missed the bidirectional liveness deadline; removing its participant and active assets.', {
          peerId, playerId: peer.playerId, idleForMs: nowMs - peer.lastRoundTripAtMs, timeoutMs: PEER_LIVENESS_TIMEOUT_MS
        });
        this.removePeerDuringPublication(peerId, 'heartbeat-timeout', true);
        continue;
      }

      const participant = currentFrame.snapshot.humanPlayers.find(candidate => candidate.playerId === peer.playerId);
      if (!participant) {
        const error = new Error(`Registered peer '${peerId}' references missing participant '${peer.playerId}'.`);
        console.error('[multiplayer host] Repairing an orphaned peer registration.', { peerId, playerId: peer.playerId, error });
        this.removePeerDuringPublication(peerId, 'missing-participant', true);
        continue;
      }

      this.updateDefeatNotification(peerId, peer, currentFrame, participant.coreId, nowMs);

      if (!peer.assignmentQueued) {
        this.sendParticipantAssignment(peerId, peer);
        if (!peer.assignmentQueued) continue;
      }

      if (peer.needsFullState || peer.waitingFullStateAckRevision !== null) {
        if (nowMs < peer.lastFullStateSentAtMs + FULL_STATE_RETRY_MS) continue;
        if (peer.fullStateAttempts >= MAX_FULL_STATE_ATTEMPTS) {
          const error = new Error(`Guest '${peerId}' did not acknowledge a valid full state after ${peer.fullStateAttempts} attempts.`);
          console.error('[multiplayer host] Removing guest whose state replica could not be synchronized.', {
            peerId, playerId: peer.playerId, fullStateAttempts: peer.fullStateAttempts,
            waitingRevision: peer.waitingFullStateAckRevision, error
          });
          this.removePeerDuringPublication(peerId, 'state-sync-timeout', true);
          continue;
        }
        this.sendFullState(peerId, peer, currentFrame, nowMs);
        continue;
      }

      if (peer.baseline && peer.baseline.worldId !== currentFrame.worldId) {
        throw new Error(`Multiplayer world changed under peer '${peerId}' without a new room handshake.`);
      }

      if (peer.baseline && peer.baseline.revision < currentFrame.revision) {
        const base = peer.baseline;
        const operations = diffState(base.snapshot, currentFrame.snapshot);
        if (operations.length > 0) {
          const delta: PeerDataMessage = {
            type: 'game-state-delta',
            roomSessionId: this.roomSessionId,
            protocolVersion: STATE_SYNC_PROTOCOL_VERSION,
            worldId: currentFrame.worldId,
            baseRevision: base.revision,
            revision: currentFrame.revision,
            serverTimeMs: currentFrame.serverTimeMs,
            operations
          };
          // Baseline is set before send because in-memory transports can deliver synchronously.
          peer.baseline = currentFrame;
          const sent = this.tryQueueTransportMessage(delta, peerId, 'state-delta');
          if (!sent) {
            peer.baseline = base;
          }
        }
      }

      if (peer.baseline && peer.baseline.revision > peer.lastAcknowledgedRevision &&
          nowMs - peer.lastAcknowledgedAtMs >= ACK_STALE_RESYNC_MS) {
        console.warn('[multiplayer host] No recent state ACK; requesting a full synchronization to verify replica health.', {
          peerId, lastAcknowledgedRevision: peer.lastAcknowledgedRevision,
          lastSentRevision: peer.baseline.revision
        });
        this.sendFullState(peerId, peer, currentFrame, nowMs);
      }
    }
  }

  protected override resetPeerReplication(peer: PeerReplicationState, nowMs: number, needsFullState = true): void {
    peer.baseline = null;
    peer.pendingFullStateFrame = null;
    peer.waitingFullStateAckRevision = null;
    peer.lastFullStateSentAtMs = 0;
    peer.fullStateAttempts = 0;
    peer.needsFullState = needsFullState;
    peer.lastAcknowledgedRevision = -1;
    peer.lastAcknowledgedAtMs = nowMs;
    peer.defeatNotification = null;
    peer.defeatAcknowledged = false;
    peer.lastDefeatNoticeSentAtMs = 0;
    peer.assignmentQueued = false;
  }

  protected override resetAllPeerReplicasForFullState(): void {
    const nowMs = Date.now();
    if (!this.hasWorld) {
      for (const peer of this.replicationByPeer.values()) this.resetPeerReplication(peer, nowMs, false);
      return;
    }
    const frame = this.server.captureWorldFrame();
    for (const [peerId, peer] of this.replicationByPeer) {
      this.resetPeerReplication(peer, nowMs, true);
      this.sendParticipantAssignment(peerId, peer);
      if (peer.assignmentQueued) this.sendFullState(peerId, peer, frame, nowMs);
    }
  }

  protected override sendParticipantAssignment(peerId: string, peer: PeerReplicationState): void {
    // The guest repeats game-hello until it observes this assignment. A room
    // listener can be replaced during React development remounts, so a prior
    // DataConnection.send() is not proof that the current client instance saw
    // the assignment. Replay the idempotent assignment for every valid hello.
    const wasPreviouslyQueued = peer.assignmentQueued;
    const sent = this.tryQueueTransportMessage({
      type: 'game-player-assigned', protocolVersion: COMMAND_PROTOCOL_VERSION,
      stateSyncProtocolVersion: STATE_SYNC_PROTOCOL_VERSION,
      roomSessionId: this.roomSessionId,
      playerId: peer.playerId,
      // A direct transport may survive replacement of the host runtime. Include
      // the authoritative world in the assignment so a new baseline is an
      // explicit handoff rather than an unexplained world-ID mutation.
      worldId: this.hasWorld ? this.server.worldId : null
    }, peerId, 'participant-assignment');
    peer.assignmentQueued = sent;
    if (!sent) {
      console.error('[multiplayer host] Could not queue participant assignment; the guest handshake will retry.', {
        peerId, playerId: peer.playerId, wasPreviouslyQueued
      });
    } else if (wasPreviouslyQueued) {
      console.info('[multiplayer host] Replayed participant assignment for a repeated guest hello.', {
        peerId, playerId: peer.playerId
      });
    }
  }

  protected override sendFullState(peerId: string, peer: PeerReplicationState, frame: GameWorldFrame, nowMs: number): void {
    if (!this.hasWorld) throw new Error('Cannot publish a game-state baseline while the room has no active world.');
    // Keep the same recovery baseline until it is ACKed. Replacing it every
    // retry makes a slow guest perpetually acknowledge an older revision and
    // can evict healthy peers on higher-latency or throttled connections.
    const frameToSend = peer.pendingFullStateFrame ?? frame;
    const previous = {
      baseline: peer.baseline,
      pendingFrame: peer.pendingFullStateFrame,
      waitingRevision: peer.waitingFullStateAckRevision,
      lastSentAt: peer.lastFullStateSentAtMs,
      needsFullState: peer.needsFullState,
      fullStateAttempts: peer.fullStateAttempts
    };
    peer.baseline = frameToSend;
    peer.pendingFullStateFrame = frameToSend;
    peer.waitingFullStateAckRevision = frameToSend.revision;
    peer.lastFullStateSentAtMs = nowMs;
    peer.needsFullState = false;
    const sent = this.tryQueueTransportMessage({ type: 'game-initial-state', roomSessionId: this.roomSessionId, protocolVersion: STATE_SYNC_PROTOCOL_VERSION, frame: frameToSend }, peerId, 'full-state');
    if (sent) {
      peer.fullStateAttempts += 1;
      console.info('[multiplayer host] Queued authoritative full-state synchronization.', {
        peerId, worldId: frameToSend.worldId, revision: frameToSend.revision, attempt: peer.fullStateAttempts,
        retryingSameBaseline: previous.pendingFrame !== null
      });
    } else {
      peer.baseline = previous.baseline;
      peer.pendingFullStateFrame = previous.pendingFrame;
      peer.waitingFullStateAckRevision = previous.waitingRevision;
      peer.lastFullStateSentAtMs = previous.lastSentAt;
      peer.fullStateAttempts = previous.fullStateAttempts;
      peer.needsFullState = true;
      console.error('[multiplayer host] Could not queue authoritative full state; it will be retried.', {
        peerId, worldId: frameToSend.worldId, revision: frameToSend.revision
      });
    }
  }

  protected override acceptStateAcknowledgement(peerId: string, message: PeerDataMessage): void {
    if (!this.hasWorld) return;
    const peer = this.replicationByPeer.get(peerId);
    if (!peer) {
      console.error('[multiplayer host] Rejected state ACK from an unregistered peer.', { peerId, message });
      return;
    }
    const revision = message.revision;
    if (message.protocolVersion !== STATE_SYNC_PROTOCOL_VERSION || message.worldId !== this.server.worldId ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      console.error('[multiplayer host] Rejected malformed or cross-world state ACK.', { peerId, message });
      return;
    }
    const maxSentRevision = peer.baseline?.revision ?? -1;
    if (revision > maxSentRevision) {
      console.error('[multiplayer host] Rejected ACK for a revision that was never sent to this peer.', {
        peerId, revision, maxSentRevision
      });
      return;
    }
    if (revision < peer.lastAcknowledgedRevision) {
      console.warn('[multiplayer host] Ignored a stale state ACK.', { peerId, revision, lastAcknowledgedRevision: peer.lastAcknowledgedRevision });
      return;
    }
    const nowMs = Date.now();
    peer.lastAcknowledgedRevision = revision;
    peer.lastAcknowledgedAtMs = nowMs;
    peer.lastHeardAtMs = nowMs;
    if (peer.waitingFullStateAckRevision !== null && revision >= peer.waitingFullStateAckRevision) {
      peer.waitingFullStateAckRevision = null;
      peer.pendingFullStateFrame = null;
      peer.needsFullState = false;
      peer.fullStateAttempts = 0;
    }
  }
}
