# v1.14.0 — Simulation hardening

## Engine correctness

- `GameEngine.step()` now simulates delayed frames in bounded substeps of at most 50ms, preserving up to 500ms of elapsed time and avoiding the old behavior of silently dropping time beyond 100ms.
- Scoped player commands now restore the host-facing snapshot from the host's saved input/selection context. Nullable selections are restored explicitly, so selecting and cancelling a building cannot resurrect a stale selection in the HUD.
- Economy helpers reject NaN/Infinity/negative affordability inputs, sanitize resource transfers, and prevent stale repair commands from reviving destroyed structures.
- Building placement rejects fractional/invalid grid coordinates and non-positive or unreasonable footprints. Footprint checks use the building spatial index.

## Core destruction and salvage

- Destroying an outpost Core no longer deletes its surviving structures. The Core is removed; dependent drones/harvesters are removed; the commander survives and can dismantle inert structures.
- Surviving structures are explicitly rendered desaturated with a gray overlay, retain their HP, and remain eligible for HP-proportional salvage.
- Commander AI makes an immediate strategic decision when idle and immediately reconsiders an interrupted goal when its Core is damaged, preserving the emergency repair priority.

## Lightweight test path

- Added `node scripts/test-simulation.mjs`, which compiles only simulation modules/tests to a temporary directory and runs them with Node's built-in test runner. It does not require React, Vite, Tailwind, `tsx`, or the signaling-server dependencies. A TypeScript compiler is still required (the project's local compiler or `tsc` on PATH).
- Added regression tests for bounded simulation time, malformed economy values, invalid build footprints, destroyed-structure repair, orphaned-structure survival, and salvage.

## Verification

- Engine/simulation test suite: 99 tests passed in the development environment.
- Full browser build and live visual playthrough were not run as part of this engine-only pass. Canvas appearance and long-duration performance still require a browser soak test.
