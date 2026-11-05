import type { Building } from '../types';

/** Cardinal directions are expressed in world-grid space, not screen pixels. */
export const CARDINAL_DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type CardinalDirection = (typeof CARDINAL_DIRECTIONS)[number];

/**
 * Every structure touching a building along one cardinal edge. An edge can
 * contain multiple neighbors when a large footprint touches smaller structures.
 * Diagonal contact is deliberately not considered adjacency.
 */
export type BuildingNeighborhood = Readonly<Record<CardinalDirection, readonly Building[]>>;

const emptyNeighborhood = (): BuildingNeighborhood => ({ north: [], east: [], south: [], west: [] });
const cellKey = (gx: number, gy: number) => `${gx},${gy}`;

function footprintDimension(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

/**
 * Per-frame spatial index for cardinal building adjacency.
 *
 * Construct once for a render pass and share it with every building renderer.
 * Lookups then inspect only the cells along the queried footprint's four edges,
 * instead of scanning every building separately for each draw call.
 */
export class BuildingNeighborhoodIndex {
  private readonly occupiedCells = new Map<string, Building[]>();

  constructor(buildings: readonly Building[]) {
    for (const building of buildings) {
      if (building.hp <= 0 || !Number.isFinite(building.gx) || !Number.isFinite(building.gy)) continue;
      const width = footprintDimension(building.widthInCells);
      const height = footprintDimension(building.heightInCells);
      for (let dx = 0; dx < width; dx++) {
        for (let dy = 0; dy < height; dy++) {
          const key = cellKey(building.gx + dx, building.gy + dy);
          const occupants = this.occupiedCells.get(key);
          if (occupants) occupants.push(building);
          else this.occupiedCells.set(key, [building]);
        }
      }
    }
  }

  /** Resolve all alive edge neighbors in stable edge order, de-duplicated by building ID. */
  getNeighbors(building: Building): BuildingNeighborhood {
    if (building.hp <= 0) return emptyNeighborhood();
    const width = footprintDimension(building.widthInCells);
    const height = footprintDimension(building.heightInCells);
    const neighbors: Record<CardinalDirection, Building[]> = { north: [], east: [], south: [], west: [] };
    const seen: Record<CardinalDirection, Set<string>> = {
      north: new Set(), east: new Set(), south: new Set(), west: new Set()
    };
    const collect = (direction: CardinalDirection, gx: number, gy: number) => {
      for (const candidate of this.occupiedCells.get(cellKey(gx, gy)) ?? []) {
        if (candidate.id === building.id || seen[direction].has(candidate.id)) continue;
        seen[direction].add(candidate.id);
        neighbors[direction].push(candidate);
      }
    };

    for (let dx = 0; dx < width; dx++) {
      collect('north', building.gx + dx, building.gy - 1);
      collect('south', building.gx + dx, building.gy + height);
    }
    for (let dy = 0; dy < height; dy++) {
      collect('east', building.gx + width, building.gy + dy);
      collect('west', building.gx - 1, building.gy + dy);
    }

    return neighbors;
  }
}
