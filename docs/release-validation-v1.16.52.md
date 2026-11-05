# Release Validation — v1.16.52

## Validation performed for this handoff

- Manually reviewed the kamikaze damage guard and its TypeScript narrowing; all later damage arithmetic uses the validated local numeric value.
- Added regression tests for missing drone weapon damage, A* corner capture, continuous wall sliding, physically connected clearance escape, stale A* result rejection, and waypoint-directed acceleration.
- Added a bounded route-progress watchdog and rate-limited diagnostics to stop a persistently blocked A* waypoint from receiving thrust indefinitely.
- Updated the current architecture, drone AI and gameplay-AI Skill documentation to describe the new route invariants.
- `node scripts/check-maintenance-docs.mjs`: **passed** — 124 Markdown files, 4 indexed Skill playbooks, version 1.16.52.
- The complete simulation suite, full TypeScript project check, and production build were **not run** for this handoff to avoid heavyweight commands. The added regression tests therefore have not been executed in this environment, and this file does not claim they passed.
- The archive omits `node_modules` and `package-lock.json`, as in the previous handoff.

## Root cause summary

The previous waypoint capture threshold was greater than a full grid cell, so the route follower could skip the orthogonal waypoint at a corner and aim diagonally into a wall. Collision substepping then stopped at the first partial collision rather than sliding along the other axis. Separately, A* can relocate a blocked start cell to a free cell without creating a physical path from the actual drone position; this is unsafe when a drone starts in the expanded building-clearance ring. Version 1.16.52 addresses those independent paths and rejects stale worker results during escape routing.
