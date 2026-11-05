/** Shared unupgraded weapon baseline. Keep Commander and Auto-Turret parity here. */
export const BASE_WEAPON_TUNING = Object.freeze({
  damage: 30,
  fireCooldown: 0.18,
  range: 360,
  projectileSpeed: 450,
  projectileRadius: 4,
  muzzleOffset: 19
});

/** Base Commander movement speed in world pixels per second; keep entity creation and AI comparisons aligned. */
export const BASE_COMMANDER_SPEED = 195;

/** Baseline drone weapon and low-health kamikaze tuning. Range remains measured in grid cells. */
export const BASE_DRONE_TUNING = Object.freeze({
  damage: 32,
  fireCooldown: 0.28,
  weaponRangeInGridCells: 2.8,
  kamikazeSpeedMultiplier: 1.2
});
