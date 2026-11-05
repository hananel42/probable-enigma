import type { GameSnapshot, GameWorldFrame } from '../../server/protocol';
import type { PeerDataMessage } from '../transport';
import { applyStateDelta } from '../stateDelta';
import type { TimedGameSnapshot } from '../snapshotInterpolation';
import type { InitialStateEnvelope, StateDeltaEnvelope } from './model';
import { STATE_SYNC_PROTOCOL_VERSION, notifyListeners } from './model';
import { RemoteGameClientPortMessageDispatch } from './RemoteGameClientPortMessageDispatch';

export abstract class RemoteGameClientPortFrameSync extends RemoteGameClientPortMessageDispatch {

  protected override acceptInitialStateEnvelope(message: PeerDataMessage): void {
    const envelope = message as InitialStateEnvelope;
    if (envelope.protocolVersion !== STATE_SYNC_PROTOCOL_VERSION || !this.isValidFrame(envelope.frame)) {
      this.fail('Host sent a malformed initial-state envelope or frame.', message);
    }
    if (!this.playerAssigned) {
      if (!this.pendingInitialStateBeforeAssignment ||
          envelope.frame.worldId !== this.pendingInitialStateBeforeAssignment.frame.worldId ||
          envelope.frame.revision >= this.pendingInitialStateBeforeAssignment.frame.revision) {
        this.pendingInitialStateBeforeAssignment = envelope;
      }
      return;
    }
    if (this.announcedWorldId && envelope.frame.worldId !== this.announcedWorldId) {
      // An RTCDataChannel can still deliver a queued full state while the host
      // room runtime is being replaced. Do not let the frame silently replace
      // the active world, and do not close the transport before the matching
      // assignment arrives. Keep one candidate and require the explicit handoff.
      if (this.authoritativeFrame?.worldId === envelope.frame.worldId) {
        console.debug('[multiplayer guest] Ignored a stale full state for the previous host world.', {
          receivedWorldId: envelope.frame.worldId, announcedWorldId: this.announcedWorldId,
          revision: envelope.frame.revision
        });
        return;
      }
      if (this.retiredWorldIds.has(envelope.frame.worldId)) {
        console.debug('[multiplayer guest] Ignored a late full state from a retired host world.', {
          receivedWorldId: envelope.frame.worldId,
          announcedWorldId: this.announcedWorldId,
          revision: envelope.frame.revision
        });
        return;
      }
      this.pendingInitialStateForUnannouncedWorld = envelope;
      this.awaitingAuthorityAnnouncement = true;
      this.markSessionNotReady();
      console.error('[multiplayer guest] Received a full state for a world that has not been announced by game-player-assigned; waiting for the explicit world handoff.', {
        receivedWorldId: envelope.frame.worldId,
        announcedWorldId: this.announcedWorldId,
        currentWorldId: this.authoritativeFrame?.worldId ?? null
      });
      return;
    }
    this.acceptFullState(envelope);
  }

  protected override isValidFrame(frame: unknown): frame is GameWorldFrame {
    if (!frame || typeof frame !== 'object') return false;
    const candidate = frame as GameWorldFrame;
    return candidate.protocolVersion === 3 && typeof candidate.worldId === 'string' && candidate.worldId.length > 0 &&
      Number.isSafeInteger(candidate.worldSeed) && candidate.worldSeed >= 0 && candidate.worldSeed <= 0xffff_ffff &&
      Number.isSafeInteger(candidate.revision) && candidate.revision >= 0 && Number.isFinite(candidate.serverTimeMs) &&
      !!candidate.snapshot && typeof candidate.snapshot === 'object' &&
      Array.isArray(candidate.snapshot.humanPlayers) && Array.isArray(candidate.snapshot.entities) &&
      Array.isArray(candidate.snapshot.buildings) && Array.isArray(candidate.snapshot.resourceNodes) &&
      Array.isArray(candidate.snapshot.projectiles) && Array.isArray(candidate.snapshot.particles);
  }

