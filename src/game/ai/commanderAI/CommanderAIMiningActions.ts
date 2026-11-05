import type { Building, GameEntity, ResourceNode, Resources } from '../../types';
import { canAfford, distance, getRepairCost, getBuildingSalvageRefund, collectStationResources, getResourceGridBounds, getResourceNodesInCellBounds, STATION_INTERACTION_RADIUS, GRID_SIZE, MAX_BUILDING_LEVEL, getBuildingUpgradeCost, upgradeBuildingStats, takeWholeResourceBatch } from '../../rules';
import { findPath } from '../../pathfinding';
import { belongsToTeam, getCombatTeamId } from '../../combat';
import { sound } from '../../audio';
import { applyCommanderUpgradeEffects, getBuildingUpgradeOptions, getRecommendedBuildingUpgradeId } from '../../upgrades/upgradeSystem';
import { isOrphanedStructure } from '../../coreStatus';
import type { CommanderActionFeedback } from './model';
import { CommanderAICoreEconomicActions } from './CommanderAICoreEconomicActions';

export abstract class CommanderAIMiningActions extends CommanderAICoreEconomicActions {

protected override executeCollectResourcesGoal(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const target = buildings.find(building =>
      building.id === commander.aiTargetBuildingId &&
      building.type === 'HARVESTER_STATION' &&
      building.hp > 0 &&
      ((building.storedWood || 0) > 0 || (building.storedStone || 0) > 0)
    );
    commander.isActivelyMining = false;
    commander.miningProgress = 0;
    if (!target) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }

    if (distance(commander.x, commander.y, target.x, target.y) > STATION_INTERACTION_RADIUS) {
      this.moveTowards(commander, target.x, target.y, buildings, resources, dt);
      return;
    }

    const collected = collectStationResources(target, wallet);
    if (collected.wood > 0 || collected.stone > 0) {
      sound.playMine();
      feedback?.onSpark?.(target.x, target.y, '#4ade80', 8);
      const parts = [];
      if (collected.wood > 0) parts.push(`+${collected.wood} WOOD`);
      if (collected.stone > 0) parts.push(`+${collected.stone} STONE`);
      feedback?.onFloatingText?.(target.x, target.y - 20, `COLLECTED ${parts.join(' / ')}`, '#4ade80');
    }
    commander.aiGoal = 'IDLE';
    commander.aiTargetBuildingId = null;
  }

/** Direct extraction is allowed; it is not a substitute for station pickup. */
  protected override executeMiningGoal(
    commander: GameEntity,
    wallet: Resources,
    resources: ResourceNode[],
    buildings: Building[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const target = resources.find(node => node.id === commander.aiTargetResourceId && node.amount > 0);
    if (!target) {
      commander.isActivelyMining = false;
      commander.miningProgress = 0;
      commander.miningTargetId = null;
      commander.aiGoal = 'IDLE';
      commander.aiTargetResourceId = null;
      return;
    }

    if (distance(commander.x, commander.y, target.x, target.y) > 68) {
      commander.isActivelyMining = false;
      commander.miningProgress = 0;
      this.moveTowards(commander, target.x, target.y, buildings, resources, dt);
      return;
    }

    commander.isActivelyMining = true;
    commander.miningTargetId = target.id;
    commander.angle = Math.atan2(target.y - commander.y, target.x - commander.x);
    commander.miningProgress = (commander.miningProgress || 0) + Math.max(0, dt) * Math.max(0.25, commander.miningSpeedMultiplier || 1) / 2;
    if (commander.miningProgress < 1) return;

    const amount = takeWholeResourceBatch(target, 15 * Math.max(0.25, commander.miningYieldMultiplier || 1));
    wallet[target.type] += amount;
    commander.miningProgress = 0;
    commander.isActivelyMining = false;
    commander.miningTargetId = null;
    commander.aiGoal = 'IDLE';
    commander.aiTargetResourceId = null;
    sound.playMine();
    feedback?.onSpark?.(target.x, target.y, '#f59e0b', 8);
    feedback?.onFloatingText?.(target.x, target.y - 20, `+${amount} ${target.type.toUpperCase()}`, '#fbbf24');
  }
}
