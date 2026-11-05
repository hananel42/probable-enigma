# Multiplayer Runtime Map

This document defines the boundaries that keep room management, world simulation, replication, and transport maintainable. The core rule is: **a room is not a world**, and a transport event must never create or mutate a world by itself.

## Responsibility map

| Component | Owns | Must not own |
|---|---|---|
| `src/game/engine.ts` | Deterministic world rules, entities, damage, combat, construction and simulation state | Room membership, PeerJS, DOM events or rendering |
| `src/game/server/LocalGameServer.ts` | The active authoritative engine, fixed-step clock, validated game commands and immutable world frames | Peer connection details or lobby UI policy |
| `src/game/multiplayer/HostRoomController.ts` | Room phase/mode and roster; start/pause/resume/end/revive operations; command validation, heartbeat leases, per-peer replication and room-status ordering | WebRTC negotiation or game rules/rendering |
| `src/game/multiplayer/RemoteGameClientPort.ts` | Guest room-control view, explicit world assignment, validation of full states/deltas, ACK/resync, interpolation and presentation-only prediction | Creating a replacement world or advancing authority |
| `src/game/multiplayer/PeerJsRoomClient.ts` | PeerJS signalling, direct peer connections, BinaryPack serializer negotiation, sender identity, data envelopes and transport failures | Game participants, world revisions or gameplay decisions |
| `src/game/multiplayer/transport.ts` | Transport-neutral `GameDataTransport` and message contracts | PeerJS negotiation or simulation policy |
| `src/game/multiplayer/stateDelta.ts` | JSON-safe structural diff/patch for an exact revision chain | Selecting an authoritative world or silently repairing a gap |
| `src/game/multiplayer/roomPanelTransitions.ts` | Pure UI policy for deciding when a real room/world/readiness transition changes room-panel visibility | Transport, protocol state, or periodic same-world refreshes overriding user choice |
| `src/App.tsx` | Compose room controls, screen selection, Escape-menu navigation, client/render lifecycle and cleanup | Protocol sequencing or simulation rules |

Both the host and guest protocol layers depend on `GameDataTransport`, not directly on PeerJS. This makes in-memory protocol tests possible without duplicating the room or engine implementation.

## Room and world lifecycles

A new room starts with `phase: 'lobby'`, `hasWorld: false`, and `worldId: null`. The host uses one transition function with this allowed graph: `lobby -> playing`; `playing -> paused`, `results`, or `lobby`; `paused -> playing` or `lobby`; `results -> playing` (revival) or `lobby`. Only `lobby` may have `hasWorld: false`; the transition method checks this invariant on every edge. The direct connection, participant identity, roster, chat, and liveness checks are available, but no active world frame is published and the game renderer/HUD is not mounted as a running match. The dormant server object is an implementation detail; the room contract exposes no active world until the host explicitly starts one.

| Host action | Room/world result | Guest behavior |
|---|---|---|
| Create room / guest joins | Lobby remains open; `hasWorld: false`, `worldId: null`; assignment contains no active world | Show room UI; no game state or gameplay commands |
| Start world | `HostRoomController.startMatch()` creates a fresh authoritative world and participant set, marks it active, sends assignment and full baseline, starts the simulation clock, and broadcasts room status | Reset world-scoped replication only after the explicit assignment; apply only the matching full state |
| Pause / resume | `pauseMatch()` stops the simulation clock; `resumeMatch()` restarts the same world | Same `worldId`, room membership and replication authority remain intact |
| Revive a defeated participant | `reviveParticipant()` creates a new Core in the current world and restores the participant; it does not replace the world | Same room/connection/world; updated authoritative state arrives through normal replication |
| Return to room | `returnToLobby()` stops the simulation, sends `game-world-ended`, assigns `worldId: null`, clears world replication baselines, and publishes lobby status | Remove active-world replica and controls; preserve room connection, roster, chat and heartbeats |
| Start next world | `startMatch()` generates a fresh world ID and a new initial state while reusing room members | Wait for new assignment and matching full baseline; never infer a world switch from an arbitrary frame |

In CO-OP, players share one Core; individual-Core revival is rejected by the engine because the operation must create a fresh shared world. In TEAM/FFA, the host can revive one defeated connected participant with a distinct Core ID.

## Message scopes

Room-level messages survive world switches and must be fenced by `roomSessionId` rather than `worldId`:

