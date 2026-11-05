import { Building, PathWaypoint, ResourceNode } from './types';
import { AIR_BUILDING_CLEARANCE_CELLS, GRID_SIZE, getBuildingCandidatesInCellBounds, getResourceNodesInCellBounds, snapToGrid } from './rules';

export interface PathNode extends PathWaypoint {}

interface AStarNode {
  gx: number;
  gy: number;
  g: number;
  h: number;
  f: number;
  parent?: AStarNode;
}

class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly score: (item: T) => number) {}

  get size() { return this.items.length; }

  push(item: T) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.score(this.items[parent]) <= this.score(item)) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const first = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length && this.score(this.items[right]) < this.score(this.items[left]) ? right : left;
        if (this.score(this.items[child]) >= this.score(last)) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

const manhattan = (x1: number, y1: number, x2: number, y2: number) => Math.abs(x2 - x1) + Math.abs(y2 - y1);

/**
 * Grid A* with four-direction movement, flying/ground obstacle rules, and an
 * approach tile for blocked targets (resources and multi-cell buildings).
 * The search budget scales with start-to-goal distance rather than imposing a
 * fixed travel radius, so remote mining trips remain valid.
 */
export function findPath(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  isFlying: boolean,
  buildings: Building[],
  resources: ResourceNode[],
  maxSearchSteps?: number
): PathNode[] {
  const start = snapToGrid(startX, startY, GRID_SIZE);
  const target = snapToGrid(targetX, targetY, GRID_SIZE);
  // Restrict each search to a corridor around start and goal. The corridor
  // grows with trip length (so long-distance mining still works), while a blocked
  // target cannot make A* explore the entire infinite world and stall a frame.
  const startH = manhattan(start.gx, start.gy, target.gx, target.gy);
  const margin = Math.max(32, Math.ceil(startH * 0.18) + 12);
  const minGx = Math.min(start.gx, target.gx) - margin;
  const maxGx = Math.max(start.gx, target.gx) + margin;
  const minGy = Math.min(start.gy, target.gy) - margin;
  const maxGy = Math.max(start.gy, target.gy) + margin;

  // Snapshot only obstacles in this route's corridor. Resource nodes can number
  // in the tens of thousands in a long session, but the spatial index queries the
  // local buckets instead of rebuilding a world-sized obstacle set per route.
  const corridorWidth = maxGx - minGx + 1;
  // Numeric cell keys avoid allocating thousands of `${x},${y}` strings in A*.
  const keyOf = (gx: number, gy: number) => (gy - minGy) * corridorWidth + (gx - minGx);
  const blockedCells = new Set<number>();
  const addBlockedCell = (gx: number, gy: number) => {
    if (gx >= minGx && gx <= maxGx && gy >= minGy && gy <= maxGy) {
      blockedCells.add(keyOf(gx, gy));
    }
  };
  const clearance = isFlying ? AIR_BUILDING_CLEARANCE_CELLS : 0;
  // Query only structures that can influence this route corridor. The shared
  // building spatial index avoids rescanning structures across the entire world
  // for every drone, rover, and autonomous commander path request.
  const nearbyBuildings = getBuildingCandidatesInCellBounds(
    buildings,
    minGx - clearance,
    minGy - clearance,
    maxGx + clearance,
    maxGy + clearance
  );
  for (const building of nearbyBuildings) {
    if (building.hp <= 0) continue;
    const width = building.widthInCells || 1;
    const height = building.heightInCells || 1;
    for (let occupiedX = 0; occupiedX < width; occupiedX++) {
      for (let occupiedY = 0; occupiedY < height; occupiedY++) {
        const cellGx = building.gx + occupiedX;
        const cellGy = building.gy + occupiedY;
        for (let dx = -clearance; dx <= clearance; dx++) {
          for (let dy = -clearance; dy <= clearance; dy++) {
            addBlockedCell(cellGx + dx, cellGy + dy);
          }
        }
      }
    }
  }
  if (!isFlying) {
    const localResources = getResourceNodesInCellBounds(resources, minGx, minGy, maxGx, maxGy, false);
    for (const resource of localResources) addBlockedCell(resource.gx, resource.gy);
  }
  const isBlocked = (gx: number, gy: number) => blockedCells.has(keyOf(gx, gy));

  const findOpenCell = (gx: number, gy: number, maxRadius: number, originX: number, originY: number) => {
    if (!isBlocked(gx, gy)) return { gx, gy };
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best: { gx: number; gy: number; score: number } | undefined;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const cx = gx + dx;
          const cy = gy + dy;
          if (isBlocked(cx, cy)) continue;
          // First choose the closest usable tile to the requested cell, then
          // prefer the one that reduces travel from the opposite endpoint. This
          // avoids "approach" points hundreds of pixels away from a station.
          const score = Math.hypot(dx, dy) * 100 + manhattan(cx, cy, originX, originY);
          if (!best || score < best.score) best = { gx: cx, gy: cy, score };
        }
      }
      if (best) return { gx: best.gx, gy: best.gy };
    }
    return undefined;
  };

  const openStart = findOpenCell(start.gx, start.gy, 32, target.gx, target.gy);
  if (!openStart) return [];
  const openTarget = findOpenCell(target.gx, target.gy, 12, openStart.gx, openStart.gy);
  if (!openTarget) return [];

  if (openStart.gx === openTarget.gx && openStart.gy === openTarget.gy) {
    return [{ ...openTarget, ...snapToGrid(openTarget.gx * GRID_SIZE + GRID_SIZE / 2, openTarget.gy * GRID_SIZE + GRID_SIZE / 2) }];
  }

  const routeHeuristic = manhattan(openStart.gx, openStart.gy, openTarget.gx, openTarget.gy);
  const first: AStarNode = { ...openStart, g: 0, h: routeHeuristic, f: routeHeuristic };
  // A* often has many equal-f candidates on open grids. A small positive h
  // tie-breaker pulls the queue toward the goal instead of expanding the whole
  // diagonal diamond; it does not change optimal route costs.
  const open = new MinHeap<AStarNode>(node => node.f + node.h * 0.0001);
  const bestG = new Map<number, number>([[keyOf(first.gx, first.gy), 0]]);
  const closed = new Set<number>();
  open.push(first);

  // The search is already geographically bounded above. Keep a second, lower
  // expansion budget for pathological mazes; open long-distance routes remain
  // unbounded in travel distance because A* follows their narrow shortest corridor.
  const corridorArea = (maxGx - minGx + 1) * (maxGy - minGy + 1);
  const defaultBudget = Math.min(corridorArea, Math.max(6_000, Math.min(40_000, (startH + 1) * 16)));
  const budget = maxSearchSteps ?? defaultBudget;
  let steps = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  while (open.size > 0 && steps < budget) {
    steps++;
    const current = open.pop();
    if (!current) break;
    const currentKey = keyOf(current.gx, current.gy);
    if (closed.has(currentKey)) continue;
    if (current.g > (bestG.get(currentKey) ?? Number.POSITIVE_INFINITY)) continue;

    if (current.gx === openTarget.gx && current.gy === openTarget.gy) {
      const startWasRelocated = openStart.gx !== start.gx || openStart.gy !== start.gy;
      return reconstructPath(current, !startWasRelocated);
    }
    closed.add(currentKey);

    for (const [dx, dy] of directions) {
      const gx = current.gx + dx;
      const gy = current.gy + dy;
      if (gx < minGx || gx > maxGx || gy < minGy || gy > maxGy) continue;
      const key = keyOf(gx, gy);
      if (closed.has(key) || isBlocked(gx, gy)) continue;
      const g = current.g + 1;
      if (g >= (bestG.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      const h = manhattan(gx, gy, openTarget.gx, openTarget.gy);
      bestG.set(key, g);
      open.push({ gx, gy, g, h, f: g + h, parent: current });
    }
  }

  // A partial route is not a successful route. Treating a nearby dead-end as
  // success caused drones to stop at its last waypoint without reaching their
  // actual hover target. The mover applies backoff and retries later.
  return [];
}

function reconstructPath(node: AStarNode, skipStartingCell = true): PathNode[] {
  const path: PathNode[] = [];
  let current: AStarNode | undefined = node;
  while (current) {
    const x = current.gx * GRID_SIZE + GRID_SIZE / 2;
    const y = current.gy * GRID_SIZE + GRID_SIZE / 2;
    path.unshift({ gx: current.gx, gy: current.gy, x, y });
    current = current.parent;
  }
  // The mover is already standing on the first path cell in ordinary cases.
  if (skipStartingCell && path.length > 1) path.shift();
  return path;
}
