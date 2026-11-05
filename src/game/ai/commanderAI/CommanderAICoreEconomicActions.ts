import type { Building, GameEntity, ResourceNode, Resources } from '../../types';
import { canAfford, distance, getRepairCost, getBuildingSalvageRefund, collectStationResources, getResourceGridBounds, getResourceNodesInCellBounds, STATION_INTERACTION_RADIUS, GRID_SIZE, MAX_BUILDING_LEVEL, getBuildingUpgradeCost, upgradeBuildingStats, takeWholeResourceBatch } from '../../rules';
import { belongsToTeam, getCombatTeamId } from '../../combat';
import { sound } from '../../audio';
import { applyCommanderUpgradeEffects, getBuildingUpgradeOptions, getRecommendedBuildingUpgradeId } from '../../upgrades/upgradeSystem';
import { isOrphanedStructure } from '../../coreStatus';
import type { CommanderActionFeedback } from './model';
import { CommanderAICombatLayer } from './CommanderAICombatLayer';

export abstract class CommanderAICoreEconomicActions extends CommanderAICombatLayer {

  protected override executeGuardCoreGoal(
    commander: GameEntity,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number
  ) {
    const teamId = getCombatTeamId(commander);
    const core = buildings.find(building => building.type === 'CORE' &&
      building.hp > 0 && belongsToTeam(building, teamId));
    if (!core || core.hp >= core.maxHp) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }
    commander.aiTargetBuildingId = core.id;
    commander.isActivelyMining = false;
    commander.miningProgress = 0;
    commander.miningTargetId = null;
    // Hold a defensive ring around the Core instead of walking onto its footprint.
    // The normal self-defense layer still fires at hostiles that enter weapon range.
    if (distance(commander.x, commander.y, core.x, core.y) > 150) {
      this.moveTowards(commander, core.x, core.y, buildings, resources, dt);
    } else {
      commander.vx = 0;
      commander.vy = 0;
    }
  }

  protected override executeRepairGoal(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const target = buildings.find(b => b.id === commander.aiTargetBuildingId && b.hp > 0);
    if (!target || target.hp >= target.maxHp) {
      commander.aiGoal = 'IDLE';
      return;
    }

    const d = distance(commander.x, commander.y, target.x, target.y);
    if (d > 75) {
      this.moveTowards(commander, target.x, target.y, buildings, resources, dt);
    } else {
      const cost = getRepairCost(target);
      if (canAfford(wallet, cost)) {
        wallet.wood -= cost.wood;
        wallet.stone -= cost.stone;
        wallet.diamonds -= cost.diamonds;
        target.hp = target.maxHp;
        sound.playRepair();
        if (feedback?.onSpark) {
          feedback.onSpark(target.x, target.y, '#f43f5e', 8);
        }
      }
      commander.aiGoal = 'IDLE';
    }
  }

  protected override executeDismantleGoal(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const target = buildings.find(building => building.id === commander.aiTargetBuildingId && isOrphanedStructure(building, buildings));
    if (!target) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }
    if (distance(commander.x, commander.y, target.x, target.y) > 82) {
      this.moveTowards(commander, target.x, target.y, buildings, resources, dt);
      return;
    }
    const refund = getBuildingSalvageRefund(target);
    wallet.wood += refund.wood;
    wallet.stone += refund.stone;
    const index = buildings.findIndex(building => building.id === target.id);
    if (index >= 0) buildings.splice(index, 1);
    commander.aiTargetBuildingId = null;
    commander.aiGoal = 'IDLE';
    commander.aiFailedTargetId = null;
    sound.playBuild();
    feedback?.onSpark?.(target.x, target.y, '#94a3b8', 10);
    feedback?.onFloatingText?.(target.x, target.y - 20, `SALVAGED +${refund.wood} WOOD / +${refund.stone} STONE`, '#cbd5e1');
  }

  protected override executeUpgradeGoal(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const teamId = getCombatTeamId(commander);
    const target = buildings.find(
      building => building.id === commander.aiTargetBuildingId &&
        belongsToTeam(building, teamId) && building.hp > 0 && building.level < MAX_BUILDING_LEVEL
    );
    if (!target) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }

    if (distance(commander.x, commander.y, target.x, target.y) > 120) {
      this.moveTowards(commander, target.x, target.y, buildings, resources, dt);
      return;
    }

    const upgradeId = getRecommendedBuildingUpgradeId(target);
    if (!upgradeId) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }
    const cost = getBuildingUpgradeCost(target, upgradeId);
    if (!canAfford(wallet, cost)) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }

    const selectedUpgrade = getBuildingUpgradeOptions(target).find(option => option.id === upgradeId);
    if (!selectedUpgrade) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }
    const upgraded = upgradeBuildingStats(target, upgradeId);
    if (upgraded.level !== target.level + 1) {
      commander.aiGoal = 'IDLE';
      commander.aiTargetBuildingId = null;
      return;
    }
    const index = buildings.findIndex(building => building.id === target.id);
    if (index !== -1) {
      wallet.wood -= cost.wood;
      wallet.stone -= cost.stone;
      wallet.diamonds = Math.max(0, wallet.diamonds - cost.diamonds);
      // Core options enhance the Commander itself. Structure options affect only
      // the target building. Both paths share this same data-defined upgrade.
      if (target.type === 'CORE') applyCommanderUpgradeEffects(commander, selectedUpgrade);
      // Preserve the structure's identity for any AI index/cache holding this object.
      Object.assign(target, upgraded);
      buildings[index] = target;
      sound.playBuild();
      feedback?.onSpark?.(upgraded.x, upgraded.y, '#f43f5e', 12);
    }
    commander.aiGoal = 'IDLE';
    commander.aiTargetBuildingId = null;
  }

  /**
   * Choose an actually reachable direct-mining target without sorting every
   * resource in the persistent world. The indexed search expands as needed, so
   * a commander can still travel to distant known deposits.
   */
  protected override findDirectMiningTarget(
    commander: GameEntity,
    resources: ResourceNode[],
    buildings: Building[],
    preferredType: ResourceNode['type']
  ): ResourceNode | undefined {
    if (resources.length === 0) return undefined;
    const failedId = (commander.aiFailedTargetCooldown || 0) > 0 ? commander.aiFailedTargetId : undefined;
    const gx = Math.floor(commander.x / GRID_SIZE);
    const gy = Math.floor(commander.y / GRID_SIZE);
    const bounds = getResourceGridBounds(resources);
    let radius = 24;
    let nearest: Array<{ node: ResourceNode; d2: number }> = [];

    while (true) {
      nearest = [];
      for (const node of getResourceNodesInCellBounds(resources, gx - radius, gy - radius, gx + radius, gy + radius, false)) {
        if (node.amount <= 0 || node.id === failedId) continue;
        const dx = node.x - commander.x;
        const dy = node.y - commander.y;
        const d2 = dx * dx + dy * dy;
        const score = Math.sqrt(d2) / Math.max(8, Math.sqrt(node.amount)) + (node.type === preferredType ? 0 : 1000);
        let insertAt = nearest.findIndex(item => {
          const itemScore = Math.sqrt(item.d2) / Math.max(8, Math.sqrt(item.node.amount)) + (item.node.type === preferredType ? 0 : 1000);
          return score < itemScore;
        });
        if (insertAt < 0) insertAt = nearest.length;
        nearest.splice(insertAt, 0, { node, d2 });
        if (nearest.length > 24) nearest.pop();
      }
      const coversWorld = gx - radius <= bounds.minGx && gx + radius >= bounds.maxGx &&
        gy - radius <= bounds.minGy && gy + radius >= bounds.maxGy;
      const farthestCandidate = nearest.length >= 24 ? Math.sqrt(nearest[nearest.length - 1].d2) : Number.POSITIVE_INFINITY;
      if (coversWorld || (nearest.length >= 24 && farthestCandidate <= radius * GRID_SIZE)) break;
      const maxRadius = Math.max(Math.abs(gx - bounds.minGx), Math.abs(gx - bounds.maxGx),
        Math.abs(gy - bounds.minGy), Math.abs(gy - bounds.maxGy), 24);
      if (radius >= maxRadius) break;
      radius = Math.min(maxRadius, radius * 2);
    }

    // Do not run up to 24 full A* searches inside the simulation tick just to
    // validate candidates. Choose by resource utility, then let moveEntityAlongPath
    // validate the actual route asynchronously. Its watchdog cools down a proven
    // unreachable target so the planner can try another deposit rather than loop.
    return nearest[0]?.node;
  }

  /** Direct extraction is allowed; it is not a substitute for station pickup. */

}
