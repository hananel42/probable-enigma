import type { Building } from './types';

interface BuildingOperationalIndex {
  length: number;
  first: Building | undefined;
  middle: Building | undefined;
  last: Building | undefined;
  byId: Map<string, Building>;
  coresByTeam: Map<string, Building[]>;
}

/**
 * Shared structural index for repeated operational checks during target scans.
 * The arrays contain live Building references, so changing Core HP takes effect
 * immediately without rebuilding the index. Structural array changes invalidate it.
 */
const operationalIndexes = new WeakMap<readonly Building[], BuildingOperationalIndex>();

function getOperationalIndex(buildings: readonly Building[]): BuildingOperationalIndex {
  const length = buildings.length;
  const first = buildings[0];
  const middle = buildings[Math.floor(length / 2)];
  const last = buildings[length - 1];
  const cached = operationalIndexes.get(buildings);
  if (cached && cached.length === length && cached.first === first &&
      cached.middle === middle && cached.last === last) return cached;

  const byId = new Map<string, Building>();
  const coresByTeam = new Map<string, Building[]>();
  for (const building of buildings) {
    // Preserve Array.find semantics for duplicate IDs by retaining the first one.
    if (!byId.has(building.id)) byId.set(building.id, building);
    if (building.type !== 'CORE') continue;
    const teamId = building.teamId || building.faction;
    const teamCores = coresByTeam.get(teamId);
    if (teamCores) teamCores.push(building);
    else coresByTeam.set(teamId, [building]);
  }

  const index = { length, first, middle, last, byId, coresByTeam };
  operationalIndexes.set(buildings, index);
  return index;
}

/** A structure remains salvageable but is inert when its owning team's Core is gone. */
export function isBuildingOperational(building: Building, buildings: readonly Building[]): boolean {
  if (!Number.isFinite(building.hp) || building.hp < 0) {
    throw new RangeError(`Building '${building.id}' has invalid HP while checking operational status: ${building.hp}.`);
  }
  if (building.hp === 0) return false;
  if (building.type === 'CORE') return true;

  const index = getOperationalIndex(buildings);
  if (building.coreId) {
    const core = index.byId.get(building.coreId);
    if (!core || core.type !== 'CORE') return false;
    if (!Number.isFinite(core.hp) || core.hp < 0) {
      throw new RangeError(`Core '${core.id}' has invalid HP while checking building '${building.id}': ${core.hp}.`);
    }
    return core.hp > 0;
  }

  // Generated enemy-base structures use teamId without a coreId. Querying the
  // team's small Core list avoids scanning every building for every target scan.
  const ownerId = building.teamId || building.faction;
  const teamCores = index.coresByTeam.get(ownerId) || [];
  for (const core of teamCores) {
    if (!Number.isFinite(core.hp) || core.hp < 0) {
      throw new RangeError(`Core '${core.id}' has invalid HP while checking building '${building.id}': ${core.hp}.`);
    }
    if (core.hp > 0) return true;
  }
  return false;
}

/** Non-Core structures belonging to a destroyed/missing Core can be salvaged by any commander. */
export function isOrphanedStructure(building: Building, buildings: readonly Building[]): boolean {
  const operational = isBuildingOperational(building, buildings);
  return building.type !== 'CORE' && building.hp > 0 && !operational;
}
