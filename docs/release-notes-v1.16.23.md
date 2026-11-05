# v1.16.23 — Production multiplayer lifecycle hardening

## Host and guest lifecycle

- The host emits a targeted `game-player-defeated` event whenever a participant's Core is destroyed. The event carries a stable idempotency key and is retried every 750 ms until a matching ACK arrives. The guest waits for the corresponding authoritative revision, presents the defeat notice exactly once, and ACKs duplicate notices too.
- Guest liveness is bidirectional. Clients send heartbeats every 2 seconds; the host closes and removes a peer after 12 seconds without a completed heartbeat round-trip.
- Full-state synchronization retries are bounded to 12 attempts. Peers that never acknowledge a state they can apply are removed instead of remaining as stale room participants indefinitely. Resync requests are rate-limited.
- The host enforces a limit of 120 commands per peer per second and disconnects a peer that exceeds the budget. The room controller explicitly closes guest channels and removes participants/assets during host-room shutdown.
- Unexpected PeerJS host-instance closure now triggers participant cleanup immediately instead of waiting for heartbeat expiry. Failed incoming data-channel negotiations are always closed, even if the channel never opened.
- Duplicate/malformed direct-link parameters are rejected. Direct join URLs retain a single validated `?room=ABCDE` parameter and are parsed automatically; leaving the room clears that parameter.

## Project cleanup

- Removed the unused local WebSocket relay service, relay adapter, and development scripts. PeerJS Cloud plus direct reliable WebRTC is the only supported multiplayer transport path in the production project; failure is reported rather than silently falling back.
- Updated transport, lifecycle, room-link, and release documentation.

## Verification

- `node scripts/test-simulation.mjs`: 191/191 simulation, multiplayer lifecycle, transport, room-link, recovery and stress tests pass.
- TypeScript/TSX syntax transpilation passes for 124 source files. A full `tsc --noEmit` / Vite production build still requires installing the declared npm dependencies.
- PeerJS Cloud connectivity across real browsers and restrictive NATs still requires an end-to-end browser test. The current build configures STUN but no TURN service; direct WebRTC cannot be guaranteed on every network.
