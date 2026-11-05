import type { Building, GameEntity, Projectile, ResourceNode } from '../../types';
import type { DefenseOrbitRoute, DroneBuildingIndex, DroneEntityIndex, DroneFlightCurve } from './model';

export abstract class DroneAIState {
  public abstract invalidateGroupRelations(): void;
  protected abstract getEntityIndex(entities: GameEntity[]): DroneEntityIndex;
  protected abstract getBuildingIndex(buildings: Building[]): DroneBuildingIndex;
  public abstract getConnectedBuildingCluster(station: Building, allBuildings: Building[], nowSeconds?: any): Building[];
  protected abstract getAirObstacleCells(buildings: Building[], nowSeconds: number): Set<string>;
  protected abstract isAirCellBlocked(gx: number, gy: number, blockedCells: Set<string>): boolean;
  protected abstract getDefenseOrbitRoute(station: Building, allBuildings: Building[], cluster: Building[]): DefenseOrbitRoute;
  protected abstract advanceEllipsePhase(phase: number, radiusX: number, radiusY: number, linearSpeed: number, dt: number): any;
  protected abstract updateSmoothedFlightGoal(drone: GameEntity, targetX: number, targetY: number, dt: number, goalSpeed: number): any;
  protected abstract clearDroneNavigation(drone: GameEntity): any;
  protected abstract getClearCombatOrbit(centerX: number, centerY: number, baseRadiusX: number, baseRadiusY: number, buildings: Building[], maxRadius?: any): { radiusX: number; radiusY: number } | undefined;
  protected abstract moveOnDefenseOrbit(drone: GameEntity, route: DefenseOrbitRoute, buildings: Building[], resourceNodes: ResourceNode[], dt: number, maxSpeed: number): any;
  protected abstract pointOnCurve(curve: DroneFlightCurve, phase: number): any;
  protected abstract moveDroneOnCurve(drone: GameEntity, curve: DroneFlightCurve, dt: number, buildings: Building[], resources: ResourceNode[], maxSpeed: number): { moved: boolean; target: { x: number; y: number } };
  protected abstract updateKamikazeDrone(drone: GameEntity, entities: GameEntity[], buildings: Building[], dt: number): boolean;
  public abstract updateDrone(drone: GameEntity, player: GameEntity, buildings: Building[], entities: GameEntity[], projectiles: Projectile[], dt: number, resourceNodes?: ResourceNode[], gameTimeSeconds?: any): any;
  protected abstract resolveStoredCombatTarget(drone: GameEntity, entities: GameEntity[], buildings: Building[], maxRange: number): import('../../combat').PrioritizedCombatTarget | undefined;
  protected abstract resolveAlertTarget(drone: GameEntity, entities: GameEntity[], buildings: Building[]): import('../../combat').PrioritizedCombatTarget | undefined;
  protected abstract broadcastDefenseAlert(source: GameEntity, target: import('../../combat').PrioritizedCombatTarget, entities: GameEntity[], buildings: Building[], nowSeconds: number): any;
  protected abstract isDirectAirRouteBlocked(startX: number, startY: number, targetX: number, targetY: number, blockedCells: Set<string>): boolean;
  protected abstract findSafeHoverTarget(desiredX: number, desiredY: number, currentX: number, currentY: number, blockedCells: Set<string>, buildings: Building[]): { x: number; y: number };

  protected readonly clusterCache = new Map<string, {
    expiresAt: number;
    buildingCount: number;
    buildings: Building[];
    cluster: Building[];
    maxDistance: number;
  }>();

  protected airObstacleCache?: {
    expiresAt: number;
    buildings: Building[];
    buildingCount: number;
    blockedCells: Set<string>;
  };

  protected entityIndexCache?: DroneEntityIndex;

  protected buildingIndexCache?: DroneBuildingIndex;

  protected readonly lastBroadcastByTeamTarget = new Map<string, number>();

  protected readonly defenseOrbitRoutes = new Map<string, DefenseOrbitRoute>();
}
