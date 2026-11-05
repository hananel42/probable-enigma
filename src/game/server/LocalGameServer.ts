import { GameEngine, type GameEngineState } from '../engine';
import type {
  ClientCommandEnvelope,
  ConnectClientOptions,
  GameClientPort,
  GameClientRole,
  GameClientSessionInfo,
  GameCommand,
  GameServerPort,
  GameSnapshot,
  GameWorldFrame
} from './protocol';
import { isValidGameCommand } from './protocol';
import { createWorldSeed } from '../world';
import type { RoomParticipantIdentity } from '../multiplayer/RoomGameAuthority';
import { flushPerformanceDiagnostics, measurePerformance, recordPerformanceSample } from '../performance/PerformanceDiagnostics';

let nextWorldSerial = 1;

/** Keep overload diagnostics visible without printing a warning every delayed tick. */
const OVERLOAD_DIAGNOSTIC_INTERVAL_MS = 5_000;

interface ClientSessionRecord {
  info: GameClientSessionInfo;
  lastAcceptedSequence: number;
}

/**
 * In-browser authoritative world runtime. It owns simulation time and mutable
 * game state, while client sessions communicate only through versioned commands.
 * No canvas, DOM event or renderer dependency is allowed here.
 */
export class LocalGameServer implements GameServerPort {
  private currentWorldId: string;
  private engine: GameEngine;
  private currentWorldSeed: number;
  private readonly frameListeners = new Set<(frame: GameWorldFrame) => void>();
  private readonly sessions = new Map<string, ClientSessionRecord>();
  private controllerClientId: string | null = null;
  private running = false;
  private schedulerHandle: ReturnType<typeof setTimeout> | null = null;
  private nextTickDeadlineMs = 0;
  private readonly simulationTickMs = 1000 / 60;
  private readonly maxCatchUpSteps = 5;
  private revision = 0;
  private nextClientSerial = 1;
  private currentFrame: GameWorldFrame;
  private lastOverloadDiagnosticAtMs = Number.NEGATIVE_INFINITY;
  private droppedTicksSinceDiagnostic = 0;
  private totalDroppedWallClockTicks = 0;
  private measuredEngineStepCount = 0;
  private measuredEngineStepTotalMs = 0;
  private measuredEngineStepMaxMs = 0;

  constructor(
    worldSeed = createWorldSeed(),
    restoredWorld?: { snapshot: GameEngineState; activeChunkKeys: readonly string[] }
  ) {
    if (!Number.isSafeInteger(worldSeed) || worldSeed < 0 || worldSeed > 0xffff_ffff) {
      throw new RangeError(`World seed must be an unsigned 32-bit integer; received ${worldSeed}.`);
    }
    this.currentWorldSeed = worldSeed;
    this.currentWorldId = this.createWorldId();
    this.engine = new GameEngine(worldSeed);
    if (restoredWorld) this.engine.restoreSinglePlayerState(restoredWorld.snapshot, restoredWorld.activeChunkKeys);
    this.currentFrame = this.createFrame(this.engine.state);
    this.attachEngineStateChanges(this.engine);
  }

  /** Current world identity. It changes only when the room owner creates a new world. */
  get worldId(): string { return this.currentWorldId; }

  /** Seed of the active/dormant engine world. A new room world receives a fresh seed. */
  get worldSeed(): number { return this.currentWorldSeed; }

  getSnapshot(): GameSnapshot {
    return this.engine.state;
  }

  /** Snapshot the chunk-generation ledger separately from game entities. */
  getLoadedChunkKeys(): string[] {
    return this.engine.getLoadedChunkKeys();
  }

  getWorldFrame(): GameWorldFrame {
    return this.currentFrame;
  }

  /** Capture a coherent, immutable-by-ownership wire frame at the current revision. */
  captureWorldFrame(): GameWorldFrame {
    const snapshot = measurePerformance('server.captureWorldFrame.serializeClone', () => {
      const encodedSnapshot = JSON.stringify(this.engine.state);
      if (encodedSnapshot === undefined) throw new TypeError('Authoritative game state could not be serialized.');
      return JSON.parse(encodedSnapshot) as GameSnapshot;
    }, { entityCount: this.engine.state.entities.length, buildingCount: this.engine.state.buildings.length, resourceNodeCount: this.engine.state.resourceNodes.length });
    return {
      protocolVersion: 3,
      worldId: this.worldId,
      worldSeed: this.worldSeed,
      revision: this.revision,
      serverTimeMs: Date.now(),
      snapshot
    };
  }

