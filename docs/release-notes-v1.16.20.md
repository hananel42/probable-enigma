# v1.16.20 — Independent replication, fullscreen input recovery, and player lifecycle

- Raised authoritative state-delta publication from 10 Hz to 20 Hz (50 ms cadence) while retaining event-driven commands and full-state sends only for join/resynchronization.
- Moved the host publication clock into `HostRoomController`. React and canvas/render/resize callbacks no longer own network progression; the host's 60 Hz fixed-step simulation remains separate from both rendering and state publication.
- Added fullscreen/window-resize focus recovery for the canvas when focus is not intentionally in a HUD control or text-entry field. Held inputs are still released on window blur.
- Permanently removes a Commander from renderable world entities when its Core is destroyed and blocks further commands from that participant. Remote clients project a non-rendered defeat tombstone only for final camera/HUD metadata.
- Enemy outpost spawning now ignores connected participants who have been defeated; it still throws if an undefeated participant is missing its required Commander.
- Disconnect removes the participant's Core, active owned structures, units, projectiles, resource ledger, and group. Structures that were already gray/inert remain in the world as salvage.
- Restart is treated as a room-level host command and publishes only after the full new room state (including preserved participant identities) has been assembled, preventing a transient participant-less frame.
- Added regression coverage for the independently running publication clock, core defeat, disconnect cleanup, and restart after all TEAM participants lose their Cores.

## Validation

- `node scripts/test-simulation.mjs`: 177 tests passed after this release's publication-clock test is included.
- `node --test signaling-server/src/roomCodes.test.js`: 3 room-code tests.
- A full Vite production build and interactive multi-browser fullscreen test still require installing project dependencies and running real browser sessions.
