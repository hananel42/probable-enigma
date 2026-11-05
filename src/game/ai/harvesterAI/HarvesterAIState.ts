import type { Building, GameEntity, ResourceNode } from '../../types';

export abstract class HarvesterAIState {
  public abstract updateBot(bot: GameEntity, buildings: Building[], resourceNodes: ResourceNode[], dt: number, onDeposit?: (station: Building, wood: number, stone: number) => void): any;
  protected abstract chooseResource(bot: GameEntity, station: Building, resources: ResourceNode[], buildings: Building[]): any;
  protected abstract hasStationCapacityFor(station: Building, type: ResourceNode['type']): boolean;
  protected abstract depositCargo(bot: GameEntity, station: Building, onDeposit?: (station: Building, wood: number, stone: number) => void): any;
  protected abstract findStationApproachCandidate(bot: GameEntity, station: Building, buildings: Building[], resources: ResourceNode[]): { x: number; y: number } | undefined;
  protected abstract watchNavigationProgress(bot: GameEntity, dt: number, goalX: number, goalY: number): boolean;
  protected abstract resetNavigationWatchdog(bot: GameEntity): any;
  protected abstract clearTarget(bot: GameEntity): any;

}
