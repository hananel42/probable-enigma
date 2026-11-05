---
name: multiplayer-protocol
description: Use for room membership, host authority, peer lifecycle, WebRTC transport, command validation, snapshots, deltas, ACKs, or recovery.
---
# Multiplayer Protocol Playbook

## Read first

- [`docs/multiplayer-runtime-map.md`](../../docs/multiplayer-runtime-map.md)
- [`docs/host-authoritative-multiplayer.md`](../../docs/host-authoritative-multiplayer.md)
- [`docs/client-server-boundary.md`](../../docs/client-server-boundary.md)
- [`docs/transport-adapter-contract.md`](../../docs/transport-adapter-contract.md)
- [`docs/state-replication.md`](../../docs/state-replication.md)
- [`docs/peerjs-webrtc.md`](../../docs/peerjs-webrtc.md)

## Ownership map

- `HostRoomController.ts` and `hostRoomController/`: host room/world lifecycle, participant identity, authority, replication, ACK/recovery, and per-peer cleanup.
- `RemoteGameClientPort.ts` and `remoteGameClientPort/`: guest state machine, assignment validation, authoritative frames/deltas, projection, and recovery.
- `PeerJsRoomClient.ts` and `peerJsRoomClient/`: PeerJS signalling and direct WebRTC connection lifecycle. It does not own game rules.
- `transport.ts`, `peerMessageEnvelope.ts`, and transport adapters: transport-neutral data contract, envelope validation, byte budgets, backpressure, and delivery errors.
- `LocalGameServer.ts`: host simulation clock and command boundary, not the signaling service.

## Non-negotiable protocol invariants

- The room is not the world. Membership does not start a simulation; only an explicit host action does.
- The room creator is the sole simulation authority. Guests never create a local authoritative fallback.
- PeerJS Cloud is signalling; normal game traffic travels over direct reliable WebRTC data channels. No local WebSocket relay fallback is shipped. STUN-only configuration cannot guarantee all NAT/firewall paths.
- The active PeerJS application protocol is v2 and replicated world-state protocol is v3. Require exact version matches; when either wire contract changes, bump its version and reject every previous version rather than negotiating or adapting it. The command envelope has its own independently versioned contract.
- Treat all peer data as untrusted. Validate message shape, sender-to-participant binding, IDs, sequence/revision, string lengths, payload bytes, and rate budgets at the appropriate boundary.
- Keep room identity, participant identity, room-status sequence, and world identity as separate scopes.
- Preserve exact revision chains. If a delta is missing or rejected, use bounded full-state recovery rather than silently continuing with a fabricated state.
- Cleanup must be idempotent and release timers, listeners, connections, and participant state. A failure for one peer must not abort cleanup/fan-out for others. If a guest is already disconnected and cannot acknowledge a removal notice, finish cleanup quietly rather than surfacing a room-level error.
- Signalling is a control plane, not the existing data plane. Signalling outages must not close established WebRTC channels; keep retrying in the background and expose a manual retry for restoring new-room negotiations.
- Keep retry and timeout loops bounded and surface real errors. Deduplicating expected stale messages is acceptable; swallowing protocol failures is not.

## Test strategy

Add focused tests for lifecycle transitions and malformed input. For async flows, use state-based waits with finite deadlines instead of narrow sleeps. Exercise duplicate/stale messages, invalid assignments, disconnect during pending work, failed sends/backpressure, world replacement, and cleanup idempotence as applicable. In-memory tests do not prove real signalling, ICE/NAT traversal, or browser-to-browser behavior; do not claim they do.

## Completion checklist

- [ ] Host authority and room/world identity rules remain intact.
- [ ] Validation and limits are applied at the correct boundary.
- [ ] Timers/listeners/peers are cleaned up on every terminal path.
- [ ] Regression tests and relevant protocol docs are updated.
- [ ] `npm test` and `npm run docs:check` pass; browser checks are reported separately.
