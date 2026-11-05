import { GameEntity, ResourceNode } from '../types';
import { distance, getResourceNodesNear, takeWholeResourceBatch } from '../rules';
import { sound } from '../audio';

export interface MiningResult {
  isMining: boolean;
  harvested: { type: 'wood' | 'stone'; amount: number } | null;
  targetNodeId: string | null;
}

/**
 * Dedicated Mining System:
 * Completely decouples mining interaction from weapon shooting so firing bullets
 * is never accidentally triggered while channeling resource extraction.
 */
export class MiningSystem {
  public updatePlayerMining(
    player: GameEntity,
    resourceNodes: ResourceNode[],
    mouseWorld: { x: number; y: number },
    wantsToMineKey: boolean,
    isPointerDown: boolean,
    hasSelectedBuilding: boolean,
    dt: number
  ): MiningResult {
    // Cannot mine if selecting a building to place
    if (hasSelectedBuilding) {
      player.isActivelyMining = false;
      player.miningProgress = 0;
      player.miningTargetId = null;
      return { isMining: false, harvested: null, targetNodeId: null };
    }

    // Check if mouse is hovering over or clicked near a resource node
    // Query only nearby resource buckets; scanning every chunk ever explored on
    // every frame made mining progressively slower as players travelled farther.
    const hoveredResource = getResourceNodesNear(resourceNodes, mouseWorld.x, mouseWorld.y, 64)
      .find(r => distance(mouseWorld.x, mouseWorld.y, r.x, r.y) <= r.radius + 15);

    // Only nearby nodes participate in the reachability sort (normally zero to 4).
    const nearestReachable = getResourceNodesNear(resourceNodes, player.x, player.y, 90)
      .filter(r => distance(player.x, player.y, r.x, r.y) <= 85)
      .sort((a, b) => distance(player.x, player.y, a.x, a.y) - distance(player.x, player.y, b.x, b.y))[0];

    // Player wants to mine if pressing F/J or clicking specifically on a resource
    const isTargetingResource = (hoveredResource && isPointerDown && distance(player.x, player.y, hoveredResource.x, hoveredResource.y) <= 100);
    const wantsToMine = wantsToMineKey || isTargetingResource;

    const targetNode = isTargetingResource ? hoveredResource : (wantsToMineKey ? nearestReachable : null);

    if (wantsToMine && targetNode) {
      player.isActivelyMining = true;
      player.miningTargetId = targetNode.id;
      const miningSpeed = Math.max(0.25, player.miningSpeedMultiplier || 1);
      player.miningProgress = (player.miningProgress || 0) + dt * miningSpeed / 2.0;

      // Turn player to face target node
      player.angle = Math.atan2(targetNode.y - player.y, targetNode.x - player.x);

      if (Math.random() < 0.22) {
        sound.playMine();
      }

      if (player.miningProgress >= 1.0) {
        const amount = takeWholeResourceBatch(
          targetNode, 15 * Math.max(0.25, player.miningYieldMultiplier || 1)
        );
        player.miningProgress = 0;
        sound.playMine();

        return {
          isMining: true,
          harvested: { type: targetNode.type, amount },
          targetNodeId: targetNode.id
        };
      }

      return { isMining: true, harvested: null, targetNodeId: targetNode.id };
    }

    player.isActivelyMining = false;
    player.miningProgress = 0;
    player.miningTargetId = null;
    return { isMining: false, harvested: null, targetNodeId: null };
  }
}

export const miningSystem = new MiningSystem();
