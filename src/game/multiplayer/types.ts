import type { Resources } from '../types';

/** Game ruleset selected when an authoritative world is created. */
export type GameMode = 'FREE_FOR_ALL' | 'TEAM' | 'COOPERATIVE';

export interface MultiplayerParticipantInput {
  playerId: string;
  groupId: string;
  commanderId: string;
  /** Used only for initial display metadata; simulation ownership uses stable IDs. */
  displayName?: string;
  color?: string;
}

/** A participant owns a commander and a private resource ledger in every mode. */
export interface MultiplayerPlayerState extends MultiplayerParticipantInput {
  resources: Resources;
  connected: boolean;
  allianceId: string;
  coreId: string;
}

/** Core ownership is distinct from who is allowed to use the structure. */
export interface MultiplayerCoreState {
  id: string;
  ownerPlayerId: string | null;
  shared: boolean;
}

export interface MultiplayerWorldState {
  readonly schemaVersion: 1;
  readonly mode: GameMode;
  readonly players: MultiplayerPlayerState[];
  readonly cores: MultiplayerCoreState[];
}

export type SpawnAnchor = { playerId: string; commanderId: string; coreId: string };
