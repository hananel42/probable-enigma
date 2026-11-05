# Release v1.16.30 — Peer disconnect race and room-status delivery

## Root cause from the reported console log

The host's liveness timer attempted to close a guest after PeerJS had already removed its `DataConnection` from the registered-connection map. The old cleanup path treated that ordinary race as a failed close and raised an `AggregateError` after removing the participant. That exception escaped the room publication timer and reached the app-level runtime handler, which stopped the multiplayer renderer/simulation. The repeated `Target peer has no registered direct connection` and failed delta-queue messages were symptoms of trying to publish to a stale peer registration.

## Fixes

- `PeerJsRoomClient.closePeer` is idempotent. An already absent peer is treated as completed cleanup, and a stale pending connection is also removed/closed.
- `HostRoomController.removePeer` always invokes the transport's idempotent close operation when cleanup requests a close, even if `hasPeerConnection` reports that the channel is already closed. This clears a closed `DataConnection` that may remain in an adapter registry.
- The host checks transport membership before broadcasting the next delta, removes orphaned participant records/assets promptly, and no longer keeps disconnected participants in the active room roster.
- Room-status send state is stored per peer and only updated after a successful enqueue. A transient `false` return or thrown transport exception remains pending for retry.
- Transport-send exceptions and local room-status listener exceptions are caught at their boundary, logged with peer/message context, and reported to the room UI. They do not abort delivery to the other guests.
- The lower-level `WebRtcDataChannelTransport` now implements `hasPeerConnection` and idempotent `closePeer`; missing/closed peer diagnostics are rate-limited per peer instead of repeating every publication tick.
- The app-level multiplayer runtime listener shows the error and opens the room panel without automatically stopping the renderer and simulation. Controller/engine invariant failures still produce an explicit console stack and UI diagnostic.

## Regression tests

Added tests for (1) cleanup after a transport removed a peer before the host cleanup runs, (2) exceptions during room-status send that must be reported but not escape, and (3) retrying the status transition to `playing` after the send succeeds. The full simulation/protocol suite passes 229 tests in the latest verification run.

## Remaining validation

These deterministic tests verify controller/transport behavior, but they do not replace a live two-browser WebRTC run. Confirm the build with `npm install` and `npm run build`, then test a guest leaving during a match, host start, reconnection, and multiple simultaneous guests on real networks. TURN is still not configured, so direct WebRTC connectivity remains network-dependent.


## Follow-up — guest handshake lifecycle and stale heartbeat isolation

A further investigation of connection attempts found that a guest client object can be replaced while its PeerJS data connection remains open (notably during React development remounts). The host previously treated an already-queued participant assignment as sufficient, so the replacement client could miss its assignment/full-state handshake. Heartbeat responses from the previous client lifecycle could also be misclassified as a fatal protocol error because sequence counters restart with the new client object.

- Each `RemoteGameClientPort` now advertises a per-instance `clientSessionId` in its hello and heartbeat messages.
- The host preserves the existing participant identity but resets per-client sequence/replication cursors when the client session token changes, then sends a fresh assignment and authoritative full-state baseline.
- Host heartbeat responses echo the client session token; stale session responses are diagnosed and ignored rather than closing the active peer. A response with a sequence not yet issued by the current client is also treated as stale, while malformed heartbeat envelopes remain fatal and visible.
- The precise invariant failure text is now printed directly in the console message, with session/state context attached, so a future protocol failure is diagnosable without expanding a collapsed object.
- Regression coverage now includes assignment replay, client-session replacement over the same peer, fresh baseline delivery, reset command sequence acceptance, and delayed heartbeat isolation.

The latest `npm test` run passes 229 tests. `npm run lint` and `npm run build` were attempted but remain blocked by the environment's missing `@types/node` dependency; they are not reported as passing. A live two-browser WebRTC verification was not available in this environment.


## Follow-up — explicit world identity and host authority handoff (2026-10-27)

The next guest connection log exposed a flaw in the previous handshake fix: the client could already hold `world-1` while receiving an initial frame for `world-2`, but `game-player-assigned` did not carry the authoritative world ID. The receiver therefore had no explicit protocol event that could distinguish a legitimate host-runtime/world handoff from a contradictory packet. Automatically trusting the new frame would have hidden real protocol violations, while immediately closing the connection prevented a valid handoff from completing.

- `HostRoomController.sendParticipantAssignment` now includes the authority's `worldId` in `game-player-assigned`; the host continues to send the assignment before the corresponding full baseline.
- `RemoteGameClientPort` treats that assignment as the only authority boundary for switching worlds. A full state for an unknown world is held as one bounded candidate until the matching assignment arrives. A world switch without a matching assignment remains an explicit protocol failure.
- Revision counters are compared only within the same world. An announced handoff resets world-scoped sequence/heartbeat state, event de-duplication, prediction, and interpolation, then requires a matching full baseline and subsequent valid update before restoring readiness.
- Late frames/deltas from recently retired worlds are logged and ignored, preventing queued traffic from an old runtime from rolling back the new world. The guest retains the last rendered snapshot while waiting, but disables command delivery until new state is synchronized.
- Added regression tests for explicit world handoff, a candidate full state arriving before assignment, stale packets from the previous world, and rejecting an unannounced world change.

The final automated test run for this follow-up passes **231/231 tests**. `npm run lint` and `npm run build` were run after the code change and both exited with code 2 at TypeScript startup because `@types/node` is absent (`TS2688`); Vite did not start. A live two-browser PeerJS/WebRTC session was not available, so browser-level connection verification remains unconfirmed. See [Multiplayer Runtime Map](multiplayer-runtime-map.md) for layer responsibilities and the message sequence.
