import type { BuildingType, BuildingBlueprint } from '../types';
import type { BuildingDefinition, BuildingPresentation } from '../buildings/types';
import { BUILDING_MODULES } from '../buildings/registry';

/** Current aggregate catalog derived from the authoritative building modules. */
export type { BuildingDefinition, BuildingPresentation, BuildingCategory, BuildingCombatRole } from '../buildings/types';
export const BUILDING_CATALOG = Object.fromEntries(
  Object.entries(BUILDING_MODULES).map(([type, module]) => [type, module.definition])
) as Record<BuildingType, BuildingDefinition>;

/** Build hotbar blueprints are derived from the module registry; Core remains non-buildable. */
export const BUILDING_BLUEPRINTS = Object.fromEntries(
  Object.entries(BUILDING_CATALOG).filter(([type]) => type !== 'CORE')
) as unknown as Record<Exclude<BuildingType, 'CORE'>, BuildingBlueprint>;

export const CORE_BLUEPRINT = {
  name: BUILDING_CATALOG.CORE.name,
  cost: { ...BUILDING_CATALOG.CORE.cost },
  hp: BUILDING_CATALOG.CORE.hp,
  range: BUILDING_CATALOG.CORE.range,
  widthInCells: BUILDING_CATALOG.CORE.widthInCells,
  heightInCells: BUILDING_CATALOG.CORE.heightInCells
};

const BUILDING_ROLE_TARGET_TIER: Record<BuildingDefinition['combatRole'], number> = {
  NONE: 4,
  WEAPON: 1,
  SPAWN: 2,
  SUPPORT: 3,
  FORTIFICATION: 4
};

export const BUILDING_COMBAT_PROFILES = Object.fromEntries(
  Object.entries(BUILDING_CATALOG).map(([type, definition]) => [type, {
    canAttack: definition.combatRole === 'WEAPON',
    targetTier: BUILDING_ROLE_TARGET_TIER[definition.combatRole]
  }])
) as Record<BuildingType, { canAttack: boolean; targetTier: number }>;
