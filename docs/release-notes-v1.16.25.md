# Release v1.16.25 — Smooth drone recovery and room management stability

## Drone behavior

- Defense drones re-anchor to the current position when a combat target is destroyed or leaves pursuit range, route to the corresponding patrol ellipse point through obstacle-aware pathfinding, then resume continuous ellipse movement.
- Patrol orbit following uses speed-capped velocity and positional correction; it never assigns a distant orbit point directly to the drone's coordinates.
- Smooth embedded recovery tracks a free-cell target and moves a flyer out of newly placed building geometry without an instantaneous positional snap.
- The `C` hotkey changes doctrine for the current contextual in-range Drone Station: hovered target first, otherwise nearest eligible station in range. It shares the cyan interaction-outline resolver and requires no extra selection frame. `T` remains the chat hotkey.

## Room management and stability

- Hosts get a dedicated room management panel for roster/connection status, game mode selection, match start, guest removal, results, and creating a fresh lobby.
- Room phase (`lobby`, `playing`, `results`) is authoritative. Roster changes are sent immediately; the room timer is coalesced to 1 Hz instead of being broadcast on every replication tick.
- Host/client heartbeat checks continue every two seconds even for defeated participants. Defeat leaves the peer connected; the 25-second bidirectional liveness lease is only for detecting a failed or departed connection.
- Signalling disconnect recovery uses bounded exponential backoff and keeps existing direct channels when PeerJS supports doing so. Signalling status is distinct from the direct game data plane.
- Regression coverage includes defense/escort pursuit breakoff with a capped physical movement step, room roster publication without flooding, host lifecycle transitions, kick cleanup, and a clean-room restart with currently connected participants.

## Known deployment boundary

PeerJS Cloud is signalling, not a TURN relay. The current RTC configuration uses STUN only, so restrictive NAT/firewall combinations can still prevent a direct connection. The release has automated in-memory and source-syntax checks, but should receive a two-browser test across different networks before broad public deployment. See [PeerJS room design](peerjs-webrtc.md), [host-authoritative multiplayer](host-authoritative-multiplayer.md), and [the state-replication design](state-replication.md).
