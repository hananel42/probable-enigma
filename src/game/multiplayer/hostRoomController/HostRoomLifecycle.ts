import { MULTIPLAYER_SNAPSHOT_INTERVAL_MS } from '../transport';
import { normalizeDisplayName } from '../displayName';
import type { RoomPhase } from '../roomManagement';
import type { PendingRoomRemoval } from './model';
import { COMMAND_PROTOCOL_VERSION, ROOM_REMOVAL_ACK_TIMEOUT_MS } from './model';
import { HostRoomStatus } from './HostRoomStatus';

export abstract class HostRoomLifecycle extends HostRoomStatus {

  /** Create and start a fresh world only when the room owner explicitly starts it. */
  public override startMatch(): void {
    if (this.roomPhase !== 'lobby' || this.hasWorld) throw new Error(`Cannot start a world while room phase is '${this.roomPhase}'.`);
    const participants = [
      { playerId: 'player-host', displayName: normalizeDisplayName(this.hostDisplayName || 'Host') },
      ...[...this.playerByPeer.entries()].map(([peerId, playerId]) => ({
        playerId,
        displayName: this.displayNameByPeer.get(peerId) ?? 'Guest'
      }))
    ];
    this.server.createWorld(this.mode, participants);
    this.transitionRoomLifecycle('playing', true, 'host-started-world');

    // A room-level participant assignment is replayed before each world's full
    // baseline. This is an explicit world handoff, not a transport reconnect.
    const frame = this.server.captureWorldFrame();
    const nowMs = Date.now();
    for (const [peerId, peer] of this.replicationByPeer) {
      // Command sequences are scoped to a world and the guest resets its cursor
      // after the assignment below. Heartbeat sequences remain room-scoped.
      this.lastSequenceByPeer.set(peerId, 0);
      this.resetPeerReplication(peer, nowMs);
      this.sendParticipantAssignment(peerId, peer);
      if (peer.assignmentQueued) this.sendFullState(peerId, peer, frame, nowMs);
    }
    this.server.start();
    this.broadcastRoomStatus(true);
    console.info('[multiplayer host] A new authoritative world was created and started.', {
      worldId: this.server.worldId, mode: this.mode, participants: participants.length
    });
  }

  /** Pause the simulation clock without ending the room or discarding the world. */
  public override pauseMatch(): void {
    if (this.roomPhase !== 'playing' || !this.hasWorld) throw new Error(`Cannot pause a world while room phase is '${this.roomPhase}'.`);
    this.server.stop();
    this.transitionRoomLifecycle('paused', true, 'host-paused-world');
    this.broadcastRoomStatus(true);
  }

  /** Resume the same world; participant identities and replication baselines stay intact. */
  public override resumeMatch(): void {
    if (this.roomPhase !== 'paused' || !this.hasWorld) throw new Error(`Cannot resume a world while room phase is '${this.roomPhase}'.`);
    this.server.start();
    this.transitionRoomLifecycle('playing', true, 'host-resumed-world');
    this.broadcastRoomStatus(true);
  }

  /** Revive a defeated participant with a fresh Core in the current world. */
  public override reviveParticipant(playerId: string): void {
    if (!this.hasWorld || this.roomPhase === 'lobby') throw new Error('Participants can only be revived while a world exists.');
    const peerEntry = [...this.playerByPeer.entries()].find(([, mappedPlayerId]) => mappedPlayerId === playerId);
    if (!peerEntry && playerId !== 'player-host') throw new Error(`Cannot revive '${playerId}': no connected room participant exists.`);
    const revived = this.server.reviveHumanParticipant(playerId);
    if (!revived) throw new Error(`Participant '${playerId}' is not defeated or cannot be revived in the current world.`);
    for (const peer of this.replicationByPeer.values()) {
      if (peer.playerId === playerId) {
        peer.defeatNotification = null;
        peer.defeatAcknowledged = false;
        peer.lastDefeatNoticeSentAtMs = 0;
      }
    }
    if (this.roomPhase === 'results') {
      this.server.start();
      this.transitionRoomLifecycle('playing', true, 'host-revived-participant-after-results');
    }
    this.resetAllPeerReplicasForFullState();
    this.broadcastRoomStatus(true);
  }

