import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, GRID_SIZE, isCellBlockedForGround, STATION_INTERACTION_RADIUS } from '../../rules';
import { HarvesterAICargo } from './HarvesterAICargo';

export abstract class HarvesterAINavigation extends HarvesterAICargo {

  /**
   * Choose a station-perimeter candidate cheaply. Actual reachability is evaluated
   * by the shared worker-backed navigator; this selector must not run A* repeatedly
   * on the main thread when a harvester has already stalled on its return trip.
   */
  protected override findStationApproachCandidate(
    bot: GameEntity,
    station: Building,
    buildings: Building[],
    resources: ResourceNode[]
  ): { x: number; y: number } | undefined {
    const width = station.widthInCells || 1;
    const height = station.heightInCells || 1;
    const perimeter: Array<{ x: number; y: number; distance: number }> = [];
    const minGx = station.gx - 1;
    const maxGx = station.gx + width;
    const minGy = station.gy - 1;
    const maxGy = station.gy + height;
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        if (gx !== minGx && gx !== maxGx && gy !== minGy && gy !== maxGy) continue;
        if (isCellBlockedForGround(gx, gy, buildings, resources)) continue;
        const x = gx * GRID_SIZE + GRID_SIZE / 2;
        const y = gy * GRID_SIZE + GRID_SIZE / 2;
        if (distance(x, y, station.x, station.y) > STATION_INTERACTION_RADIUS) continue;
        perimeter.push({ x, y, distance: distance(x, y, bot.x, bot.y) });
      }
    }
    perimeter.sort((a, b) => a.distance - b.distance);
    if (perimeter.length === 0) return undefined;
    const nextIndex = (bot.harvesterStationApproachIndex ?? 0) % perimeter.length;
    bot.harvesterStationApproachIndex = (nextIndex + 1) % perimeter.length;
    const candidate = perimeter[nextIndex];
    return { x: candidate.x, y: candidate.y };
  }

  /**
   * Detects both a stationary rover and a rover that is moving in a loop without
   * getting closer to its goal. Small movements no longer reset every failure
   * counter, which previously let corner-stuck rovers run forever.
   */
  protected override watchNavigationProgress(bot: GameEntity, dt: number, goalX: number, goalY: number): boolean {
    const lastX = bot.lastProgressX ?? bot.x;
    const lastY = bot.lastProgressY ?? bot.y;
    const moved = distance(lastX, lastY, bot.x, bot.y);
    bot.lastProgressX = bot.x;
    bot.lastProgressY = bot.y;

    if (moved >= 1.25) {
      bot.navigationNoProgressTimer = 0;
    } else {
      bot.navigationNoProgressTimer = (bot.navigationNoProgressTimer || 0) + dt;
    }

    bot.navigationGoalProgressTimer = (bot.navigationGoalProgressTimer || 0) + dt;
    const goalDistance = distance(bot.x, bot.y, goalX, goalY);
    if (bot.navigationLastGoalDistance === undefined) bot.navigationLastGoalDistance = goalDistance;

    let failedProgressWindow = false;
    if ((bot.navigationGoalProgressTimer || 0) >= 2.1) {
      const improvement = (bot.navigationLastGoalDistance ?? goalDistance) - goalDistance;
      bot.navigationGoalProgressTimer = 0;
      bot.navigationLastGoalDistance = goalDistance;
      if (improvement >= 8) {
        bot.navigationRetryCount = Math.max(0, (bot.navigationRetryCount || 0) - 1);
      } else {
        failedProgressWindow = true;
      }
    }

    const hasStalledInPlace = (bot.navigationNoProgressTimer || 0) >= 0.9;
    if (hasStalledInPlace || failedProgressWindow) {
      bot.navigationNoProgressTimer = 0;
      bot.navigationRetryCount = (bot.navigationRetryCount || 0) + 1;
      bot.path = [];
      bot.pathIndex = 0;
      bot.pathRecalcTimer = 2;
      bot.stuckTimer = 0;
    }

    return (bot.navigationRetryCount || 0) >= 3;
  }

  protected override resetNavigationWatchdog(bot: GameEntity) {
    bot.navigationNoProgressTimer = 0;
    bot.navigationRetryCount = 0;
    bot.navigationGoalProgressTimer = 0;
    bot.navigationLastGoalDistance = undefined;
    bot.lastProgressX = bot.x;
    bot.lastProgressY = bot.y;
  }

  protected override clearTarget(bot: GameEntity) {
    bot.harvesterState = 'IDLE';
    bot.targetResourceId = null;
    bot.harvesterReturnX = undefined;
    bot.harvesterReturnY = undefined;
    bot.path = [];
    bot.pathIndex = 0;
    bot.pathRecalcTimer = 0;
    bot.harvesterSearchTimer = 0;
    this.resetNavigationWatchdog(bot);
  }
}