  subscribe(listener: (snapshot: GameSnapshot) => void): () => void {
    const onFrame = (frame: GameWorldFrame) => listener(frame.snapshot);
    return this.subscribeWorldFrames(onFrame);
  }

  subscribeWorldFrames(listener: (frame: GameWorldFrame) => void): () => void {
    this.frameListeners.add(listener);
    listener(this.currentFrame);
    return () => this.frameListeners.delete(listener);
  }

  /**
   * Create an addressable client session for this shared world. In single-player
   * mode there is one command-authorized controller; any extra sessions are
   * observers and receive the same world stream without mutating simulation state.
   */
  connectClient(options: ConnectClientOptions = {}): GameClientPort {
    const clientId = options.clientId?.trim() || `${this.worldId}-client-${this.nextClientSerial++}`;
    if (!clientId) throw new Error('Client ID must not be empty.');
    if (this.sessions.has(clientId)) throw new Error(`Client ID already connected: ${clientId}`);

    const role: GameClientRole = options.role ?? (this.controllerClientId === null ? 'controller' : 'observer');
    if (role === 'controller' && this.controllerClientId !== null) {
      throw new Error('This single-player world already has a controller session.');
    }

    const server = this;
    const info: GameClientSessionInfo = Object.freeze({
      get worldId() { return server.worldId; },
      clientId,
      role,
      controlledEntityId: role === 'controller' ? this.engine.state.player.id : null,
      get joinedAtRevision() { return server.revision; }
    });
    this.sessions.set(clientId, { info, lastAcceptedSequence: 0 });
    if (role === 'controller') this.controllerClientId = clientId;

    return new LocalGameClientSession(
      info,
      () => this.getSnapshot(),
      () => this.getWorldFrame(),
      listener => this.subscribe(listener),
      listener => this.subscribeWorldFrames(listener),
      envelope => this.acceptClientCommand(envelope),
      () => this.disconnectClient(clientId)
    );
  }

  getConnectedClients(): readonly GameClientSessionInfo[] {
    return [...this.sessions.values()].map(session => session.info);
  }

  /**
   * Server/system-side command hook used by tests and trusted local systems.
   * UI and future transport adapters must use the scoped client session instead.
   */
  dispatch(command: GameCommand): void {
    if (command.type === 'RESTART' && !this.canRestart()) return;
    this.engine.dispatchForPlayer('player-host', command as unknown as { type: string; [key: string]: unknown }, () => this.applyCommand(command));
  }

  /** Execute a validated command in a participant-specific commander and resource context. */
  dispatchForPlayer(playerId: string, command: GameCommand): boolean {
    if (!isValidGameCommand(command)) return false;
    if (command.type === 'RESTART' && !this.canRestart()) return false;
    if (playerId !== 'player-host' && (command.type === 'RESTART' || command.type === 'SET_GROUP_ALLIANCE' || command.type === 'SET_GROUP_IDENTITY')) return false;
    // Movement keys are persistent per-player state, not a one-off simulation
    // action. Write directly to that participant's control map so a remote key
    // press cannot be lost when the scoped command context is restored.
    if (command.type === 'SET_INPUT_KEY') {
      if (typeof command.code !== 'string' || typeof command.pressed !== 'boolean') return false;
      return this.engine.setPlayerInputKey(playerId, command.code, command.pressed);
    }
    return this.engine.dispatchForPlayer(playerId, command as unknown as { type: string; [key: string]: unknown }, () => this.applyCommand(command));
  }

  private canRestart(): boolean {
    // The engine owns the authoritative participant/Core rules. In CO-OP a
    // shared-Core defeat is terminal; in TEAM/FFA the whole room may restart
    // only after every connected participant has been defeated.
    return this.engine.canRestartGame();
  }

  addHumanParticipant(playerId: string, mode: GameEngineState['multiplayerMode']) {
    return this.engine.addHumanParticipant(playerId, mode);
  }

  setParticipantConnected(playerId: string, connected: boolean): boolean {
    return this.engine.setHumanParticipantConnected(playerId, connected);
  }

  setHumanParticipantDisplayName(playerId: string, displayName: string): boolean {
    return this.engine.setHumanParticipantDisplayName(playerId, displayName);
  }

  removeHumanParticipant(playerId: string): boolean {
    return this.engine.removeHumanParticipant(playerId);
  }

