# Local World Persistence

## Scope

The no-backwards-compatibility rule in [Development Policy](development-policy.md) applies to every save and import path.

The first world library is single-player only. The multiplayer host/guest protocol and its replication snapshots are not stored by this local repository. World selection lives in `src/app/worlds/WorldSelectScreen.tsx`; simulation state stays inside `LocalGameServer` and `GameEngine`.

## Storage architecture

`src/game/persistence/WorldSaveStore.ts` owns a browser IndexedDB database named `craftbound-survival-outpost-local-worlds`. It uses two object stores:

- `worldMetadata`, keyed by stable `id`, contains the name, world seed, creation/update timestamps, and last-played timestamp.
- `worldStates`, keyed by `worldId`, contains the versioned state envelope and the gameplay snapshot.

This separation matters: the selector reads only metadata, so listing ten worlds does not clone ten potentially large snapshots. IndexedDB is the only storage backend. If it is unavailable or a transaction fails, the UI reports the failure; it does not silently substitute localStorage, memory-only state, or a blank world.

## Durable snapshot and autosave

`src/game/persistence/worldSaveCodec.ts` uses schema version `3` and export format `craftbound-survival-outpost-world`. The durable snapshot retains the player and participant ledger, groups, entities and AI state, buildings and upgrades, resource nodes, enemy bases, camera, world time, difficulty and game-over state. It excludes in-flight projectiles, particles, floating text, transient selection, aim state, and held input. Transient arrays are replaced before the state is cloned so the autosave does not first copy a large visual-effects burst.

The game requests autosaves every 10 seconds, when the page becomes hidden, when pausing, and before leaving gameplay. Writes are serialized in a promise queue, and the snapshot is captured when its queued write begins. On failure, the prior committed IndexedDB state remains intact and an explicit status/error is shown. Browsers can still clear local storage; users should export important worlds for backup.

## Restore invariants

Only a validated one-participant `TEAM` snapshot whose owner is `player-host` can enter this single-player restore path. `GameEngine.restoreSinglePlayerState` creates a new object graph, rebinds `state.player` to the canonical matching entity after a JSON round-trip, restores the loaded chunk-key ledger, and rebuilds per-player runtime controls. It resets held keys/pointer state, transient effects/projectiles, selection/aim state, harvester chunk tracking, particle serial, and the per-run core reward ledger. The world seed must match the save metadata and remains responsible for deterministic generation of chunks that have not yet been loaded.

The `activeChunkKeys` list is persisted because a chunk may be generated even if every resource in it was filtered or later removed. Each saved resource node must refer to a chunk marked as loaded. This avoids generating a second copy of resources when restoring.

## Import/export safety

Export writes a readable JSON file with format identifier, schema version, world name, seed, timestamp, active chunks, and saved state. Import rejects files larger than 32 MiB, invalid JSON, unknown format/schema, invalid or mismatched seeds, malformed arrays/records, non-finite required numeric fields, duplicate IDs, invalid world mode/participant count, and resource nodes linked to missing chunks. A malformed file is rejected with a visible error; it is not repaired using guessed values.

Imported worlds receive a fresh local database ID. Duplicated worlds also receive a new ID but preserve the same seed and exact saved state, yielding a separate branch of the same world. Rename updates metadata; delete removes both metadata and state in one IndexedDB transaction.

## Change checklist

When changing a gameplay field that must survive reload, verify it is present in `GameEngineState` and retained by the durable codec. When changing `GameEngineState` or chunk generation, update validation and tests. This project is under active development and has no save-format backwards-compatibility requirement. For every persisted-contract change, increment `WORLD_SAVE_SCHEMA_VERSION`, validate the exact current shape, and reject all older schemas. Never write migrations, dual-version readers, or guessed defaults. Required fields such as every building’s `upgradeIds` and the complete Effect Tower runtime state must be present; incomplete state is rejected rather than repaired.
