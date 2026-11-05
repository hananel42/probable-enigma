# v1.16.19 — Fullscreen stability and lightweight render interpolation

## Render history memory/performance

- Replaced retained full-snapshot history with a bounded buffer of compact render poses for entities, projectiles, particles, floating text, enemy bases, and camera presentation values.
- Full authoritative snapshots are no longer retained once per interpolation sample. Large static/stateful collections such as structures and resource nodes are not duplicated across the render buffer.
- Compose render output from the current authoritative snapshot plus interpolated visual poses, keeping authoritative data immutable.
- Preserve locally predicted commander movement as a render-only overlay and reconcile it toward the latest authoritative position. Commands, damage, building, AI, and resources remain host-authoritative.

## Rendering and input consistency

- Keep CSS pixels as the shared coordinate space for the renderer, camera extents, and pointer mapping, independently of the canvas backing bitmap.
- Fullscreen, visual viewport, DPR, and layout changes resize the backing bitmap using a capped pixel budget.
- Structure telemetry in the top bar remains limited to type, health, and level.

## Verification

- `node scripts/test-simulation.mjs`: 171 tests passed, including interpolation-buffer and local prediction separation checks.
- Focused TypeScript checking for `CanvasGameRenderer`, `CanvasGameClient`, canvas sizing, interpolation, and the multiplayer render port passed.
- The complete Vite production build could not be verified in this environment because npm dependency installation did not complete. Run `npm install` and `npm run build`, then smoke-test fullscreen and a two-browser multiplayer session in the target browser.
