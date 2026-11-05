import type { Building, GameEntity } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import { areHostile, getCombatTeamId, isAliveEntity } from '../../combat';
import type { DroneBuildingIndex, DroneEntityIndex } from './model';
import { DroneAIState } from './DroneAIState';

export abstract class DroneAIIndexing extends DroneAIState {

  /**
   * Diplomacy may change in-place while entity/building arrays keep their identity.
   * Clear derived connectivity/orbit caches when the authority changes alliances.
   */
  public override invalidateGroupRelations(): void {
    this.clusterCache.clear();
    this.defenseOrbitRoutes.clear();
    this.entityIndexCache = undefined;
    this.buildingIndexCache = undefined;
    this.lastBroadcastByTeamTarget.clear();
  }

  /** Index repeatedly queried entity collections once, not once per drone. */
  protected override getEntityIndex(entities: GameEntity[]): DroneEntityIndex {
    const middle = entities[Math.floor(entities.length / 2)];
    const cached = this.entityIndexCache;
    if (cached && cached.entities === entities && cached.length === entities.length &&
        cached.first === entities[0] && cached.middle === middle && cached.last === entities[entities.length - 1]) {
      return cached;
    }

    const byId = new Map<string, GameEntity>();
    const dronesByTeam = new Map<string, GameEntity[]>();
    const dronesByStation = new Map<string, GameEntity[]>();
    const commandersByTeam = new Map<string, GameEntity>();
    for (const entity of entities) {
      byId.set(entity.id, entity);
      const teamId = getCombatTeamId(entity);
      if (entity.kind === 'COMMANDER' && isAliveEntity(entity) && !commandersByTeam.has(teamId)) {
        commandersByTeam.set(teamId, entity);
      }
      if (entity.kind !== 'DRONE' || !isAliveEntity(entity)) continue;
      const teamDrones = dronesByTeam.get(teamId);
      if (teamDrones) teamDrones.push(entity);
      else dronesByTeam.set(teamId, [entity]);
      if (entity.parentStationId) {
        const stationDrones = dronesByStation.get(entity.parentStationId);
        if (stationDrones) stationDrones.push(entity);
        else dronesByStation.set(entity.parentStationId, [entity]);
      }
    }

    const escortFormationById = new Map<string, { index: number; count: number }>();
    const stationFormationById = new Map<string, { index: number; count: number }>();
    for (const group of dronesByTeam.values()) {
      for (let index = 0; index < group.length; index++) {
        escortFormationById.set(group[index].id, { index, count: group.length });
      }
    }
    for (const group of dronesByStation.values()) {
      for (let index = 0; index < group.length; index++) {
        stationFormationById.set(group[index].id, { index, count: group.length });
      }
    }

    this.entityIndexCache = {
      entities, length: entities.length, first: entities[0], middle,
      last: entities[entities.length - 1], byId, dronesByTeam, dronesByStation,
      commandersByTeam, escortFormationById, stationFormationById
    };
    return this.entityIndexCache;
  }

  /** Resolve building ids in O(1); footprint topology changes invalidate by array/length. */
  protected override getBuildingIndex(buildings: Building[]): DroneBuildingIndex {
    const middle = buildings[Math.floor(buildings.length / 2)];
    const cached = this.buildingIndexCache;
    if (cached && cached.buildings === buildings && cached.length === buildings.length &&
        cached.first === buildings[0] && cached.middle === middle && cached.last === buildings[buildings.length - 1]) {
      return cached;
    }
    const byId = new Map<string, Building>();
    for (const building of buildings) byId.set(building.id, building);
    this.buildingIndexCache = {
      buildings, length: buildings.length, first: buildings[0], middle,
      last: buildings[buildings.length - 1], byId
    };
    return this.buildingIndexCache;
  }

  /**
   * Finds the connected friendly compound with bucketed neighbour queries.
   * Since topology normally changes only when a structure is built/destroyed,
   * cache the result and avoid repeating the connectivity walk per drone/frame.
   */
  public override getConnectedBuildingCluster(station: Building, allBuildings: Building[], nowSeconds = performance.now() / 1000): Building[] {
    const cached = this.clusterCache.get(station.id);
    if (cached && cached.buildings === allBuildings && cached.buildingCount === allBuildings.length &&
        nowSeconds < cached.expiresAt) {
      return cached.cluster;
    }

    const friendly = allBuildings.filter(building =>
      !areHostile(station, building) && building.hp > 0
    );
    const connectThreshold = GRID_SIZE * 2.6;
    // Nearby-cell buckets turn the connected-compound traversal from repeatedly
    // comparing every building with every other building into a local search.
    const bucketSize = connectThreshold;
    const bucketKey = (x: number, y: number) => `${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)}`;
    const buildingBuckets = new Map<string, Building[]>();
    for (const building of friendly) {
      const key = bucketKey(building.x, building.y);
      const bucket = buildingBuckets.get(key);
      if (bucket) bucket.push(building);
      else buildingBuckets.set(key, [building]);
    }
    const cluster: Building[] = [];
    const visited = new Set<string>();
    const queue: Building[] = [];
    const start = friendly.find(building => building.id === station.id);
    if (start) {
      queue.push(start);
      visited.add(start.id);
    }
    let maxDistance = 40;
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      cluster.push(current);
      maxDistance = Math.max(maxDistance, distance(station.x, station.y, current.x, current.y));
      const bucketX = Math.floor(current.x / bucketSize);
      const bucketY = Math.floor(current.y / bucketSize);
      for (let bx = bucketX - 1; bx <= bucketX + 1; bx++) {
        for (let by = bucketY - 1; by <= bucketY + 1; by++) {
          const nearby = buildingBuckets.get(`${bx},${by}`);
          if (!nearby) continue;
          for (const building of nearby) {
            if (visited.has(building.id)) continue;
            if (distance(current.x, current.y, building.x, building.y) > connectThreshold) continue;
            visited.add(building.id);
            queue.push(building);
          }
        }
      }
    }

    this.clusterCache.set(station.id, {
      expiresAt: nowSeconds + 5.0,
      buildingCount: allBuildings.length,
      buildings: allBuildings,
      cluster,
      maxDistance
    });
    return cluster;
  }
}
