# Release Notes — v1.16.54

## Single-player local world library

- Added a world-selection screen with Create, Enter, Duplicate, Rename, Import, Export, and Delete actions.
- Added `WorldSaveStore`, backed by IndexedDB with separate metadata and world-state stores. The selector loads metadata only; large snapshots are fetched only when a world is opened, duplicated, or exported.
- Added schema-versioned `craftbound-survival-outpost-world` JSON exports and strict import validation, including a 32 MiB import cap, unique IDs, numeric validation, seed consistency, single-player participant/mode checks, and loaded-chunk/resource consistency.
- Added 10-second autosave, save-on-pause, save-on-exit, and best-effort save when the browser tab becomes hidden. Writes are serialized so stale snapshots cannot overwrite newer snapshots; failures are visible and never fall back silently to memory or localStorage.
- Durable snapshots omit projectiles, particles, floating texts, selection/aim, and held input to reduce stored data and avoid restoring transient effects. Entities, structures, upgrades, resources, enemy bases, AI state, game time, camera, seed, and generated chunk keys are retained.
- Added an explicit `GameEngine.restoreSinglePlayerState` API to rebuild runtime controls/caches and rebind the primary player reference after export/import.
- Added focused tests covering transient-state stripping, export/import round trips, malformed states, duplicate IDs, unloaded resource chunks, and restore invariants.
- Added the world-persistence AI playbook and `docs/world-persistence.md`.

## Compatibility

- Multiplayer persistence is intentionally not included. Existing multiplayer authority and networking contracts are unchanged.
- Save format schema is version 1. Unknown schemas fail visibly; no speculative migration or default-value repair is performed.
