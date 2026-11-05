import type { GameEntity, ResourceNode } from '../../types';

export interface CommanderActionFeedback {
  onSpark?: (x: number, y: number, color: string, count: number) => void;
  onFloatingText?: (x: number, y: number, text: string, color: string) => void;
}

/**
 * Assign one direct-mining job without resetting an extraction that is already
 * in progress. The strategic planner can run more often than the two-second
 * extraction cycle (especially while a Core needs repair); reselecting the same
 * deposit must not reset its progress on every planning tick.
 */
export function assignMiningGoal(commander: GameEntity, node: ResourceNode): void {
  const continuingSameJob = commander.aiGoal === 'MINE_RESOURCE' &&
    commander.aiTargetResourceId === node.id;

  if (!continuingSameJob) {
    commander.isActivelyMining = false;
    commander.miningProgress = 0;
    commander.miningTargetId = null;
  }

  commander.aiGoal = 'MINE_RESOURCE';
  commander.aiTargetResourceId = node.id;
  commander.aiTargetBuildingId = null;
  commander.aiTargetEntityId = null;
  commander.aiBuildType = null;
}