- `game-room-status` carries the host's monotonic `statusRevision`, roster and phase. Revision ordering persists over world start/pause/resume/end/restart. A status that claims `hasWorld: true` must match the explicitly assigned `worldId`.
- `game-chat-broadcast`, `game-client-heartbeat`, `game-host-heartbeat`, transport connectivity and participant assignment belong to the room. Heartbeat correlation uses client/session and sequence tokens, never the current world ID.
- Room status cannot establish the host-controller identity. It is accepted only after a `game-player-assigned` message announces the `roomSessionId`.

World-level messages are scoped by both room session (where present) and `worldId`:

- `game-initial-state`, `game-state-delta`, `game-state-ack`, `game-resync-request`, defeat events, and gameplay commands are valid only for an explicitly assigned active world.
- Revision counters are comparable only inside the same world. A new assignment resets world-scoped command sequencing, defeat-event correlation, prediction and interpolation—not room status ordering, chat deduplication, or room liveness.
- A full frame that arrives ahead of its assignment is held as one bounded candidate. It is applied only if the subsequent assignment names that exact world. An unknown or contradictory world is never auto-trusted.

## Normal synchronization sequence

1. Guest sends `game-hello` with protocol versions, `clientSessionId`, and display name.
2. Host sends `game-player-assigned`. In the lobby its `worldId` is `null`; in a live world it contains the active world identity.
3. In the lobby, the handshake ends at room membership. No `game-initial-state` is sent.
4. At world start, host sends the non-null assignment, then a complete `game-initial-state` frame and room status. Reliable ordered WebRTC delivery preserves send order on a connection.
5. Guest accepts the initial state only when the world ID matches its assignment, then ACKs `(worldId, revision)`. It becomes ready only after the initial baseline and a follow-up valid update.
6. Ordinary `game-state-delta` messages extend the exact `baseRevision -> revision` chain. A missing base or failed patch triggers a logged `game-resync-request`, not a fabricated state.

## Smoothness and scheduling

- The authoritative simulation uses a separate fixed 60 Hz clock. It never depends on React render cadence or guest browser frame rate. A dropped-tick warning still means the host main thread was late; do not hide it as a supposed transport fix.
- State deltas are published at 30 Hz. Room roster/phase changes publish immediately; the changing room clock is coalesced to at most once per second.
- Guest presentation keeps an 18-sample interpolation history (about 600 ms at 30 Hz) and interpolates remote poses with a bounded delay. Prediction is cosmetic and limited; host authority is unchanged.
- Room status is not used as a simulation-frame stream. Chat, heartbeats and roster updates must not reset interpolation or world revision cursors.

## Stale packets, diagnostics and failures

A data channel is reliable and ordered, but messages from a replaced React/controller lifecycle can still be observed if lifecycle cleanup was incomplete or an existing peer connection is reused. `roomSessionId` rejects messages from a retired room controller; room `statusRevision` rejects replayed control states; `worldId` rejects frames from retired worlds; `clientSessionId` and heartbeat sequence reject prior guest-port responses.

Expected stale packets are ignored at debug level, and repeating the same mismatched room/world diagnostic is deduplicated so a queued burst cannot flood the console. Malformed envelopes, invalid IDs, an impossible revision transition or failed recovery remain visible errors—there is no silent state fabrication. Host publication timers and transport listeners must be disposed during React effect cleanup before their server/client objects are replaced.

## Implementation and tests

- Room lifecycle and status sequence: `src/game/multiplayer/HostRoomController.ts`.
- Guest world/session guards and presentation buffer: `src/game/multiplayer/RemoteGameClientPort.ts`.
- Transport connection ownership and BinaryPack transfer policy: `src/game/multiplayer/PeerJsRoomClient.ts`, `src/game/multiplayer/peerJsTransportPolicy.ts`, and `src/game/multiplayer/peerMessageEnvelope.ts`. The shared envelope helper validates inbound and outbound shape/size; it does not choose or encode a transport wire format. The room sends large snapshots using PeerJS `serialization: 'binary'`, not the non-chunked JSON serializer.
- Shared transport contract: `src/game/multiplayer/transport.ts`.
- Room status schema: `src/game/multiplayer/roomManagement.ts`.

Regression tests cover lobby-only join, delayed statuses, explicit world handoff, paused simulation time, resume, Core revival, next-world creation, connection persistence, and stale message filtering. Real two-browser tests across different NAT/firewall networks are still required to validate public PeerJS/WebRTC behavior end to end.
