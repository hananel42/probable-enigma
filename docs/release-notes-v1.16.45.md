# Release Notes — v1.16.45

## Drone combat tuning

- Low-health kamikaze drones now move at 1.15× the hostile Commander's effective movement speed, rather than multiplying the drone's own high cruise speed. The speed relationship stays consistent with the player/Commander and respects temporary movement effects on the reference Commander.
- Increased the base drone firing rate from one shot every 0.38 seconds to one shot every 0.28 seconds (about 3.6 shots/second before modifiers).
- Preserved the combat weapon range at 2.8 grid cells. New drone instances and runtime AI now initialize the same range, rather than briefly starting with a different value.
- Kept drone base damage at 32 and aligned newly created drone state and Drone Station inspection values with the existing combat value. The inspector now shows effective station shots per second instead of only a multiplier.

## Simulation performance

- `isBuildingOperational` now uses a weakly cached index by Core ID and team. Core HP is checked live on each query; when a building is added/removed or index boundary references change, the index is rebuilt.
- This removes repeated full-building-array scans from hostile target selection for generated enemy structures that have a `teamId` but no explicit `coreId`, reducing that hot path from repeated near-quadratic scans to a single building pass plus small per-team Core checks.
- Kept the simulation-clock overload warning enabled. It now reports average and maximum `engine.step()` duration, counts of entities/drones/buildings/resources/projectiles, and dropped ticks so future warnings distinguish slow simulation steps from other main-thread blocking.

## Validation

- `node scripts/test-simulation.mjs`: **299/299 tests passed**.
- Full production build was not run. The TypeScript test runner transpiled the full regression-test dependency graph; browser performance profiling was not available in this workspace, so any remaining overload warning should be interpreted using the new timing and world-count diagnostics.
