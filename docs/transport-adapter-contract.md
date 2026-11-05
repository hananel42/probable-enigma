# Game transport adapter contract

The authoritative engine, `HostRoomController`, and `RemoteGameClientPort` depend only on `GameDataTransport` (`src/game/multiplayer/transport.ts`). They do not depend on WebSocket APIs, PeerJS, signalling URLs, `RTCDataChannel`, or SDP/ICE negotiation details.

## Active transports

`PeerJsRoomClient` is the default implementation. It uses PeerJS Cloud only to register the host's fixed-prefix/five-letter room ID and establish peer links. Each guest opens a reliable, ordered direct WebRTC data connection to the room host. Game commands and replication data then travel through the direct data channel, not through PeerJS Cloud.

The legacy WebSocket relay adapter has been removed from the production source tree. There is no automatic or user-selectable relay fallback for a failed WebRTC connection.

`WebRtcDataChannelTransport` remains a lower-level adapter for applications that already negotiate and own raw `RTCDataChannel` instances. The PeerJS room client uses PeerJS's `DataConnection` API directly because PeerJS owns channel negotiation and lifecycle in the default path.

## PeerJS large-message policy

The PeerJS room initiator explicitly requests `serialization: 'binary'`. PeerJS carries this serializer choice through connection setup, and the host rejects a channel that does not negotiate the expected format. BinaryPack enables PeerJS's chunked data-send path for large authoritative full snapshots; `serialization: 'json'` is not suitable for world baselines because the library can report `Message too big for JSON channel`. The application still caps a JSON-stringified envelope at 16 MiB before sending/accepting it, for predictable resource bounds. This JSON string is only a size-validation representation, not the wire format. Full-state retries remain bounded and require an application-level revision ACK.

## Envelope validation

Both adapters use `src/game/multiplayer/peerMessageEnvelope.ts` for plain-object/type checks, JSON-compatible payload sizing, and transport-derived sender identity. Transport-specific encoded-size ceilings remain separate: PeerJS uses the documented 16 MiB application envelope policy and BinaryPack on the wire; the generic text RTCDataChannel adapter uses its smaller 1,500,000-byte limit. Invalid data and listener exceptions are logged and isolated to the offending peer rather than escaping an event callback.

## Delivery rules

- `game-initial-state` is a full authoritative state used on join, explicit resynchronization, and a world handoff announced by `game-player-assigned`. The world seed is sent with it, not with routine deltas.
- `game-state-delta` is reliable state mutation traffic, not an interchangeable “latest frame.” Do not coalesce/drop one delta and then deliver a later delta as if the chain were intact. `baseRevision` and `revision` detect gaps, and the guest requests a full authoritative resync when the chain is invalid.
- `game-state-ack` is an application-level acknowledgement that the guest applied a revision. A local `send()` call or a small transport buffer does not prove the remote application applied it.
- `game-command`, `game-hello`, `game-resync-request`, heartbeat messages, and defeat notices/ACKs are semantic protocol actions and must not be silently replaced. Transport close signals must cause authoritative participant cleanup.
- Each `RemoteGameClientPort` instance must include a valid `clientSessionId` in `game-hello` and heartbeat messages; the token is mandatory, not optional. If a new client-port lifecycle reuses an existing direct peer connection, the host keeps the same participant identity but resets per-client sequence/replication cursors and sends a fresh assignment plus full-state baseline. Host heartbeat replies echo that token; stale responses from previous client lifecycles are ignored with diagnostics. Messages that omit the token are malformed and rejected.
- `game-hello` may be repeated until assignment is observed, so participant assignment must be idempotent and replayable. A queued assignment is not an acknowledgement that the current guest application instance received it. In the lobby, assignment uses `worldId: null`; it must not cause a game world or a full state to be created.
- `game-player-assigned` includes the host-authoritative `worldId`. This assignment is the explicit authority boundary for world identity: if the host runtime changes while the direct peer link survives, the guest may switch worlds only after receiving the matching assignment. A full frame for an unannounced world is held as one bounded candidate; the guest does not apply commands or deltas for that world until the matching assignment and full baseline are accepted.
- World revisions are scoped to `worldId`; revision numbers from different worlds are not comparable. On an announced world handoff, the guest resets world-scoped command sequencing, defeat-event correlation, interpolation, and prediction, then waits for a full baseline and a subsequent valid update before marking the session ready. It does **not** reset room-status ordering, chat deduplication, or heartbeat/liveness state. Late full frames/deltas from retired worlds are explicitly diagnosed and ignored. A changed world without an explicit assignment remains a protocol error; do not auto-trust a new ID or silently fabricate state.
- The host remains the only simulation authority. The transport never grants a guest simulation authority.
- Malformed envelopes, oversized messages, peer-identity inconsistencies, duplicate direct connections, unexpected channel states, send failures, signalling failures, liveness expiry, and cleanup invariant violations are logged with actionable errors.
- `hasPeerConnection(peerId)` reports whether the registered direct data path is usable, not merely whether a stale connection object exists. Adapters must account for a closed/failed WebRTC path, and must keep transient ICE recovery separate from terminal closure.
- `closePeer(peerId, reason)` is idempotent and must return success if that peer is already absent. The host reconciles the union of its participant, sequence, replication, and room-status maps, because a disconnect race can leave any subset behind. It removes every player identity associated with the peer, clears all peer bookkeeping, and attempts transport closure even when another cleanup stage fails. Invariant violations and cleanup failures are diagnosed with peer/player/reason/stage context; they are not silently ignored.
- A failed per-peer enqueue is not treated as delivery. The host retains the previous replication baseline and retries the missing delta chain, while room-status cache state advances only after the adapter accepts that peer's status envelope. Repeated errors are rate-limited per peer/message path without discarding retry counts or last-error details.
- Send exceptions and backpressure for one peer must not abort fan-out to other peers. Adapters isolate the individual peer attempt, keep the failure diagnosable, and trigger ordinary membership reconciliation; they must not silently substitute a relay or fabricate successful delivery.
- The room-status protocol is authoritative for UI phase and membership. `game-room-status` has a monotonic `statusRevision` that survives world transitions; it is accepted only after the room session was established by `game-player-assigned`. A world-bearing status must match the assigned world ID. Lower/equal revisions and statuses from a previous room session are discarded before they can revert the UI. The roster contains only participants whose `connected` flag is true; a defeated participant remains visible while its connection remains active. The UI may filter stale envelopes defensively but is not the source of connection truth.

## Network constraints

PeerJS Cloud is a free shared signalling service, not a TURN relay. This release uses STUN but does not configure TURN credentials; direct connectivity is therefore best-effort on restrictive NAT/firewall configurations. The production project ships no WebSocket relay fallback. See [PeerJS WebRTC rooms](peerjs-webrtc.md).
