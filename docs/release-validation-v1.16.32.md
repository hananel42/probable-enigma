# v1.16.32 Release Validation

Date: 2026-10-27

## Actual command results

| Command/check | Result | Evidence |
|---|---|---|
| `npm test` | **PASS** | 239 tests passed, 0 failed. Final run: about 5.19 seconds. The test runner compiles its selected TypeScript test graph before executing it. |
| `npm run lint` | **BLOCKED / exit 2** | `tsc --noEmit` reported `TS2688: Cannot find type definition file for 'node'`. `node_modules` is absent in this workspace. |
| `npm run build` | **BLOCKED / exit 2 before bundling** | The script stops at `npm run lint` with the same `TS2688`; Vite did not run and no production bundle is claimed. |
| TypeScript/TSX syntax transpilation | **PASS** | Transpilation checked 141 source files with no syntax diagnostics. This checks syntax only, not full project type correctness. |
| Snapshot envelope size regression | **PASS** | A host-controller test builds a real initial world, captures its full-state message, and verifies the JSON-envelope size is at or below the transport's 16 MiB application limit. |
| Live two-browser PeerJS/WebRTC test | **NOT RUN** | Automated tests use in-memory transports and do not prove actual signaling, ICE/NAT traversal, BinaryPack negotiation, or browser rendering. |
| ZIP integrity | **PASS** | `unzip -t` passed on the final release archive; no corrupt entries were reported. |

## Functional changes covered by regression tests

- Opening room management during play is preserved across periodic status updates for the same world. Actual lifecycle changes still open or close the panel deliberately.
- The multiplayer Escape menu exposes `ROOM MANAGEMENT`; clicking it hides the Escape overlay and opens room controls without leaving the room or pausing the simulation.
- Removed the global Enter listener that could start Single Player when focus was outside the Single Player button. Native keyboard activation remains available when the actual button is focused; Enter in other UI no longer starts a second game mode.
- The host's `HostRoomController` centralizes lifecycle changes and rejects invalid pause/resume/start transitions. The invariant is `phase === 'lobby'` iff `hasWorld === false`; all other phases require an active world.
- Pause/resume preserves the same `worldId`, return-to-room stops simulation and preserves room membership, and a subsequent explicit start creates a fresh world.
- PeerJS explicitly requests `serialization: 'binary'` and the host rejects an incoming channel that negotiates a different serializer. This switches large full-state frames away from the JSON serialization path that produced `Message too big for JSON channel`.
- PeerJS messages remain bounded by a 16 MiB UTF-8 JSON-envelope check. That representation is used only for size validation; actual wire transfer uses BinaryPack. Full-state recovery remains ACK-based and bounded.

## Known validation limits

Full type-check and production bundling still require installing the declared project dependencies, especially `@types/node`; those commands were not successful and are not represented as passed. Real two-browser WebRTC testing remains outstanding. The host simulation clock's dropped-tick warning is intentionally not suppressed: if it continues after the resync loop is removed, collect a new browser profile to determine whether the remaining delay is simulation work or rendering cost.

PeerJS references: [DataConnection API](https://peerjs.com/client/api/data-connection) and [Peer API](https://peerjs.com/client/api/peer).
