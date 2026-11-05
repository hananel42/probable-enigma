# Release Validation — v1.16.47

- Simulation regression suite: **299 passed, 0 failed** (`node scripts/test-simulation.mjs`).
- The test runner transpiled 57 TypeScript regression test files before execution.
- Targeted change: kamikaze speed equals `drone.speed * 1.2`, where `drone.speed` already includes the owning Drone Station’s speed multiplier. Target Commander speed is not read for this calculation.
- ZIP integrity: verified with `unzip -t`.
- Full project typecheck and production build were not run, per task constraints.