  /**
   * Remove a guest with an explicit user-facing notice. The direct channel stays
   * open until the guest acknowledges the notice or the bounded grace period
   * expires, so the user is not left seeing only a generic connection error.
   */
  public override kickParticipant(playerId: string): void {
    if (!playerId || playerId === 'player-host') throw new Error('The host cannot be removed from its own room.');
    const peerEntry = [...this.playerByPeer.entries()].find(([, mappedPlayerId]) => mappedPlayerId === playerId);
    if (!peerEntry) throw new Error('That player is no longer in the room. The participant list will refresh.');
    const [peerId] = peerEntry;
    if (this.pendingRoomRemovalsByPeer.has(peerId)) throw new Error('That player is already being removed from the room.');

    const pending: PendingRoomRemoval = {
      removalId: `${this.roomSessionId}:remove-${this.nextRoomRemovalSerial++}`,
      playerId,
      timer: null
    };
    this.pendingRoomRemovalsByPeer.set(peerId, pending);
    pending.timer = setTimeout(() => {
      const stillConnected = this.transport.hasPeerConnection?.(peerId) ?? true;
      if (stillConnected) {
        console.warn('[multiplayer host] The connected guest did not acknowledge the removal notice; completing the room removal.', {
          peerId, playerId, removalId: pending.removalId, timeoutMs: ROOM_REMOVAL_ACK_TIMEOUT_MS
        });
      }
      const cleanupError = this.finishPendingRoomRemoval(peerId, pending, 'host-kicked', stillConnected);
      // A vanished peer cannot acknowledge anything. That is ordinary disconnect
      // cleanup, not a room error and must not surface a modal or lobby warning.
      if (!cleanupError && stillConnected) {
        this.onRuntimeError?.('room-removal-ack-timeout', new Error('The room did not confirm that the removal notice was received.'));
      }
    }, ROOM_REMOVAL_ACK_TIMEOUT_MS);

    const queued = this.tryQueueTransportMessage({
      type: 'game-room-removed',
      protocolVersion: COMMAND_PROTOCOL_VERSION,
      roomSessionId: this.roomSessionId,
      removalId: pending.removalId,
      code: 'HOST_REMOVED'
    }, peerId, 'room-removal-notice');
    if (!queued) {
      const stillConnected = this.transport.hasPeerConnection?.(peerId) === true;
      const cleanupError = this.finishPendingRoomRemoval(peerId, pending, 'host-kicked', stillConnected);
      if (cleanupError && stillConnected) throw cleanupError;
      // A stale/disconnected peer cannot receive an application-level notice.
      // Finish cleanup without turning that expected race into an action error.
      if (stillConnected) {
        this.onRuntimeError?.('room-removal-notice-unavailable', new Error('The participant connection was already unavailable.'));
      }
    }
  }

  /** End the current world and return every participant to the persistent room. */
  public override returnToLobby(): void {
    if (!this.hasWorld || this.roomPhase === 'lobby') throw new Error('There is no active world to leave.');
    const endedWorldId = this.server.worldId;
    this.server.stop();
    this.transitionRoomLifecycle('lobby', false, 'host-returned-to-room');
    this.roomStatusByPeer.clear();
    const nowMs = Date.now();
    for (const [peerId, peer] of this.replicationByPeer) {
      this.tryQueueTransportMessage({
        type: 'game-world-ended', protocolVersion: COMMAND_PROTOCOL_VERSION,
        roomSessionId: this.roomSessionId, worldId: endedWorldId, reason: 'host-returned-to-room'
      }, peerId, 'world-ended');
      this.resetPeerReplication(peer, nowMs, false);
      this.sendParticipantAssignment(peerId, peer);
    }
    this.broadcastRoomStatus(true);
    console.info('[multiplayer host] World ended; room membership remains active.', { endedWorldId });
  }

  public override start(): void {
    if (this.unsubscribe) return;
    this.server.setMultiplayerMode(this.mode);
    this.unsubscribe = this.transport.subscribeData(message => this.handleMessage(message));
    // The host owns both room state and replication scheduling. This clock runs
    // while the room is in the lobby, playing, or showing results.
    this.publicationTimer = setInterval(() => {
      try {
        this.flushStateUpdates();
      } catch (error) {
        // A room/network publication failure is not permission to kill the local
        // authoritative simulation or rendering loop. Report it loudly and let
        // the next tick retry after per-peer reconciliation.
        console.error('[multiplayer host] Room publication tick failed; the next tick will retry after connection reconciliation.', { error });
        this.onRuntimeError?.('room-publication-tick', error);
      }
    }, MULTIPLAYER_SNAPSHOT_INTERVAL_MS);
    this.broadcastRoomStatus(true);
  }

