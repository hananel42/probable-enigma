# Multiplayer world-handoff fix and verification

Date: 2026-10-27

> **Maintenance note (v1.16.31):** This document is the original v1.16.30 world-handoff incident record. The live contract has since been tightened: room status, chat, and heartbeat/liveness are room-scoped and are not reset when a world changes. See [the current runtime map](multiplayer-runtime-map.md), [transport adapter contract](transport-adapter-contract.md), and [v1.16.32 release notes](release-notes-v1.16.32.md) for current behavior.

## Observed failure

The guest reported:

`Host changed world ID from 'world-1' to 'world-2' within one connection.`

The earlier handshake patch retried assignment and isolated stale heartbeat replies, but it did not define a protocol event that explicitly authorized a world identity change. `game-player-assigned` contained a participant ID and protocol versions but no authoritative `worldId`. The guest therefore could not distinguish a legitimate host runtime/world replacement on a surviving direct connection from an unexpected full-state frame. Treating every changed world as fatal prevented a valid handoff; blindly accepting the new frame would have hidden protocol errors.

## Implemented correction

- `HostRoomController.sendParticipantAssignment` adds `worldId: this.server.worldId` to every assignment, including replays for a repeated hello. The assignment is sent before the corresponding full-state baseline.
- `RemoteGameClientPort` accepts a new world only after an assignment explicitly announces that ID. When an unknown-world full state arrives first, the guest holds at most one candidate and waits for the matching assignment. It does not apply that candidate speculatively.
- Revisions are compared only when both frames belong to the same world. Revisions from two world IDs are independent counters.
- An announced handoff resets world-scoped command/heartbeat sequencing, room status, defeat/chat deduplication, interpolation and prediction. The last snapshot can remain on screen, but gameplay commands stay disabled until the new baseline and a valid follow-up delta are accepted.
- Late packets from recently retired worlds are logged and ignored. A world change that is not announced by `game-player-assigned` remains a visible protocol error; the code does not create a placeholder world or silently repair the mismatch.
- The new transition path has focused comments and named helpers (`acceptInitialStateEnvelope`, `beginAuthorityWorldChange`, `acceptFullState`, `acceptDeltaEnvelope`) so assignment, buffering, baseline validation, and delta application have separate responsibilities.

## Regression coverage

- `RemoteGameClientPort.test.ts`: announced world handoff; full state arriving before the handoff assignment; command gating while handoff is unresolved; session metadata and participant identity after change; late full state/delta from the retired world; readiness restored only after a valid delta; unannounced world switches remain errors.
- `hostRoomController.test.ts`: the assignment contains the current authoritative `worldId`; a simulated host-world replacement on an existing direct peer link triggers a repeated hello, preserves participant identity, and proves the new assignment is queued before the matching full-state baseline without allocating a duplicate participant.
- `docs/multiplayer-runtime-map.md`: documents module responsibilities, join/sync sequence, authority handoff, and error boundaries.
- Updated `README.md`, `architecture.md`, `host-authoritative-multiplayer.md`, `state-replication.md`, `transport-adapter-contract.md`, and `release-notes-v1.16.30.md` to link and describe the explicit world identity contract.

## Verification actually run

| Command/check | Result | Details |
|---|---|---|
| `npm test` | **PASS** | 231 tests passed, 0 failed. Final run: 4.49 seconds. The test script performs strict TypeScript compilation of its test-entry dependency graph before executing Node's test runner. |
| `npm run lint` | **FAILED / blocked by missing dependencies** | Exit code 2. `tsc --noEmit` reported `TS2688: Cannot find type definition file for 'node'`. There is no local `node_modules` directory, and the `@types/node` package is unavailable in this environment. |
| `npm run build` | **FAILED / blocked before bundling** | Exit code 2 at the `npm run lint` step for the same `TS2688` error. Vite did not start, and no production bundle was produced. |
| Live host + guest browsers over PeerJS/WebRTC | **NOT RUN** | The regression tests are deterministic/in-memory. They do not prove that signaling and direct WebRTC connectivity work in a real browser/network. |
| ZIP archive integrity | **PASS** | `unzip -t` reported no errors in the final archive. |

## Remaining validation

On a machine with package registry access, run `npm install`, `npm run lint`, and `npm run build`. Then use two real browser sessions to create/join a room, start the match, and exercise a guest reconnect/host runtime restart. This matters because TURN is not configured and direct WebRTC connectivity depends on NAT/firewall conditions. The code-level protocol fix is covered by regression tests, but this real-browser check is not claimed as complete.
