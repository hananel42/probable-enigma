import type { GameMode, MultiplayerCoreState, MultiplayerPlayerState, SpawnAnchor } from './types';
import type { Resources } from '../types';

export interface OwnershipRef {
  ownerPlayerId?: string | null;
  ownerGroupId?: string | null;
  ownerAllianceId?: string | null;
  coreId?: string | null;
}

/** Mode behavior is pure and deterministic so the simulation and future transport use identical rules. */
export interface GameModeRules {
  readonly mode: GameMode;
  readonly corePolicy: 'one-per-player' | 'shared-single-core';
  readonly humanFriendlyFire: boolean;
  readonly enemySpawnPolicy: 'around-each-player' | 'around-player-team';
  canDamagePlayer(attackerPlayerId: string, targetPlayerId: string): boolean;
  canAccessStructure(player: MultiplayerPlayerState, structure: OwnershipRef): boolean;
  canUseCore(player: MultiplayerPlayerState, core: MultiplayerCoreState): boolean;
  resourcePayer(player: MultiplayerPlayerState): MultiplayerPlayerState;
  getSpawnAnchors(players: readonly MultiplayerPlayerState[]): SpawnAnchor[];
}

function samePlayer(a: string, b: string): boolean { return a === b; }

function createRules(mode: GameMode): GameModeRules {
  const cooperative = mode === 'COOPERATIVE';
  return {
    mode,
    corePolicy: cooperative ? 'shared-single-core' : 'one-per-player',
    humanFriendlyFire: mode === 'FREE_FOR_ALL',
    enemySpawnPolicy: mode === 'FREE_FOR_ALL' ? 'around-each-player' : 'around-player-team',
    canDamagePlayer: (attackerPlayerId, targetPlayerId) =>
      mode === 'FREE_FOR_ALL' ? !samePlayer(attackerPlayerId, targetPlayerId) : false,
    canAccessStructure: (player, structure) => {
      if (cooperative) return true;
      // A personal Core is never made usable merely because its owner is an ally.
      if (structure.coreId) return structure.ownerPlayerId === player.playerId;
      if (structure.ownerPlayerId === player.playerId || structure.ownerGroupId === player.groupId) return true;
      // Team mode allies are non-hostile, but each player retains exclusive
      // control of their own structures. Shared interaction belongs to CO-OP.
      return false;
    },
    canUseCore: (player, core) => cooperative || core.ownerPlayerId === player.playerId,
    resourcePayer: player => player,
    getSpawnAnchors: players => players
      .filter(player => player.connected)
      .map(player => ({ playerId: player.playerId, commanderId: player.commanderId, coreId: player.coreId }))
  };
}

export const GAME_MODE_RULES: Readonly<Record<GameMode, GameModeRules>> = Object.freeze({
  FREE_FOR_ALL: createRules('FREE_FOR_ALL'),
  TEAM: createRules('TEAM'),
  COOPERATIVE: createRules('COOPERATIVE')
});

export function getGameModeRules(mode: GameMode): GameModeRules { return GAME_MODE_RULES[mode]; }

/** Charge a cost only to the acting participant; never silently draw from allies' wallets. */
export function canAffordResources(wallet: Resources, cost: Resources): boolean {
  return wallet.wood >= cost.wood && wallet.stone >= cost.stone && wallet.diamonds >= cost.diamonds;
}

export function chargeResources(player: MultiplayerPlayerState, cost: Resources): boolean {
  if (!canAffordResources(player.resources, cost)) return false;
  player.resources = {
    wood: player.resources.wood - cost.wood,
    stone: player.resources.stone - cost.stone,
    diamonds: player.resources.diamonds - cost.diamonds
  };
  return true;
}
