# v1.15.1 — Multiplayer integration and simulation stress checks

## Added

- Added a two-player in-memory integration test using the same room-data message shapes as the app's temporary relay: guest hello/assignment, authoritative frame projection, guest movement, guest firing, building placement, and participant-specific resource ledgers.
- Added engine-level projectile integration tests proving that Team projectiles pass through allied commanders without damaging them and Free-for-all projectiles damage opposing commanders.
- Added a bounded stress test with 240 ticks, 72 additional structures, and 160 projectiles. It checks simulation-time progress, projectile cleanup, finite entity/building values, and non-negative resource balances.
- Updated README guidance to distinguish the in-memory integration test from a real browser/WebSocket test and to describe the temporary signaling relay accurately.

## Verification

- `node scripts/test-simulation.mjs`: 105 tests passed.
- `node --test signaling-server/src/roomCodes.test.js`: 3 tests passed.
- Stress smoke run: 240 ticks, 72 additional structures, 160 projectiles; approximately 28 ms wall time in the latest development-container run (measurement is environment-specific).

## Limitations

- The two-player integration test uses an in-memory relay, not a real WebSocket server or two browser tabs.
- The signaling server's `ws` dependency is not installed in this test environment, so no live WebSocket end-to-end test was run.
- Full Vite build, full-project TypeScript lint, visual browser testing, and longer/high-entity-count performance profiling remain unverified.
