import type { BuildingBehavior } from '../types';
/** Walls block movement; damage mitigation is handled by the shared combat system. */
export const behavior: BuildingBehavior = { kind: 'FORTIFICATION', blocksGround: true, blocksAir: true };