  public override stop(): void {
    if (this.publicationTimer !== null) clearInterval(this.publicationTimer);
    this.publicationTimer = null;
    // Stop receiving transport events before disposing peers so the transport's
    // close callbacks cannot race this explicit room shutdown.
    this.unsubscribe?.();
    this.unsubscribe = null;
    const cleanupErrors: unknown[] = [];
    const peersToClean = new Set([
      ...this.playerByPeer.keys(),
      ...this.displayNameByPeer.keys(),
      ...this.lastSequenceByPeer.keys(),
      ...this.replicationByPeer.keys(),
      ...this.roomStatusByPeer.keys()
    ]);
    for (const peerId of peersToClean) {
      try {
        this.removePeer(peerId, 'host-room-stopped', true);
      } catch (error) {
        cleanupErrors.push(error);
        console.error('[multiplayer host] A guest cleanup failed during room shutdown; continuing cleanup for remaining peers.', {
          peerId,
          playerId: this.playerByPeer.get(peerId) ?? this.replicationByPeer.get(peerId)?.playerId,
          reason: 'host-room-stopped', stage: 'remove-peer', error
        });
      }
    }
    for (const pending of this.pendingRoomRemovalsByPeer.values()) {
      if (pending.timer !== null) clearTimeout(pending.timer);
      pending.timer = null;
    }
    this.pendingRoomRemovalsByPeer.clear();
    if (this.playerByPeer.size !== 0 || this.displayNameByPeer.size !== 0 || this.replicationByPeer.size !== 0 || this.lastSequenceByPeer.size !== 0 || this.roomStatusByPeer.size !== 0) {
      cleanupErrors.push(new Error('Host room shutdown left participant/replication/room-status state registered after peer cleanup.'));
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Host room shutdown encountered one or more cleanup failures.');
  }

  /**
   * Apply the room's single authoritative lifecycle transition.
   * A room may be in the lobby without a world; every other phase must own one.
   * Keeping both fields in this method prevents impossible phase/world pairs.
   */
  protected override transitionRoomLifecycle(nextPhase: RoomPhase, nextHasWorld: boolean, reason: string): void {
    const allowedTransitions: Record<RoomPhase, readonly RoomPhase[]> = {
      lobby: ['playing'],
      playing: ['paused', 'results', 'lobby'],
      paused: ['playing', 'lobby'],
      results: ['playing', 'lobby']
    };
    if (!allowedTransitions[this.roomPhase].includes(nextPhase)) {
      throw new Error(`Invalid room lifecycle transition '${this.roomPhase}' -> '${nextPhase}' (${reason}).`);
    }
    if (nextHasWorld !== (nextPhase !== 'lobby')) {
      throw new Error(`Invalid room lifecycle state '${nextPhase}' with hasWorld=${nextHasWorld} (${reason}).`);
    }
    if (this.hasWorld !== (this.roomPhase !== 'lobby')) {
      throw new Error(`Existing room lifecycle invariant is broken before '${reason}': phase='${this.roomPhase}', hasWorld=${this.hasWorld}.`);
    }
    this.roomPhase = nextPhase;
    this.hasWorld = nextHasWorld;
  }

  protected override updateMatchPhaseFromWorld(): void {
    if (!this.hasWorld || this.roomPhase !== 'playing') return;
    const snapshot = this.server.getSnapshot();
    const connectedParticipants = snapshot.humanPlayers.filter(participant => participant.connected);
    if (connectedParticipants.length === 0) throw new Error('A running room has no connected participants; the host participant invariant was violated.');
    const allDefeated = connectedParticipants.every(participant =>
      !snapshot.buildings.some(building => building.type === 'CORE' && building.id === participant.coreId && building.hp > 0)
    );
    if (!allDefeated) return;
    this.server.stop();
    this.transitionRoomLifecycle('results', true, 'all-connected-participants-defeated');
    console.info('[multiplayer host] All connected participants are defeated; simulation stopped and results frozen.', {
      gameTimeSeconds: snapshot.gameTime,
      participants: connectedParticipants.map(participant => ({ playerId: participant.playerId, survivedSeconds: participant.defeatedAtGameTime ?? snapshot.gameTime }))
    });
  }
}
