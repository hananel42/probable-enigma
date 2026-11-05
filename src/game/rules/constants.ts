
export const GRID_SIZE = 48;

/** Shared pickup/deposit radius for player commanders, AI commanders, and harvesters. */
export const STATION_INTERACTION_RADIUS = 88;

export const MAX_BUILDING_LEVEL = 5;

/**
 * Drones keep two full tiles of clearance around structures. Hover points and
 * routes are therefore planned outside the corner-collision envelope rather than
 * allowing a drone to skim walls and become trapped in a repeated collision.
 */
export const AIR_BUILDING_CLEARANCE_CELLS = 2;
