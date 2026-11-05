import type { Building, EnemyBase, GameEntity, Projectile, ResourceNode, Resources } from '../../types';
import { canAfford, distance, getRepairCost, findFreeAdjacentSpawnPosition } from '../../rules';
import { advanceEmbeddedEntityRecovery, moveWithGridCollisionSubstepped, recoverEmbeddedEntity } from '../../movement';
import { measurePerformance } from '../../performance/PerformanceDiagnostics';
import { belongsToTeam, findPriorityHostileTarget, getCombatTeamId, getProjectileDodgeDirection } from '../../combat';
import { sound } from '../../audio';
import type { CommanderActionFeedback } from './model';
import { CommanderAIPlanning } from './CommanderAIPlanning';

export abstract class CommanderAIUpdate extends CommanderAIPlanning {

  public override updateCommander(
    commander: GameEntity,
    factionResources: Resources,
    buildings: Building[],
    resourceNodes: ResourceNode[],
    allEntities: GameEntity[],
    projectiles: Projectile[],
    enemyBases: EnemyBase[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    // 1. Handle Respawn (3 seconds at Core, identical to player)
    if (commander.isDead) {
      commander.respawnTimer = Math.max(0, (commander.respawnTimer || 0) - dt);
      if (commander.respawnTimer <= 0) {
        const core = buildings.find(
          b => b.type === 'CORE' && belongsToTeam(b, getCombatTeamId(commander)) && b.hp > 0
        );
        if (core) {
          const spawn = findFreeAdjacentSpawnPosition(core, false, buildings, resourceNodes);
          commander.x = spawn.x;
          commander.y = spawn.y;
        } else {
          commander.hp = 0;
          return;
        }
        commander.hp = commander.maxHp;
        commander.isDead = false;
        commander.vx = 0;
        commander.vy = 0;
        commander.aiGoal = 'IDLE';
        sound.playMine();
      }
      return;
    }

    // Recovery must also progress while idle. Embedded units are never snapped
    // to a free cell; the bounded movement step owns the tick until the unit exits.
    const needsRecovery = measurePerformance('ai.commander.embeddedRecovery.search', () =>
      recoverEmbeddedEntity(commander, buildings, resourceNodes),
      { commanderId: commander.id, buildingCount: buildings.length }
    );
    const recoveryStartX = commander.x;
    const recoveryStartY = commander.y;
    // Never suspend strategic decisions just because a structure appeared over
    // the Commander. Recovery is applied in finally only when normal AI did not
    // already move the unit during this tick.
    try {
      commander.aiFailedTargetCooldown = Math.max(0, (commander.aiFailedTargetCooldown || 0) - dt);
    commander.aiDecisionTimer = (commander.aiDecisionTimer || 0) + dt;
    const currentBase = enemyBases.find(base => (base.teamId || base.id) === getCombatTeamId(commander));
    const currentCore = buildings.find(building => building.type === 'CORE' &&
      building.hp > 0 && belongsToTeam(building, getCombatTeamId(commander)));
    const coreNeedsRepair = Boolean(currentCore && currentCore.hp < currentCore.maxHp);
    const decisionInterval = coreNeedsRepair ? 0.16
      : currentBase?.stance === 'ASSAULT' ? 0.38
      : currentBase?.stance === 'DEFENDING' ? 0.55
      : 1.05;

    // Re-plan rapidly under pressure; use a calmer cadence while fortifying so
    // long-running work such as mining/repairing is not needlessly interrupted.
    const needsImmediateStrategicDecision = !commander.aiGoal || commander.aiGoal === 'IDLE' ||
      (coreNeedsRepair && (commander.aiGoal !== 'REPAIR_STRUCTURE' || commander.aiTargetBuildingId !== currentCore?.id));
    if (commander.aiDecisionTimer >= decisionInterval || needsImmediateStrategicDecision) {
      commander.aiDecisionTimer = 0;
      this.evaluateCommanderGoals(
        commander,
        factionResources,
        buildings,
        resourceNodes,
        allEntities,
        enemyBases
      );
    }

    // Simple hard-priority state machine. Repair and an immediate local threat
    // always override the planner. When neither applies, however, the Commander
    // must be allowed to gather the resources needed to repair its Core instead
    // of idling defensively forever. Construction/upgrade goals are cancelled.
    if (currentCore && currentCore.hp < currentCore.maxHp) {
      const repairCost = getRepairCost(currentCore);
      const coreThreat = findPriorityHostileTarget(currentCore, allEntities, buildings, 390,
        (commander.aiFailedTargetCooldown || 0) > 0 ? commander.aiFailedTargetId : undefined);
      if (canAfford(factionResources, repairCost)) {
        commander.aiTargetResourceId = null;
        commander.aiBuildType = null;
        commander.isActivelyMining = false;
        commander.miningProgress = 0;
        commander.miningTargetId = null;
        commander.aiGoal = 'REPAIR_STRUCTURE';
        commander.aiTargetBuildingId = currentCore.id;
        commander.aiTargetEntityId = null;
      } else if (coreThreat) {
        commander.aiTargetResourceId = null;
        commander.aiBuildType = null;
        commander.isActivelyMining = false;
        commander.miningProgress = 0;
        commander.miningTargetId = null;
        commander.aiGoal = 'ATTACK_TARGET';
        commander.aiTargetEntityId = coreThreat.kind === 'ENTITY' ? coreThreat.entity.id : null;
        commander.aiTargetBuildingId = coreThreat.kind === 'BUILDING' ? coreThreat.building.id : null;
      } else {
        const localMiningTarget = commander.aiGoal === 'MINE_RESOURCE'
          ? resourceNodes.find(node => node.id === commander.aiTargetResourceId && node.amount > 0 &&
            distance(node.x, node.y, currentCore.x, currentCore.y) <= 520)
          : undefined;
        const isLocalEconomyTask = commander.aiGoal === 'COLLECT_RESOURCES' ||
          commander.aiGoal === 'DISMANTLE_STRUCTURE' || commander.aiGoal === 'GUARD_CORE' || Boolean(localMiningTarget);
        if (!isLocalEconomyTask) {
          commander.aiGoal = 'IDLE';
          commander.aiTargetEntityId = null;
          commander.aiTargetBuildingId = null;
          commander.aiTargetResourceId = null;
          commander.aiBuildType = null;
          commander.isActivelyMining = false;
          commander.miningProgress = 0;
          commander.miningTargetId = null;
          // Re-evaluate on the next simulation tick rather than waiting for the
          // normal low-pressure decision interval after cancelling a stale goal.
          commander.aiDecisionTimer = decisionInterval;
        }
      }
    }

    // 3. Goal Execution
    // Mining animation/progress belongs only to the mining task. If the planner
    // changes goals (for combat, repairs, delivery, etc.), clear stale mining
    // state immediately so the commander cannot look like it is still mining
    // while walking or fighting.
    if (commander.aiGoal !== 'MINE_RESOURCE') {
      commander.isActivelyMining = false;
      commander.miningProgress = 0;
      commander.miningTargetId = null;
    }

    switch (commander.aiGoal) {
      case 'REPAIR_STRUCTURE':
        this.executeRepairGoal(commander, factionResources, buildings, resourceNodes, dt, feedback);
        break;

      case 'GUARD_CORE':
        this.executeGuardCoreGoal(commander, buildings, resourceNodes, dt);
        break;

      case 'DISMANTLE_STRUCTURE':
        this.executeDismantleGoal(commander, factionResources, buildings, resourceNodes, dt, feedback);
        break;

      case 'COLLECT_RESOURCES':
        this.executeCollectResourcesGoal(commander, factionResources, buildings, resourceNodes, dt, feedback);
        break;

      case 'MINE_RESOURCE':
        this.executeMiningGoal(commander, factionResources, resourceNodes, buildings, dt, feedback);
        break;

      case 'BUILD_STRUCTURE':
        this.executeBuildGoal(commander, factionResources, buildings, resourceNodes, allEntities, enemyBases, dt, feedback);
        break;

      case 'UPGRADE_STRUCTURE':
        this.executeUpgradeGoal(commander, factionResources, buildings, resourceNodes, dt, feedback);
        break;

      case 'ATTACK_TARGET':
        this.executeAttackGoal(commander, allEntities, buildings, resourceNodes, projectiles, dt, feedback);
        break;

      default:
        commander.isActivelyMining = false;
        commander.miningProgress = 0;
        // Never retreat because of low health. If the commander is idle it stays
        // on its current task/position until the normal strategic planner chooses
        // a new goal, and it continues to return fire at every health level.
        break;
    }

    // Tactical layer: evade shots predicted to cross the commander's collision
    // envelope. The dodge is a short, collision-aware strafe and does not erase
    // the strategic objective being executed above.
    if (commander.aiDodgeCheckTimer === undefined) {
      // Deterministic phase offsets prevent several commanders from scanning the
      // entire projectile array on the same frame during large battles.
      let hash = 0;
      for (let index = 0; index < commander.id.length; index++) hash = (hash * 31 + commander.id.charCodeAt(index)) >>> 0;
      commander.aiDodgeCheckTimer = ((hash % 1000) / 1000) * 0.08;
    }
    commander.aiDodgeCheckTimer -= dt;
    commander.evasionTimer = Math.max(0, (commander.evasionTimer || 0) - dt);
    if (commander.aiDodgeCheckTimer <= 0) {
      const dodge = getProjectileDodgeDirection(commander, projectiles);
      if (dodge) {
        commander.evasionDirectionX = dodge.x;
        commander.evasionDirectionY = dodge.y;
        commander.evasionTimer = Math.max(commander.evasionTimer || 0, 0.14);
      } else if ((commander.evasionTimer || 0) <= 0) {
        commander.evasionDirectionX = 0;
        commander.evasionDirectionY = 0;
      }
      commander.aiDodgeCheckTimer = 0.08;
    }
    if ((commander.evasionTimer || 0) > 0 &&
        (commander.evasionDirectionX || commander.evasionDirectionY)) {
      // A sidestep is additive to the current strategic action, so it must use
      // a short tactical step rather than a second full commander-speed move.
      const dodgeStep = Math.min(8, 72 * Math.max(0, dt));
      moveWithGridCollisionSubstepped(
        commander,
        commander.x + (commander.evasionDirectionX || 0) * dodgeStep,
        commander.y + (commander.evasionDirectionY || 0) * dodgeStep,
        buildings,
        resourceNodes
      );
    }

    // 4. Autonomous Combat Self-Defense (Fire at any opposing unit in weapon range with predictive aim)
    if (commander.aiGoal !== 'ATTACK_TARGET') {
      this.handleCombatSelfDefense(commander, allEntities, buildings, projectiles, dt);
    }

    // 5. Tactical Drone Synchronization (set friendly drone station to Escort if marching to attack)
    if (commander.aiGoal === 'ATTACK_TARGET') {
      const droneStation = buildings.find(
        b => b.type === 'DRONE_STATION' && belongsToTeam(b, getCombatTeamId(commander)) && b.hp > 0
      );
      if (droneStation && droneStation.droneMode !== 'ESCORT') {
        droneStation.droneMode = 'ESCORT';
      }
    }
    } finally {
      if (needsRecovery && Math.abs(commander.x - recoveryStartX) < 0.001 &&
          Math.abs(commander.y - recoveryStartY) < 0.001) {
        measurePerformance('ai.commander.embeddedRecovery.step', () =>
          advanceEmbeddedEntityRecovery(commander, buildings, resourceNodes, dt, commander.speed),
          { commanderId: commander.id }
        );
      }
    }
  }
}
