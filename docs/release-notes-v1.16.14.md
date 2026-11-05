# v1.16.14 Release Notes

## Drone station selection and defense patrol

- `SET_DRONE_MODE` and the `T` hotkey can change doctrine only for the explicitly selected, live, operational Drone Station owned by the active participant.
- Clicking a station persists the selection in the active participant's controls. Selecting a build item or cancelling selection clears the station target so an old pad cannot remain active by accident.
- The selected Drone Station retains a dashed amber outline even when the cursor moves to another structure.
- Defense drone route entry uses direct movement only when the final segment is clear; otherwise it uses obstacle-aware path navigation. The direct-entry stall watchdog no longer adds time on top of the pathfinder watchdog, and a stalled approach retries a different phase of the safe ellipse.
- The existing ellipse remains stable during normal patrol; unrelated building changes do not force route recalculation. A separate entry-stall timer survives individual A* retries, waits for in-flight Worker path requests, and picks a different orbit phase after repeated failures.

## HUD and Escape menu

- Block stats, health/status, group, selected pad doctrine, upgrade history, and the next upgrade choices/cost are presented in the top telemetry row.
- The side context panel no longer repeats basic block name/distance/readiness or upgrade cost/resource totals. It is reserved for choosing an upgrade, repairing, and dismantling.
- `Escape` pauses simulation time in single player and presents Continue / Exit to Main Menu controls.
- `Escape` presents Continue / Leave Room controls in multiplayer without stopping the host simulation or network frame exchange; only local input is disabled while the menu is open.
- Updated the architecture and HUD guides to match the selected-pad rule, top telemetry/side action-panel split, defensive orbit recovery, and single-player/multiplayer Escape behavior.

## Validation

- Added regression coverage asserting that doctrine changes are rejected unless the targeted pad is selected, that commands for another pad are rejected, and that `T` is a no-op without a selected pad. Added a defense-patrol regression for repeated failed orbit-entry paths.
- Validation in this environment: 147/147 simulation tests and 3/3 signaling-server room-code tests pass; TypeScript/JSX syntax transpilation passes for all changed runtime files. The full `tsc --noEmit` check and production Vite build could not be completed because this environment has no local dependencies (`node_modules` / `@types/node`); run `npm install` and `npm run build` in a configured development environment.
