import type { Resources } from '../types';
import { getGameModeRules } from './modeRules';
import type { GameMode, MultiplayerCoreState, MultiplayerParticipantInput, MultiplayerPlayerState, MultiplayerWorldState } from './types';

const EMPTY_RESOURCES: Resources = { wood: 0, stone: 0, diamonds: 0 };

/** Create a local authoritative multiplayer domain model. This does not open sockets or enable remote play. */
export function createMultiplayerWorld(
  mode: GameMode,
  participants: readonly MultiplayerParticipantInput[],
  initialResources: Resources = EMPTY_RESOURCES
): MultiplayerWorldState {
  const ids = new Set<string>();
  const commanderIds = new Set<string>();
  for (const participant of participants) {
    for (const [label, value] of Object.entries({ playerId: participant.playerId, groupId: participant.groupId, commanderId: participant.commanderId })) {
      if (!value.trim()) throw new Error(`${label} must not be empty.`);
    }
    if (ids.has(participant.playerId)) throw new Error(`Duplicate player ID: ${participant.playerId}`);
    ids.add(participant.playerId);
    if (commanderIds.has(participant.commanderId)) throw new Error(`Duplicate commander ID: ${participant.commanderId}`);
    commanderIds.add(participant.commanderId);
  }
  if (participants.length === 0) throw new Error('At least one participant is required.');
  if (![initialResources.wood, initialResources.stone, initialResources.diamonds].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Initial resources must be finite non-negative numbers.');
  }

  const rules = getGameModeRules(mode);
  const players: MultiplayerPlayerState[] = participants.map((participant, index) => ({
    ...participant,
    resources: { ...initialResources },
    connected: true,
    allianceId: mode === 'FREE_FOR_ALL' ? `alliance:${participant.playerId}` : 'alliance:humans',
    coreId: rules.corePolicy === 'shared-single-core' ? 'core:shared' : `core:${participant.playerId}`,
    color: participant.color ?? ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185'][index % 5]
  }));

  const cores: MultiplayerCoreState[] = rules.corePolicy === 'shared-single-core'
    ? [{ id: 'core:shared', ownerPlayerId: null, shared: true }]
    : players.map(player => ({ id: player.coreId, ownerPlayerId: player.playerId, shared: false }));

  return { schemaVersion: 1, mode, players, cores };
}

export function getParticipant(world: MultiplayerWorldState, playerId: string): MultiplayerPlayerState {
  const player = world.players.find(candidate => candidate.playerId === playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  return player;
}

/** Disconnecting a participant is local lifecycle state only; it does not remove their assets or resources. */
export function setParticipantConnected(world: MultiplayerWorldState, playerId: string, connected: boolean): void {
  getParticipant(world, playerId).connected = connected;
}
