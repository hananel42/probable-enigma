# v1.16.34 — Test-runner lifecycle hardening

## Tooling and reliability

- Fixed the regression runner's subprocess lifecycle: compilation now stays in the parent process group, while the Node test runner can be isolated as a process group for cleanup. A forced timeout also settles the waiting promise and closes captured output streams instead of depending forever on a `close` event from a toolchain descendant.
- Kept automatic discovery of every `src/**/*.test.ts` suite, serial execution to avoid cross-suite simulation-clock contention, per-test timeouts, and a whole-run deadline.
- Retained the strict project type-check as a separate quality gate. The test runner's `--noCheck` option is used only for fast test-graph transpilation; it does not claim the application is type-correct.

## Verification scope

- `npm test`: 249 passed, 0 failed, 0 skipped in the completed run recorded in the current validation file.
- `npm run lint` and `npm run build`: blocked in this environment because dependencies are not installed and `@types/node` cannot be resolved (`TS2688`). Vite did not produce a production bundle.
- Full reproducible release approval still requires a lockfile created in a network-enabled checkout, a clean `npm ci`, successful `npm run check`, and a live two-browser WebRTC run. See [Release Validation](release-validation-v1.16.34.md) and [Production Readiness](production-readiness.md).
