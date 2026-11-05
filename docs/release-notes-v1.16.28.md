# Release v1.16.28 — Stable peer synchronization and lifecycle isolation

## Peer synchronization

- Full-state synchronization now uses a fixed, immutable recovery baseline until the guest acknowledges its revision. Retransmissions no longer replace the target revision while earlier acknowledgements are in flight.
- Once the baseline is acknowledged, normal delta replication resumes from that exact revision and includes mutations accumulated while the client was synchronizing.
- Full-state retry cadence is 1.5 seconds with a bounded 20-attempt window. This gives slower clients more time without allowing an unresponsive connection to remain indefinitely.
- ACK-staleness recovery waits 12 seconds before requesting a new full baseline.

## Liveness

- The guest liveness lease is 60 seconds to tolerate temporary main-thread stalls and browser tab throttling.
- Liveness is renewed only when a client heartbeat acknowledges a newer host heartbeat response. Repeating a stale ACK cannot keep a dead one-way path alive forever.
- Guest-side host-health degradation uses the same 60-second tolerance.

## Architecture

- Added `RoomGameAuthority`, a narrow contract for room protocol code to query/command the authoritative simulation without depending on the concrete `LocalGameServer` implementation. This makes the network/session protocol testable independently of the engine.
- Added regression coverage for delayed full-state ACKs while the world advances, retry-baseline stability, and stale heartbeat ACK behavior.

## Network limitations

PeerJS Cloud provides signaling/brokering and does not itself relay the WebRTC game-data path. This version keeps existing data channels alive during signaling-only outages and does not silently fall back to another transport. Restrictive NAT/firewall combinations can still require a configured TURN relay. Real browser-to-browser tests are required before claiming universal connectivity.
