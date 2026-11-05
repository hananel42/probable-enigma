import { createBuildingInstance, createInitialPlayer, createInitialResources } from '../rules';
import { isOrphanedStructure } from '../coreStatus';
import type { EngineHumanPlayer, GameEngineState } from './model';
import { EngineWorldSetup } from './EngineWorldSetup';

let nextRevivedCoreSerial = 1;

export abstract class EngineParticipants extends EngineWorldSetup {


  /** Add a second human to the same authoritative world. The host remains the simulation authority. */
  public override addHumanParticipant(playerId: string, mode: GameEngineState['multiplayerMode'] = this.state.multiplayerMode): EngineHumanPlayer {
    const normalized = playerId.trim();
    if (!normalized) throw new Error('Player ID must not be empty.');
    const existing = this.state.humanPlayers.find(p => p.playerId === normalized);
    if (existing) return existing;
    if (this.state.humanPlayers.length >= 8) throw new Error('This room supports up to eight human participants.');
    this.state.multiplayerMode = mode;
    const index = this.state.humanPlayers.length;
    const groupId = mode === 'COOPERATIVE' ? 'group-host' : `group-${normalized}`;
    const allianceId = mode === 'FREE_FOR_ALL' ? `alliance-${normalized}` : 'alliance-humans';
    const commander = createInitialPlayer(220 + index * 110, 75);
    commander.id = `commander-${normalized}`;
    commander.ownerPlayerId = normalized;
    commander.teamId = groupId;
    commander.allianceId = allianceId;
    commander.angle = Math.PI;
    const coreId = mode === 'COOPERATIVE' ? 'player-core' : `core-${normalized}`;
    if (mode !== 'COOPERATIVE') {
      const core = createBuildingInstance('CORE', 'player', 4 + index * 5, -1, coreId, groupId);
      core.ownerPlayerId = normalized;
      core.coreId = core.id;
      core.allianceId = allianceId;
      this.state.buildings.push(core);
    }
    // Cooperative mode intentionally reuses the original core, but its access remains shared.
    if (mode === 'COOPERATIVE') this.state.buildings.find(b => b.id === 'player-core')!.allianceId = allianceId;
    this.state.entities.push(commander);
    const color = ['#38bdf8', '#fbbf24', '#c084fc', '#fb7185', '#34d399', '#f97316', '#a3e635', '#e879f9'][index % 8];
    const participant: EngineHumanPlayer = { playerId: normalized, commanderId: commander.id, coreId, groupId, allianceId, displayName: index === 0 ? 'Host' : `Guest ${index}`, defeatedAtGameTime: null, color, resources: { ...createInitialResources() }, connected: true, selectedBuildingType: null, selectedStationId: null, aim: { x: commander.x, y: commander.y, gx: 0, gy: 0 }, isAiming: false };
    this.state.humanPlayers.push(participant);
    if (!this.state.groups.some(group => group.id === groupId)) {
      this.state.groups.push({ id: groupId, name: `Outpost ${index + 1}`, commanderName: `PILOT-0${index + 1}`, faction: 'player', allianceId, color });
    }
    this.playerControls.set(normalized, { keys: {}, pointerDown: false, aim: { x: commander.x, y: commander.y, gx: 0, gy: 0 }, selectedBuildingType: null, selectedStationId: null, aiming: false });
    this.triggerStateChange();
    return participant;
  }


  /** Mark a remote participant offline and clear held input so a disconnect cannot leave movement/fire stuck. */
  public override setHumanParticipantConnected(playerId: string, connected: boolean): boolean {
    const participant = this.state.humanPlayers.find(candidate => candidate.playerId === playerId);
    if (!participant) return false;
    participant.connected = connected;
    const control = this.playerControls.get(playerId);
    if (control && !connected) {
      control.keys = {};
      control.pointerDown = false;
      control.aiming = false;
    }
    this.triggerStateChange();
    return true;
  }


  /** Update the validated public name used by the HUD and room chat. */
  public override setHumanParticipantDisplayName(playerId: string, displayName: string): boolean {
    const normalized = displayName.trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > 24 || !/^[\p{L}\p{N} _'-]+$/u.test(normalized)) {
      throw new TypeError('Display name must be 1–24 characters and contain only letters, numbers, spaces, underscores, apostrophes, or hyphens.');
    }
    const participant = this.state.humanPlayers.find(candidate => candidate.playerId === playerId);
    if (!participant) return false;
    participant.displayName = normalized;
    const group = this.state.groups.find(candidate => candidate.id === participant.groupId);
    if (group && this.state.multiplayerMode !== 'COOPERATIVE') group.commanderName = normalized;
    this.triggerStateChange();
    return true;
  }


