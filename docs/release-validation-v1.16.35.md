# v1.16.35 — Release validation record

Validation date: 2026-10-27. Environment: Node.js v22.16.0, npm 10.9.2, Linux container. The project has no installed `node_modules/` and no committed npm lockfile in this archive.

## Automated commands

| Command | Result | Evidence / limitation |
|---|---|---|
| `node --check scripts/test-simulation.mjs` | **PASS** | Test-runner entry point parses successfully. |
| `npm test` | **PASS** | Exit code 0. **253 passed, 0 failed, 0 skipped**. Includes the new return-to-room persistence and room-removal notification/ACK regression tests. |
| Full-source TypeScript/TSX syntax pass with global `tsc --noCheck --noEmit` | **PASS** | All source files parsed. This only checks syntax/emit-level issues; it is not a semantic type-check. |
| `npm run lint` | **BLOCKED** (exit 2) | `tsc --noEmit` reported `TS2688: Cannot find type definition file for 'node'`. `@types/node` is declared in `devDependencies` but not installed. |
| `npm run build` | **BLOCKED** (exit 2) | Stops at the same TypeScript setup error. Vite did **not** run and no successful production bundle is claimed. |
| ZIP integrity | **PASS** | `unzip -t` reported no errors in the compressed data of the final release archive. |

## Regression coverage added

- Returning to the room sends `game-world-ended` and a room assignment with `worldId: null` without closing the room connection.
- The guest can still send room chat after returning, and can receive/start a later world under the same room session.
- The host sends an explicit `game-room-removed` notice and waits for `game-room-removal-ack` before closing a reachable participant.
- The guest displays a single fixed user-facing removal message and acknowledges duplicate deliveries without showing duplicate notices.
- When a peer is already unavailable, cleanup completes without throwing an avoidable action error; a clear host-facing status explains that the notice may not have arrived.
- User-facing connection/runtime messages are checked for internal PeerJS/WebRTC/transport details.

## Manual browser validation still required

No live two-browser session was performed in this environment. Before a production release:

1. Install dependencies from a lockfile in a network-enabled checkout (`npm ci`).
2. Run `npm run check` and resolve all failures.
3. With two browsers, start a world, click **Return to room**, confirm both participants remain in the room and can chat, then start a second world without rejoining.
4. Kick the guest and confirm they see **“The host removed you from this room.”** before the connection closes.
5. Verify the room UI shows actionable messages for network failures and does not display raw implementation errors.

## Release decision

**Not fully production-validated.** Regression tests and syntax checks pass, but strict type-checking, production bundle creation, dependency-lockfile reproducibility, and live browser/WebRTC checks remain release blockers.
