# v1.16.31 — Persistent room lifecycle and smooth replication

## Room lifecycle

- Room creation and guest join now have a strict room-only contract. Assignment uses `worldId: null` in the lobby, no initial game state is published, and the app does not mount the active-world renderer until the host starts a world.
- Host room controls explicitly start a fresh world, pause/resume the existing world, return to the room without dropping connected peers, and revive a defeated TEAM/FFA participant with a new Core. CO-OP individual revival remains rejected because the team shares one Core.
- `game-world-ended`, null-world assignment, room status and cleared replication baselines form the end-of-world boundary. Heartbeat, chat, display-name and transport membership survive that boundary; the next start creates a new world identity and a new full baseline.

## Ordering and noisy stale packets

- `game-room-status` uses a monotonic `statusRevision` separate from world revisions. Status messages cannot establish `roomSessionId` before participant assignment. A world-bearing room status must match the announced world; a status from a retired room controller or an older revision cannot revert the lobby/playing/paused UI.
- World changes reset only world-scoped command/revision/presentation state. Room status ordering, chat deduplication and heartbeat/liveness remain room-scoped.
- Expected duplicate or stale packets are logged at debug level. Repeated copies of the same mismatched world status are deduplicated, while malformed messages and genuine protocol invariant failures remain visible errors.
- React host teardown disposes the publication timer and message subscription before the controller/server objects are replaced, preventing an orphaned timer from continuing to publish a retired world.

## Presentation cadence and tests

- Raised network delta publication from 20 Hz to 30 Hz while retaining the independent fixed 60 Hz authoritative simulation. Expanded the compact interpolation buffer to 18 samples (about 600 ms at 30 Hz); the room-status clock remains coalesced to at most once a second.
- Added regression coverage for a status that arrives before assignment, delayed world statuses, room-only join, pause/resume clock behavior, and revival with a different Core ID in the same world.

## Verification

- `npm test`: 235 passed, 0 failed.
- `npm run lint`: **blocked** (exit 2) by `TS2688: Cannot find type definition file for 'node'`; the archive's environment has no `node_modules`. After correcting the JSX syntax error, this was the only reported diagnostic.
- `npm run build`: **blocked before bundling** (exit 2) by the same lint/type-dependency error; Vite did not run.
- `npm install --ignore-scripts --prefer-offline --no-audit --no-fund`: timed out in this environment, so dependency installation could not complete.
- TypeScript syntax transpilation passed for `App.tsx`, `RemoteGameClientPort.ts`, `HostRoomController.ts`, and `transport.ts`; this checks syntax, not full type correctness.
- Real two-browser/WebRTC testing was not available in this execution environment and is not claimed.

See [release validation report](release-validation-v1.16.31.md), [multiplayer runtime map](multiplayer-runtime-map.md), [transport adapter contract](transport-adapter-contract.md), [host-authoritative multiplayer](host-authoritative-multiplayer.md), and [state replication](state-replication.md).
