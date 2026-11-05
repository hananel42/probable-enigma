import { isValidGameCommand } from '../../server/protocol';
import type { GameClientSessionInfo, GameCommand, GameSnapshot, GameWorldFrame } from '../../server/protocol';
import { moveCommanderWithCollision } from '../../movement';
import { GRID_SIZE } from '../../rules';
import { normalizeChatText } from '../chat';
import type { RoomChatMessage } from '../chat';
import type { RoomManagementStatus } from '../roomManagement';
import type { PlayerDefeatNotice, RemoteConnectionHealth, RoomRemovalNotice } from './model';
import { COMMAND_PROTOCOL_VERSION, applyRenderPoses, poseMap } from './model';
import { RemoteGameClientPortState } from './RemoteGameClientPortState';

export abstract class RemoteGameClientPortApi extends RemoteGameClientPortState {

  /** Stable, nullable participant ID for UI labels while an initial state is still pending. */
  public override get assignedPlayerId(): string | null {
    return this.playerAssigned ? this.playerId : null;
  }

  public override get session(): GameClientSessionInfo {
    if (!this.currentSession) this.fail('Multiplayer session identity is unavailable before an authoritative host state arrives.');
    return this.currentSession;
  }

  /** Room control/status stream is independent from world-state replication. */
  public override subscribeRoomStatus(listener: (status: RoomManagementStatus) => void): () => void {
    this.roomStatusListeners.add(listener);
    if (this.currentRoomStatus) listener(this.currentRoomStatus);
    return () => this.roomStatusListeners.delete(listener);
  }

  public override getRoomStatus(): RoomManagementStatus | null { return this.currentRoomStatus; }

  public override hasAuthoritativeState(): boolean { return this.receivedAuthoritativeFrame; }

  public override getSnapshot(): GameSnapshot {
    if (!this.receivedAuthoritativeFrame) this.fail('Authoritative multiplayer state has not arrived from the host.');
    return this.snapshot;
  }

  public override getWorldFrame(): GameWorldFrame {
    if (!this.receivedAuthoritativeFrame) this.fail('Authoritative multiplayer frame has not arrived from the host.');
    return this.frame;
  }

  /**
   * Render-only view: remote entities are interpolated between timestamped
   * authoritative snapshots; the local commander is predicted for immediate
   * controls and gradually reconciled to the latest server position.
   */
  public override getRenderSnapshot(): GameSnapshot {
    if (!this.receivedAuthoritativeFrame) this.fail('Cannot render before receiving authoritative multiplayer state.');
    const now = performance.now();
    const interpolated = this.presentationBuffer.sampleAt(now - this.interpolationDelayMs);
    const dt = this.lastRenderTimeMs === null ? 0 : Math.min(0.05, Math.max(0, (now - this.lastRenderTimeMs) / 1000));
    this.lastRenderTimeMs = now;

    const authoritativeCommander = this.snapshot.player;
    if (!this.predictedCommander || this.predictedCommander.id !== authoritativeCommander.id ||
        this.predictedCommander.isDead !== authoritativeCommander.isDead ||
        Math.hypot(this.predictedCommander.x - authoritativeCommander.x, this.predictedCommander.y - authoritativeCommander.y) > GRID_SIZE * 4) {
      this.predictedCommander = { ...authoritativeCommander };
    } else {
      const predictedX = this.predictedCommander.x;
      const predictedY = this.predictedCommander.y;
      this.predictedCommander = { ...authoritativeCommander, x: predictedX, y: predictedY };
    }

    const predicted = this.predictedCommander;
    if (dt > 0 && !predicted.isDead && predicted.hp > 0) {
      // Reconcile position error over ~120 ms instead of snapping to every
      // 30 Hz server update. This affects presentation only, never host state.
      const correction = 1 - Math.exp(-dt / 0.12);
      predicted.x += (authoritativeCommander.x - predicted.x) * correction;
      predicted.y += (authoritativeCommander.y - predicted.y) * correction;

      let dx = Number(this.predictionKeys.has('KeyD') || this.predictionKeys.has('ArrowRight')) -
        Number(this.predictionKeys.has('KeyA') || this.predictionKeys.has('ArrowLeft'));
      let dy = Number(this.predictionKeys.has('KeyS') || this.predictionKeys.has('ArrowDown')) -
        Number(this.predictionKeys.has('KeyW') || this.predictionKeys.has('ArrowUp'));
      if (dx !== 0 && dy !== 0) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      if (dx !== 0 || dy !== 0) {
        if (!this.snapshot.isMouseAiming) predicted.angle = Math.atan2(dy, dx);
        moveCommanderWithCollision(predicted, dx, dy, dt, this.snapshot.buildings, this.snapshot.resourceNodes);
      }
      if (this.snapshot.isMouseAiming && this.predictedAimPoint) {
        predicted.angle = Math.atan2(this.predictedAimPoint.y - predicted.y, this.predictedAimPoint.x - predicted.x);
      }
    }

    // Keep the complete authoritative snapshot only once. History stores compact
    // render poses, so a 12-sample buffer cannot retain 12 copies of the world.
    const renderState = interpolated;
    const entityPoses = poseMap(renderState?.entities ?? []);
    const projectiles = applyRenderPoses(this.snapshot.projectiles, poseMap(renderState?.projectiles ?? []),
      ['x', 'y', 'vx', 'vy', 'life']);
    const particles = applyRenderPoses(this.snapshot.particles, poseMap(renderState?.particles ?? []),
      ['x', 'y', 'vx', 'vy', 'life', 'alpha']);
    const floatingTexts = applyRenderPoses(this.snapshot.floatingTexts, poseMap(renderState?.floatingTexts ?? []),
      ['x', 'y', 'vy', 'life']);
    const enemyBases = applyRenderPoses(this.snapshot.enemyBases, poseMap(renderState?.enemyBases ?? []),
      ['x', 'y', 'raidTimer', 'buildTimer']);
    const renderEntities = this.snapshot.entities.map(entity => {
      if (entity.id === predicted.id) return predicted;
      const pose = entityPoses.get(entity.id);
      return pose ? { ...entity, ...pose } : entity;
    });
    const camera = renderState?.camera ?? this.snapshot.camera;
    return {
      ...this.snapshot,
      gameTime: renderState?.gameTime ?? this.snapshot.gameTime,
      player: predicted,
      entities: renderEntities,
      projectiles,
      particles,
      floatingTexts,
      enemyBases,
      camera: { ...this.snapshot.camera, zoom: camera.zoom, x: predicted.x, y: predicted.y }
    };
  }