  setMultiplayerMode(mode: GameEngineState['multiplayerMode']): void { this.engine.setMultiplayerMode(mode); }

  /** Mode changes rebuild participant cores and must only happen before a match is running. */
  configureLobbyMode(mode: GameEngineState['multiplayerMode']): void {
    if (this.running) throw new Error('Cannot change the room mode while the authoritative simulation is running.');
    this.engine.configureLobbyMode(mode);
  }

  /**
   * Create a fresh world at the room owner's explicit start command. Room members
   * are supplied by room management, not inferred from the previous world state.
   * Existing client adapters/subscriptions remain attached and receive one coherent
   * full-frame notification for the new world.
   */
  createWorld(mode: GameEngineState['multiplayerMode'], participants: readonly RoomParticipantIdentity[]): void {
    if (this.running) throw new Error('Cannot replace a world while its simulation clock is running.');
    const ids = new Set<string>();
    for (const participant of participants) {
      if (!participant.playerId.trim() || !participant.displayName.trim() || ids.has(participant.playerId)) {
        throw new TypeError('A new world requires unique participant IDs and non-empty display names.');
      }
      ids.add(participant.playerId);
    }
    if (!ids.has('player-host')) throw new Error('A multiplayer world must include its room host participant.');

    const nextSeed = createWorldSeed();
    this.currentWorldSeed = nextSeed;
    this.currentWorldId = this.createWorldId();
    this.revision = 0;
    this.engine = new GameEngine(nextSeed);
    this.engine.setMultiplayerMode(mode);

    const host = participants.find(participant => participant.playerId === 'player-host');
    if (host) this.engine.setHumanParticipantDisplayName(host.playerId, host.displayName);
    for (const participant of participants) {
      if (participant.playerId === 'player-host') continue;
      this.engine.addHumanParticipant(participant.playerId, mode);
      this.engine.setHumanParticipantDisplayName(participant.playerId, participant.displayName);
    }

    // All participant identities and Cores exist now, so the FFA spawn layout
    // can be computed once for the complete roster before the first world frame.
    this.engine.prepareWorldStart();

    for (const session of this.sessions.values()) session.lastAcceptedSequence = 0;
    this.currentFrame = this.createFrame(this.engine.state);
    this.attachEngineStateChanges(this.engine);
    for (const listener of [...this.frameListeners]) listener(this.currentFrame);
  }

  /** Explicit administrative revival creates a fresh Core and restores one commander. */
  reviveHumanParticipant(playerId: string): boolean {
    return this.engine.reviveHumanParticipant(playerId);
  }

