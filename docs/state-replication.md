# Authoritative state replication (protocol v2)

## Goals and invariants

- The room creator is the only simulation authority. Guests never generate a substitute world or make local gameplay mutations.
- Every room starts with one authoritative `game-initial-state`. Its `GameWorldFrame` includes the stable `worldId`, unsigned 32-bit `worldSeed`, `revision`, server time and complete state. The host also includes that `worldId` in `game-player-assigned`, so assignment establishes the world identity before the guest adopts a frame.
- Normal traffic uses `game-state-delta`; it must be based on one exact `baseRevision` already applied by the guest. A guest never guesses how to repair an unknown base.
- Full state is sent for join, an explicit resync request, an explicitly announced host-world handoff, or retry of an unacknowledged full-state transfer. A protocol mismatch or delta-application failure is logged and requests an authoritative resync.
- The simulation keeps its native clock. State diffing/sending runs on the host's 30 Hz publication cadence; it does not slow the simulation to network rate.

## Message flow

1. Guest sends `game-hello` with command protocol v2 and state-sync protocol v3. The PeerJS application handshake is also v2; previous versions are rejected.
2. Host assigns the guest a participant identity and sends `game-player-assigned` with the authoritative `worldId`.
3. Host sends `game-initial-state` including the full frame and seed. The guest validates it, buffers it if assignment has not arrived, and only accepts it when its `worldId` matches the explicit assignment. It then projects the frame for its own commander and ACKs `(worldId, revision)`.
4. Host compares the current captured state against that peer's latest successfully queued baseline. If there are no state changes, no message is sent. Otherwise it sends a `game-state-delta` containing the world ID, base revision, target revision, server time and patch operations. The immutable world seed is not repeated in ordinary deltas.

## World identity and authority handoff

A revision is meaningful only within its `worldId`; never compare revision counters across different worlds. If a host runtime/world is replaced while the direct transport remains open, it announces the new world in `game-player-assigned` before its full baseline. A guest that sees a full state for an unknown world holds one bounded candidate and waits for that explicit assignment. Once the matching assignment arrives, it clears world-scoped command/heartbeat sequence state, event de-duplication, interpolation and prediction, applies the matching full baseline, and remains not-ready until a valid follow-up update demonstrates that replication is live.

Late full frames and deltas from recently retired world IDs are logged and ignored so an old queued packet cannot roll the guest back. A different world ID without a matching assignment is a protocol error: it is not accepted as a silent resync and must not be repaired by inventing guest state. This handoff path is implemented in `RemoteGameClientPort.beginAuthorityWorldChange`, with the host-side assignment created in `HostRoomController.sendParticipantAssignment`.
5. Guest requires `baseRevision === currentlyAppliedRevision`, applies the patch to its unprojected authoritative snapshot, projects the resulting state for rendering, and ACKs the resulting revision.
6. If a delta base is missing, the patch is malformed, or its application fails, the guest logs the reason and sends `game-resync-request`. The host sends a full state to that guest and retries until the revision is acknowledged.

## Delta encoding

`src/game/multiplayer/stateDelta.ts` implements JSON-safe structural deltas:

- `set`: replace a changed value at a path.
- `delete`: remove a key from an object.
- `collection`: mutate a stable-keyed array by removed keys, indexed additions, and per-record patches. Stable keys are `id` and `playerId`. A full ID ordering is included only when existing records actually reorder; appending a new entity does not resend every existing ID.
- A nested object changes at the smallest changed path. Arrays without a safe stable key are replaced as a whole only when that particular array changes.
- A malformed path, duplicate/missing collection key, invalid order, or invalid insertion index throws. The receiver logs the original failure and requests a full state rather than accepting a repaired or fabricated state.

The host still captures a coherent JSON-safe frame at the replication cadence to compute a structural diff; this is not an incremental mutation journal. It avoids serializing and sending a complete world frame to every peer each simulation tick, but a future performance phase could track mutations at engine entry points to reduce host-side comparison work further.

## Loss and transport behavior

The production PeerJS transport uses reliable ordered direct WebRTC data delivery; the lower-level `WebRtcDataChannelTransport` adapts an already-negotiated channel. Both keep transport queues bounded and may reject a send under backpressure. If that creates a revision gap, the guest detects it from `baseRevision` and requests a full authoritative resync. Deltas are not replaceable snapshots: silently dropping one and continuing would break the exact revision chain. The transport adapter owns delivery/backpressure; the state protocol owns revisions, ACKs and recovery. The legacy WebSocket relay is not part of the production project.

`bufferedAmount` is used as a queue-pressure signal in the browser transports, but it is not proof that the remote application has applied a message. Application-level state ACKs remain necessary. See the transport adapter contract and host-authoritative multiplayer document for limitations.

## Seed semantics

`LocalGameServer` creates one unsigned 32-bit seed per world. Procedural resource chunks and enemy outpost placement use that seed so those world-generation inputs are reproducible. The guest receives the seed once inside the initial/full frame as stable world metadata; it renders the authoritative state rather than independently regenerating the active world. A seed change inside an existing `worldId` is a protocol violation.

## Current limits

The default `PeerJsRoomClient` carries this protocol over PeerJS-managed reliable WebRTC data connections; PeerJS Cloud is used for signalling, not normal game traffic. The lower-level `WebRtcDataChannelTransport` remains available for applications that negotiate raw `RTCDataChannel` instances themselves. Reconnection/resume and host migration are not implemented. Real two-browser tests across distinct and lossy networks are still required before treating the direct transport as production hardened.
