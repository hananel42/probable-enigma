import type { Resources } from '../types';
import { isOrphanedStructure } from '../coreStatus';
import type { EngineHumanPlayer, GameEngineState } from './model';
import { EngineGroups } from './EngineGroups';
import { measurePerformance, recordPerformanceSample } from '../performance/PerformanceDiagnostics';

export abstract class EngineSimulation extends EngineGroups {
  private lastCappedDeltaWarningAtMs = Number.NEGATIVE_INFINITY;

  /**
   * Advance simulation time in bounded substeps. A single long frame must not
   * silently discard elapsed time (which can delay weapon cooldowns, mining,
   * production and AI decisions). We cap catch-up to 0.5s to avoid a spiral of
   * death after a suspended tab, then simulate that interval in <=33ms steps.
   */
  public override step(dt: number) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError(`Simulation delta must be finite and non-negative; received ${dt}.`);
    }
    if (dt === 0) return;
    const maxCatchUpSeconds = 0.5;
    if (dt > maxCatchUpSeconds) {
      const nowMs = performance.now();
      recordPerformanceSample('simulation.discardedDeltaMs', (dt - maxCatchUpSeconds) * 1000, {
        requestedDeltaSeconds: dt,
        simulatedDeltaSeconds: maxCatchUpSeconds
      });
      if (nowMs - this.lastCappedDeltaWarningAtMs >= 1_000) {
        this.lastCappedDeltaWarningAtMs = nowMs;
        console.warn('[simulation clock] Large delta was explicitly capped to prevent an unbounded catch-up spiral.', {
          requestedDeltaSeconds: dt,
          simulatedDeltaSeconds: maxCatchUpSeconds,
          discardedElapsedSeconds: dt - maxCatchUpSeconds
        });
      }
    }
    let remaining = Math.min(dt, maxCatchUpSeconds);
    const stepStartedAt = performance.now();
    let substepCount = 0;
    try {
      while (remaining > 1e-9) {
        const substep = Math.min(remaining, 1 / 30);
        this.update(substep);
        remaining -= substep;
        substepCount += 1;
      }
    } finally {
      recordPerformanceSample('simulation.engineStep', performance.now() - stepStartedAt, {
        substepCount,
        entityCount: this.state.entities.length,
        buildingCount: this.state.buildings.length,
        resourceNodeCount: this.state.resourceNodes.length,
        projectileCount: this.state.projectiles.length
      });
    }
  }


  /** Keep the active HUD wallet and the participant ledger in sync immediately.
   * Resource changes must survive the next participant-context switch in updatePlayer().
   */
  protected override setActivePlayerResources(resources: Resources): void {
    const committed = { wood: resources.wood, stone: resources.stone, diamonds: resources.diamonds };
    this.state.resources = committed;
    const participant = this.state.humanPlayers?.find(player => player.playerId === this.activePlayerId);
    if (participant) participant.resources = { ...committed };
  }


  public override triggerStateChange() {
    if (this.scopedCommandDepth > 0 || this.updatingHumanPlayers) { this.pendingStateChange = true; return; }
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({ ...this.state });
    }
  }


  protected override update(dt: number) {
    // Core destruction disables its structures, but does not freeze the world: commanders can still salvage them.

    this.state.gameTime += dt;
    this.state.difficultyLevel = 1 + Math.floor(this.state.gameTime / 180);

    measurePerformance('simulation.updatePlayer', () => this.updatePlayer(dt), { humanPlayerCount: this.state.humanPlayers.length });
    measurePerformance('simulation.updateChunks', () => this.updateChunks(), { activeChunkCount: this.activeChunks.size, resourceNodeCount: this.state.resourceNodes.length });
    measurePerformance('simulation.updateAutonomousUnits', () => this.updateAutonomousUnits(dt), { entityCount: this.state.entities.length, droneCount: this.state.entities.reduce((count, entity) => count + (entity.kind === 'DRONE' && entity.hp > 0 ? 1 : 0), 0) });
    measurePerformance('simulation.updateBuildings', () => this.updateBuildings(dt), { buildingCount: this.state.buildings.length, entityCount: this.state.entities.length });
    measurePerformance('simulation.updateEnemyBases', () => this.updateEnemyBases(dt), { baseCount: this.state.enemyBases.length, buildingCount: this.state.buildings.length });
    measurePerformance('simulation.updateProjectiles', () => this.updateProjectiles(dt), { projectileCount: this.state.projectiles.length });
    measurePerformance('simulation.updateParticles', () => this.updateParticles(dt), { particleCount: this.state.particles.length });
    measurePerformance('simulation.updateFloatingTexts', () => this.updateFloatingTexts(dt), { floatingTextCount: this.state.floatingTexts.length });

    // The public HUD represents the host. Guest clients derive their own defeat
    // state from their assigned Core when projecting the same authoritative frame.
    this.state.isGameOver = this.isParticipantDefeated('player-host');

    // Follow the host Commander only while their Core remains operational and
    // the Commander still exists in the live entity list. Defeat freezes the view
    // at the loss location rather than tracking a hidden tombstone forever.
    measurePerformance('simulation.cameraFollow', () => {
      if (!this.isParticipantDefeated('player-host') && this.state.entities.some(entity => entity.id === this.state.player.id)) {
        this.state.camera.x += (this.state.player.x - this.state.camera.x) * 6 * dt;
        this.state.camera.y += (this.state.player.y - this.state.camera.y) * 6 * dt;
      }
    });

    // A destroyed Core is a strategic loss, not a frozen simulation.

    // Keep proximity-based structure information and live HP/resources current
    // without tying HUD updates to clicks or other one-off events.
    this.uiSyncTimer += dt;
    if (this.uiSyncTimer >= 1 / 30) {
      this.uiSyncTimer %= 1 / 30;
      this.triggerStateChange();
    }
  }


  protected override updatePlayer(dt: number) {
    // The host participant is a required invariant: all player contexts are
    // restored to it after iterating participants, so fail before mutating context.
    const hostParticipant = this.state.humanPlayers.find(p => p.playerId === 'player-host');
    if (!hostParticipant) throw new Error("Simulation invariant violated: required host participant 'player-host' is missing.");
    const hostPlayer = this.state.player;
    const hostKeys = this.keys;
    const hostPointerDown = this.isPointerDown;
    const hostAim = this.state.mouseWorld;
    const hostSelection = this.state.selectedBuildingType;
    const hostStation = this.state.selectedStationId;
    const hostAiming = this.state.isMouseAiming;
    this.updatingHumanPlayers = true;
    for (const participant of this.state.humanPlayers) {
      if (!participant.connected) continue;
      if (this.isParticipantDefeated(participant.playerId)) {
        this.retireDefeatedParticipant(participant);
        if (participant.playerId === 'player-host') this.state.isGameOver = true;
        continue;
      }
      const commander = this.state.entities.find(e => e.id === participant.commanderId);
      if (!commander) throw new Error(`Connected participant '${participant.playerId}' is missing commander '${participant.commanderId}'.`);
      const control = this.playerControls.get(participant.playerId);
      if (!control) throw new Error(`Connected participant '${participant.playerId}' is missing its input-control state.`);
      this.state.player = commander; this.state.resources = participant.resources; this.keys = control.keys; this.isPointerDown = control.pointerDown; this.state.mouseWorld = control.aim; this.state.selectedBuildingType = control.selectedBuildingType; this.state.selectedStationId = control.selectedStationId; this.state.isMouseAiming = control.aiming; this.activePlayerId = participant.playerId;
      this.updateSinglePlayer(dt);
      participant.resources = this.state.resources; participant.selectedBuildingType = this.state.selectedBuildingType; participant.selectedStationId = this.state.selectedStationId; participant.aim = this.state.mouseWorld; participant.isAiming = this.state.isMouseAiming; control.keys = this.keys; control.pointerDown = this.isPointerDown; control.aim = this.state.mouseWorld; control.selectedBuildingType = this.state.selectedBuildingType; control.selectedStationId = this.state.selectedStationId; control.aiming = this.state.isMouseAiming;
    }
    this.state.player = hostPlayer; this.state.resources = hostParticipant.resources; this.keys = hostKeys; this.isPointerDown = hostPointerDown; this.state.mouseWorld = hostAim; this.state.selectedBuildingType = hostSelection; this.state.selectedStationId = hostStation; this.state.isMouseAiming = hostAiming; this.activePlayerId = 'player-host';
    this.updatingHumanPlayers = false;
    if (this.pendingStateChange) { this.pendingStateChange = false; this.triggerStateChange(); }
  }


  protected override isParticipantDefeated(playerId: string): boolean {
    const participant = this.state.humanPlayers.find(candidate => candidate.playerId === playerId);
    if (!participant) return false;
    return !this.state.buildings.some(building => building.type === 'CORE' && building.id === participant.coreId && building.hp > 0);
  }


  /** Remove a defeated participant's Commander once; gray structures remain salvageable. */
  protected override retireDefeatedParticipant(participant: EngineHumanPlayer): void {
    // Freeze this participant's survival time exactly once while the shared room
    // continues running for survivors. A room restart creates a fresh run and clears it.
    if (participant.defeatedAtGameTime === undefined || participant.defeatedAtGameTime === null) {
      participant.defeatedAtGameTime = this.state.gameTime;
      this.pendingStateChange = true;
    }
    const commanderIndex = this.state.entities.findIndex(entity => entity.id === participant.commanderId);
    if (commanderIndex >= 0) {
      this.state.entities.splice(commanderIndex, 1);
      this.harvesterChunkLocations.delete(participant.commanderId);
      this.pendingStateChange = true;
    }

    const controls = this.playerControls.get(participant.playerId);
    if (controls) {
      controls.keys = {};
      controls.pointerDown = false;
      controls.aiming = false;
      controls.selectedBuildingType = null;
      controls.selectedStationId = null;
    }
    if (this.activePlayerId === participant.playerId || participant.playerId === 'player-host') {
      this.keys = {};
      this.isPointerDown = false;
      this.state.isMouseAiming = false;
      this.state.selectedBuildingType = null;
      this.state.selectedStationId = null;
    }

    // Ownership of operational structures is already disabled by Core status.
    // Clear the direct owner marker on orphaned structures so they are treated as
    // abandoned salvage, not as assets that should disappear on later disconnect.
    for (const building of this.state.buildings) {
      if (building.type !== 'CORE' && building.ownerPlayerId === participant.playerId &&
          isOrphanedStructure(building, this.state.buildings)) {
        building.ownerPlayerId = undefined;
      }
    }
  }
}
