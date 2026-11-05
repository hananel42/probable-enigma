# Craftbound Survival v1.16.2

> Historical release notes. The `CUSTOM` behavior descriptor described below was removed in v1.16.4; the current architecture uses only the fixed built-in building types.

## Modular building runtime

- Moved the building simulation loop out of `engine.ts` into `src/game/buildings/runtime.ts`; `GameEngine` now delegates to a runtime service instead of owning the building-specific simulation loop.
- Added the `CUSTOM` behavior descriptor (`id` plus optional primitive config) for new modules. Custom behavior is only run through the module's `update(building, context)` callback; the runtime deliberately skips custom behaviors without a callback rather than falling through into legacy built-in behavior handling.
- The runtime context is world-oriented and is passed identically for player- and AI-owned structures. It exposes the authoritative state and shared entity/projectile/damage/effect services.
- Extended multiplayer integration coverage to verify that a remote guest's fire command causes real damage to a hostile commander in the authoritative simulation, in addition to the existing movement, construction, wallet-isolation and projectile-creation checks.

## Validation

- `node scripts/test-simulation.mjs`: 117 tests passed, 0 failed.
- Signaling-server room-code tests and syntax check are run separately for this release.
- A full Vite build/browser/WebSocket end-to-end session is not claimed by the simulation test run.
