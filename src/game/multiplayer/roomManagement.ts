import type { GameMode } from './types';

export type RoomPhase = 'lobby' | 'playing' | 'paused' | 'results';
export type RoomPlayerPhase = 'alive' | 'defeated' | 'disconnected' | 'kicked';

export interface RoomPlayerStatus {
  readonly playerId: string;
  readonly displayName: string;
  readonly isHost: boolean;
  readonly connected: boolean;
  readonly phase: RoomPlayerPhase;
  /** Simulation seconds survived before defeat, disconnect, or the current clock. */
  readonly survivalSeconds: number;
}

export interface RoomManagementStatus {
  /** Lobby membership is room-scoped; a world exists only after the host starts one. */
  readonly hasWorld: boolean;
  /** World identity is null while the room is waiting for its first/next world. */
  readonly worldId: string | null;
  readonly phase: RoomPhase;
  readonly mode: GameMode;
  readonly gameTimeSeconds: number;
  readonly players: readonly RoomPlayerStatus[];
  readonly updatedAtMs: number;
}

const GAME_MODES = new Set<GameMode>(['FREE_FOR_ALL', 'TEAM', 'COOPERATIVE']);
const ROOM_PHASES = new Set<RoomPhase>(['lobby', 'playing', 'paused', 'results']);
const PLAYER_PHASES = new Set<RoomPlayerPhase>(['alive', 'defeated', 'disconnected', 'kicked']);

function isSetMember<T extends string>(values: ReadonlySet<T>, value: unknown): value is T {
  return typeof value === 'string' && values.has(value as T);
}

/** Validate room-control messages before they can affect the UI or room lifecycle. */
export function isRoomManagementStatus(value: unknown): value is RoomManagementStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = value as Partial<RoomManagementStatus>;
  if (!isSetMember(ROOM_PHASES, status.phase) || !isSetMember(GAME_MODES, status.mode) ||
      typeof status.hasWorld !== 'boolean' || !(status.worldId === null || (typeof status.worldId === 'string' && status.worldId.length > 0))) return false;
  if ((status.phase === 'lobby') === status.hasWorld || (status.hasWorld && status.worldId === null) || (!status.hasWorld && status.worldId !== null)) return false;
  if (typeof status.gameTimeSeconds !== 'number' || !Number.isFinite(status.gameTimeSeconds) || status.gameTimeSeconds < 0 ||
      typeof status.updatedAtMs !== 'number' || !Number.isSafeInteger(status.updatedAtMs) || status.updatedAtMs < 0 ||
      !Array.isArray(status.players) || status.players.length > 32) return false;
  const ids = new Set<string>();
  for (const candidate of status.players) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const player = candidate as Partial<RoomPlayerStatus>;
    if (typeof player.playerId !== 'string' || !player.playerId || player.playerId.length > 128 || ids.has(player.playerId) ||
        typeof player.displayName !== 'string' || player.displayName.length < 1 || player.displayName.length > 24 ||
        typeof player.isHost !== 'boolean' || typeof player.connected !== 'boolean' ||
        !isSetMember(PLAYER_PHASES, player.phase) ||
        typeof player.survivalSeconds !== 'number' || !Number.isFinite(player.survivalSeconds) || player.survivalSeconds < 0) return false;
    ids.add(player.playerId);
  }
  return true;
}
