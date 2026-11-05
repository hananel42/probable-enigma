import type { ResourceNode } from '../types';
import { GRID_SIZE } from './constants';

/**
 * Incremental spatial index for the persistent resource field.
 * World chunks are never discarded because distant harvesters may be travelling
 * to them, so linear scans of the full resource list become progressively more
 * expensive. This index updates only when new nodes are appended; amounts are
 * read from the live node objects, so depletion is reflected immediately.
 */
const RESOURCE_BUCKET_CELLS = 12;

interface ResourceSpatialIndex {
  indexedLength: number;
  byCell: Map<string, ResourceNode[]>;
  byId: Map<string, ResourceNode>;
  byBucket: Map<string, ResourceNode[]>;
  minGx: number;
  minGy: number;
  maxGx: number;
  maxGy: number;
}

const resourceSpatialIndexes = new WeakMap<ResourceNode[], ResourceSpatialIndex>();

const resourceCellKey = (gx: number, gy: number) => `${gx},${gy}`;

const resourceBucketKey = (gx: number, gy: number) =>
  `${Math.floor(gx / RESOURCE_BUCKET_CELLS)},${Math.floor(gy / RESOURCE_BUCKET_CELLS)}`;

function appendResourceToIndex(index: ResourceSpatialIndex, node: ResourceNode) {
  const cellKey = resourceCellKey(node.gx, node.gy);
  const sameCell = index.byCell.get(cellKey);
  if (sameCell) sameCell.push(node);
  else index.byCell.set(cellKey, [node]);

  const bucketKey = resourceBucketKey(node.gx, node.gy);
  const bucket = index.byBucket.get(bucketKey);
  if (bucket) bucket.push(node);
  else index.byBucket.set(bucketKey, [node]);

  index.byId.set(node.id, node);
  index.minGx = Math.min(index.minGx, node.gx);
  index.minGy = Math.min(index.minGy, node.gy);
  index.maxGx = Math.max(index.maxGx, node.gx);
  index.maxGy = Math.max(index.maxGy, node.gy);
}

function getResourceSpatialIndex(resources: ResourceNode[]): ResourceSpatialIndex {
  let index = resourceSpatialIndexes.get(resources);
  if (!index || resources.length < index.indexedLength) {
    index = {
      indexedLength: 0,
      byCell: new Map(),
      byId: new Map(),
      byBucket: new Map(),
      minGx: Number.POSITIVE_INFINITY,
      minGy: Number.POSITIVE_INFINITY,
      maxGx: Number.NEGATIVE_INFINITY,
      maxGy: Number.NEGATIVE_INFINITY
    };
    if (resources.length > 0) {
      index.minGx = index.maxGx = resources[0].gx;
      index.minGy = index.maxGy = resources[0].gy;
    }
    resourceSpatialIndexes.set(resources, index);
  }

  // Only index new nodes. A harvest changes amount but does not change topology.
  for (let i = index.indexedLength; i < resources.length; i++) {
    appendResourceToIndex(index, resources[i]);
  }
  index.indexedLength = resources.length;
  return index;
}

/** Returns the live, non-depleted resource in a cell, if any. */
export function getResourceNodeAtCell(
  resources: ResourceNode[],
  gx: number,
  gy: number
): ResourceNode | undefined {
  return getResourceSpatialIndex(resources).byCell.get(resourceCellKey(gx, gy))?.find(node => node.amount > 0);
}

/** O(1) resource lookup used by AI and render hints. */
export function getResourceNodeById(resources: ResourceNode[], id: string | null | undefined): ResourceNode | undefined {
  if (!id) return undefined;
  return getResourceSpatialIndex(resources).byId.get(id);
}

/**
 * Returns resources in an inclusive grid-cell rectangle using 12x12-cell buckets.
 * Depleted nodes may be included for rendering; their live amount is preserved.
 */
export function getResourceNodesInCellBounds(
  resources: ResourceNode[],
  minGx: number,
  minGy: number,
  maxGx: number,
  maxGy: number,
  includeDepleted = true
): ResourceNode[] {
  const index = getResourceSpatialIndex(resources);
  const result: ResourceNode[] = [];
  const minBx = Math.floor(minGx / RESOURCE_BUCKET_CELLS);
  const maxBx = Math.floor(maxGx / RESOURCE_BUCKET_CELLS);
  const minBy = Math.floor(minGy / RESOURCE_BUCKET_CELLS);
  const maxBy = Math.floor(maxGy / RESOURCE_BUCKET_CELLS);
  for (let bx = minBx; bx <= maxBx; bx++) {
    for (let by = minBy; by <= maxBy; by++) {
      const bucket = index.byBucket.get(`${bx},${by}`);
      if (!bucket) continue;
      for (const node of bucket) {
        if (node.gx < minGx || node.gx > maxGx || node.gy < minGy || node.gy > maxGy) continue;
        if (!includeDepleted && node.amount <= 0) continue;
        result.push(node);
      }
    }
  }
  return result;
}

/** Extents of all loaded resource nodes, including depleted nodes. */
export function getResourceGridBounds(resources: ResourceNode[]) {
  const index = getResourceSpatialIndex(resources);
  if (resources.length === 0) return { minGx: 0, minGy: 0, maxGx: 0, maxGy: 0 };
  return {
    minGx: index.minGx,
    minGy: index.minGy,
    maxGx: index.maxGx,
    maxGy: index.maxGy
  };
}

/** Fetch all active resources in a world-space square around a point. */
export function getResourceNodesNear(
  resources: ResourceNode[],
  x: number,
  y: number,
  radius: number
): ResourceNode[] {
  return getResourceNodesInCellBounds(
    resources,
    Math.floor((x - radius) / GRID_SIZE),
    Math.floor((y - radius) / GRID_SIZE),
    Math.floor((x + radius) / GRID_SIZE),
    Math.floor((y + radius) / GRID_SIZE),
    false
  );
}