  /** Immediate local input hint; the host still validates and simulates the command. */
  public override setPredictedInputKey(code: string, pressed: boolean): void {
    const isMovement = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code);
    if (!isMovement) return;
    if (pressed) this.predictionKeys.add(code);
    else this.predictionKeys.delete(code);
  }

  public override setPredictedAimPoint(worldX: number, worldY: number): void {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      throw new RangeError(`Predicted aim point must be finite; received (${worldX}, ${worldY}).`);
    }
    this.predictedAimPoint = { x: worldX, y: worldY };
  }

  public override subscribe(listener: (snapshot: GameSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    if (this.receivedAuthoritativeFrame) listener(this.snapshot);
    return () => this.snapshotListeners.delete(listener);
  }

  public override subscribeWorldFrames(listener: (frame: GameWorldFrame) => void): () => void {
    this.frameListeners.add(listener);
    if (this.receivedAuthoritativeFrame) listener(this.frame);
    return () => this.frameListeners.delete(listener);
  }

  public override subscribeConnectionHealth(listener: (health: RemoteConnectionHealth, message?: string) => void): () => void {
    this.healthListeners.add(listener);
    listener(this.connectionHealth);
    return () => this.healthListeners.delete(listener);
  }

  public override subscribePlayerDefeated(listener: (notice: PlayerDefeatNotice) => void): () => void {
    this.defeatListeners.add(listener);
    return () => this.defeatListeners.delete(listener);
  }

  /** Listen for an explicit host removal without exposing transport details to the UI. */
  public override subscribeRoomRemoval(listener: (notice: RoomRemovalNotice) => void): () => void {
    this.roomRemovalListeners.add(listener);
    return () => this.roomRemovalListeners.delete(listener);
  }

  public override dispatch(command: GameCommand): boolean {
    // Renderer cleanup, stale input events, and UI actions can race the explicit
    // world-ended/assignment messages. No active world is a normal non-playable
    // room state, not a peer protocol failure: reject the local command without
    // throwing into the transport message listener.
    if (!this.active || !this.receivedAuthoritativeFrame) return false;
    if (this.awaitingAuthorityBaseline || this.awaitingAuthorityAnnouncement) {
      console.debug('[multiplayer guest] Command suppressed while the newly announced host world is synchronizing.', {
        announcedWorldId: this.announcedWorldId,
        previousWorldId: this.authoritativeFrame?.worldId ?? null
      });
      return false;
    }
    const commandType = (command as { type?: unknown } | null)?.type;
    if (!isValidGameCommand(command)) this.fail(`Invalid multiplayer command: ${String(commandType)}`, command);
    const sent = this.transport.sendData({
      type: 'game-command',
      protocolVersion: COMMAND_PROTOCOL_VERSION,
      roomSessionId: this.announcedRoomSessionId,
      sequence: ++this.sequence,
      observedRevision: this.revision,
      command
    });
    if (!sent) console.error('[multiplayer guest] Command was not queued by the transport.', { command, sequence: this.sequence });
    return sent;
  }

  /** Ready means assignment + full state + at least one subsequent delta were received. */
  public override isSessionReady(): boolean { return this.sessionReady; }

  public override subscribeSessionReadiness(listener: (ready: boolean) => void): () => void {
    this.readinessListeners.add(listener);
    listener(this.sessionReady);
    return () => this.readinessListeners.delete(listener);
  }

  public override subscribeChat(listener: (message: RoomChatMessage) => void): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  public override sendChat(rawText: string): void {
    const text = normalizeChatText(rawText);
    const sent = this.transport.sendData({ type: 'game-chat-send', protocolVersion: COMMAND_PROTOCOL_VERSION, roomSessionId: this.announcedRoomSessionId, text });
    if (!sent) throw new Error('The room connection is not ready to send chat. Check your connection and try again.');
  }

  public override disconnect(): void {
    this.active = false;
    if (this.helloRetry) clearInterval(this.helloRetry);
    this.helloRetry = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.unsubscribeData();
    this.snapshotListeners.clear();
    this.frameListeners.clear();
    this.healthListeners.clear();
    this.defeatListeners.clear();
    this.roomRemovalListeners.clear();
    this.chatListeners.clear();
    this.readinessListeners.clear();
    this.receivedChatMessageIds.clear();
    this.receivedDefeatEventIds.clear();
    this.receivedRoomRemovalIds.clear();
    this.pendingInitialStateBeforeAssignment = null;
    this.pendingInitialStateForUnannouncedWorld = null;
    this.retiredWorldIds.clear();
    this.announcedWorldId = null;
    this.pendingDefeatNotice = null;
    this.presentationBuffer.clear();
    this.predictionKeys.clear();
    this.predictedCommander = null;
    this.predictedAimPoint = null;
  }
}
