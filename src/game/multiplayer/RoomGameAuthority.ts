import type { GameCommand, GameSnapshot, GameWorldFrame } from '../server/protocol';
import type { GameMode } from './types';

/**
 * Narrow room-facing boundary implemented by the authoritative game server.
 * Multiplayer protocol/lifecycle code depends only on this contract, not on
 * LocalGameServer or concrete simulation/renderer internals.
 */
export interface RoomParticipantIdentity {
  readonly playerId: string;
  readonly displayName: string;
}

export interface RoomGameAuthority {
  readonly worldId: string;
  readonly isRunning: boolean;
  getSnapshot(): GameSnapshot;
  getWorldFrame(): GameWorldFrame;
  captureWorldFrame(): GameWorldFrame;
  setMultiplayerMode(mode: GameMode): void;
  configureLobbyMode(mode: GameMode): void;
  /** Replace the dormant/finished simulation with a fresh authoritative world. */
  createWorld(mode: GameMode, participants: readonly RoomParticipantIdentity[]): void;
  /** Restore one defeated participant with a fresh Core in the active world. */
  reviveHumanParticipant(playerId: string): boolean;
  start(): void;
  stop(): void;
  addHumanParticipant(playerId: string, mode: GameMode): unknown;
  setHumanParticipantDisplayName(playerId: string, displayName: string): boolean;
  removeHumanParticipant(playerId: string): boolean;
  dispatchForPlayer(playerId: string, command: GameCommand): boolean;
}
