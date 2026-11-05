import type { GameMode } from './types';

export interface StructureAccessTarget {
  faction: 'player' | 'enemy';
  ownerPlayerId?: string | null;
}

/** Whether the current participant may manage a structure (upgrade, repair, dismantle, or configure it). */
export function canManagePlayerStructure(
  playerId: string | null | undefined,
  mode: GameMode,
  structure: StructureAccessTarget
): boolean {
  if (structure.faction !== 'player' || !playerId) return false;
  if (mode === 'COOPERATIVE') return true;
  return typeof structure.ownerPlayerId === 'string' && structure.ownerPlayerId === playerId;
}
