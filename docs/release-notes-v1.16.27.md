# Release v1.16.27 — Restore entity rendering and bound Canvas state

## Rendering regression

- The renderer previously finished its world pass after drawing terrain, resources, buildings and the selected-structure outline. Its existing entity/effect drawers were never called, leaving the Commander, drones, harvesters, projectiles, particles and combat text invisible.
- The local projected Commander is explicitly added to the render set by ID so an incomplete transport entity array cannot make the local player disappear. Duplicate entity IDs are rendered only once.
- Entities and transient effects are culled against the visible world bounds before drawing.
- Placement preview, selection outline, and enemy-base screen-space indicators are restored in the render pass.

## Canvas lifecycle and performance

- World rendering now wraps its transform in a balanced `save()` / `restore()` scope with `try/finally`. The previous method called `save()` every frame without a matching restore; this let the Canvas drawing-state stack grow over time and could contribute to main-thread stalls.
- A test Canvas records translation calls to confirm the Commander and a drone reach their draw methods, and verifies no saved Canvas state remains after repeated frames.
- The existing `[simulation clock] Main thread could not keep up` warning remains enabled. It reports dropped overdue wall-clock ticks, rather than an entity-rendering exception. If it continues after this fix under normal gameplay, profile the authoritative `GameEngine.step()` and render frame separately; do not suppress the warning.

## Validation

- `npm test` — 209 tests passed, including two new Canvas renderer regression tests.
- A full browser build and live browser FPS check still need to be run with the project dependencies installed.
