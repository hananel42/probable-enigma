# Release Notes — v1.16.58

## Development policy: no backwards compatibility

- Added [`Development Policy`](development-policy.md) and made it mandatory in the AI-agent, contribution, architecture, persistence, and subsystem guidance. This project is under active development: obsolete saves, data shapes, identifiers, module paths, and APIs are not preserved for earlier development versions.
- When a contract changes, update every current producer, consumer, validator, and fixture directly. Do not add migrations, dual readers, aliases, API shims, version heuristics, or guessed defaults just to keep old artifacts running.
- Bumped world-state synchronization from protocol v2 to **v3** because the replicated `Building` contract changed. Bumped the PeerJS application handshake from v1 to **v2**. A client from an older build is rejected; there is no version negotiation or compatibility adapter. The command protocol remains independently versioned at v2.

## Strict current save/runtime contracts

- Bumped `WORLD_SAVE_SCHEMA_VERSION` from 2 to **3**. IndexedDB world snapshots and imported files must use schema 3; older saved worlds and exported files are rejected. No v1/v2 migration or dual-format reader is provided.
- Persisted resource ledgers must include `wood`, `stone`, and `diamonds`. Every building must contain its current `upgradeIds` array. Effect Towers must contain their complete current runtime state and valid effect IDs; missing values are rejected rather than filled in.
- Removed the obsolete entity/building `burnDuration` and old entity-level Burning damage fields and their migration path. Flashover now scales the canonical `effectDuration` field.
- Effect Tower behavior, pulse application, drawing, and inspection validate the current Effect Tower contract instead of inventing missing effects, durations, or damage values.
- Removed unused drone patrol-route bookkeeping fields and obsolete building drawing metadata/projections that no longer belong to the current architecture.
- Removed fallback reads/writes for optional `upgradeIds`; the field is now required and initialized by the canonical building factory.

## Retained current gameplay/network behavior

- Signalling-service retries continue in the background without destroying established direct peer connections; the room exposes a retry action when new participants cannot join.
- CO-OP keeps its shared Core, group, structures, drones, and miners when a participant disconnects, while resource wallets remain individual.
- Drone ESCORT mode stores and follows the commander explicitly assigned by the participant who selected ESCORT. There is no migration for an old station without that assignment; such a state is invalid under the current contract.

## Validation

See [`Release Validation v1.16.58`](release-validation-v1.16.58.md) for executed checks and environment limitations.