  get isRunning(): boolean { return this.running; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextTickDeadlineMs = performance.now() + this.simulationTickMs;

    // The authoritative simulation clock deliberately does not use
    // requestAnimationFrame. Rendering can pause, resize, or run at a different
    // refresh rate without becoming a prerequisite for world/network updates.
    const tick = () => {
      if (!this.running) return;
      this.schedulerHandle = null;
      let now = performance.now();
      let steps = 0;

      while (now >= this.nextTickDeadlineMs && steps < this.maxCatchUpSteps) {
        // Fixed 60 Hz ticks keep movement, AI and cooldowns independent from
        // the display refresh rate. Exceptions are intentionally uncaught.
        const stepStartedAtMs = performance.now();
        this.engine.step(this.simulationTickMs / 1000);
        const engineStepDurationMs = performance.now() - stepStartedAtMs;
        recordPerformanceSample('server.engineStep', engineStepDurationMs, { revision: this.revision });
        this.measuredEngineStepCount += 1;
        this.measuredEngineStepTotalMs += engineStepDurationMs;
        this.measuredEngineStepMaxMs = Math.max(this.measuredEngineStepMaxMs, engineStepDurationMs);
        this.nextTickDeadlineMs += this.simulationTickMs;
        steps += 1;
        now = performance.now();
      }

      if (now >= this.nextTickDeadlineMs) {
        const skippedTicks = Math.floor((now - this.nextTickDeadlineMs) / this.simulationTickMs) + 1;
        this.droppedTicksSinceDiagnostic += skippedTicks;
        this.totalDroppedWallClockTicks += skippedTicks;
        if (now - this.lastOverloadDiagnosticAtMs >= OVERLOAD_DIAGNOSTIC_INTERVAL_MS) {
          const snapshot = this.engine.state;
          console.warn('[simulation clock] Main thread could not keep up; dropping overdue wall-clock ticks to prevent a catch-up spiral.', {
            droppedTicksSinceLastDiagnostic: this.droppedTicksSinceDiagnostic,
            totalDroppedWallClockTicks: this.totalDroppedWallClockTicks,
            simulationTickRateHz: 60,
            latenessMs: now - this.nextTickDeadlineMs,
            diagnosticIntervalMs: OVERLOAD_DIAGNOSTIC_INTERVAL_MS,
            engineStepSamples: this.measuredEngineStepCount,
            averageEngineStepMs: this.measuredEngineStepCount > 0
              ? this.measuredEngineStepTotalMs / this.measuredEngineStepCount : 0,
            maxEngineStepMs: this.measuredEngineStepMaxMs,
            activeEntityCount: snapshot.entities.length,
            droneCount: snapshot.entities.reduce((count, entity) => count + (entity.kind === 'DRONE' && entity.hp > 0 ? 1 : 0), 0),
            buildingCount: snapshot.buildings.length,
            resourceNodeCount: snapshot.resourceNodes.length,
            projectileCount: snapshot.projectiles.length
          });
          this.droppedTicksSinceDiagnostic = 0;
          this.measuredEngineStepCount = 0;
          this.measuredEngineStepTotalMs = 0;
          this.measuredEngineStepMaxMs = 0;
          this.lastOverloadDiagnosticAtMs = now;
        }
        this.nextTickDeadlineMs += skippedTicks * this.simulationTickMs;
      }

      flushPerformanceDiagnostics({
        worldId: this.worldId,
        gameTimeSeconds: Number(this.engine.state.gameTime.toFixed(2)),
        revision: this.revision,
        activeEntityCount: this.engine.state.entities.length,
        droneCount: this.engine.state.entities.reduce((count, entity) => count + (entity.kind === 'DRONE' && entity.hp > 0 ? 1 : 0), 0),
        commanderCount: this.engine.state.entities.reduce((count, entity) => count + (entity.kind === 'COMMANDER' && entity.hp > 0 ? 1 : 0), 0),
        buildingCount: this.engine.state.buildings.length,
        enemyBaseCount: this.engine.state.enemyBases.length,
        resourceNodeCount: this.engine.state.resourceNodes.length,
        projectileCount: this.engine.state.projectiles.length,
        pendingFrameListeners: this.frameListeners.size
      });

      if (this.running) {
        this.schedulerHandle = setTimeout(tick, Math.max(0, this.nextTickDeadlineMs - performance.now()));
      }
    };

    this.schedulerHandle = setTimeout(tick, Math.max(0, this.nextTickDeadlineMs - performance.now()));
  }

  stop(): void {
    this.running = false;
    if (this.schedulerHandle !== null) clearTimeout(this.schedulerHandle);
    this.schedulerHandle = null;
  }

  /** Exposed for deterministic local tests and future non-browser host clocks. */
  step(dt: number): void {
    this.engine.step(dt);
  }

  private acceptClientCommand(envelope: ClientCommandEnvelope): boolean {
    if (envelope.protocolVersion !== 1 || envelope.worldId !== this.worldId || !isValidGameCommand(envelope.command)) return false;
    const session = this.sessions.get(envelope.clientId);
    if (!session || session.info.role !== 'controller') return false;
    if (this.controllerClientId !== envelope.clientId) return false;
    if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence <= session.lastAcceptedSequence) return false;
    if (!Number.isSafeInteger(envelope.observedRevision) || envelope.observedRevision > this.revision) return false;

