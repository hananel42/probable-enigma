import type { BuildingType } from '../types';
import type { BuildingModule } from './types';
import { coreModule } from './core';
import { wallModule } from './wall';
import { autoTurretModule } from './autoTurret';
import { harvesterStationModule } from './harvesterStation';
import { droneStationModule } from './droneStation';
import { fireTowerModule } from './fireTower';

/**
 * Closed, compile-time list of the game's built-in building types. Each type's
 * definition, behavior, upgrades, inspection and renderer live in its own folder.
 * This is not a runtime plugin registry; adding/removing a type is a source-code change.
 */
export const BUILDING_MODULES: Record<BuildingType, BuildingModule> = {
  CORE: coreModule,
  WALL: wallModule,
  AUTO_TURRET: autoTurretModule,
  HARVESTER_STATION: harvesterStationModule,
  DRONE_STATION: droneStationModule,
  FIRE_TOWER: fireTowerModule
};

export function getBuildingModule(type: BuildingType): BuildingModule {
  return BUILDING_MODULES[type];
}