  /**
   * Revive one defeated participant in an active FFA/TEAM world. A new Core gets
   * a distinct ID; surviving structures owned by the participant are attached to
   * it again. CO-OP shares a single Core, so recovery must create a new world for
   * the whole team instead of pretending one participant can be revived alone.
   */
  public override reviveHumanParticipant(playerId: string): boolean {
    const participant = this.state.humanPlayers.find(candidate => candidate.playerId === playerId && candidate.connected);
    if (!participant) return false;
    if (this.state.multiplayerMode === 'COOPERATIVE') {
      throw new Error('CO-OP uses one shared Core; create a new world to revive the whole team.');
    }
    const currentCore = this.state.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId && building.hp > 0);
    if (currentCore) return false;

    const oldCoreId = participant.coreId;
    const index = Math.max(0, this.state.humanPlayers.findIndex(candidate => candidate.playerId === playerId));
    const coreId = `core-${playerId}-revived-${nextRevivedCoreSerial++}`;
    const commander = createInitialPlayer(220 + index * 110, 75);
    commander.id = participant.commanderId;
    commander.ownerPlayerId = participant.playerId;
    commander.teamId = participant.groupId;
    commander.allianceId = participant.allianceId;

    // Avoid reusing the destroyed Core's ID, and keep the new Core close to the
    // participant's original spawn lane without overlapping a surviving Core.
    let gx = 4 + index * 5;
    const gy = -1;
    while (this.state.buildings.some(building => building.type === 'CORE' &&
      Math.abs(building.gx - gx) < 2 && Math.abs(building.gy - gy) < 2)) gx += 2;
    const core = createBuildingInstance('CORE', 'player', gx, gy, coreId, participant.groupId);
    core.ownerPlayerId = participant.playerId;
    core.coreId = coreId;
    core.teamId = participant.groupId;
    core.allianceId = participant.allianceId;

    this.state.buildings = this.state.buildings.filter(building =>
      !(building.type === 'CORE' && (building.id === oldCoreId || building.ownerPlayerId === playerId))
    );
    for (const building of this.state.buildings) {
      if (building.ownerPlayerId === playerId && building.coreId === oldCoreId) {
        building.coreId = coreId;
        building.allianceId = participant.allianceId;
      }
    }
    this.state.buildings.push(core);
    this.state.entities = this.state.entities.filter(entity => entity.id !== participant.commanderId);
    this.state.entities.push(commander);
    participant.coreId = coreId;
    participant.defeatedAtGameTime = null;
    participant.resources = createInitialResources();
    participant.selectedBuildingType = null;
    participant.selectedStationId = null;
    participant.aim = { x: commander.x, y: commander.y, gx: 0, gy: 0 };
    participant.isAiming = false;
    this.playerControls.set(playerId, {
      keys: {}, pointerDown: false, aim: participant.aim,
      selectedBuildingType: null, selectedStationId: null, aiming: false
    });
    if (playerId === 'player-host') {
      this.state.player = commander;
      this.activePlayerId = 'player-host';
    }
    this.state.isGameOver = false;
    this.triggerStateChange();
    return true;
  }


  /**
   * Remove a disconnected participant from the active room. In CO-OP, player
   * structures, autonomous units, and projectiles are room-owned shared assets;
   * only the disconnected commander's control entity and personal resource ledger
   * leave with the participant. Other modes retain per-player asset cleanup.
   */
  public override removeHumanParticipant(playerId: string): boolean {
    if (!playerId || playerId === 'player-host') return false;
    const index = this.state.humanPlayers.findIndex(candidate => candidate.playerId === playerId);
    if (index < 0) return false;
    const [participant] = this.state.humanPlayers.splice(index, 1);
    this.playerControls.delete(playerId);

    if (this.state.multiplayerMode !== 'COOPERATIVE') {
      const originalBuildings = this.state.buildings;
      this.state.buildings = originalBuildings.filter(building => {
        const belongsToParticipant = building.ownerPlayerId === playerId ||
          building.teamId === participant.groupId || building.coreId === participant.coreId;
        if (!belongsToParticipant) return true;
        if (building.type === 'CORE' || building.hp <= 0) return false;
        if (isOrphanedStructure(building, originalBuildings)) {
          building.ownerPlayerId = undefined;
          return true;
        }
        return false;
      });
      this.state.entities = this.state.entities.filter(entity =>
        entity.id !== participant.commanderId && entity.ownerPlayerId !== playerId &&
        !(entity.faction === 'player' && entity.teamId === participant.groupId)
      );
      this.state.projectiles = this.state.projectiles.filter(projectile =>
        !(projectile.faction === 'player' && projectile.teamId === participant.groupId)
      );
      this.state.groups = this.state.groups.filter(group => group.id !== participant.groupId);
    } else {
      // Cooperative assets are not owned by a connection. Keep them available to
      // the remaining team even when the participant who originally placed them leaves.
      this.state.entities = this.state.entities.filter(entity => entity.id !== participant.commanderId);
    }

    if (this.state.selectedStationId && !this.state.buildings.some(building => building.id === this.state.selectedStationId)) {
      this.state.selectedStationId = null;
    }
    this.triggerStateChange();
    return true;
  }
}
