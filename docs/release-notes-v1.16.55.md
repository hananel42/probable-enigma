# Release Notes — v1.16.55

## World persistence reliability

- Fixed the single-player pause menu's return action so its icon and label match the world-select navigation instead of referencing an unavailable icon.
- Made asynchronous world-selection actions avoid setting component state after navigation unmounts the screen.
- Corrected IndexedDB blocked-open handling so a late-successful connection is closed instead of being leaked after the request already failed visibly.
- Ensured world-list request failures also observe transaction failure, avoiding unhandled transaction rejections.
- Kept the save schema version sourced from `WORLD_SAVE_SCHEMA_VERSION` rather than duplicating a numeric literal.
- Updated the world persistence test to assert the actual restore error contract.

## Scope

- No multiplayer persistence or networking behavior changed.
- World-save schema remains version 1; this release changes no persisted data shape.
