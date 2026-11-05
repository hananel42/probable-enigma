import type { Building, PathWaypoint, ResourceNode } from '../types';
import {
  AIR_BUILDING_CLEARANCE_CELLS,
  GRID_SIZE,
  getBuildingCandidatesInCellBounds,
  getResourceNodesInCellBounds,
  snapToGrid
} from '../rules';
import { WorkerTaskScheduler } from './workerTaskScheduler';

export interface PathfindingWorkerPayload {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  isFlying: boolean;
  buildings: Array<Pick<Building, 'id' | 'upgradeIds' | 'type' | 'faction' | 'teamId' | 'allianceId' | 'gx' | 'gy' | 'widthInCells' | 'heightInCells' | 'x' | 'y' | 'hp' | 'maxHp' | 'level' | 'lastActionTime' | 'range'>>;
  resources: Array<Pick<ResourceNode, 'id' | 'type' | 'gx' | 'gy' | 'x' | 'y' | 'amount' | 'maxAmount' | 'radius' | 'seed' | 'chunkKey'>>;
}

const workerTasks = new WorkerTaskScheduler();
workerTasks.registerTaskType(
  'pathfinding',
  () => new Worker(new URL('./pathfinding.worker.ts', import.meta.url), { type: 'module' }),
  2
);

/**
 * Build a bounded, serializable snapshot and submit A* to a worker.
 * Returns null only when the Worker API is unavailable, allowing movement.ts to
 * use its explicitly documented non-worker path. Worker construction/runtime failures
 * throw or reject and must never turn into a synchronous fallback. The frame loop
 * never awaits this promise.
 */
export function requestPathInWorker(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  isFlying: boolean,
  buildings: Building[],
  resources: ResourceNode[]
): Promise<PathWaypoint[]> | null {
  const start = snapToGrid(startX, startY, GRID_SIZE);
  const target = snapToGrid(targetX, targetY, GRID_SIZE);
  const startDistance = Math.abs(target.gx - start.gx) + Math.abs(target.gy - start.gy);
  const margin = Math.max(32, Math.ceil(startDistance * 0.18) + 12);
  const minGx = Math.min(start.gx, target.gx) - margin;
  const maxGx = Math.max(start.gx, target.gx) + margin;
  const minGy = Math.min(start.gy, target.gy) - margin;
  const maxGy = Math.max(start.gy, target.gy) + margin;
  const clearance = isFlying ? AIR_BUILDING_CLEARANCE_CELLS : 0;
  const localBuildings = getBuildingCandidatesInCellBounds(
    buildings, minGx - clearance, minGy - clearance, maxGx + clearance, maxGy + clearance
  );
  const localResources = isFlying
    ? []
    : getResourceNodesInCellBounds(resources, minGx, minGy, maxGx, maxGy, false);

  const payload: PathfindingWorkerPayload = {
    startX, startY, targetX, targetY, isFlying,
    buildings: localBuildings.map(building => ({
      id: building.id, upgradeIds: building.upgradeIds, type: building.type, faction: building.faction,
      teamId: building.teamId, allianceId: building.allianceId,
      gx: building.gx, gy: building.gy,
      widthInCells: building.widthInCells, heightInCells: building.heightInCells,
      x: building.x, y: building.y, hp: building.hp, maxHp: building.maxHp,
      level: building.level, lastActionTime: building.lastActionTime, range: building.range
    })),
    resources: localResources.map(resource => ({
      id: resource.id, type: resource.type, gx: resource.gx, gy: resource.gy,
      x: resource.x, y: resource.y, amount: resource.amount, maxAmount: resource.maxAmount,
      radius: resource.radius, seed: resource.seed, chunkKey: resource.chunkKey
    }))
  };
  return workerTasks.submit<PathfindingWorkerPayload, PathWaypoint[]>('pathfinding', payload, 'normal');
}
