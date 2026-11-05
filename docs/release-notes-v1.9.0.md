# Craftbound 1.9.0 — Multiplayer Engine Integration

- Added host-authoritative human participant records with stable commander/core/group identities.
- Added participant-scoped movement, aim, pointer, build-selection, and station-selection contexts.
- Added a private resource ledger for each human participant and routed guest commands through the host's participant context.
- Added a separate commander and core for each participant in Free-for-all and Team modes; Cooperative uses one shared core.
- Added a game-mode selector to room creation.
- Projected authoritative host frames onto the guest's commander, camera, resources, aim, and selection.
- Generated later enemy bases around participant positions in rotation and load world chunks around all connected commanders.
- Tied player-built structures to a core ID, so core lifecycle and shared-core behavior remain explicit.
- Added focused engine participant tests and multiplayer engine documentation.

## Limits

The room transport remains host + one guest. Multi-peer signaling, reconnect/resume, a room roster, and automated end-to-end browser tests are not included. TURN is intentionally unsupported. Full `npm test`, `npm run lint`, and `npm run build` could not be run in the authoring environment because dependency installation timed out; focused TypeScript checks for the changed engine/network modules passed.
