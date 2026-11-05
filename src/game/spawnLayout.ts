import { GRID_SIZE } from './rules';

/** World-space spawn information for one human participant in a Free-for-All match. */
export interface FreeForAllSpawnSlot {
  readonly angle: number;
  readonly coreGx: number;
  readonly coreGy: number;
  readonly coreX: number;
  readonly coreY: number;
  readonly commanderX: number;
  readonly commanderY: number;
}

export interface FreeForAllSpawnLayoutOptions {
  /** Radius of the spawn ring in world pixels. Eight participants remain well separated at this radius. */
  readonly radius?: number;
  readonly gridSize?: number;
  readonly coreWidthInCells?: number;
  readonly coreHeightInCells?: number;
  readonly commanderRadius?: number;
}

/**
 * Calculate deterministic, evenly spaced FFA spawns.
 *
 * Spawn placement is computed once when the host creates a new world. It is
 * intentionally independent of player IDs and RNG, so reordering a roster is
 * the only thing that changes a player's slot. A solo FFA game keeps the
 * familiar central opening and guaranteed starter deposits.
 */
export function createFreeForAllSpawnLayout(
  participantCount: number,
  options: FreeForAllSpawnLayoutOptions = {}
): FreeForAllSpawnSlot[] {
  if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 8) {
    throw new RangeError(`FFA spawn layout requires between 1 and 8 participants; received ${participantCount}.`);
  }

  const gridSize = options.gridSize ?? GRID_SIZE;
  const radius = options.radius ?? 1_100;
  const coreWidth = options.coreWidthInCells ?? 2;
  const coreHeight = options.coreHeightInCells ?? 2;
  const commanderRadius = options.commanderRadius ?? 16;
  for (const [label, value] of Object.entries({ gridSize, radius, coreWidth, coreHeight, commanderRadius })) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be finite and greater than zero.`);
  }
  if (!Number.isInteger(coreWidth) || !Number.isInteger(coreHeight)) {
    throw new RangeError('Core footprint dimensions must be positive integers.');
  }

  if (participantCount === 1) {
    return [{ angle: 0, coreGx: -1, coreGy: -1, coreX: 0, coreY: 0, commanderX: 0, commanderY: 75 }];
  }

  return Array.from({ length: participantCount }, (_, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / participantCount;
    const requestedCoreX = Math.cos(angle) * radius;
    const requestedCoreY = Math.sin(angle) * radius;
    // The building factory uses the top-left cell and derives a footprint center.
    // Snap that center to a valid footprint location without duplicating the factory's math.
    const coreGx = Math.round(requestedCoreX / gridSize - coreWidth / 2);
    const coreGy = Math.round(requestedCoreY / gridSize - coreHeight / 2);
    const coreX = coreGx * gridSize + (coreWidth * gridSize) / 2;
    const coreY = coreGy * gridSize + (coreHeight * gridSize) / 2;
    // Put the Commander just beyond the Core's edge on the outward radial side.
    const coreBoundaryRadius = (coreWidth * gridSize / 2) * Math.abs(Math.cos(angle)) +
      (coreHeight * gridSize / 2) * Math.abs(Math.sin(angle));
    const commanderOffset = coreBoundaryRadius + commanderRadius + 14;

    return {
      angle,
      coreGx,
      coreGy,
      coreX,
      coreY,
      commanderX: coreX + Math.cos(angle) * commanderOffset,
      commanderY: coreY + Math.sin(angle) * commanderOffset
    };
  });
}
