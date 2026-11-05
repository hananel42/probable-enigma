import type { GameEntity } from '../types';
import { GRID_SIZE, snapToGrid, getBuildingCandidatesInCellBounds } from '../rules';
import { CHUNK_SIZE, generateChunk } from '../world';
import { createFreeForAllSpawnLayout } from '../spawnLayout';
import type { EngineHumanPlayer, GameEngineState } from './model';
import { EngineState } from './EngineState';
import { measurePerformance } from '../performance/PerformanceDiagnostics';

export abstract class EngineWorldSetup extends EngineState {


  public override setMultiplayerMode(mode: GameEngineState['multiplayerMode']): void {
    this.state.multiplayerMode = mode;
    const allianceId = mode === 'FREE_FOR_ALL' ? 'alliance-player-host' : 'alliance-humans';
    const host = this.state.humanPlayers.find(p => p.playerId === 'player-host');
    if (host) { host.allianceId = allianceId; host.groupId = 'group-host'; }
    const hostCommander = this.state.entities.find(e => e.id === 'player-commander');
    if (hostCommander) hostCommander.allianceId = allianceId;
    const hostGroup = this.state.groups.find(group => group.id === 'group-host'); if (hostGroup) hostGroup.allianceId = allianceId;
    for (const building of this.state.buildings) if (building.ownerPlayerId === 'player-host') building.allianceId = allianceId;
    this.triggerStateChange();
  }


  /**
   * Finalize spawn positions immediately before publishing a newly created world.
   * FFA participants receive evenly spaced Core locations; TEAM and CO-OP preserve
   * their intentionally clustered/shared start. This method is called by the
   * authoritative server after every connected participant has been registered.
   */
  public override prepareWorldStart(): void {
    // Every new world gets a fresh one-reward-per-Core ledger.
    this.rewardedCoreIds.clear();
    if (this.state.multiplayerMode !== 'FREE_FOR_ALL') return;

    const participants = this.state.humanPlayers.filter(participant => participant.connected);
    const slots = createFreeForAllSpawnLayout(participants.length);
    if (slots.length !== participants.length) {
      throw new Error('FFA spawn layout invariant failed: every connected participant must have exactly one spawn slot.');
    }

    for (const [index, participant] of participants.entries()) {
      const slot = slots[index];
      const commander = this.state.entities.find(entity => entity.id === participant.commanderId);
      if (!commander) throw new Error(`Cannot prepare FFA spawn: Commander '${participant.commanderId}' is missing.`);
      const core = this.state.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
      if (!core) throw new Error(`Cannot prepare FFA spawn: Core '${participant.coreId}' is missing.`);

      core.gx = slot.coreGx;
      core.gy = slot.coreGy;
      core.x = slot.coreX;
      core.y = slot.coreY;

      commander.x = slot.commanderX;
      commander.y = slot.commanderY;
      commander.vx = 0;
      commander.vy = 0;
      commander.angle = slot.angle + Math.PI;
      commander.path = undefined;
      commander.pathIndex = 0;
      commander.pathTargetX = undefined;
      commander.pathTargetY = undefined;
      commander.pathRecalcTimer = 0;

      const aim = snapToGrid(commander.x, commander.y, GRID_SIZE);
      participant.aim = { ...aim };
      participant.isAiming = false;
      const control = this.playerControls.get(participant.playerId);
      if (control) {
        control.keys = {};
        control.pointerDown = false;
        control.aim = { ...aim };
        control.aiming = false;
      }
    }

    const host = participants.find(participant => participant.playerId === 'player-host');
    const hostCommander = host && this.state.entities.find(entity => entity.id === host.commanderId);
    if (!hostCommander) throw new Error("Cannot prepare FFA world: required host Commander 'player-commander' is missing.");
    this.state.camera.x = hostCommander.x;
    this.state.camera.y = hostCommander.y;
    this.state.mouseWorld = snapToGrid(hostCommander.x, hostCommander.y, GRID_SIZE);
    this.state.isMouseAiming = false;

    // Preload nearby resource chunks for every spawn before the first full state
    // is published. Resource nodes may have been generated before FFA relocation;
    // remove any that now overlap a Core footprint.
    for (const participant of participants) {
      const commander = this.state.entities.find(entity => entity.id === participant.commanderId);
      if (commander) this.loadChunksAroundWorld(commander.x, commander.y, 1);
    }
    this.state.resourceNodes = this.state.resourceNodes.filter(node => !this.isResourceCellOccupied(node.gx, node.gy));
    this.triggerStateChange();
  }


  /** A resource node cannot occupy a cell in a live building footprint. */
  protected override isResourceCellOccupied(gx: number, gy: number): boolean {
    // A chunk can contain several resource nodes. Query the building spatial index
    // for the one cell instead of rescanning every structure for each node.
    return getBuildingCandidatesInCellBounds(this.state.buildings, gx, gy, gx, gy).some(building =>
      building.hp > 0 &&
      gx >= building.gx && gx < building.gx + Math.max(1, building.widthInCells) &&
      gy >= building.gy && gy < building.gy + Math.max(1, building.heightInCells));
  }


  protected override initWorld() {
    for (let cx = -1; cx <= 1; cx++) {
      for (let cy = -1; cy <= 1; cy++) {
        this.loadChunk(cx, cy);
      }
    }
  }


  protected override loadChunk(cx: number, cy: number) {
    const key = `${cx},${cy}`;
    if (this.activeChunks.has(key)) return;
    this.activeChunks.add(key);

    const chunk = measurePerformance('world.generateChunk', () => generateChunk(cx, cy, this.worldSeed), {
      chunkX: cx, chunkY: cy, worldSeed: this.worldSeed
    });
    const acceptedNodes = measurePerformance('world.filterChunkResources', () =>
      chunk.nodes.filter(node => !this.isResourceCellOccupied(node.gx, node.gy)),
      { chunkX: cx, chunkY: cy, candidateCount: chunk.nodes.length, buildingCount: this.state.buildings.length }
    );
    this.state.resourceNodes.push(...acceptedNodes);
  }


  protected override loadChunksAroundWorld(worldX: number, worldY: number, radius: number) {
    const centerCx = Math.floor(worldX / CHUNK_SIZE);
    const centerCy = Math.floor(worldY / CHUNK_SIZE);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) this.loadChunk(centerCx + dx, centerCy + dy);
    }
  }


  protected override updateChunks() {
    const commanders = this.state.humanPlayers.map(participant => this.state.entities.find(entity => entity.id === participant.commanderId)).filter((entity): entity is GameEntity => Boolean(entity));
    for (const commander of commanders) {
      const playerCx = Math.floor(commander.x / CHUNK_SIZE);
      const playerCy = Math.floor(commander.y / CHUNK_SIZE);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) this.loadChunk(playerCx + dx, playerCy + dy);
    }
  }
}
