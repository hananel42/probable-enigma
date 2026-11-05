# Release Validation — v1.16.51

## Validation performed for this archive

The checks below distinguish source-level simulation coverage from environment-dependent browser/build validation.

- New source-level protections: bounded substep collision integration shared across smooth, path, and drone movement; finite-state validation; explicit handling of malformed A* worker responses; no chained catch that silently ignores a result-handler failure after releasing its pending lock.
- Added regression coverage for a long movement segment toward a point past a wall, explicit rejection of segments requiring more than 64 substeps, non-finite drone acceleration input, and performance-monitor return/error/report semantics.
- Added five-second performance reporting and rate-limited slow-stage messages. See [Performance Diagnostics](performance-diagnostics.md) for console usage and stage names.
- `npm test`: **312 passed, 0 failed** in the recorded simulation test run for this source tree (59 TypeScript regression suites transpiled).
- `npm run docs:check`: **passed**, validating 122 Markdown files and all 4 indexed Skill playbooks.
- `npm run typecheck` and `npm run build`: **not run for this handoff**, per the instruction to avoid heavy commands. No claim is made that either passed.
- The archive intentionally omits `node_modules` and `package-lock.json`; install dependencies in your normal development environment before attempting a local build.

## Interpreting runtime data

- `[perf:slow]` reports a stage taking at least 4 ms (frame intervals have a 34 ms warning threshold) and is rate-limited per stage.
- `[perf] Simulation performance window.` reports the highest-total-time stages in the last window, call counts, averages, maxima, and entity/world context.
- `[perf] Enemy outpost spawned.` identifies base index, total elapsed spawn time, new objects, and world sizes.
- `[simulation clock]` reports overdue ticks dropped by the authoritative scheduler. A separate large-delta warning explains when an externally supplied simulation delta is capped.
- A live browser still needs to be tested at the game times when outposts spawn. Timing instrumentation narrows the search but cannot prove there are no stalls in every device/browser.
