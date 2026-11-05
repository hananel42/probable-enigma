# Release notes — v1.11.0

## Fixes

- Signaling server room-code generation and peer IDs now use explicit `node:crypto` `randomBytes` helpers rather than relying on a `randomInt` symbol.
- When an AI commander's home Core is damaged and the commander cannot yet afford the repair, the AI now enters `GUARD_CORE`, returns to a defensive ring, and does not leave to mine, collect, build, upgrade, or salvage. It continues to engage threats close to the Core and re-evaluates repair priority frequently.
- Escort drones now trigger stuck recovery sooner, skip forward along the orbit phase, invalidate stale navigation, and recompute a safer orbit instead of retrying the same blocked point.
- Retained the shared building-selection resolver and matching cyan world outline/HUD target so the hovered in-range building is the one shown; otherwise the nearest in-range building is highlighted.

## Validation

Run `npm test`, `npm run lint`, `npm run build`, and `npm --prefix signaling-server test` from a Node.js 20+ environment.
