# v1.16.38 — Release validation record

## Changes in this release

Escape now works independently of canvas keyboard focus. Single Player pauses/resumes the local simulation with a clear menu; Multiplayer opens room management without pausing the shared world. A lobby with no active world keeps the room panel visible. Active guidance and text-entry fields retain Escape ownership.

## Automated validation results

- `npm test`: **passed — 270 tests, 0 failures, 0 skipped**.
- Targeted strict TypeScript check for `src/game/client/escapeRouting.ts`: **passed**.
- Full `src/**/*.ts` / `src/**/*.tsx` syntax and transpilation check using TypeScript `--noCheck`: **passed**. This verifies syntax/transformation, not semantic typing.
- `npm run lint`: **blocked** with `TS2688: Cannot find type definition file for 'node'` because dependencies are not installed in this archive workspace.
- `npm run build`: **blocked** by the same `TS2688` during `typecheck`; Vite did not run.
- Browser UI and live multiplayer/WebRTC testing: **not performed** in this environment.

## Manual browser checks still recommended

1. In Single Player, press Escape while the canvas, HUD buttons, or page background has focus. Confirm the simulation time and enemy movement stop; choose Resume Game and confirm they continue.
2. In Multiplayer while a world is active, press Escape. Confirm Room Management opens and other participants continue to move. Press Escape again and confirm the local player returns to the game.
3. In a lobby with no world, press Escape and confirm the room screen remains visible.
4. Open room chat and press Escape. Confirm chat closes without pausing the world or leaving the room.
5. With the first-visit guide active, press Escape. Confirm it dismisses the guide first; a subsequent Escape opens the appropriate game UI.

Automated simulation/UI-policy tests do not replace a real browser and multiplayer signaling/WebRTC check.
