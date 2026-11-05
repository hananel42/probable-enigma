import type { GameMode } from '../types';
import { normalizeDisplayName } from '../displayName';
import type { RoomManagementStatus, RoomPlayerStatus } from '../roomManagement';
import { COMMAND_PROTOCOL_VERSION, ROOM_STATUS_FAILURE_LOG_INTERVAL_MS, ROOM_STATUS_MIN_INTERVAL_MS } from './model';
import { HostRoomControllerState } from './HostRoomControllerState';

export abstract class HostRoomStatus extends HostRoomControllerState {

  public override subscribeRoomStatus(listener: (status: RoomManagementStatus) => void): () => void {
    this.roomStatusListeners.add(listener);
    listener(this.getRoomStatus());
    return () => this.roomStatusListeners.delete(listener);
  }

  public override getRoomStatus(): RoomManagementStatus {
    return this.buildRoomStatus(Date.now());
  }

  /** Change the ruleset only while the authoritative simulation is stopped in the lobby. */
  public override setRoomMode(mode: GameMode): void {
    if (this.roomPhase !== 'lobby') throw new Error(`Cannot change room mode during room phase '${this.roomPhase}'.`);
    if (this.server.isRunning) throw new Error('Cannot change room mode while the simulation clock is running.');
    if (mode === this.mode) return;
    this.server.configureLobbyMode(mode);
    this.mode = mode;
    this.resetAllPeerReplicasForFullState();
    this.broadcastRoomStatus(true);
  }

  protected override buildRoomStatus(nowMs: number): RoomManagementStatus {
    const snapshot = this.hasWorld ? this.server.getSnapshot() : null;
    const players: RoomPlayerStatus[] = [];
    const hostParticipant = snapshot?.humanPlayers.find(participant => participant.playerId === 'player-host');
    const hostCoreIsAlive = Boolean(hostParticipant && snapshot?.buildings.some(building =>
      building.type === 'CORE' && building.id === hostParticipant.coreId && building.hp > 0));
    players.push({
      playerId: 'player-host',
      displayName: normalizeDisplayName(hostParticipant?.displayName ?? (this.hostDisplayName || 'Host')),
      isHost: true,
      connected: true,
      phase: !this.hasWorld || hostCoreIsAlive ? 'alive' : 'defeated',
      survivalSeconds: snapshot ? Math.floor(Math.max(0, hostParticipant?.defeatedAtGameTime ?? snapshot.gameTime)) : 0
    });

    for (const [peerId, playerId] of this.playerByPeer) {
      if (this.transport.hasPeerConnection && !this.transport.hasPeerConnection(peerId)) continue;
      const participant = snapshot?.humanPlayers.find(candidate => candidate.playerId === playerId);
      const coreIsAlive = Boolean(participant && snapshot?.buildings.some(building =>
        building.type === 'CORE' && building.id === participant.coreId && building.hp > 0));
      players.push({
        playerId,
        displayName: normalizeDisplayName(this.displayNameByPeer.get(peerId) ?? participant?.displayName ?? 'Guest'),
        isHost: false,
        connected: true,
        phase: !this.hasWorld || coreIsAlive ? 'alive' : 'defeated',
        survivalSeconds: snapshot ? Math.floor(Math.max(0, participant?.defeatedAtGameTime ?? snapshot.gameTime)) : 0
      });
    }

    return {
      phase: this.roomPhase,
      mode: this.mode,
      hasWorld: this.hasWorld,
      worldId: this.hasWorld ? this.server.worldId : null,
      gameTimeSeconds: snapshot ? Math.floor(Math.max(0, snapshot.gameTime)) : 0,
      players: players.slice(0, 32),
      updatedAtMs: nowMs
    };
  }

