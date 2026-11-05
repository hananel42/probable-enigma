import type { Building } from '../types';

/**
 * Spatial index for static building footprints. Entity movement asks whether
 * many individual cells are obstructed every frame; scanning every building
 * for each cell made large bases progressively more expensive. Building
 * topology changes are detected through array identity/length, while live HP is
 * read from the indexed objects so destruction is immediately respected.
 */
const BUILDING_BUCKET_CELLS = 12;

interface BuildingSpatialIndex {
  indexedLength: number;
  byBucket: Map<string, Building[]>;
}

const buildingSpatialIndexes = new WeakMap<Building[], BuildingSpatialIndex>();

const buildingBucketKey = (gx: number, gy: number) =>
  `${Math.floor(gx / BUILDING_BUCKET_CELLS)},${Math.floor(gy / BUILDING_BUCKET_CELLS)}`;

function getBuildingSpatialIndex(buildings: Building[]): BuildingSpatialIndex {
  let index = buildingSpatialIndexes.get(buildings);
  if (!index || index.indexedLength !== buildings.length) {
    index = { indexedLength: buildings.length, byBucket: new Map() };
    for (const building of buildings) {
      const width = building.widthInCells || 1;
      const height = building.heightInCells || 1;
      const minBx = Math.floor(building.gx / BUILDING_BUCKET_CELLS);
      const maxBx = Math.floor((building.gx + width - 1) / BUILDING_BUCKET_CELLS);
      const minBy = Math.floor(building.gy / BUILDING_BUCKET_CELLS);
      const maxBy = Math.floor((building.gy + height - 1) / BUILDING_BUCKET_CELLS);
      for (let bx = minBx; bx <= maxBx; bx++) {
        for (let by = minBy; by <= maxBy; by++) {
          const key = `${bx},${by}`;
          const bucket = index.byBucket.get(key);
          if (bucket) bucket.push(building);
          else index.byBucket.set(key, [building]);
        }
      }
    }
    buildingSpatialIndexes.set(buildings, index);
  }
  return index;
}

/** Return live-index candidates whose physical footprints overlap a cell range. */
export function getBuildingCandidatesInCellBounds(
  buildings: Building[],
  minGx: number,
  minGy: number,
  maxGx: number,
  maxGy: number
): Building[] {
  const index = getBuildingSpatialIndex(buildings);
  const minBx = Math.floor(minGx / BUILDING_BUCKET_CELLS);
  const maxBx = Math.floor(maxGx / BUILDING_BUCKET_CELLS);
  const minBy = Math.floor(minGy / BUILDING_BUCKET_CELLS);
  const maxBy = Math.floor(maxGy / BUILDING_BUCKET_CELLS);
  const seen = new Set<Building>();
  const result: Building[] = [];
  for (let bx = minBx; bx <= maxBx; bx++) {
    for (let by = minBy; by <= maxBy; by++) {
      const bucket = index.byBucket.get(`${bx},${by}`);
      if (!bucket) continue;
      for (const building of bucket) {
        if (seen.has(building)) continue;
        seen.add(building);
        const width = building.widthInCells || 1;
        const height = building.heightInCells || 1;
        if (building.gx > maxGx || building.gx + width - 1 < minGx ||
            building.gy > maxGy || building.gy + height - 1 < minGy) continue;
        result.push(building);
      }
    }
  }
  return result;
}
