# Release Notes — v1.16.52

## Type safety and drone wall-navigation fixes

- Fixed strict TypeScript errors in kamikaze impact damage validation by taking a local snapshot of optional `drone.damage`, validating its type and finite non-negative value, then using only the validated number. Invalid damage is reported explicitly; it is not replaced with a hidden default. Applied the same explicit invariant to normal drone weapons and removed the silent baseline-damage substitution, plus silent defaults for required drone fire timing and target velocity.
- Reduced A* waypoint-capture tolerance to 0.4 grid cells. A tolerance larger than a cell could consume two adjacent waypoints around a corner, making the controller aim diagonally into the intervening wall.
- Changed substepped collision integration to continue micro-steps after a blocked axis. Every sub-step remains collision-tested, while the other axis can advance along the wall instead of aborting the rest of the tick.
- Added a short, four-connected clearance-escape route for drones that begin in the expanded air-clearance ring but are not inside a physical building footprint. The generic A* start-cell relocation is no longer used for that case, because relocating the start to the far side of a wall does not physically connect the drone to it.
- Invalidate pending long-range A* results when switching to the local clearance-escape route so a stale worker reply cannot replace the connected route.
- Added a 0.65-second waypoint no-progress watchdog. It invalidates and replans a route that is not making physical progress, and emits a rate-limited `[navigation]` diagnostic containing drone and waypoint coordinates.
- Added regression cases for missing weapon damage, corner capture, wall sliding, clearance escape, stale worker results and detour steering.
