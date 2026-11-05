import type { Building, BuildingType, EnemyBase, GameEntity, ResourceNode, Resources } from '../../types';
import { BUILDING_BLUEPRINTS, canAfford, distance, getRepairCost, MAX_BUILDING_LEVEL, getBuildingUpgradeCost } from '../../rules';
import { belongsToTeam, findPriorityHostileTarget, getCombatTeamId } from '../../combat';
import { getRecommendedBuildingUpgradeId } from '../../upgrades/upgradeSystem';
import { isBuildingOperational, isOrphanedStructure } from '../../coreStatus';
import { assignMiningGoal } from './model';
import { CommanderAIBuildingActions } from './CommanderAIBuildingActions';

export abstract class CommanderAIPlanning extends CommanderAIBuildingActions {

  protected override evaluateCommanderGoals(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    allEntities: GameEntity[],
    enemyBases: EnemyBase[]
  ) {
    const teamId = getCombatTeamId(commander);
    const homeBase = enemyBases.find(base => (base.teamId || base.id) === teamId);
    const ownBuildings = buildings.filter(building => belongsToTeam(building, teamId) && building.hp > 0);
    const homeCore = ownBuildings.find(building => building.type === 'CORE' && building.hp > 0);
    const coreDamaged = Boolean(homeCore && homeCore.hp < homeCore.maxHp);
    const isAssaulting = homeBase?.stance === 'ASSAULT';
    const nearbyThreat = findPriorityHostileTarget(
      commander, allEntities, buildings, isAssaulting ? Number.POSITIVE_INFINITY : 420,
      (commander.aiFailedTargetCooldown || 0) > 0 ? commander.aiFailedTargetId : undefined
    );
    const threatIsImmediate = Boolean(nearbyThreat && nearbyThreat.distance <= 290);

    // Core repair is a strategic emergency. Do not launch or continue an assault
    // while the home Core is damaged; if affordable, commit directly to repairing it.
    if (coreDamaged && homeCore && canAfford(wallet, getRepairCost(homeCore))) {
      commander.aiGoal = 'REPAIR_STRUCTURE';
      commander.aiTargetBuildingId = homeCore.id;
      commander.aiTargetEntityId = null;
      commander.aiTargetResourceId = null;
      commander.aiTargetBuildingId = homeCore.id;
      commander.aiBuildType = null;
      return;
    }

    // If the Core is damaged but the commander cannot yet afford its repair,
    // protect it from attackers already threatening the core area before gathering
    // more resources. This is a defensive interception, not an assault order.
    const coreDefenseTarget = homeCore
      ? findPriorityHostileTarget(homeCore, allEntities, buildings, 390,
          (commander.aiFailedTargetCooldown || 0) > 0 ? commander.aiFailedTargetId : undefined)
      : undefined;
    if (coreDamaged && homeCore && !canAfford(wallet, getRepairCost(homeCore)) && coreDefenseTarget) {
      commander.aiGoal = 'ATTACK_TARGET';
      commander.aiTargetEntityId = coreDefenseTarget.kind === 'ENTITY' ? coreDefenseTarget.entity.id : null;
      commander.aiTargetBuildingId = coreDefenseTarget.kind === 'BUILDING' ? coreDefenseTarget.building.id : null;
      commander.aiTargetResourceId = null;
      commander.aiBuildType = null;
      return;
    }

    // If the Core is damaged but cannot yet be repaired, economic recovery is
    // the next priority once nearby threats have been handled. The Core is the
    // repair target, so do not spend scarce materials on new structures/upgrades;
    // collect stored station stock or mine only within the local defensive area.
    // This branch is deliberately before construction so building can never
    // consume resources that are needed to restore the Core.

    // Combat interrupts economic work. Assaults commit to a meaningful target;
    // defense only pursues targets that threaten the outpost or enter close range.
    const shouldEngage = Boolean(homeCore && !coreDamaged && nearbyThreat && (
      isAssaulting ||
      homeBase?.stance === 'DEFENDING' ||
      threatIsImmediate ||
      nearbyThreat.distance < Math.min(480, (commander.range || 320) * 1.2)
    ));
    if (shouldEngage) {
      commander.aiGoal = 'ATTACK_TARGET';
      commander.aiTargetEntityId = nearbyThreat!.kind === 'ENTITY' ? nearbyThreat!.entity.id : null;
      commander.aiTargetBuildingId = nearbyThreat!.kind === 'BUILDING' ? nearbyThreat!.building.id : null;
      commander.aiTargetResourceId = null;
      commander.aiBuildType = null;
      return;
    }

    // Repair priority is strategic: a weakened Core is more valuable than a
    // badly damaged wall, then active defenses, industry, and ordinary barriers.
    const repairCandidates = ownBuildings
      .filter(building => isBuildingOperational(building, buildings) && (!coreDamaged || building.type === 'CORE') && building.hp < building.maxHp && !(commander.aiFailedTargetCooldown && building.id === commander.aiFailedTargetId))
      .map(building => {
        const missing = Math.max(0, 1 - building.hp / Math.max(1, building.maxHp));
        let score = missing * 10;
        if (building.type === 'CORE') score += 100 + (building.hp / building.maxHp < 0.72 ? 13 : 4);
        if (building.type === 'AUTO_TURRET' || building.type === 'FIRE_TOWER') score += 5;
        if (building.type === 'DRONE_STATION') score += 3.5;
        if (building.type === 'HARVESTER_STATION') score += 2.5;
        if (nearbyThreat && distance(building.x, building.y,
            nearbyThreat.kind === 'ENTITY' ? nearbyThreat.entity.x : nearbyThreat.building.x,
            nearbyThreat.kind === 'ENTITY' ? nearbyThreat.entity.y : nearbyThreat.building.y) < 280) {
          score += building.type === 'CORE' ? 6 : (building.type === 'AUTO_TURRET' || building.type === 'FIRE_TOWER' ? 4 : 0);
        }
        return { building, score, cost: getRepairCost(building) };
      })
      .filter(item => canAfford(wallet, item.cost))
      .sort((a, b) => b.score - a.score);
    if (repairCandidates.length) {
      commander.aiGoal = 'REPAIR_STRUCTURE';
      commander.aiTargetBuildingId = repairCandidates[0].building.id;
      commander.aiTargetEntityId = null;
      return;
    }

    // Salvage inert structures left behind by destroyed Cores. Any commander may
    // dismantle them, and the recovered materials go to that commander's own wallet.
    const salvageTarget = buildings
      .filter(building => isOrphanedStructure(building, buildings) &&
        (!homeCore || distance(commander.x, commander.y, building.x, building.y) <= 360) &&
        !(commander.aiFailedTargetCooldown && building.id === commander.aiFailedTargetId))
      .map(building => ({ building, distance: distance(commander.x, commander.y, building.x, building.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (salvageTarget && (!coreDamaged || !homeCore || !canAfford(wallet, getRepairCost(homeCore)))) {
      commander.aiGoal = 'DISMANTLE_STRUCTURE';
      commander.aiTargetBuildingId = salvageTarget.building.id;
      commander.aiTargetEntityId = null;
      commander.aiTargetResourceId = null;
      commander.aiBuildType = null;
      return;
    }

    // Station stockpiles are collected through the same physical interaction as
    // the player. This complements the commander's own direct mining. Also empty
    // a saturated station even when its current resource is not the largest
    // wallet deficit; otherwise its haulers can become permanently blocked.
    const woodNeed = Math.max(0, 190 - wallet.wood);
    const stoneNeed = Math.max(0, 190 - wallet.stone);
    const collectionTarget = ownBuildings
      .filter(building => isBuildingOperational(building, buildings) && building.type === 'HARVESTER_STATION' &&
        ((building.storedWood || 0) > 0 || (building.storedStone || 0) > 0))
      .map(building => {
        const storedWood = building.storedWood || 0;
        const storedStone = building.storedStone || 0;
        const usefulResources = Math.min(woodNeed, storedWood) + Math.min(stoneNeed, storedStone);
        const capacity = building.maxCapacity || 75;
        const atCapacity = storedWood >= capacity || storedStone >= capacity;
        return {
          building,
          usefulResources,
          atCapacity,
          distance: distance(commander.x, commander.y, building.x, building.y)
        };
      })
      .filter(candidate => candidate.usefulResources > 0 || candidate.atCapacity)
      .sort((a, b) => Number(b.atCapacity) - Number(a.atCapacity) ||
        b.usefulResources - a.usefulResources || a.distance - b.distance)[0];

    if (collectionTarget) {
      commander.aiGoal = 'COLLECT_RESOURCES';
      commander.aiTargetBuildingId = collectionTarget.building.id;
      commander.aiTargetEntityId = null;
      commander.aiTargetResourceId = null;
      commander.aiBuildType = null;
      return;
    }

    if (coreDamaged && homeCore) {
      const repairCost = getRepairCost(homeCore);
      const woodNeed = Math.max(0, repairCost.wood - wallet.wood);
      const stoneNeed = Math.max(0, repairCost.stone - wallet.stone);
      if (woodNeed > 0 || stoneNeed > 0) {
        const localResources = resources.filter(node => node.amount > 0 &&
          distance(node.x, node.y, homeCore.x, homeCore.y) <= 520);
        const neededTypes = [
          { type: 'wood' as const, need: woodNeed },
          { type: 'stone' as const, need: stoneNeed }
        ].filter(item => item.need > 0).sort((a, b) => b.need - a.need);
        let node: ResourceNode | undefined;
        for (const needed of neededTypes) {
          node = this.findDirectMiningTarget(
            commander, localResources.filter(candidate => candidate.type === needed.type), buildings, needed.type
          );
          if (node) break;
        }
        if (node) {
          assignMiningGoal(commander, node);
          return;
        }
      }
      // If the local resource field is exhausted or unreachable, hold close to
      // the Core rather than wandering away. The next planning tick retries.
      commander.aiGoal = 'GUARD_CORE';
      commander.aiTargetEntityId = null;
      commander.aiTargetBuildingId = homeCore.id;
      commander.aiTargetResourceId = null;
      commander.aiBuildType = null;
      commander.isActivelyMining = false;
      commander.miningProgress = 0;
      commander.miningTargetId = null;
      return;
    }

    const counts = (type: Building['type']) => ownBuildings.filter(building => building.type === type).length;
    const activeEnemyBaseCount = enemyBases.filter(base => !base.isDestroyed && (base.teamId || base.id) !== teamId).length;
    const pressure = homeBase?.stance === 'DEFENDING' || Boolean(nearbyThreat && nearbyThreat.distance < 560);
    const baseLevel = homeBase?.level || 1;
    const desiredTurrets = Math.min(6, 2 + Math.floor(baseLevel / 2) + (pressure ? 1 : 0));
    const desiredWalls = Math.min(20, 6 + baseLevel * 2);
    const resourceShortage = wallet.wood < 135 || wallet.stone < 135;
    const harvesterCount = counts('HARVESTER_STATION');
    // One station is the first economic milestone. Additional stations are an
    // expansion investment, not a reaction to being poor: build them only after
    // the first is online, the base has grown, and the wallet can afford the
    // investment without consuming its defensive reserve.
    const hasOperationalHarvester = ownBuildings.some(building => building.type === 'HARVESTER_STATION' &&
      isBuildingOperational(building, buildings));
    const desiredHarvesters = harvesterCount === 0 ? 1
      : (baseLevel >= 7 && harvesterCount < 3 && !pressure && wallet.wood >= 350 && wallet.stone >= 350) ? 3
      : (baseLevel >= 4 && harvesterCount < 2 && hasOperationalHarvester && !pressure && wallet.wood >= 220 && wallet.stone >= 220) ? 2
      : harvesterCount;
    const desiredDroneStations = baseLevel >= 5 && !resourceShortage && !pressure ? 2 : 1;

    // A scored construction queue adapts to combat pressure, economic health, and
    // base growth. Later outposts expand both production and force projection.
    const buildOptions: Array<{ type: Exclude<BuildingType, 'CORE'>; priority: number }> = [];
    if (counts('HARVESTER_STATION') < desiredHarvesters) {
      buildOptions.push({ type: 'HARVESTER_STATION', priority: counts('HARVESTER_STATION') === 0 ? (pressure ? 18 : 32) : 9 });
    }
    if (counts('DRONE_STATION') < desiredDroneStations) {
      buildOptions.push({ type: 'DRONE_STATION', priority: pressure ? 15 : 12 });
    }
    if (counts('AUTO_TURRET') < desiredTurrets) buildOptions.push({ type: 'AUTO_TURRET', priority: pressure ? 24 : 10 });
    if (counts('FIRE_TOWER') < Math.min(2, Math.floor((homeBase?.level || 1) / 2)) && (homeBase?.level || 1) >= 2) {
      buildOptions.push({ type: 'FIRE_TOWER', priority: pressure ? 17 : 8 });
    }
    if (counts('WALL') < desiredWalls) buildOptions.push({ type: 'WALL', priority: pressure ? 7 : 2 });

    const reserve = pressure ? 0 : resourceShortage ? 35 : (activeEnemyBaseCount > 0 ? 60 : 90);
    const affordableBuild = buildOptions
      .filter(option => {
        const cost = BUILDING_BLUEPRINTS[option.type].cost;
        return canAfford(wallet, cost) && wallet.wood - cost.wood >= reserve && wallet.stone - cost.stone >= reserve;
      })
      .sort((a, b) => b.priority - a.priority)[0];

    // Compare affordable construction against upgrades instead of always building
    // a new structure first. This permits sensible investment and saving, while a
    // missing first harvester remains the strongest non-emergency economic choice.
    const walletIsPoor = wallet.wood < 175 || wallet.stone < 175;
    const hasHarvesterStation = counts('HARVESTER_STATION') > 0;
    const upgradeCandidate = ownBuildings
      .filter(building => isBuildingOperational(building, buildings) && building.level < MAX_BUILDING_LEVEL &&
        !(commander.aiFailedTargetCooldown && building.id === commander.aiFailedTargetId))
      .map(building => {
        const upgradeId = getRecommendedBuildingUpgradeId(building);
        const cost = upgradeId ? getBuildingUpgradeCost(building, upgradeId) : getBuildingUpgradeCost(building);
        let priority = 2 + (MAX_BUILDING_LEVEL - building.level) * 0.45;
        if (building.type === 'CORE') {
          priority += hasHarvesterStation ? (walletIsPoor ? 1 : 10) : -15;
          if (pressure) priority += 2;
          if (wallet.wood > 350 && wallet.stone > 350) priority += 2;
        } else if (building.type === 'AUTO_TURRET' || building.type === 'FIRE_TOWER') {
          priority += pressure ? 15 : 7;
        } else if (building.type === 'DRONE_STATION') {
          priority += pressure ? 8 : 7;
        } else if (building.type === 'HARVESTER_STATION') {
          priority += walletIsPoor ? 12 : 4;
          if (counts('HARVESTER_STATION') === 1 && resourceShortage) priority += 4;
        } else if (building.type === 'WALL') {
          priority += pressure ? 3 : 0;
        }
        if (building.hp / Math.max(1, building.maxHp) < 0.7) priority -= 3;
        return { building, cost, priority, upgradeId };
      })
      .filter(item => Boolean(item.upgradeId) && canAfford(wallet, item.cost) &&
        wallet.wood - item.cost.wood >= reserve && wallet.stone - item.cost.stone >= reserve)
      .sort((a, b) => b.priority - a.priority)[0];

    const shouldUpgrade = Boolean(upgradeCandidate &&
      (!affordableBuild || upgradeCandidate.priority >= affordableBuild.priority + 1.5));
    if (shouldUpgrade && upgradeCandidate) {
      commander.aiGoal = 'UPGRADE_STRUCTURE';
      commander.aiTargetBuildingId = upgradeCandidate.building.id;
      commander.aiTargetEntityId = null;
      commander.aiBuildType = null;
      return;
    }
    if (affordableBuild) {
      commander.aiGoal = 'BUILD_STRUCTURE';
      commander.aiBuildType = affordableBuild.type;
      commander.aiTargetBuildingId = null;
      return;
    }

    // If no station stockpile is waiting, the commander may mine directly,
    // using the same two-second extraction and 15-unit batch as the earlier AI.
    // Station stock is handled as a separate, physical pickup task above.
    const coreRepairCost = coreDamaged && homeCore ? getRepairCost(homeCore) : null;
    const woodNeedDirect = coreRepairCost
      ? Math.max(0, coreRepairCost.wood - wallet.wood)
      : Math.max(0, 190 - wallet.wood);
    const stoneNeedDirect = coreRepairCost
      ? Math.max(0, coreRepairCost.stone - wallet.stone)
      : Math.max(0, 190 - wallet.stone);
    if (woodNeedDirect > 0 || stoneNeedDirect > 0) {
      const targetType = woodNeedDirect >= stoneNeedDirect ? 'wood' : 'stone';
      // While the Core is damaged, gather only nearby resources for its repair.
      // Do not send the defender on an unlimited-distance mining trip and leave
      // the outpost unprotected. If the local area is exhausted, stay defensive.
      const miningPool = coreDamaged && homeCore
        ? resources.filter(node => distance(node.x, node.y, homeCore.x, homeCore.y) <= 520)
        : resources;
      const node = this.findDirectMiningTarget(commander, miningPool, buildings, targetType);
      if (node) {
        assignMiningGoal(commander, node);
        return;
      }
      if (coreDamaged) {
        commander.aiGoal = 'IDLE';
        commander.aiTargetEntityId = null;
        commander.aiTargetBuildingId = null;
        commander.aiTargetResourceId = null;
        return;
      }
    }

    // Low pressure and healthy resources: stay with the base and keep drones in
    // escort only during a coordinated push.
    commander.aiGoal = 'IDLE';
    commander.aiTargetEntityId = null;
    commander.aiTargetBuildingId = null;
    commander.aiTargetResourceId = null;
    const droneStation = ownBuildings.find(building => building.type === 'DRONE_STATION');
    if (droneStation && !isAssaulting && droneStation.droneMode !== 'DEFENSE') droneStation.droneMode = 'DEFENSE';
  }
}
