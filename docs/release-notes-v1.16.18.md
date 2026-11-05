# v1.16.18 — Fullscreen canvas sizing and smooth multiplayer presentation

## Fixed: fullscreen and high-DPI rendering

- The canvas backing bitmap now scales separately from CSS dimensions, with a DPR and pixel-area budget for reliable fullscreen performance.
- Resize handling covers `ResizeObserver`, browser resize, `fullscreenchange`, and `visualViewport` resize.
- Camera centering, screen-space indicators, world bounds, grid coverage, and pointer-to-world mapping use the same CSS-pixel coordinate space.
- Grid and terrain extents account for the current camera zoom; low zoom no longer leaves uncovered areas outside the drawn terrain.

## Multiplayer presentation

- Added a bounded timestamped snapshot interpolation buffer for remote entities, projectiles, resources, and visual effects.
- Added render-only local commander prediction using the shared collision-aware movement primitive. The host remains authoritative for damage, construction, resources, AI, and all gameplay decisions.
- Reconcile the locally predicted commander smoothly toward the latest authoritative position; teleports, respawns, or large discontinuities snap to the authoritative position.
- Pointer coordinate conversion uses the same render camera used by the canvas so aiming stays aligned during local prediction.

## HUD

- Nearby structure telemetry now displays only structure type, HP, and level. Redundant group/operational details, stat lines, cargo values, and health meter were removed from that growing top-bar surface.
- Drone station mode actions remain accessible as icon buttons only while the station is selected and manageable.

## Verification

- Simulation, multiplayer, rendering interpolation, and canvas sizing tests are run by `npm test`.
- The full production build should still be run with `npm run build` in an environment with dependencies installed, and fullscreen plus two-browser multiplayer should be smoke-tested in the target browser.
