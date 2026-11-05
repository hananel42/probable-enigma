import type { Building } from './types';
import { GRID_SIZE, distance } from './rules';

/** Maximum commander-to-structure distance for direct structure actions. */
export const STRUCTURE_INTERACTION_RANGE = 155;

/**
 * Select the structure currently relevant to the cursor. A hovered structure wins
 * when it is in interaction range; otherwise choose the nearest structure in range.
 * This single rule is shared by the HUD and world outline so upgrades cannot silently
 * target a different building from the one shown as selected.
 */
export function resolveContextBuilding(
  buildings: readonly Building[],
  commander: { x: number; y: number },
  pointer: { x: number; y: number },
  range = STRUCTURE_INTERACTION_RANGE
): Building | undefined {
  const inRange = buildings.filter(building => building.hp > 0 &&
    distance(commander.x, commander.y, building.x, building.y) <= range);
  if (inRange.length === 0) return undefined;

  const gx = Math.floor(pointer.x / GRID_SIZE);
  const gy = Math.floor(pointer.y / GRID_SIZE);
  const hovered = inRange.find(building => {
    const width = building.widthInCells || 1;
    const height = building.heightInCells || 1;
    return gx >= building.gx && gx < building.gx + width &&
      gy >= building.gy && gy < building.gy + height;
  });
  if (hovered) return hovered;
  return inRange.reduce((nearest, building) =>
    distance(commander.x, commander.y, building.x, building.y) <
      distance(commander.x, commander.y, nearest.x, nearest.y) ? building : nearest
  );
}
