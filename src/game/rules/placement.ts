import type { Building, ResourceNode } from '../types';
import { GRID_SIZE, AIR_BUILDING_CLEARANCE_CELLS } from './constants';
import { getBuildingCandidatesInCellBounds } from './buildingSpatialIndex';
import { getResourceNodeAtCell } from './resourceSpatialIndex';

export function isCellBlockedForGround(
  gx: number,
  gy: number,
  buildings: Building[],
  resources: ResourceNode[]
): boolean {
  for (const building of getBuildingCandidatesInCellBounds(buildings, gx, gy, gx, gy)) {
    if (building.hp <= 0) continue;
    const width = building.widthInCells || 1;
    const height = building.heightInCells || 1;
    if (gx >= building.gx && gx < building.gx + width &&
        gy >= building.gy && gy < building.gy + height) return true;
  }

  return Boolean(getResourceNodeAtCell(resources, gx, gy));
}

/** True only when a cell overlaps the physical footprint of a live building. */
export function isCellInsideBuildingFootprint(
  gx: number,
  gy: number,
  buildings: Building[]
): boolean {
  for (const building of getBuildingCandidatesInCellBounds(buildings, gx, gy, gx, gy)) {
    if (building.hp <= 0) continue;
    const width = building.widthInCells || 1;
    const height = building.heightInCells || 1;
    if (gx >= building.gx && gx < building.gx + width &&
        gy >= building.gy && gy < building.gy + height) return true;
  }
  return false;
}

export function isCellBlockedForAir(
  gx: number,
  gy: number,
  buildings: Building[]
): boolean {
  const clearance = AIR_BUILDING_CLEARANCE_CELLS;
  for (const building of getBuildingCandidatesInCellBounds(
    buildings, gx - clearance, gy - clearance, gx + clearance, gy + clearance
  )) {
    if (building.hp <= 0) continue;
    const width = building.widthInCells || 1;
    const height = building.heightInCells || 1;
    if (
      gx >= building.gx - clearance && gx < building.gx + width + clearance &&
      gy >= building.gy - clearance && gy < building.gy + height + clearance
    ) return true;
  }
  return false;
}

export function isAreaBuildable(
  startGx: number,
  startGy: number,
  widthInCells: number,
  heightInCells: number,
  buildings: Building[],
  resources: ResourceNode[]
): boolean {
  // Grid placement must be discrete and bounded to a real positive footprint.
  // This also prevents malformed remote/test commands from creating fractional
  // footprints or passing NaN coordinates through the overlap checks.
  if (![startGx, startGy, widthInCells, heightInCells].every(Number.isFinite) ||
      !Number.isInteger(startGx) || !Number.isInteger(startGy) ||
      !Number.isInteger(widthInCells) || !Number.isInteger(heightInCells) ||
      widthInCells < 1 || heightInCells < 1 || widthInCells > 16 || heightInCells > 16) {
    return false;
  }
  for (let dx = 0; dx < widthInCells; dx++) {
    for (let dy = 0; dy < heightInCells; dy++) {
      const gx = startGx + dx;
      const gy = startGy + dy;

      // Check existing buildings
      for (const b of getBuildingCandidatesInCellBounds(buildings, gx, gy, gx, gy)) {
        if (b.hp <= 0) continue;
        const bw = b.widthInCells || 1;
        const bh = b.heightInCells || 1;
        if (gx >= b.gx && gx < b.gx + bw && gy >= b.gy && gy < b.gy + bh) return false;
      }

      // O(1) lookup avoids scanning the complete, persistent world resource field.
      if (getResourceNodeAtCell(resources, gx, gy)) return false;
    }
  }
  return true;
}

export function isCellBuildable(
  gx: number,
  gy: number,
  buildings: Building[],
  resources: ResourceNode[]
): boolean {
  return isAreaBuildable(gx, gy, 1, 1, buildings, resources);
}

/**
 * Finds an adjacent unblocked tile outside of a building's perimeter.
 * Guarantees that newly deployed robots and drones are never spawned inside building geometry!
 */
export function findFreeAdjacentSpawnPosition(
  building: Building,
  isFlying: boolean,
  buildings: Building[],
  resources: ResourceNode[]
): { x: number; y: number } {
  const w = building.widthInCells || 1;
  const h = building.heightInCells || 1;
  const isBlocked = (gx: number, gy: number) => isFlying
    ? isCellBlockedForAir(gx, gy, buildings)
    : isCellBlockedForGround(gx, gy, buildings, resources);

  // Prefer the nearest open perimeter tile, but search beyond the first ring
  // when a station is surrounded by walls, resources, or another structure.
  for (let radius = 1; radius <= 32; radius++) {
    const candidates: Array<{ gx: number; gy: number; distance: number }> = [];
    const minGx = building.gx - radius;
    const maxGx = building.gx + w - 1 + radius;
    const minGy = building.gy - radius;
    const maxGy = building.gy + h - 1 + radius;
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        if (gx !== minGx && gx !== maxGx && gy !== minGy && gy !== maxGy) continue;
        if (isBlocked(gx, gy)) continue;
        const x = gx * GRID_SIZE + GRID_SIZE / 2;
        const y = gy * GRID_SIZE + GRID_SIZE / 2;
        candidates.push({ gx, gy, distance: Math.hypot(x - building.x, y - building.y) });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      return {
        x: candidates[0].gx * GRID_SIZE + GRID_SIZE / 2,
        y: candidates[0].gy * GRID_SIZE + GRID_SIZE / 2
      };
    }
  }

  // This only occurs in an unusually sealed compound; never spawn inside the
  // station itself. The expanding search above normally finds an exit quickly.
  return {
    x: building.x + (w * GRID_SIZE) / 2 + GRID_SIZE / 2,
    y: building.y + (h * GRID_SIZE) / 2 + GRID_SIZE / 2
  };
}
