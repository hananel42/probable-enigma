# v1.16.9 — Enemy HUD crash fix

## Root cause
`CanvasGameRenderer.draw()` originally declared `isAlliedGroup` as a local helper. `renderEnemyBaseHUDIndicators()` is a separate class method and could not access that local variable. Once an enemy base was created and the HUD loop attempted to compute its alliance color, the browser threw `ReferenceError: isAlliedGroup is not defined`. Since the renderer uses fail-fast behavior, the draw loop stopped as requested.

## Fixes
- Replaced the inaccessible local helper calls with the existing shared `areGroupsAllied(group, playerGroup)` helper.
- Renamed the Core's commander-specific damage-reduction stat to `COMMANDER DAMAGE REDUCTION` to distinguish it from the Core building's own reduction stat.
- Made HUD stat list keys unique by combining each label with its row index.
- Changed `npm run build` to run `npm run lint` (TypeScript) before Vite, so name-resolution/type errors block the build.
- Added a local SVG favicon to remove the browser's repeated default favicon 404.

The duplicated React-key warning was a separate HUD issue. The favicon 404 did not cause the freeze.
