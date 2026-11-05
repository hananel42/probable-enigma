import type { BuildingType } from '../types';
import { GRID_SIZE, isCommanderOperational, snapToGrid } from '../rules';
import { resolveContextBuilding } from '../buildingSelection';
import { EngineCommands } from './EngineCommands';

export abstract class EngineInput extends EngineCommands {


  /** Input state is supplied by a client adapter; simulation never reads DOM events. */
  public override setInputKey(code: string, pressed: boolean) {
    this.keys[code] = pressed;
    const control = this.playerControls.get(this.activePlayerId);
    if (control) control.keys[code] = pressed;
  }


  public override setAimPoint(worldX: number, worldY: number) {
    const snapped = snapToGrid(worldX, worldY, GRID_SIZE);
    this.state.mouseWorld = { x: worldX, y: worldY, gx: snapped.gx, gy: snapped.gy };
    const control = this.playerControls.get(this.activePlayerId); if (control) control.aim = this.state.mouseWorld;
    this.state.isMouseAiming = true;
    const activeControl = this.playerControls.get(this.activePlayerId); if (activeControl) activeControl.aiming = true;
    // React/HUD only needs to refresh when the actual action target changes, not
    // on every pointer-move event. The renderer still reads the current aim each frame.
    const contextBuildingId = resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld)?.id ?? null;
    if (contextBuildingId !== this.lastContextBuildingId) {
      this.lastContextBuildingId = contextBuildingId;
      this.triggerStateChange();
    }
  }


  /** Handle a world-coordinate pointer command from the client. */
  public override handleWorldPointerDown(button: 0 | 2, worldX: number, worldY: number) {
    this.setAimPoint(worldX, worldY);
    if (button === 0) {
      this.isPointerDown = true;
      // Pointer state must be stored per participant, not only in the temporary
      // active-player context. updatePlayer() restores controls from this map
      // every simulation tick; without this assignment clicks never sustain
      // mining or weapon fire (and remote players are affected too).
      const control = this.playerControls.get(this.activePlayerId);
      if (control) control.pointerDown = true;
      if (this.state.selectedBuildingType) {
        this.attemptPlaceSelectedBuilding();
      } else {
        const { gx, gy } = this.state.mouseWorld;
        const clickedBuilding = this.state.buildings.find(building => {
          const width = building.widthInCells || 1;
          const height = building.heightInCells || 1;
          return gx >= building.gx && gx < building.gx + width &&
            gy >= building.gy && gy < building.gy + height && building.hp > 0;
        });
        if (clickedBuilding && (clickedBuilding.type === 'DRONE_STATION' || clickedBuilding.type === 'HARVESTER_STATION')) {
          this.state.selectedStationId = clickedBuilding.id;
        } else {
          this.state.selectedStationId = null;
        }
        // Selection belongs to the active participant. Persist it before the
        // scoped command restores another participant's input context.
        const activeControl = this.playerControls.get(this.activePlayerId);
        if (activeControl) activeControl.selectedStationId = this.state.selectedStationId;
        this.triggerStateChange();
      }
    } else {
      this.cancelSelection();
    }
  }


  public override handleWorldPointerUp(button: 0 | 2) {
    if (button === 0) {
      this.isPointerDown = false;
      const control = this.playerControls.get(this.activePlayerId);
      if (control) control.pointerDown = false;
    }
  }


  public override cancelSelection() {
    this.state.selectedBuildingType = null;
    this.state.selectedStationId = null;
    this.isPointerDown = false;
    const control = this.playerControls.get(this.activePlayerId);
    if (control) {
      control.pointerDown = false;
      control.selectedBuildingType = null;
      control.selectedStationId = null;
    }
    this.triggerStateChange();
  }


  public override selectBuilding(type: BuildingType | null) {
    if (!isCommanderOperational(this.state.player)) return;
    this.state.selectedBuildingType = this.state.selectedBuildingType === type ? null : type;
    // Construction selection and pad configuration are mutually exclusive:
    // selecting a build hotkey must not leave an old Drone Station target active.
    this.state.selectedStationId = null;
    const control = this.playerControls.get(this.activePlayerId);
    if (control) {
      control.selectedBuildingType = this.state.selectedBuildingType;
      control.selectedStationId = null;
    }
    this.triggerStateChange();
  }
}
