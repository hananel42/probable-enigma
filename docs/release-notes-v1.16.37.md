# v1.16.37 — FFA spawn spacing, building neighborhoods, and reusable guidance

## Added

- Free-for-All worlds now place connected participants on a deterministic, evenly spaced spawn ring after the full room roster is known. Each participant starts beside their own Core. A one-player FFA retains the central opening, while TEAM and CO-OP keep their existing layout.
- Spawn preparation centers the host camera on the host's new spawn, clears stale movement/path state, preloads resource chunks near each spawn, and removes resource nodes that overlap Core footprints before the initial world frame is published.
- Added `BuildingNeighborhoodIndex`, a footprint-aware cardinal adjacency API that supplies north/east/south/west neighbor arrays to every building module during drawing. Large footprints can report multiple structures along one edge; diagonal and destroyed neighbors are excluded.
- Added a reusable interactive guidance framework and a lightweight first-visit briefing. Guide definitions are data-driven; a shared accessible overlay, target anchors, keyboard navigation, versioned progress storage, interruption recovery, and manual replay can be reused by future guides.

## Documentation

- Added `docs/building-neighborhoods.md` and `docs/interactive-guidance.md`.
- Updated the project map, documentation index, contributing rules, build label, and current release metadata.
- All new source comments and documentation are written in English.

## Regression coverage

- Eight-player FFA spawn spacing, per-player Core proximity, no resource/Core overlap, and correct initial camera position.
- Solo FFA and TEAM spawn layouts remain unchanged.
- Cardinal adjacency, multi-neighbor edges, diagonal exclusion, destroyed-structure filtering, and renderer-context wiring.
- Versioned guidance persistence, invalid saved progress, and guide definition validation.

## Validation

Exact command results for this archive are recorded in `docs/release-validation-v1.16.37.md`. The regression suite passed. Full project type-checking and bundling remain blocked in this environment because dependencies are not installed and npm registry access did not complete. A real browser/WebRTC test is separate from the simulation and guidance model test suites.
