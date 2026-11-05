import type { Building, DroneStationMode } from '../types';
import { BUILDING_BLUEPRINTS, canAfford, createBuildingInstance, deductCost, GRID_SIZE, isAreaBuildable, isCommanderOperational, snapToGrid } from '../rules';
import { sound } from '../audio';
import { canManagePlayerStructure } from '../multiplayer/structureAccess';
import { isBuildingOperational } from '../coreStatus';
import { resolveContextBuilding } from '../buildingSelection';
import { EngineInput } from './EngineInput';

export abstract class EnginePlacement extends EngineInput {


  protected override canUsePlayerStructure(building: Building): boolean {
    return canManagePlayerStructure(this.activePlayerId, this.state.multiplayerMode, building);
  }


  /** Change doctrine only for the standard context-selected Drone Station. */
  public override setDroneStationMode(stationId: string, mode: DroneStationMode) {
    if (!isCommanderOperational(this.state.player)) return;
    const contextStation = resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld);
    if (!contextStation || contextStation.id !== stationId || contextStation.type !== 'DRONE_STATION') return;
    const station = this.state.buildings.find(building =>
      building.id === stationId && building.type === 'DRONE_STATION' && building.hp > 0 &&
      isBuildingOperational(building, this.state.buildings) && this.canUsePlayerStructure(building)
    );
    if (!station) return;
    station.droneMode = mode;
    station.escortCommanderId = mode === 'ESCORT' ? this.activePlayerId : undefined;
    sound.playMine();
    this.triggerStateChange();
  }


  /** C toggles the station selected by the shared hover/nearest-in-range rule. */
  public override attemptToggleDroneMode() {
    if (!isCommanderOperational(this.state.player)) return;
    const target = resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld);
    if (!target || target.type !== 'DRONE_STATION' || target.hp <= 0 ||
        !isBuildingOperational(target, this.state.buildings) || !this.canUsePlayerStructure(target)) return;
    const nextMode: DroneStationMode = target.droneMode === 'DEFENSE' ? 'ESCORT' : 'DEFENSE';
    this.setDroneStationMode(target.id, nextMode);
  }


  public override attemptPlaceSelectedBuilding() {
    if (!isCommanderOperational(this.state.player)) {
      this.state.selectedBuildingType = null;
      this.isPointerDown = false;
      this.triggerStateChange();
      return;
    }
    const type = this.state.selectedBuildingType;
    if (!type || type === 'CORE') return;

    const bp = BUILDING_BLUEPRINTS[type];
    let targetGx = this.state.mouseWorld.gx;
    let targetGy = this.state.mouseWorld.gy;

    if (!this.state.isMouseAiming) {
      const forwardX = this.state.player.x + Math.cos(this.state.player.angle) * 65;
      const forwardY = this.state.player.y + Math.sin(this.state.player.angle) * 65;
      const snapped = snapToGrid(forwardX, forwardY, GRID_SIZE);
      targetGx = snapped.gx;
      targetGy = snapped.gy;
    }

    if (!canAfford(this.state.resources, bp.cost)) {
      this.addFloatingText(this.state.player.x, this.state.player.y - 25, 'NOT ENOUGH RESOURCES!', '#f43f5e');
      sound.playHit();
      return;
    }

    if (!isAreaBuildable(targetGx, targetGy, bp.widthInCells, bp.heightInCells, this.state.buildings, this.state.resourceNodes)) {
      this.addFloatingText(this.state.player.x, this.state.player.y - 25, 'CELL BLOCKED BY OBSTACLE!', '#f43f5e');
      sound.playHit();
      return;
    }

    const unitInFootprint = this.state.entities.some(entity => {
      if (entity.hp <= 0 || entity.isDead) return false;
      const gx = Math.floor(entity.x / GRID_SIZE);
      const gy = Math.floor(entity.y / GRID_SIZE);
      return gx >= targetGx && gx < targetGx + bp.widthInCells && gy >= targetGy && gy < targetGy + bp.heightInCells;
    });
    if (unitInFootprint) {
      this.addFloatingText(this.state.player.x, this.state.player.y - 25, 'MOVE UNITS BEFORE BUILDING', '#f43f5e');
      return;
    }

    // Resolve ownership before charging resources so broken participant state
    // cannot spend resources and then leave a structure attached to the wrong Core.
    const ownerParticipant = this.state.humanPlayers.find(p => p.playerId === this.activePlayerId);
    if (!ownerParticipant) {
      throw new Error(`Cannot place building: active participant '${this.activePlayerId}' is not registered.`);
    }
    // Deduct cost and place.
    this.setActivePlayerResources(deductCost(this.state.resources, bp.cost));
    const newBuilding = createBuildingInstance(type, 'player', targetGx, targetGy, undefined, this.state.player.teamId || 'group-host');
    newBuilding.ownerPlayerId = this.activePlayerId;
    newBuilding.coreId = ownerParticipant.coreId;
    newBuilding.allianceId = this.state.player.allianceId || this.state.player.teamId || 'player';
    this.state.buildings.push(newBuilding);

    sound.playBuild();
    this.createSparks(newBuilding.x, newBuilding.y, '#38bdf8', 12);

    this.triggerStateChange();
  }
}
