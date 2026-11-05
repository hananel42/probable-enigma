import { EntityKind } from '../types';

export type EntityCategory = 'COMMAND' | 'COMBAT' | 'ECONOMY';

export interface FactionEntityPalette {
  primary: string;
  secondary: string;
  trim: string;
  glow: string;
}

export interface EntityDefinition {
  name: string;
  category: EntityCategory;
  /** Armed entities are prioritized over structures when automatically acquiring targets. */
  canAttack: boolean;
  targetTier: number;
  visual: {
    player: FactionEntityPalette;
    enemy: FactionEntityPalette;
  };
}

/**
 * Data-only unit catalog: names, combat role, and visual palette live together.
 * Unit movement/behavior is implemented in its controller module. When adding a
 * new EntityKind, add one complete entry here before wiring its factory and AI.
 */
export const ENTITY_CATALOG: Record<EntityKind, EntityDefinition> = {
  COMMANDER: {
    name: 'Commander Robot', category: 'COMMAND', canAttack: true, targetTier: 0,
    visual: {
      player: { primary: '#38bdf8', secondary: '#67e8f9', trim: '#0284c7', glow: 'rgba(56, 189, 248, 0.35)' },
      enemy: { primary: '#ef4444', secondary: '#fca5a5', trim: '#991b1b', glow: 'rgba(244, 63, 94, 0.35)' }
    }
  },
  DRONE: {
    name: 'Combat Drone', category: 'COMBAT', canAttack: true, targetTier: 0,
    visual: {
      player: { primary: '#38bdf8', secondary: '#67e8f9', trim: '#0284c7', glow: 'rgba(56, 189, 248, 0.35)' },
      enemy: { primary: '#f43f5e', secondary: '#fda4af', trim: '#be123c', glow: 'rgba(244, 63, 94, 0.35)' }
    }
  },
  HARVESTER_BOT: {
    name: 'Harvester Rover', category: 'ECONOMY', canAttack: false, targetTier: 5,
    visual: {
      player: { primary: '#10b981', secondary: '#6ee7b7', trim: '#065f46', glow: 'rgba(16, 185, 129, 0.25)' },
      enemy: { primary: '#f59e0b', secondary: '#fcd34d', trim: '#92400e', glow: 'rgba(245, 158, 11, 0.25)' }
    }
  }
};

/** Kept as a compact selector-facing map, generated from the catalog. */
export const ENTITY_COMBAT_PROFILES = Object.fromEntries(
  Object.entries(ENTITY_CATALOG).map(([kind, definition]) => [kind, {
    canAttack: definition.canAttack,
    targetTier: definition.targetTier
  }])
) as Record<EntityKind, { canAttack: boolean; targetTier: number }>;
