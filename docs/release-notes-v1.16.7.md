# v1.16.7 — Fail-fast rendering and resize lifecycle

## Changes

- Removed silent recovery from canvas drawing and simulation frame loops. Exceptions stop the affected loop and propagate to the browser console with their original stack. The app-level error handlers stop the paired game loop too.
- Removed per-building, per-entity, and enemy HUD draw catches that could conceal broken rendering state.
- Replaced window-only resize handlers with `ResizeObserver` on the canvas and guarded backing-size writes so identical dimensions do not reset the 2D context.

## Validation and limitation

The simulation suite and signaling tests pass, including the test that advances beyond the first procedural enemy outpost spawn. The freeze reported during actual browser resize was not reproducible in the headless simulation suite; this release eliminates the previous silent-error behavior and corrects canvas resize lifecycle handling, but the exact original browser exception remains unconfirmed until reproduced with a console stack trace.
