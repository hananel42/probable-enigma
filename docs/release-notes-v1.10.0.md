# Craftbound 1.10.0 — Targeting, AI and signaling fixes

## Fixes

- Imported `randomInt` from `node:crypto` in the signaling server. This resolves the runtime `ReferenceError` when a WebSocket peer connects.
- When a Core is damaged, commander AI attempts repair before economic or offensive goals. If repair materials are insufficient, it defends against hostiles within the Core's protection radius and gathers repair resources locally instead of committing to unlimited-distance mining.
- Escort drone navigation has a stuck watchdog for both curve following and path-based orbit entry. After a persistent stall, it discards stale path state and re-anchors/rebuilds its orbit.
- The contextual structure target is consistent across the corner HUD, world outline, and upgrade/repair/dismantle actions. A hovered in-range structure wins; otherwise the nearest in-range structure is used.

## Validation

- `node --check signaling-server/src/server.js` — passed.
- `node --test signaling-server/src/roomCodes.test.js` — 3 tests passed.
- Focused TypeScript check of non-test game modules — passed.
- Full `npm install`, project test suite, and production build could not be completed in this environment because dependency installation timed out. Run `npm install`, `npm test`, `npm run lint`, and `npm run build` locally before release.

## Network policy

The room creator remains the only simulation host. No TURN support or fallback is included. Direct WebRTC connections can fail on networks that do not permit peer-to-peer connectivity.
