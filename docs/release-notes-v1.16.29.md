# Release v1.16.29 — Stable room synchronization and WebRTC recovery

## Root causes addressed

- Host full-state retries previously replaced the state revision being awaited on every retry. When a guest ACK arrived behind a newer retry, synchronization could chase a moving target and eventually evict an otherwise connected guest. The host now retries an immutable recovery frame and resumes deltas from that exact baseline after its ACK.
- The PeerJS adapter previously closed a `DataConnection` immediately after any post-open `error` event. A data-connection error is useful diagnostic information but does not alone prove that the WebRTC path is terminal. The adapter now inspects the underlying peer and ICE states rather than immediately tearing the room down.

## Recovery and liveness

- Full-state recovery retries every 1.5 seconds, up to 20 attempts, keeping one baseline revision stable until ACK.
- A 12-second grace window is used after WebRTC enters transient `disconnected`. A return to `connected` or ICE `completed` cancels the close timer. Explicit ICE/peer-connection `failed` states close only the affected data connection.
- Signalling reconnection remains distinct from data-channel liveness: a PeerJS signalling outage does not destroy existing WebRTC channels automatically.
- Guest liveness leases remain 60 seconds and are renewed only when a client heartbeat acknowledges a newer host heartbeat response. Repeating an old heartbeat ACK cannot keep a dead one-way path alive.

## Architecture

- `HostRoomController` depends on `RoomGameAuthority`, a narrow contract for reading/controlling the authoritative simulation, not on the `LocalGameServer` implementation.
- The authoritative game, room lifecycle/state protocol, and PeerJS/WebRTC adapter have distinct contracts: `RoomGameAuthority`, `HostRoomController`/`RemoteGameClientPort`, and `GameDataTransport`/`PeerJsRoomClient` respectively.
- Added regression tests for late initial-state ACKs while the world advances and stale heartbeat echoes. Existing simulation and room protocol tests still run as a single deterministic suite.

## Evidence and known constraints

PeerJS documentation distinguishes signalling-server `disconnected` from `close`: existing data connections can remain alive during signalling loss, while `close` destroys them. MDN documents `RTCPeerConnection` `disconnected` as less stringent and potentially transient, whereas `failed` indicates the connection path has failed. The implementation follows that distinction. See [PeerJS Peer API](https://peerjs.com/client/api/peer), [PeerJS DataConnection API](https://peerjs.com/client/api/data-connection), [MDN connectionState](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState), and [MDN iceConnectionState](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState).

PeerJS Cloud handles signalling, not general TURN relaying. Networks that block direct peer-to-peer traffic can still need a properly operated TURN service. The code changes must still be verified in a real two-browser session and across restrictive networks; in-memory tests do not prove internet connectivity.