  /**
   * Validate and apply a full authoritative baseline. A changed world is only
   * legal after `game-player-assigned` has explicitly announced its identity.
   */
  protected override acceptFullState(envelope: InitialStateEnvelope): void {
    const fullFrame = envelope.frame;
    if (!this.playerAssigned) throw new Error('Internal protocol invariant failed: full state cannot be projected before identity assignment.');
    if (this.authoritativeFrame && fullFrame.worldId !== this.authoritativeFrame.worldId &&
        this.announcedWorldId !== fullFrame.worldId) {
      this.fail(`Full state for world '${fullFrame.worldId}' cannot be applied before the host announces that world; current assignment is '${this.announcedWorldId}'.`, envelope);
    }
    const sameWorld = this.authoritativeFrame?.worldId === fullFrame.worldId;
    if (sameWorld && this.authoritativeFrame && fullFrame.revision < this.revision) {
      console.debug('[multiplayer guest] Ignored an older full-state retransmission; the replica already has a newer revision.', {
        receivedRevision: fullFrame.revision, currentRevision: this.revision
      });
      this.sendStateAck(this.authoritativeFrame);
      return;
    }
    if (sameWorld && this.authoritativeFrame && fullFrame.worldSeed !== this.authoritativeFrame.worldSeed) {
      this.fail('Host attempted to change the world seed within one world.', { previousSeed: this.authoritativeFrame.worldSeed, receivedSeed: fullFrame.worldSeed });
    }
    this.resyncPending = false;
    this.acceptAuthoritativeFrame(fullFrame);
    this.awaitingAuthorityBaseline = false;
    this.sendStateAck(fullFrame);
    this.flushPendingDefeatNotice();
  }

  /**
   * Apply one exact-base patch for the announced world, or request an explicit
   * full resync when the revision chain cannot safely continue.
   */
  protected override acceptDeltaEnvelope(message: PeerDataMessage): void {
    const delta = message as StateDeltaEnvelope;
    if (delta.protocolVersion !== STATE_SYNC_PROTOCOL_VERSION || typeof delta.worldId !== 'string' || !delta.worldId ||
        !Number.isSafeInteger(delta.baseRevision) || delta.baseRevision < 0 ||
        !Number.isSafeInteger(delta.revision) || delta.revision <= delta.baseRevision ||
        !Number.isFinite(delta.serverTimeMs) || !Array.isArray(delta.operations) || delta.operations.length === 0) {
      this.fail('Host sent a malformed state-delta envelope.', message);
    }

    if (this.awaitingAuthorityAnnouncement) {
      console.debug('[multiplayer guest] Ignored a state delta while waiting for the matching world announcement.', {
        receivedWorldId: delta.worldId,
        announcedWorldId: this.announcedWorldId
      });
      return;
    }
    if (this.announcedWorldId && delta.worldId !== this.announcedWorldId) {
      console.debug('[multiplayer guest] Ignored a stale or unannounced state delta.', {
        receivedWorldId: delta.worldId,
        announcedWorldId: this.announcedWorldId,
        currentWorldId: this.authoritativeFrame?.worldId ?? null,
        revision: delta.revision
      });
      return;
    }
    if (this.awaitingAuthorityBaseline) {
      if (this.announcedWorldId && delta.worldId === this.announcedWorldId) {
        this.requestFullResync('delta-arrived-before-new-world-baseline', delta.worldId, delta.baseRevision);
      }
      return;
    }

    if (!this.authoritativeFrame || !this.receivedAuthoritativeFrame) {
      this.requestFullResync('received-delta-before-initial-state', delta.worldId, delta.baseRevision);
      return;
    }
    if (delta.worldId !== this.authoritativeFrame.worldId) {
      this.fail('Host state delta belongs to a different world.', {
        expectedWorldId: this.authoritativeFrame.worldId, receivedWorldId: delta.worldId
      });
    }
    if (delta.revision <= this.revision) {
      console.debug('[multiplayer guest] Ignored a duplicate or stale state delta.', { currentRevision: this.revision, baseRevision: delta.baseRevision, receivedRevision: delta.revision });
      this.sendStateAck(this.authoritativeFrame);
      return;
    }
    if (this.resyncPending) return;
    if (delta.baseRevision !== this.revision) {
      this.requestFullResync('delta-base-revision-mismatch', delta.worldId, delta.baseRevision);
      return;
    }

    let nextSnapshot: GameSnapshot;
    try {
      nextSnapshot = applyStateDelta(this.authoritativeFrame.snapshot, delta.operations) as GameSnapshot;
    } catch (error) {
      // This is an explicit protocol recovery path, not a silent fallback: record
      // the original error and request a full authoritative baseline.
      console.error('[multiplayer guest] Could not apply state delta; requesting an authoritative resync.', {
        worldId: delta.worldId, baseRevision: delta.baseRevision, revision: delta.revision, error
      });
      this.requestFullResync('delta-application-failed', delta.worldId, delta.baseRevision);
      return;
    }

    const nextFrame: GameWorldFrame = {
      protocolVersion: 3,
      worldId: delta.worldId,
      // The seed is immutable world metadata sent with the initial/full state;
      // repeating it in every delta would be redundant network traffic.
      worldSeed: this.authoritativeFrame.worldSeed,
      revision: delta.revision,
      serverTimeMs: delta.serverTimeMs,
      snapshot: nextSnapshot
    };
    this.acceptAuthoritativeFrame(nextFrame);
    this.sendStateAck(nextFrame);
    if (!this.sessionReady) this.markSessionReady();
    this.flushPendingDefeatNotice();
  }