    session.lastAcceptedSequence = envelope.sequence;
    // Commands must run in the owning participant's resource/input context.
    // Otherwise the next simulation tick restores the previous wallet from humanPlayers.
    return this.engine.dispatchForPlayer('player-host', envelope.command as unknown as { type: string; [key: string]: unknown }, () => this.applyCommand(envelope.command));
  }

  private disconnectClient(clientId: string): void {
    this.sessions.delete(clientId);
    if (this.controllerClientId === clientId) this.controllerClientId = null;
  }

  private createWorldId(): string { return `world-${nextWorldSerial++}`; }

  private attachEngineStateChanges(engine: GameEngine): void {
    engine.setOnStateChange(state => this.publish(state));
  }

  private createFrame(snapshot: GameSnapshot): GameWorldFrame {
    return {
      protocolVersion: 3,
      worldId: this.worldId,
      worldSeed: this.worldSeed,
      revision: this.revision,
      serverTimeMs: Date.now(),
      snapshot
    };
  }

  private publish(snapshot: GameSnapshot): void {
    measurePerformance('server.publishState', () => {
      this.revision += 1;
      this.currentFrame = this.createFrame(snapshot);
      for (const listener of this.frameListeners) listener(this.currentFrame);
    }, {
      listenerCount: this.frameListeners.size,
      entityCount: snapshot.entities.length,
      buildingCount: snapshot.buildings.length,
      resourceNodeCount: snapshot.resourceNodes.length,
      projectileCount: snapshot.projectiles.length
    });
  }

  private applyCommand(command: GameCommand): void {
    switch (command.type) {
      case 'SET_INPUT_KEY': this.engine.setInputKey(command.code, command.pressed); break;
      case 'AIM_AT': this.engine.setAimPoint(command.worldX, command.worldY); break;
      case 'POINTER_DOWN': this.engine.handleWorldPointerDown(command.button, command.worldX, command.worldY); break;
      case 'POINTER_UP': this.engine.handleWorldPointerUp(command.button); break;
      case 'SELECT_BUILDING': this.engine.selectBuilding(command.buildingType); break;
      case 'CANCEL_SELECTION': this.engine.cancelSelection(); break;
      case 'PLACE_SELECTED_BUILDING': this.engine.attemptPlaceSelectedBuilding(); break;
      case 'UPGRADE_NEARBY': this.engine.attemptUpgradeHotkeyNearby(command.key); break;
      case 'REPAIR_NEARBY': this.engine.attemptRepairNearby(command.buildingId); break;
      case 'DISMANTLE_NEARBY': this.engine.attemptDismantleNearby(command.buildingId); break;
      case 'TOGGLE_DRONE_MODE': this.engine.attemptToggleDroneMode(); break;
      case 'SET_DRONE_MODE': this.engine.setDroneStationMode(command.stationId, command.mode); break;
      case 'SET_GROUP_ALLIANCE': this.engine.setGroupAlliance(command.groupId, command.allianceId); break;
      case 'SET_GROUP_IDENTITY': this.engine.setGroupIdentity(command.groupId, command.name, command.commanderName, command.color); break;
      case 'RESTART': this.engine.restartGame(); break;
    }
  }
}

/** Client adapter that attaches identity, sequence and world revision to every command. */
class LocalGameClientSession implements GameClientPort {
  private sequence = 0;
  private active = true;
  private readonly cleanupSubscriptions = new Set<() => void>();

  constructor(
    readonly session: GameClientSessionInfo,
    private readonly snapshotReader: () => GameSnapshot,
    private readonly frameReader: () => GameWorldFrame,
    private readonly snapshotSubscriber: (listener: (snapshot: GameSnapshot) => void) => () => void,
    private readonly frameSubscriber: (listener: (frame: GameWorldFrame) => void) => () => void,
    private readonly commandSender: (envelope: ClientCommandEnvelope) => boolean,
    private readonly disconnectHandler: () => void
  ) {}

  getSnapshot(): GameSnapshot {
    return this.snapshotReader();
  }

  getWorldFrame(): GameWorldFrame {
    return this.frameReader();
  }

  subscribe(listener: (snapshot: GameSnapshot) => void): () => void {
    if (!this.active) return () => undefined;
    return this.trackSubscription(this.snapshotSubscriber(listener));
  }

  subscribeWorldFrames(listener: (frame: GameWorldFrame) => void): () => void {
    if (!this.active) return () => undefined;
    return this.trackSubscription(this.frameSubscriber(listener));
  }

  dispatch(command: GameCommand): boolean {
    if (!this.active) return false;
    const frame = this.frameReader();
    const envelope: ClientCommandEnvelope = {
      protocolVersion: 1,
      worldId: this.session.worldId,
      clientId: this.session.clientId,
      sequence: ++this.sequence,
      observedRevision: frame.revision,
      command
    };
    return this.commandSender(envelope);
  }

  disconnect(): void {
    if (!this.active) return;
    this.active = false;
    for (const cleanup of this.cleanupSubscriptions) cleanup();
    this.cleanupSubscriptions.clear();
    this.disconnectHandler();
  }

  private trackSubscription(cleanup: () => void): () => void {
    this.cleanupSubscriptions.add(cleanup);
    return () => {
      cleanup();
      this.cleanupSubscriptions.delete(cleanup);
    };
  }
}
