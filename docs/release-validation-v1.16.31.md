# v1.16.31 Release Validation

Date: 2026-10-27

## Actual command results

| Command/check | Result | Evidence |
|---|---|---|
| `npm test` | **PASS** | 235 tests passed, 0 failed. The final run completed in about 4.16 seconds. |
| `npm run lint` | **BLOCKED / exit 2** | `tsc --noEmit` reported `TS2688: Cannot find type definition file for 'node'`. The project dependencies are not installed in this workspace. |
| `npm run build` | **BLOCKED / exit 2 before bundling** | The script stops at `npm run lint` with the same `TS2688`; Vite did not run and no production bundle was created. |
| Syntax transpilation | **PASS** | TypeScript `transpileModule` with diagnostics passed for `src/App.tsx`, `RemoteGameClientPort.ts`, `HostRoomController.ts`, and `transport.ts`. This checks syntax only; it does not replace a full typecheck. |
| Dependency installation | **NOT COMPLETED** | `npm install --ignore-scripts --prefer-offline --no-audit --no-fund` timed out. No `node_modules` directory was available. |
| Live two-browser PeerJS/WebRTC test | **NOT RUN** | The automated tests are in-memory and do not prove real signalling, ICE/NAT traversal, or live browser behavior. |
| ZIP integrity | **PASS** | Verified with `unzip -t` after packaging. |

## Functional changes covered by regression tests

- A room can exist in the lobby without publishing a world or initial game state.
- A room status cannot establish the room-session identity before `game-player-assigned`.
- Delayed room statuses from a retired world cannot undo the active world or its paused/playing phase.
- Room-status ordering remains independent of world revisions and uses `statusRevision` within a room session.
- Pause stops the authoritative simulation clock; resume continues the same `worldId`.
- A defeated TEAM participant can be revived in the same world with a distinct new Core ID.
- Return-to-room keeps membership while stopping world publication; starting again creates a fresh world.
- Expected duplicate/stale status and heartbeat traffic is debug-level and deduplicated rather than emitted as repeated warning-level messages.
- Network delta publication is 30 Hz while simulation remains fixed at 60 Hz; guest interpolation history is 18 samples, about 600 ms at the new cadence.

## Remaining validation

Install dependencies in an environment with package-registry access, then rerun `npm run lint` and `npm run build`. Finally test with two real browser sessions on independent connections through PeerJS/WebRTC, including create room, join before world start, start/pause/resume, return to room, revive, and start a fresh world. The project does not configure TURN, so restrictive NAT/firewall environments may still prevent direct P2P connections.
