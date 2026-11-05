---
name: testing-and-docs
description: Use when adding tests, changing scripts, updating documentation, preparing releases, or maintaining the skills directory itself.
---
# Testing, Documentation, and Release Playbook

## Test commands

- `npm test` / `npm run test:simulation`: recursively discovers every `src/**/*.test.ts`, transpiles test dependency graphs to a temporary directory, and executes serially with finite timeouts and child-process cleanup.
- `npm run docs:check`: validates Markdown links, current version consistency, skill front matter/index coverage, and known stale active-runtime claims.
- `npm run lint`: currently runs strict TypeScript checking; it is not ESLint.
- `npm run build`: type-checks then runs the Vite production build.
- `npm run check`: runs lint, tests, docs checks, and build in that order.

The test runner transpilation uses TypeScript `--noCheck`; therefore a passing `npm test` is not a substitute for `npm run lint`. A passing in-memory multiplayer test is not a real browser/WebRTC test. Report only checks actually run and their actual exit codes.

## Test design

- Prefer focused behavior tests with deterministic fixture builders.
- Test both normal paths and important edges: absent/dead/unhostile targets, malformed inputs, repeated lifecycle transitions, maximum/minimum values, upgrades, and cleanup/retry failure.
- For async tests, wait for a state transition with a finite deadline instead of assuming a fixed sleep is enough.
- Keep fixture helpers out of `*.test.ts` filenames so recursive discovery does not treat them as suites.
- Do not weaken assertions or skip tests merely to make the suite green. Fix the underlying defect or clearly document an intentional contract change.

## Documentation authority

- `README.md`: setup, commands, high-level map, and current release metadata.
- `docs/README.md`: documentation index and current release pointers.
- `docs/architecture.md` and `docs/repository-structure.md`: current ownership and module map.
- Domain contract docs: current behavior and invariants.
- `docs/release-notes-vX.Y.Z.md`: immutable release history.
- `docs/release-validation-vX.Y.Z.md`: only checks actually performed for that release.
- `docs/project-history-*`, older `modular-systems-*`, and handoff notes: historical context; label plans as historical when they no longer describe runtime behavior.
- `skills/README.md` and each `skills/*/SKILL.md`: instructions for future AI maintenance.

## Self-maintenance of skills

When an implementation changes, ask whether an AI agent following the current playbook could make a wrong change. If yes, update the playbook in the same patch. When adding or removing a skill, update `skills/README.md` and check root `AGENTS.md` routing. When adding a durable documentation invariant, encode it in `scripts/check-maintenance-docs.mjs` so it cannot silently drift.

## Release checklist

1. Bump `package.json`, root README, docs index, and current release documents together.
2. Add release notes and a validation record; do not rewrite older release facts.
3. Run `npm test` and `npm run docs:check`; run typecheck/build where dependencies permit.
4. Validate ZIP integrity after packaging.
5. Clearly distinguish automated in-memory checks from real browser, WebRTC, and mobile testing.

## Performance diagnostics

- Keep instrumentation in `src/game/performance/PerformanceDiagnostics.ts`; record stage durations through `measurePerformance` or `recordPerformanceSample` rather than ad-hoc per-frame logging.
- Slow operations should emit a rate-limited warning with the stage and relevant entity/world counts. High-frequency details should be aggregated into five-second windows.
- When performance work changes frame timing, update `docs/performance-diagnostics.md`, regression tests, the current release note, and the validation record. Do not claim a stall is eliminated without a reproduced test or live-browser measurement.
- `window.craftboundPerformance.reportNow()` forces the current aggregate report; `setEnabled(false)` disables measurement/logging and `setEnabled(true)` re-enables it.
