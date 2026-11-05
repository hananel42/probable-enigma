# Release v1.16.24 — Multiplayer lifecycle and connection UX

## Correctness

- Resolve the HUD Core by the local participant's explicit `coreId`; never assume the first player-faction Core is local, and render no Core value when participant identity is unknown.
- Freeze survival time at the local participant's first Core-defeat timestamp. Restart clears defeat timestamps and preserves selected player names.
- Keep defeated participants connected and assigned in the room. They lose gameplay control, receive a reliable defeat notification, and may remain in room chat until the host restarts or they leave.
- Distinguish defeat from peer departure. Only a real disconnect removes the participant, command context, resource ledger, Commander and active structures. Gray structures abandoned by a destroyed Core remain as salvage.
- Ensure rejoining creates a fresh participant with a living Core/Commander and no prior defeat state.

## Session experience

- Keep guests behind a synchronization screen until identity assignment, initial authoritative state, and a subsequent authoritative update have all arrived.
- Show clear connection failure guidance with a visible icon and return-to-lobby action instead of a black screen or a permanent spinner.
- Add display-name validation and English random robot names when the input is blank.
- Add compact host-authoritative room chat. `T` opens, Enter sends and closes, Escape closes; chat messages are normalized, bounded, rate-limited, and attributed by the host.

## Validation

- `npm test`: 203 simulation, multiplayer, transport, UI-projection, connection-error, and stress checks pass.
- The project-level `npm run lint` could not be completed in the editing environment because dependencies are not installed (`@types/node` is missing). Run `npm install`, then `npm run lint` and `npm run build` before deployment.
