import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, getResourceNodeById, STATION_INTERACTION_RADIUS, takeWholeResourceBatch } from '../../rules';
import { advanceEmbeddedEntityRecovery, moveEntityAlongPath, recoverEmbeddedEntity } from '../../movement';
import { measurePerformance } from '../../performance/PerformanceDiagnostics';
import { isBuildingOperational } from '../../coreStatus';
import { HarvesterAINavigation } from './HarvesterAINavigation';

export abstract class HarvesterAIUpdate extends HarvesterAINavigation {

  public override updateBot(
    bot: GameEntity,
    buildings: Building[],
    resourceNodes: ResourceNode[],
    dt: number,
    onDeposit?: (station: Building, wood: number, stone: number) => void
  ) {
    const station = buildings.find(b => b.id === bot.parentStationId && b.hp > 0);
    if (!station || !isBuildingOperational(station, buildings)) {
      bot.hp = 0;
      return;
    }

    const needsRecovery = measurePerformance('ai.harvester.embeddedRecovery.search', () =>
      recoverEmbeddedEntity(bot, buildings, resourceNodes),
      { botId: bot.id, buildingCount: buildings.length, resourceNodeCount: resourceNodes.length }
    );
    const recoveryStartX = bot.x;
    const recoveryStartY = bot.y;
    // Continue mining/deposit state transitions while embedded recovery is
    // pending. A smooth recovery step runs in finally only if normal movement
    // did not already change the unit's position this tick.
    try {
      bot.teamId = station.teamId || station.faction;
    // Read live station modifiers so both current and future rovers benefit.
    bot.cargoCapacity = 20 * Math.max(0.25, station.botCargoCapacityMultiplier || 1);
    bot.harvesterState ||= 'IDLE';
    bot.harvesterFailureCooldown = Math.max(0, (bot.harvesterFailureCooldown || 0) - dt);
    if ((bot.harvesterFailureCooldown || 0) <= 0) {
      bot.harvesterFailedResourceIds = [];
      bot.harvesterFailedResourceId = null;
    }
    bot.harvesterSearchTimer = bot.harvesterSearchTimer === undefined
      ? 0.75
      : bot.harvesterSearchTimer + dt;

    if (bot.harvesterState === 'IDLE' && bot.harvesterSearchTimer >= 0.75) {
      bot.harvesterSearchTimer = 0;
      measurePerformance('ai.harvester.selectResource', () =>
        this.chooseResource(bot, station, resourceNodes, buildings),
        { botId: bot.id, resourceNodeCount: resourceNodes.length, buildingCount: buildings.length }
      );
    }

    if (bot.harvesterState === 'NAVIGATING_TO_RESOURCE') {
      const resolvedTarget = getResourceNodeById(resourceNodes, bot.targetResourceId);
      const target = resolvedTarget && resolvedTarget.amount > 0 ? resolvedTarget : undefined;
      if (!target || !this.hasStationCapacityFor(station, target.type)) {
        this.clearTarget(bot);
        return;
      }

      if (distance(bot.x, bot.y, target.x, target.y) <= 68) {
        bot.harvesterState = 'MINING';
        bot.miningTimer = 0;
        bot.path = [];
        this.resetNavigationWatchdog(bot);
        bot.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
      } else {
        moveEntityAlongPath(bot, target.x, target.y, buildings, resourceNodes, dt, 20);
        if (distance(bot.x, bot.y, target.x, target.y) <= 68) {
          bot.harvesterState = 'MINING';
          bot.miningTimer = 0;
          bot.path = [];
          this.resetNavigationWatchdog(bot);
        } else if (this.watchNavigationProgress(bot, dt, target.x, target.y)) {
          bot.harvesterFailedResourceId = bot.targetResourceId;
          bot.harvesterFailedResourceIds = [...new Set([...(bot.harvesterFailedResourceIds || []), ...(bot.targetResourceId ? [bot.targetResourceId] : [])])].slice(-256);
          bot.harvesterFailureCooldown = 18;
          this.clearTarget(bot);
        }
      }
      return;
    }

    if (bot.harvesterState === 'MINING') {
      const resolvedTarget = getResourceNodeById(resourceNodes, bot.targetResourceId);
      const target = resolvedTarget && resolvedTarget.amount > 0 ? resolvedTarget : undefined;
      if (target && !this.hasStationCapacityFor(station, target.type)) {
        this.clearTarget(bot);
        return;
      }
      if (!target) {
        bot.harvesterState = 'RETURNING';
        bot.harvesterReturnX = station.x;
        bot.harvesterReturnY = station.y;
        bot.path = [];
        this.resetNavigationWatchdog(bot);
        return;
      }

      bot.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
      bot.miningTimer = (bot.miningTimer || 0) + dt;
      const extractionTime = 1.65 / Math.max(0.25, station.miningSpeedMultiplier || 1);
      if (bot.miningTimer >= extractionTime) {
        // Read modifiers from the live station so upgrades also affect already-deployed rovers.
        const effectiveCargo = 20 * Math.max(1, station.botCargoCapacityMultiplier || 1);
        const requestedCargo = Math.max(bot.cargoCapacity || 20, effectiveCargo);
        const amount = takeWholeResourceBatch(target, requestedCargo);
        bot.cargoType = target.type;
        bot.cargoAmount = amount;
        bot.harvesterState = 'RETURNING';
        bot.harvesterReturnX = station.x;
        bot.harvesterReturnY = station.y;
        bot.path = [];
        bot.pathRecalcTimer = 2;
        bot.miningTimer = 0;
        this.resetNavigationWatchdog(bot);
      }
      return;
    }

    if (bot.harvesterState === 'RETURNING') {
      const returnX = bot.harvesterReturnX ?? station.x;
      const returnY = bot.harvesterReturnY ?? station.y;
      // Delivery is a physical interaction: the bot must actually reach the
      // station's collection radius. It is never moved to the station to fake a
      // successful return, and cargo is retained if the station is full.
      if (distance(bot.x, bot.y, station.x, station.y) <= STATION_INTERACTION_RADIUS) {
        this.depositCargo(bot, station, onDeposit);
        this.resetNavigationWatchdog(bot);
        if ((bot.cargoAmount || 0) > 0) {
          bot.targetResourceId = null;
          bot.path = [];
          bot.pathIndex = 0;
          return;
        }
        bot.harvesterState = 'IDLE';
        bot.targetResourceId = null;
        bot.harvesterReturnX = undefined;
        bot.harvesterReturnY = undefined;
        bot.path = [];
        this.resetNavigationWatchdog(bot);
        return;
      }

      moveEntityAlongPath(bot, returnX, returnY, buildings, resourceNodes, dt, 22);
      if (distance(bot.x, bot.y, station.x, station.y) <= STATION_INTERACTION_RADIUS) {
        this.depositCargo(bot, station, onDeposit);
        this.resetNavigationWatchdog(bot);
        if ((bot.cargoAmount || 0) <= 0) {
          bot.harvesterState = 'IDLE';
          bot.targetResourceId = null;
          bot.harvesterReturnX = undefined;
          bot.harvesterReturnY = undefined;
          bot.path = [];
        } else {
          // The station is full; wait at its real entrance until capacity is
          // freed rather than losing the overflow or mining another load.
          bot.targetResourceId = null;
          bot.path = [];
          bot.pathIndex = 0;
        }
        return;
      }

      if (this.watchNavigationProgress(bot, dt, returnX, returnY)) {
        // The primary station-centre route can fail if buildings or resources
        // block its preferred approach. Try a reachable adjacent station tile.
        // Unlike the old watchdog, this never teleports the bot or deposits from
        // a distance. If no approach is reachable, preserve cargo and back off.
        const alternative = this.findStationApproachCandidate(bot, station, buildings, resourceNodes);
        bot.path = [];
        bot.pathIndex = 0;
        bot.pathRecalcTimer = 0;
        bot.pathFailureCount = 0;
        bot.pathRetryDelay = 0.8;
        if (alternative) {
          bot.harvesterReturnX = alternative.x;
          bot.harvesterReturnY = alternative.y;
        } else {
          bot.harvesterReturnX = station.x;
          bot.harvesterReturnY = station.y;
          bot.pathRecalcTimer = 1.5;
        }
        // Reset the progress window after each failed route so subsequent
        // recovery attempts happen at a controlled cadence, not every frame.
        bot.navigationRetryCount = 0;
        bot.navigationNoProgressTimer = 0;
        bot.navigationGoalProgressTimer = 0;
        bot.navigationLastGoalDistance = distance(bot.x, bot.y, bot.harvesterReturnX, bot.harvesterReturnY);
        bot.lastProgressX = bot.x;
        bot.lastProgressY = bot.y;
      }
    }
    } finally {
      if (needsRecovery && Math.abs(bot.x - recoveryStartX) < 0.001 &&
          Math.abs(bot.y - recoveryStartY) < 0.001) {
        measurePerformance('ai.harvester.embeddedRecovery.step', () =>
          advanceEmbeddedEntityRecovery(bot, buildings, resourceNodes, dt, bot.speed),
          { botId: bot.id }
        );
      }
    }
  }
}
