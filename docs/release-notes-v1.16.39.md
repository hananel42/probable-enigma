# v1.16.39 — Stable Commander Mining Cycles

## Bug fix

- Fixed a Commander AI mining stall that was most visible while its Core was damaged. The emergency economy planner reevaluates at a short interval (0.16 seconds) while gathering resources for a Core repair. Re-selecting the same resource deposit used to reset `miningProgress` on every decision, so the two-second extraction could never finish.
- Added a shared `assignMiningGoal` helper. Keeping the same `MINE_RESOURCE` target now preserves the current extraction cycle; entering mining or switching to a different resource resets stale progress and mining animation state.
- The fix does not weaken Core repair or combat priorities. A legitimate change of goal still clears mining state, and a depleted or unreachable deposit can still be abandoned.

## Regression coverage

- Added `src/game/ai/commanderAI.test.ts` with a damaged-Core simulation that forces the fast planning cadence and verifies that a completed batch reduces the resource deposit and credits the enemy wallet.
- Added coverage that retargeting a depleted deposit resets stale progress before mining the replacement resource.

## Architecture notes: changing building upgrades and behavior

Existing buildings are intentionally organized as modules under `src/game/buildings/<building>/`:

- `upgrades.ts` owns upgrade tiers, choices, descriptions, and declarative stat effects.
- `upgradeScaling.ts` owns the generic per-level stat scaling profile.
- `behavior.ts` owns a building's behavior settings and, where needed, its update logic.
- `draw.ts` owns its visual recipe; `inspect.ts` owns its detailed stat lines; `definition.ts` owns cost, footprint, health, and presentation metadata.
- `index.ts` composes the module; `src/game/buildings/registry.ts` registers the fixed set of built-in building types.

Common upgrade effects (`ADD`, `MULTIPLY`, `SET`, and `ALL_STATS`) can be adjusted as data. A genuinely new mechanic or stat may require a focused extension to shared upgrade types/runtime and regression tests. Adding an entirely new building type is a source change to the static registry and related type/catalog code, not a runtime plugin operation. See `docs/BUILDING_MODULES.md` and `docs/adding-content.md`.

## Validation

See `release-validation-v1.16.39.md` for exact results. The in-memory regression suite passed. Full lint/build remain blocked in this archive workspace by the missing `@types/node` dependency; live browser gameplay was not tested here.
