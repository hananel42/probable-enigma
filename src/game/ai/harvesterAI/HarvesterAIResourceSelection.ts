import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, getResourceGridBounds, getResourceNodesInCellBounds, GRID_SIZE } from '../../rules';
import { HarvesterAIState } from './HarvesterAIState';

export abstract class HarvesterAIResourceSelection extends HarvesterAIState {

  /**
   * Search the whole known resource index without running A* synchronously for
   * every candidate. Rank a small set by a cheap trip-utility estimate; the shared
   * navigator then resolves the real obstacle-aware path in a worker. This keeps
   * remote deposits eligible without turning a new base or idle rover into a burst
   * of dozens of main-thread A* searches.
   */
  protected override chooseResource(bot: GameEntity, station: Building, resources: ResourceNode[], buildings: Building[]) {
    const capacity = Math.max(0, station.maxCapacity ?? 75);
    const woodRoom = Math.max(0, capacity - (station.storedWood || 0));
    const stoneRoom = Math.max(0, capacity - (station.storedStone || 0));
    // Do not dispatch a new trip for a resource the station cannot accept. This
    // prevents bots from filling cargo and then idling forever at a full store.
    if (woodRoom <= 0 && stoneRoom <= 0) {
      bot.harvesterState = 'IDLE';
      bot.targetResourceId = null;
      bot.path = [];
      return;
    }
    const candidateLimit = 16;
    const nearest: Array<{ node: ResourceNode; distanceSquared: number }> = [];
    const failedIds = new Set(bot.harvesterFailedResourceIds || []);
    if (bot.harvesterFailedResourceId) failedIds.add(bot.harvesterFailedResourceId);
    const botGx = Math.floor(bot.x / GRID_SIZE);
    const botGy = Math.floor(bot.y / GRID_SIZE);
    const bounds = getResourceGridBounds(resources);
    let radiusCells = 24;

    // Search nearby resource buckets first. The known world can contain many
    // persistent chunks; expanding indexed rectangles makes common searches local
    // while still reaching any known deposit with no station-distance limit.
    while (true) {
      nearest.length = 0;
      const localNodes = getResourceNodesInCellBounds(
        resources,
        botGx - radiusCells, botGy - radiusCells,
        botGx + radiusCells, botGy + radiusCells,
        false
      );
      for (const node of localNodes) {
        if (node.amount <= 0 || failedIds.has(node.id)) continue;
        if ((node.type === 'wood' && woodRoom <= 0) || (node.type === 'stone' && stoneRoom <= 0)) continue;
        const dx = node.x - bot.x;
        const dy = node.y - bot.y;
        const distanceSquared = dx * dx + dy * dy;
        if (nearest.length === candidateLimit && distanceSquared >= nearest[nearest.length - 1].distanceSquared) continue;
        let insertAt = nearest.findIndex(item => distanceSquared < item.distanceSquared);
        if (insertAt < 0) insertAt = nearest.length;
        nearest.splice(insertAt, 0, { node, distanceSquared });
        if (nearest.length > candidateLimit) nearest.pop();
      }

      const coversKnownWorld = botGx - radiusCells <= bounds.minGx && botGx + radiusCells >= bounds.maxGx &&
        botGy - radiusCells <= bounds.minGy && botGy + radiusCells >= bounds.maxGy;
      const nearestCandidateDistance = nearest.length === candidateLimit
        ? Math.sqrt(nearest[nearest.length - 1].distanceSquared)
        : Number.POSITIVE_INFINITY;
      // Any node outside the search square is at least radiusCells cells away.
      if (coversKnownWorld || (nearest.length === candidateLimit && nearestCandidateDistance <= radiusCells * GRID_SIZE)) break;
      const maximumRadius = Math.max(
        Math.abs(botGx - bounds.minGx), Math.abs(botGx - bounds.maxGx),
        Math.abs(botGy - bounds.minGy), Math.abs(botGy - bounds.maxGy), 24
      );
      if (radiusCells >= maximumRadius) break;
      radiusCells = Math.min(maximumRadius, radiusCells * 2);
    }

    let best: { node: ResourceNode; score: number } | null = null;
    // Route distance is approximated here to keep selection bounded. The selected
    // route is NOT assumed valid: moveEntityAlongPath asks the worker for a real A*
    // path, and the navigation watchdog excludes a target if it proves unreachable.
    for (const candidate of nearest) {
      const node = candidate.node;
      const nodeDistance = Math.sqrt(candidate.distanceSquared);
      const estimatedRoundTrip = Math.max(1, nodeDistance + distance(node.x, node.y, station.x, station.y));
      const room = node.type === 'wood' ? woodRoom : stoneRoom;
      const usefulLoad = Math.min(Math.max(0, node.amount), Math.max(1, bot.cargoCapacity || 20), room);
      const score = usefulLoad / estimatedRoundTrip;
      if (!best || score > best.score) best = { node, score };
    }

    if (best) {
      const { node } = best;
      bot.targetResourceId = node.id;
      bot.harvesterState = 'NAVIGATING_TO_RESOURCE';
      bot.miningTimer = 0;
      bot.path = [];
      bot.pathIndex = 0;
      bot.pathTargetX = node.x;
      bot.pathTargetY = node.y;
      bot.pathRecalcTimer = 0;
      bot.pathFailureCount = 0;
      bot.pathRetryDelay = 0.8;
      this.resetNavigationWatchdog(bot);
      return;
    }

    // If the nearest deposits are blocked, mark the nearest one as temporarily
    // failed so the next scan can progress to the next candidate instead of
    // reconsidering the same unreachable resource forever.
    if (nearest.length > 0) {
      bot.harvesterFailedResourceId = nearest[0].node.id;
      bot.harvesterFailedResourceIds = [...new Set([...(bot.harvesterFailedResourceIds || []), ...nearest.map(item => item.node.id)])].slice(-256);
      bot.harvesterFailureCooldown = 18;
    }
    const fartherWorldExists = Math.max(
      Math.abs(bounds.minGx - botGx), Math.abs(bounds.maxGx - botGx),
      Math.abs(bounds.minGy - botGy), Math.abs(bounds.maxGy - botGy)
    ) > 12;
    bot.harvesterState = 'IDLE';
    bot.harvesterSearchTimer = fartherWorldExists ? 0.45 : 0;
    bot.targetResourceId = null;
    bot.path = [];
  }

  protected override hasStationCapacityFor(station: Building, type: ResourceNode['type']): boolean {
    const capacity = Math.max(0, station.maxCapacity ?? 75);
    const stored = type === 'wood' ? (station.storedWood || 0) : (station.storedStone || 0);
    return stored < capacity;
  }
}