  protected override requestFullResync(reason: string, worldId?: string, receivedBaseRevision?: number): void {
    if (this.resyncPending) return;
    console.error('[multiplayer guest] State synchronization mismatch; requesting full authoritative state.', {
      reason, expectedRevision: this.receivedAuthoritativeFrame ? this.revision : null, receivedBaseRevision
    });
    const sent = this.transport.sendData({
      type: 'game-resync-request',
      roomSessionId: this.announcedRoomSessionId,
      protocolVersion: STATE_SYNC_PROTOCOL_VERSION,
      ...(worldId ? { worldId } : {}),
      expectedRevision: this.receivedAuthoritativeFrame ? this.revision : null,
      ...(receivedBaseRevision !== undefined ? { receivedBaseRevision } : {}),
      reason
    });
    if (sent) this.resyncPending = true;
    else console.error('[multiplayer guest] Resync request could not be queued; future state traffic will retry the explicit request.', { reason });
  }

  protected override sendStateAck(frame: GameWorldFrame): void {
    const sent = this.transport.sendData({
      type: 'game-state-ack',
      roomSessionId: this.announcedRoomSessionId,
      protocolVersion: STATE_SYNC_PROTOCOL_VERSION,
      worldId: frame.worldId,
      revision: frame.revision
    });
    if (!sent) console.error('[multiplayer guest] State ACK was not queued; the host will retry the full state or detect the missing acknowledgement.', {
      worldId: frame.worldId, revision: frame.revision
    });
  }

  /**
   * Store a validated host frame and derive the participant-specific guest
   * projection. World boundaries clear interpolation/prediction history.
   */
  protected override acceptAuthoritativeFrame(frame: GameWorldFrame): void {
    const previousFrame = this.authoritativeFrame;
    const sameWorld = previousFrame?.worldId === frame.worldId;
    if (sameWorld && frame.revision < this.revision) return;
    if (previousFrame && !sameWorld) {
      this.rememberRetiredWorldId(previousFrame.worldId);
      // Never interpolate positions or reuse predictions between unrelated worlds.
      this.presentationBuffer.clear();
      this.predictedCommander = null;
      this.predictedAimPoint = null;
      this.predictionKeys.clear();
      this.lastRenderTimeMs = null;
    }
    const projectedFrame = this.projectFrame(frame);
    this.authoritativeFrame = frame;
    this.revision = frame.revision;
    this.frame = projectedFrame;
    this.snapshot = projectedFrame.snapshot;
    if (this.snapshot.isGameOver) {
      this.predictionKeys.clear();
      this.predictedAimPoint = null;
    }
    this.presentationBuffer.push({ receivedAtMs: performance.now(), snapshot: this.snapshot } satisfies TimedGameSnapshot);
    this.receivedAuthoritativeFrame = true;
    this.currentSession = !sameWorld || !this.currentSession
      ? Object.freeze({
          worldId: projectedFrame.worldId,
          clientId: this.playerId,
          role: 'controller',
          controlledEntityId: projectedFrame.snapshot.player.id,
          joinedAtRevision: projectedFrame.revision
        })
      : Object.freeze({
          ...this.currentSession,
          controlledEntityId: projectedFrame.snapshot.player.id
        });

    notifyListeners('world-frame', this.frameListeners, this.frame);
    notifyListeners('snapshot', this.snapshotListeners, this.snapshot);
  }
}