  protected override broadcastRoomStatus(force: boolean, nowMs = Date.now()): void {
    const status = this.buildRoomStatus(nowMs);
    const content = JSON.stringify({ phase: status.phase, mode: status.mode, hasWorld: status.hasWorld, worldId: status.worldId, gameTimeSeconds: status.gameTimeSeconds, players: status.players });
    // Roster and lifecycle changes are delivered immediately. The changing game
    // clock is coarse (1 Hz), so it cannot flood peer data channels at 30 Hz.
    const urgentContent = JSON.stringify({
      phase: status.phase,
      mode: status.mode,
      hasWorld: status.hasWorld,
      worldId: status.worldId,
      players: status.players.map(player => [player.playerId, player.displayName, player.isHost, player.connected, player.phase])
    });
    const urgentChanged = urgentContent !== this.lastPublishedRoomUrgentContent;
    const intervalElapsed = nowMs - this.lastRoomStatusPublicationAtMs >= ROOM_STATUS_MIN_INTERVAL_MS;
    const localStatusChanged = content !== this.lastPublishedRoomStatusContent || urgentChanged;
    // A room status may be delayed behind a later world transition on the same
    // data channel. Sequence the control plane independently from world revisions
    // so guests can safely discard old lobby/playing/paused envelopes.
    if (localStatusChanged) this.roomStatusRevision += 1;
    if (force || localStatusChanged || intervalElapsed) {
      this.lastPublishedRoomStatusContent = content;
      this.lastPublishedRoomUrgentContent = urgentContent;
      this.lastRoomStatusPublicationAtMs = nowMs;
      for (const listener of [...this.roomStatusListeners]) {
        try {
          listener(status);
        } catch (error) {
          // A local HUD/listener failure must never stop room-status delivery to
          // other peers or break the host's 30 Hz replication loop.
          console.error('[multiplayer host] A local room-status subscriber failed; network publication will continue.', { error });
          this.onRuntimeError?.('room-status-subscriber', error);
        }
      }
    }
    // Peer delivery is tracked independently. A failed send is not marked as
    // published, so a guest cannot miss a lobby -> playing transition forever.
    for (const peerId of [...this.replicationByPeer.keys()]) this.sendRoomStatusToPeer(peerId, nowMs, status, force);
  }

  protected override sendRoomStatusToPeer(peerId: string, nowMs = Date.now(), existingStatus?: RoomManagementStatus, force = false): void {
    if (!this.replicationByPeer.has(peerId)) return;
    const status = existingStatus ?? this.buildRoomStatus(nowMs);
    const content = JSON.stringify({ phase: status.phase, mode: status.mode, hasWorld: status.hasWorld, worldId: status.worldId, gameTimeSeconds: status.gameTimeSeconds, players: status.players });
    const urgentContent = JSON.stringify({
      phase: status.phase,
      mode: status.mode,
      hasWorld: status.hasWorld,
      worldId: status.worldId,
      players: status.players.map(player => [player.playerId, player.displayName, player.isHost, player.connected, player.phase])
    });
    const previous = this.roomStatusByPeer.get(peerId);
    const intervalElapsed = !previous || nowMs - previous.lastSentAtMs >= ROOM_STATUS_MIN_INTERVAL_MS;
    const changed = !previous || content !== previous.content || urgentContent !== previous.urgentContent;
    if (!force && !intervalElapsed && !changed) return;
    const sent = this.tryQueueTransportMessage({
      type: 'game-room-status', protocolVersion: COMMAND_PROTOCOL_VERSION,
      roomSessionId: this.roomSessionId, statusRevision: this.roomStatusRevision, status
    }, peerId, 'room-status');
    if (sent) {
      this.roomStatusByPeer.set(peerId, {
        content, urgentContent, lastSentAtMs: nowMs,
        lastFailureLoggedAtMs: previous?.lastFailureLoggedAtMs ?? 0
      });
      return;
    }
    const lastFailureLoggedAtMs = previous?.lastFailureLoggedAtMs ?? 0;
    if (nowMs - lastFailureLoggedAtMs >= ROOM_STATUS_FAILURE_LOG_INTERVAL_MS) {
      console.warn('[multiplayer host] Room status was not queued; delivery remains pending and will be retried.', {
        peerId, phase: status.phase, hasRegisteredTransport: this.transport.hasPeerConnection?.(peerId) ?? 'unknown'
      });
      this.roomStatusByPeer.set(peerId, {
        content: previous?.content ?? '',
        urgentContent: previous?.urgentContent ?? '',
        lastSentAtMs: previous?.lastSentAtMs ?? 0,
        lastFailureLoggedAtMs: nowMs
      });
    }
  }
}
