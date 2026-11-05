# Multiplayer peer cleanup — implementation and verification report

Date: 2026-10-27

## Implemented

- Host cleanup reconciles the union of participant, sequence, replication and room-status maps. A missing entry in one map no longer prevents removal of the player/assets or cleanup of the other maps. Duplicate cleanup remains idempotent, and transport closure is attempted even after an inconsistent registration is detected.
- Cleanup errors include peer/player/reason/stage context. A publication callback catches the resulting aggregate, reports it to the runtime error channel, and continues processing other peers rather than leaking an `AggregateError` out of the host publication tick.
- The host reconciles stale direct connections before publication and does not mark room-status content delivered until that peer's send is accepted. Failed per-peer sends retain replication baselines for retry and produce rate-limited diagnostics with retry count and last-error details.
- The PeerJS adapter checks whether the underlying direct WebRTC path is live, logs missing-target state without emitting the same warning on every attempt, and isolates synchronous send failures per peer so other guest connections still receive fan-out attempts.
- The raw `RTCDataChannel` adapter isolates per-channel send failures and detaches terminally closed channels for later membership reconciliation.
- The roster is sourced from connected participants only; a defeated participant remains listed while connected. The UI also filters stale room-status envelopes defensively.
- Added regression coverage for inconsistent cleanup maps, duplicate cleanup, active-only roster semantics, adapter send-race isolation, and the host-to-guest `lobby → playing` transition with continuing world updates.
- Updated `docs/transport-adapter-contract.md` with the lifecycle, delivery and roster contracts.

## Verification results

| Command/check | Result | Details |
|---|---|---|
| `npm test` | **PASS** | 229 tests passed, 0 failed. Final run after handshake changes: 5.74 s. |
| `npm run lint` | **BLOCKED / FAILED** | The command was run and exited 2: TypeScript cannot find `@types/node` (`TS2688`). The supplied project archive has no installed `node_modules`. |
| `npm run build` | **BLOCKED / FAILED** | The command was run and exited 2 at its `npm run lint` stage for the same missing `@types/node` error; Vite build did not start. |
| Targeted TypeScript checks | **PASS (limited scope)** | The modified `HostRoomController.ts` and `WebRtcDataChannelTransport.ts` passed a direct strict `tsc` check. `PeerJsRoomClient.ts` also passed using a temporary minimal PeerJS declaration because its real package types were unavailable. This is not a replacement for full project lint. |
| Dependency installation | **UNAVAILABLE** | `npm install` was attempted, but the npm registry request failed with `EAI_AGAIN`; no package installation could be completed in this environment. |
| Two real browser windows (host + guest) | **NOT RUN** | The in-memory host/guest integration regression passes, but a real browser/WebRTC smoke test requires installed dependencies and reachable signalling/network access, which were not available here. |

## Remaining verification

On a network-enabled machine, run `npm install`, then `npm run lint` and `npm run build`, followed by a two-browser host/guest test that starts the game, closes the guest tab, and disconnects a peer during publication. Those checks are intentionally not marked as passed here.


## Follow-up client handshake fix (2026-10-27)

- Added a per-`RemoteGameClientPort` session token to the guest hello and heartbeat protocol.
- Repeated hello messages replay the stable participant assignment. When the session token changes on an existing PeerJS connection, the host resets peer-scoped sequence/replication cursors and queues a fresh authoritative full state without allocating another player.
- Host heartbeat replies echo the session token; stale replies from an old client lifecycle are ignored with diagnostics rather than closing a valid connection. Malformed heartbeat envelopes still raise visible protocol errors.
- The exact protocol/state invariant failure is now included in the first console argument rather than only in a collapsed details object.
- Regression suite result after these changes: 229/229 tests passed. `npm run lint` and `npm run build` were attempted; both remain blocked at TypeScript startup with `TS2688` because `@types/node` is absent. No live two-browser WebRTC test was performed.


## Follow-up: explicit world identity and authority handoff (2026-10-27)

A later live connection attempt showed `Host changed world ID from 'world-1' to 'world-2' within one connection`. The prior handshake follow-up did not include an explicit authoritative `worldId` in `game-player-assigned`, so it did not define how the guest should validate a legitimate host-world handoff over a surviving transport. This was corrected: assignment now declares `worldId`, the guest buffers a full frame for an unknown world until the matching assignment arrives, and old-world packets are diagnosed and ignored. A world switch without an explicit assignment remains a protocol error. The implementation also resets world-scoped replication/presentation state and keeps gameplay disabled until a valid baseline and follow-up delta arrive.

The latest `npm test` run passes **231/231 tests**. `npm run lint` and `npm run build` were rerun; both exited with code 2 because `@types/node` is unavailable (`TS2688`), and Vite did not start. Live browser/WebRTC validation has not been performed. See [multiplayer world-handoff fix and verification](multiplayer-world-handoff-fix.md) and [multiplayer runtime map](multiplayer-runtime-map.md) for the current behavior and layer responsibilities. The earlier 229-test count above belongs to the previous checkpoint, before the world-handoff regression tests were added.
