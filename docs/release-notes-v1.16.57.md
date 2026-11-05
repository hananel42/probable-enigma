# Release Notes — v1.16.57

## Multiplayer room recovery

- A room host remains in the room lobby when the last guest disconnects; a peer-level signalling error after room creation no longer automatically changes the active room into a fatal connection state.
- PeerJS signalling retries continue with exponential backoff. After five unsuccessful attempts, the room panel explains that new guests cannot join temporarily and provides a manual retry button. Existing direct WebRTC data channels are preserved while signalling recovers.
- If a guest is already disconnected and cannot acknowledge a removal notice, the host completes cleanup without showing a user-facing room error. A connected guest that fails to acknowledge still produces a visible notice timeout.

## Cooperative mode

- CO-OP participants use one shared group. Disconnecting a guest removes that commander and personal resource wallet, but does not remove shared structures, drones, automated harvesters, or projectiles.
- Harvester-station stockpiles can be collected by any connected commander physically within interaction range. The nearest commander receives the stockpile into their own wallet; resource ledgers remain separate.
- Drone Stations record the commander of the participant who selected ESCORT. Drones resolve that commander by ID instead of following the engine's current active-player context. Returning to DEFENSE clears the assignment. At v1.16.57, Legacy ESCORT stations without an assignment were migrated once with an explicit console warning. This migration was removed in v1.16.58; the current runtime requires the explicit assignment and does not accept the old state.

## Validation scope

- Added regressions for cooperative shared asset retention, independent wallets during station pickup, explicit escort commander assignment, and quiet cleanup for already-disconnected guests.
- Full browser/WebRTC recovery was not validated by the simulation test runner and must be tested with two real browser instances.
