import test from 'node:test';
import assert from 'node:assert';
import {
  GRID_SIZE,
  BUILDING_BLUEPRINTS,
  snapToGrid,
  canAfford,
  deductCost,
  getRepairCost,
  getBuildingUpgradeCost,
  getBuildingSalvageRefund,
  repairBuilding,
  upgradeBuildingStats,
  isCellBlockedForGround,
  isCellBlockedForAir,
  isCellInsideBuildingFootprint,
  isCellBuildable,
  isAreaBuildable,
  createBuildingInstance,
  createCombatDrone,
  createHarvesterBot,
  createCommander,
  collectStationResources,
  findFreeAdjacentSpawnPosition,
  getBuildingOccupiedCells,
  getBuildingCandidatesInCellBounds,
  takeWholeResourceBatch,
  isCommanderOperational
} from './rules';
import { Building, EnemyBase, GameGroup, Projectile, ResourceNode, Resources } from './types';
import { findPath } from './pathfinding';
import { applyBuildingDamage, applyEntityDamage, areHostile, findClosestHostileEntity, findPriorityHostileTarget, getProjectileDodgeDirection, isProjectileHostileTo } from './combat';
import { BUILDING_CATALOG, BUILDING_COMBAT_PROFILES } from './content/buildingCatalog';
import { ENTITY_CATALOG, ENTITY_COMBAT_PROFILES } from './content/entityCatalog';
import { DroneAI } from './ai/droneAI';
import { resolveDroneAIState } from './ai/droneStateMachine';
import { LocalGameServer } from './server/LocalGameServer';
import { generateProceduralEnemyBase } from './world';
import { HarvesterAI } from './ai/harvesterAI';
import { CommanderAI } from './ai/commanderAI';
import { advanceEmbeddedEntityRecovery, getSmoothEmbeddedRecoveryTarget, isEntityPathPending, moveEntityAlongPath, moveEntityTowardSmoothly, recoverEmbeddedEntity } from './movement';
import { EnemyCommanderAI, enemyCommanderAI, getFortressBlueprint } from './ai/enemyCommanderAI';
import { BUILDING_UPGRADE_TREES } from './upgrades/upgradeCatalog';
import { applyCommanderUpgradeEffects, getAppliedUpgradeNames, getBuildingStatLines, getBuildingUpgradeOptions, getRecommendedBuildingUpgradeId, getUpgradeOptionForHotkey } from './upgrades/upgradeSystem';
import { shouldDrawRangePreview } from './drawers/effectDrawer';
import { BUILDING_MODULES } from './buildings/registry';
import { isBuildingOperational, isOrphanedStructure } from './coreStatus';
import { buildingDrawer } from './drawers/buildingDrawer';
import { GameEngine } from './engine';
import { WorkerTaskScheduler } from './runtime/workerTaskScheduler';


/** Add a distant live Core so tests of a standalone station exercise its active behavior. */
export function operationalBuildingSet(building: Building): Building[] {
  const teamId = building.teamId || building.faction;
  const core = createBuildingInstance(
    'CORE', building.faction, building.gx + 50, building.gy + 50,
    `test-live-core-${building.id}`, teamId
  );
  core.coreId = core.id;
  return [core, building];
}

export function createTestEnemyBase(id: string, stance: EnemyBase['stance']): EnemyBase {
  return {
    id,
    teamId: id,
    gx: 0,
    gy: 0,
    x: 24,
    y: 24,
    coreId: `${id}-core`,
    commanderId: `${id}-commander`,
    level: 2,
    raidTimer: 999,
    raidInterval: 999,
    isDestroyed: false,
    resources: { wood: 0, stone: 0, diamonds: 0 },
    buildTimer: 999,
    repairTimer: 999,
    stance
  };
}


export {
  test,
  assert,
  GRID_SIZE,
  BUILDING_BLUEPRINTS,
  snapToGrid,
  canAfford,
  deductCost,
  getRepairCost,
  getBuildingUpgradeCost,
  getBuildingSalvageRefund,
  repairBuilding,
  upgradeBuildingStats,
  isCellBlockedForGround,
  isCellBlockedForAir,
  isCellInsideBuildingFootprint,
  isCellBuildable,
  isAreaBuildable,
  createBuildingInstance,
  createCombatDrone,
  createHarvesterBot,
  createCommander,
  collectStationResources,
  findFreeAdjacentSpawnPosition,
  getBuildingOccupiedCells,
  getBuildingCandidatesInCellBounds,
  takeWholeResourceBatch,
  isCommanderOperational,
  findPath,
  applyBuildingDamage,
  applyEntityDamage,
  areHostile,
  findClosestHostileEntity,
  findPriorityHostileTarget,
  getProjectileDodgeDirection,
  isProjectileHostileTo,
  BUILDING_CATALOG,
  BUILDING_COMBAT_PROFILES,
  ENTITY_CATALOG,
  ENTITY_COMBAT_PROFILES,
  DroneAI,
  resolveDroneAIState,
  LocalGameServer,
  generateProceduralEnemyBase,
  HarvesterAI,
  CommanderAI,
  advanceEmbeddedEntityRecovery,
  getSmoothEmbeddedRecoveryTarget,
  isEntityPathPending,
  moveEntityAlongPath,
  moveEntityTowardSmoothly,
  recoverEmbeddedEntity,
  EnemyCommanderAI,
  enemyCommanderAI,
  getFortressBlueprint,
  BUILDING_UPGRADE_TREES,
  applyCommanderUpgradeEffects,
  getAppliedUpgradeNames,
  getBuildingStatLines,
  getBuildingUpgradeOptions,
  getRecommendedBuildingUpgradeId,
  getUpgradeOptionForHotkey,
  shouldDrawRangePreview,
  BUILDING_MODULES,
  isBuildingOperational,
  isOrphanedStructure,
  buildingDrawer,
  GameEngine,
  WorkerTaskScheduler
};
export type { Building, EnemyBase, GameGroup, Projectile, ResourceNode, Resources };
