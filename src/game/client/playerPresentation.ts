import type { EngineHumanPlayer, GameEngineState } from '../engine';
import type { Building, GameGroup } from '../types';

export type PlayerBaseRelationship = 'HOME' | 'ALLY' | 'ENEMY';

export interface PlayerBaseNavigationTarget {
  playerId: string;
  label: string;
  relationship: PlayerBaseRelationship;
  color: string;
  core: Building;
}

export const PLAYER_BASE_INDICATOR_COLORS = Object.freeze({
  home: '#38bdf8',
  ally: '#4ade80',
  enemy: '#f43f5e'
});

/**
 * Resolve a rendered ownership group against the participant whose Commander
 * is currently projected into this client's local view. Group identity alone
 * is insufficient: FFA players are all in the `player` faction but are hostile.
 */
export function isGroupFriendlyToParticipant(
  group: GameGroup | undefined,
  participant: Pick<EngineHumanPlayer, 'groupId' | 'allianceId'>
): boolean {
  return Boolean(group && (
    group.id === participant.groupId ||
    group.allianceId === participant.allianceId
  ));
}

/**
 * Produce one navigation target for the local Core and one for each distinct
 * other participant Core. CO-OP participants share a Core and therefore do
 * not receive duplicate indicators. This is presentation-only derived state.
 */
export function resolvePlayerBaseNavigationTargets(
  state: Readonly<GameEngineState>
): PlayerBaseNavigationTarget[] {
  const localParticipant = state.humanPlayers.find(participant =>
    participant.commanderId === state.player.id || participant.playerId === state.player.ownerPlayerId
  );
  if (!localParticipant) {
    throw new Error(`Cannot resolve player base indicators: local Commander '${state.player.id}' has no participant record.`);
  }

  const coresById = new Map(
    state.buildings
      .filter(building => building.type === 'CORE')
      .map(building => [building.id, building] as const)
  );
  const targets: PlayerBaseNavigationTarget[] = [];
  const homeCore = coresById.get(localParticipant.coreId);
  if (homeCore) {
    targets.push({
      playerId: localParticipant.playerId,
      label: 'YOUR BASE',
      relationship: 'HOME',
      color: PLAYER_BASE_INDICATOR_COLORS.home,
      core: homeCore
    });
  }

  const representedCoreIds = new Set([localParticipant.coreId]);
  for (const participant of state.humanPlayers) {
    if (participant.playerId === localParticipant.playerId || representedCoreIds.has(participant.coreId)) continue;
    representedCoreIds.add(participant.coreId);

    const core = coresById.get(participant.coreId);
    if (!core) continue;

    const relationship = participant.allianceId === localParticipant.allianceId ? 'ALLY' : 'ENEMY';
    targets.push({
      playerId: participant.playerId,
      label: participant.displayName.toUpperCase(),
      relationship,
      color: relationship === 'ALLY' ? PLAYER_BASE_INDICATOR_COLORS.ally : PLAYER_BASE_INDICATOR_COLORS.enemy,
      core
    });
  }

  return targets;
}
