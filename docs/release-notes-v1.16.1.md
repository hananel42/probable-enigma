# Craftbound Survival v1.16.1

## Modular building runtime seam

- Added an optional module-owned `update(building, context)` contract to `BuildingModule`.
- The authoritative engine dispatches module-owned updates through one generic call and supplies world state plus narrow services for spawning entities/projectiles, applying damage, sparks, sounds, distance, and resource nodes.
- Player-owned and AI-owned structures use the same runtime context; ownership-specific decisions remain explicit data/rules rather than a separate simulation implementation.
- Existing built-in behaviors remain on the established behavior path unless a module opts into the new callback, preserving existing game behavior while allowing new behavior modules to be implemented without adding a type-specific branch to `engine.ts`.
- Added a test for generic runtime dispatch and context delivery.

## Validation

- Simulation suite: 116 passed, 0 failed.
- Signaling server syntax check: passed.
- Room-code tests: 3 passed, 0 failed.
- Full Vite build and whole-project lint could not be run in this environment because dependencies are not installed (`vite` and `@types/node` are missing). This is an environment limitation, not a passing build claim.
