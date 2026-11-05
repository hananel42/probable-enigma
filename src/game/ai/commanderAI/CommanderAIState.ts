import type { Building, EnemyBase, GameEntity, Projectile, ResourceNode, Resources } from '../../types';
import type { CommanderActionFeedback } from './model';

export abstract class CommanderAIState {
  public abstract updateCommander(commander: GameEntity, factionResources: Resources, buildings: Building[], resourceNodes: ResourceNode[], allEntities: GameEntity[], projectiles: Projectile[], enemyBases: EnemyBase[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract evaluateCommanderGoals(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], allEntities: GameEntity[], enemyBases: EnemyBase[]): any;
  protected abstract executeGuardCoreGoal(commander: GameEntity, buildings: Building[], resources: ResourceNode[], dt: number): any;
  protected abstract executeRepairGoal(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract executeDismantleGoal(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract executeUpgradeGoal(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract findDirectMiningTarget(commander: GameEntity, resources: ResourceNode[], buildings: Building[], preferredType: ResourceNode['type']): ResourceNode | undefined;
  protected abstract executeMiningGoal(commander: GameEntity, wallet: Resources, resources: ResourceNode[], buildings: Building[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract executeCollectResourcesGoal(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract executeBuildGoal(commander: GameEntity, wallet: Resources, buildings: Building[], resources: ResourceNode[], allEntities: GameEntity[], enemyBases: EnemyBase[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract executeAttackGoal(commander: GameEntity, allEntities: GameEntity[], buildings: Building[], resources: ResourceNode[], projectiles: Projectile[], dt: number, feedback?: CommanderActionFeedback): any;
  protected abstract handleCombatSelfDefense(commander: GameEntity, allEntities: GameEntity[], buildings: Building[], projectiles: Projectile[], dt: number): any;
  protected abstract moveTowards(entity: GameEntity, targetX: number, targetY: number, buildings: Building[], resources: ResourceNode[], dt: number): any;

}
