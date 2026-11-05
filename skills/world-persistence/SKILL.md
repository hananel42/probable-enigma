---
name: world-persistence
description: Use when changing single-player world creation, autosave, IndexedDB storage, world restoration, or save-file import/export.
---
# World Persistence Playbook

## Read first

- [`docs/world-persistence.md`](../../docs/world-persistence.md)
- [`src/game/persistence/worldSaveCodec.ts`](../../src/game/persistence/worldSaveCodec.ts)
- [`src/game/persistence/WorldSaveStore.ts`](../../src/game/persistence/WorldSaveStore.ts)
- [`src/game/engine/EngineState.ts`](../../src/game/engine/EngineState.ts)

## Ownership boundaries

- `src/app/worlds/WorldSelectScreen.tsx` owns world-library presentation and user actions only. It must not mutate the authoritative simulation state.
- `WorldSaveStore` owns IndexedDB reads/writes for metadata and state. Keep the world list metadata-only; do not read every large world snapshot just to render the picker.
- `worldSaveCodec.ts` owns the versioned file contract, import-size cap, runtime validation, and durable-snapshot policy. Never cast untrusted JSON directly to `GameEngineState` without validation.
- `LocalGameServer` carries the seed and validated snapshot into the engine and exposes loaded chunk keys. `GameEngine.restoreSinglePlayerState` reconstructs non-serialized runtime state.
- Multiplayer remains outside this first local-world library. Do not wire this repository directly into remote client/host persistence without a separate protocol design.

## Save invariants

1. Use IndexedDB, not synchronous localStorage, for large world snapshots. Do not add a silent fallback if storage is unavailable; surface a clear error.
2. Store metadata and snapshots in separate object stores so browsing world names does not materialize full states.
3. Every durable state includes schema version, world seed, save timestamp, loaded chunk keys, and a validated single-player snapshot.
4. Never persist transient projectiles, particles, floating texts, aim/selection state, or held movement keys. Keep entities, buildings, enemy bases, resource deposits, economy, game time, camera, and AI-owned gameplay state.
5. Serialize asynchronous saves; an old write must not overwrite a newer one. Save on a timer and explicit pause/exit; report failures and retain the prior valid save.
6. Imports are untrusted. Enforce byte limits, exact format/schema versions, finite numeric fields, unique IDs, valid single-player ownership, and chunk consistency before committing to IndexedDB.
7. Duplicate/import must create a fresh local world ID. Duplicate preserves the exact source seed and saved state. Rename and deletion operate on both metadata and state stores transactionally.
8. On any persisted-contract change, bump `WORLD_SAVE_SCHEMA_VERSION` and accept only that exact current schema. Do not add migrations, dual readers, old-shape conversions, or guessed defaults; reject every older schema.

## Development compatibility rule

The project is actively developed and has no save-format backwards-compatibility requirement. Update current producers, consumers, validators, and fixtures together; old saves are rejected rather than migrated. See [`docs/development-policy.md`](../../docs/development-policy.md).

## Tests and documentation

- Add focused codec tests for valid round-trips, transient stripping, malformed fields, duplicated IDs, missing chunk keys, invalid schema, and restore-time runtime reconstruction.
- Update `docs/world-persistence.md`, README module map, release notes, validation record, and this playbook when ownership/contracts change.
- Run `npm run docs:check`; run `npm test` and full typecheck/build only when the project dependencies are installed and the workload is appropriate.
