# v1.16.17 — Seeded initial state and delta-only multiplayer replication

## State protocol

- Added state-sync protocol v2: joining clients receive a full authoritative `GameWorldFrame` with the world seed, then receive structural `game-state-delta` patches for actual changes.
- Every delta is bound to an exact `baseRevision`. The guest ACKs successfully applied revisions; a skipped/malformed patch causes a logged, targeted `game-resync-request` and full-state recovery.
- Full state is retried until ACKed. A missed full-state message no longer leaves the guest without a frame indefinitely.
- Removed the immutable seed from normal delta envelopes, and skip empty deltas when the snapshot has no changed fields.
- Stable-key collection patches remove/add/update records by ID. Indexed insertions avoid sending every entity ID when a collection grows; order data is sent only when the existing order changes.
- Added a world seed that deterministically controls procedural resource chunk generation and enemy outpost placement. Guests receive the seed but render the authoritative host state rather than rebuilding a separate world.

## Verification

- Added regression coverage for seeded initial state, compact deltas, no repeated seed in deltas, missed-update recovery, initial-state retransmission, and stable-key patch application.
- `npm test`: 164 simulation/integration tests and 3 signaling room-code tests passed.
- The signaling-server room-code tests, JavaScript syntax checks, and full Vite production build are run separately; dependencies are not installed in the source workspace, so the full application build still needs verification after `npm install`.
