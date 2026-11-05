import type { GameSnapshot } from '../server/protocol';
import type { Building } from '../types';

/** Resolve HUD identity from the projected Commander, never from array ordering. */
export function resolveHudParticipant(state: GameSnapshot) {
  return state.humanPlayers.find(participant =>
    participant.commanderId === state.player.id || participant.playerId === state.player.ownerPlayerId
  );
}

/** The HUD must display the Core assigned to this participant, not the first player-faction Core. */
export function resolveHudCore(state: GameSnapshot): Building | undefined {
  const participant = resolveHudParticipant(state);
  if (!participant) return undefined;
  return state.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
}

/** Freeze the displayed survival clock at first defeat; a new run has a null timestamp. */
export function resolveHudSurvivalTime(state: GameSnapshot): number {
  const participant = resolveHudParticipant(state);
  return participant?.defeatedAtGameTime ?? state.gameTime;
}
