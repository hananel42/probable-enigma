import { GRID_SIZE, snapToGrid } from '../rules';
import type { EngineHumanPlayer, GameEngineState } from './model';
import { EngineParticipants } from './EngineParticipants';

export abstract class EngineCommands extends EngineParticipants {


  /** Execute a command in the named participant's input/resource context. */
  public override dispatchForPlayer(playerId: string, command: { type: string; [key: string]: unknown }, execute: () => void): boolean {
    const participant = this.state.humanPlayers.find(p => p.playerId === playerId && p.connected);
    const participantCore = participant && this.state.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId && building.hp > 0);
    if (command.type === 'RESTART') {
      // Restart is a room-level command, not a Commander action. A defeated
      // host has intentionally been removed from the renderable entity list,
      // so requiring a live Commander here would make the valid restart path
      // impossible after the final Core is destroyed. Suppress intermediate
      // state notifications while the new room is being assembled, then publish
      // exactly one coherent frame containing every preserved participant.
      if (playerId !== 'player-host' || !participant || !this.canRestartGame()) return false;
      this.scopedCommandDepth += 1;
      try {
        execute();
      } finally {
        this.scopedCommandDepth -= 1;
        if (this.scopedCommandDepth === 0 && !this.updatingHumanPlayers && this.pendingStateChange) {
          this.pendingStateChange = false;
          this.triggerStateChange();
        }
      }
      return true;
    }
    if (!participant || !participantCore) return false;
    const commander = this.state.entities.find(e => e.id === participant.commanderId && e.hp >= 0);
    const control = this.playerControls.get(playerId);
    if (!participant || !commander || !control) return false;
    const previous = { player: this.state.player, resources: this.state.resources, keys: this.keys, pointerDown: this.isPointerDown, aim: this.state.mouseWorld, selectedBuildingType: this.state.selectedBuildingType, selectedStationId: this.state.selectedStationId, isMouseAiming: this.state.isMouseAiming, activePlayerId: this.activePlayerId };
    this.state.player = commander;
    this.state.resources = participant.resources;
    this.keys = control.keys;
    this.isPointerDown = control.pointerDown;
    this.state.mouseWorld = control.aim;
    this.state.selectedBuildingType = control.selectedBuildingType;
    this.state.selectedStationId = control.selectedStationId;
    this.state.isMouseAiming = control.aiming;
    this.activePlayerId = playerId;
    this.scopedCommandDepth += 1;
    try { execute(); }
    finally {
      participant.resources = this.state.resources; participant.selectedBuildingType = this.state.selectedBuildingType; participant.selectedStationId = this.state.selectedStationId; participant.aim = this.state.mouseWorld; participant.isAiming = this.state.isMouseAiming;
      control.keys = this.keys; control.pointerDown = this.isPointerDown; control.aim = this.state.mouseWorld;
      control.selectedBuildingType = this.state.selectedBuildingType; control.selectedStationId = this.state.selectedStationId; control.aiming = this.state.isMouseAiming;
      // The public snapshot/HUD is the host player's view. Do not restore stale
      // global selection fields captured before a scoped command: selection and
      // aim live in per-player controls, and restoring the old null selection
      // made newly selected buildings disappear from the build preview/HUD.
      const restorePlayerId = this.scopedCommandDepth > 1 ? previous.activePlayerId : 'player-host';
      const restoreParticipant = this.state.humanPlayers.find(p => p.playerId === restorePlayerId);
      const restoreCommander = restoreParticipant
        ? this.state.entities.find(entity => entity.id === restoreParticipant.commanderId)
        : undefined;
      const restoreControl = this.playerControls.get(restorePlayerId);
      this.state.player = restoreCommander || previous.player;
      this.state.resources = restoreParticipant?.resources || previous.resources;
      this.keys = restoreControl?.keys || previous.keys;
      this.isPointerDown = restoreControl?.pointerDown ?? previous.pointerDown;
      this.state.mouseWorld = restoreControl?.aim || previous.aim;
      this.state.selectedBuildingType = restoreControl ? restoreControl.selectedBuildingType : previous.selectedBuildingType;
      this.state.selectedStationId = restoreControl ? restoreControl.selectedStationId : previous.selectedStationId;
      this.state.isMouseAiming = restoreControl?.aiming ?? previous.isMouseAiming;
      this.activePlayerId = restorePlayerId;
      this.scopedCommandDepth = Math.max(0, this.scopedCommandDepth - 1);
      if (this.scopedCommandDepth === 0 && !this.updatingHumanPlayers && this.pendingStateChange) { this.pendingStateChange = false; this.triggerStateChange(); }
    }
    return true;
  }


  public override setPlayerInputKey(playerId: string, code: string, pressed: boolean): boolean {
    const participant = this.state.humanPlayers.find(candidate => candidate.playerId === playerId && candidate.connected);
    if (!participant || this.isParticipantDefeated(playerId)) return false;
    const control = this.playerControls.get(playerId);
    if (!control) return false;
    control.keys[code] = pressed;
    if (playerId === 'player-host') this.keys[code] = pressed;
    return true;
  }


  public override setPlayerAimPoint(playerId: string, worldX: number, worldY: number): boolean {
    const control = this.playerControls.get(playerId);
    if (!control || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    const snapped = snapToGrid(worldX, worldY, GRID_SIZE);
    control.aim = { x: worldX, y: worldY, gx: snapped.gx, gy: snapped.gy };
    if (playerId === 'player-host') this.state.mouseWorld = control.aim;
    return true;
  }


  public override setOnStateChange(callback: (state: GameEngineState) => void) {
    this.onStateChangeCallback = callback;
  }
}
