# v1.16.38 — Reliable Escape navigation

## Behavior changes

- Single Player now routes `Escape` through the application shell rather than relying on a mounted canvas renderer or canvas focus. The simulation clock stops while the pause menu is open and resumes when the player chooses **Resume Game** or presses `Escape` again.
- The Single Player pause menu contains **Resume Game** and **Main Menu** actions.
- Multiplayer routes `Escape` directly to room management. Opening the room panel releases the local participant's held controls but does not pause or stop the host-authoritative simulation.
- When a multiplayer world is active, `Escape` toggles room management open/closed. When no world exists, `Escape` keeps the room lobby visible or restores it if hidden.
- If room chat is focused, its input handles `Escape` to close chat. Editable fields retain their own keyboard behavior, and the first-visit guidance overlay retains priority while it is active.
- Removed the renderer's old Escape-to-cancel-selection behavior. The renderer no longer owns application navigation; it only prevents the browser default as a defensive measure.

## Architecture

- Added `src/game/client/escapeRouting.ts` as a pure policy function shared by the UI handlers and tests.
- Added regression coverage for Single Player pause routing, multiplayer room navigation without world pausing, lobby behavior, chat, editable fields, and active guidance.
- Kept the simulation lifecycle separate: only Single Player calls the local server's `stop()`/`start()` from its pause menu. Multiplayer Escape changes room-panel visibility only.

## Validation

See `release-validation-v1.16.38.md` for the exact test, lint, and build results from this archive.
