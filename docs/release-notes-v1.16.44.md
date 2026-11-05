# Release Notes — v1.16.44

## Shared radial explosion system

- Added `src/game/explosions.ts` as the single reusable implementation for radial blast geometry, radius checks, exclusions, target eligibility, and damage falloff.
- Kamikaze drones and explosive projectile payloads now use the same helper. Each caller retains its own hostility rules, armour/damage application, reward handling, floating text, sparks, and audio.
- Projectile explosions preserve their existing flat-damage behavior and target-size reach; their gameplay balance is unchanged.
- Kamikaze drones use quadratic falloff across a three-grid-cell radius. Damage is strongest at the centre, one quarter at half radius, and zero at/outside the edge.
- Added isolated tests for quadratic falloff, edge exclusion, and preserved projectile behavior.

## Repository organization and maintenance

- Preserved public import paths for `GameEngine`, rules, shared types, and movement while moving their implementations behind small API barrels.
- Split the authoritative engine into behavior-owned layers for world setup, participant and command handling, input, placement/economy, simulation, autonomous systems, enemy bases, combat/projectiles, and lifecycle. Shared state and update ordering remain explicit in the internal class hierarchy.
- Split the simulation rules tests into 13 focused suites and separated shared fixtures. Also divided oversized host-room, guest-replica, and two-player integration suites by lifecycle/protocol responsibility.
- Extracted multiplayer UI/session logic and HUD sections into focused React modules; kept UI as a projection of authoritative state.
- Split commander, harvester, and drone AI into behavior layers, keeping the original AI imports as small facades. Split the host room controller, guest replica and PeerJS client into layers for lifecycle, dispatch, synchronization, recovery and cleanup; their public module paths remain unchanged.
- This is a structure/maintainability refactor; it is not intended to change game balance or multiplayer protocol behavior. The subsequent drone follow-up fixes route capture, watchdog and clearance-recovery behavior without changing the two-state PATROL/ATTACK model.


## Drone navigation reliability and AI organization

- Orbit approach now captures a stable point on the ellipse and holds its phase while the drone approaches. Drones far from the route use acceleration-limited steering instead of abruptly snapping onto the moving curve, then blend into the orbit once close enough.
- Combat and escort approaches now share a stall watchdog. A stalled clear route advances to another orbit phase; a drone trapped in the expanded air-clearance grid is guided toward a nearby safe hover cell with ordinary collision-aware movement, never a teleport.
- A pending path worker no longer disables the patrol watchdog indefinitely. Orbit entries use a short progress threshold and a bounded longer grace period while pathfinding is pending.
- Split the previous per-frame drone update into focused combat/escort orbit planning, orbit navigation, defense-patrol entry, safe-hover recovery, state-transition cleanup and weapon aiming/firing modules. `DroneAIUpdate.ts` now serves as a coordinator below 300 lines.
- Removed unused drone recovery flags and stale orbit bookkeeping, including values that were written but never read. Added regression tests for stable escort-orbit entry and safe-hover recovery.

## Validation

- `node scripts/test-simulation.mjs`: **294/294 tests passed** after the drone navigation changes.
- Source syntax transpilation and relative-import checks passed for **287 TypeScript/TSX files**, with no syntax diagnostics, transpiler failures, or unresolved relative files.
- Targeted strict type-check passed for `src/game/ai/droneAI.ts` and its imported dependency graph after the navigation refactor.
- Full project typecheck is blocked before source checking because `@types/node` is absent (`TS2688`). Production build was not run, as requested; browser playtesting was not run in this environment.
