# v1.16.13 Release Notes

## Automated weapons and abandoned structures
- Fixed target acquisition in Auto-Turrets and Fire Towers. Their first scan now performs the shared priority search; subsequent update ticks resolve and revalidate the cached target.
- Automated target selection, drone cached targets, defense alerts, commander attack goals, and projectile collision reject orphaned structures whose owning Core is gone. Gray orphan structures remain inert and salvageable.
- Added regression coverage for turrets skipping nearer gray structures, actual Auto-Turret projectile creation, Fire Tower pulse damage, and drones dropping invalid cached targets.

## Multiplayer session correctness
- The guest client no longer fabricates a local engine snapshot before the host state arrives. Session and snapshot access require a real authoritative host frame.
- Fixed the join-order race where a world frame can be broadcast during participant registration before the guest receives its participant assignment. The guest buffers the newest valid frame and projects it after assignment.
- Room creation/join waits for `room-created`/`room-joined` server acknowledgement, instead of marking the room ready merely because the WebSocket opened.
- Multiplayer protocol mismatches, unavailable sends, unexpected socket closure, and worker protocol/runtime failures are surfaced rather than swallowed. Invalid JSON now propagates as an uncaught server exception with its stack trace instead of being converted into a fallback response.

## Strict runtime invariants
- Negative/non-finite simulation deltas now throw; zero remains an intentional no-op.
- Damage application rejects invalid HP, armor, or damage values instead of silently normalizing them to zero.
- Economy mutations and status effects reject malformed numerical state instead of turning it into zero/one or deleting malformed effects as if expired.
- The one legacy burn migration default is retained only when the legacy damage field is absent; explicitly malformed legacy data throws.
- Missing host/participant ownership, absent connected-player command state, impossible respawn state, and missing spawn anchors throw instead of switching to hard-coded player/Core/position defaults. Disconnected participants can no longer anchor procedural enemy outposts.
- Removed silent catches/fallbacks from audio initialization/use, canvas rendering, pathfinding workers, worker scheduling, and the multiplayer client.

## Verification
- `npm test`: 145 simulation/integration tests and 3 signaling room-code tests pass.
- Targeted TypeScript checking for the modified engine/client modules and Node syntax checks for the signaling server/test runner pass.
- Full lint/build could not be run in this environment because dependency installation timed out and `@types/node` is not installed.
- `npm run lint` and `npm run build`: validate TypeScript and production bundle when dependencies are installed.
