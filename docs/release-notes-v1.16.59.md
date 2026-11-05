# Release Notes — v1.16.59

## Player base navigation and visual identity

- Added a persistent `YOUR BASE` marker for the local participant's current Core. The marker follows the current Core coordinates and switches between an on-screen pointer and an off-screen directional arrow with distance in blocks.
- Added corresponding markers for other participants whenever their Core is distinct from the local participant's Core. TEAM/allied participants use the friendly color; FFA opponents use the enemy color. Shared CO-OP Cores are shown once rather than creating duplicate teammate arrows.
- Destroyed Core objects remain identifiable as a `DOWN` navigation target while they remain in the world.
- Resolved the local participant from the projected Commander identity and used participant group/alliance identity when rendering commanders, drones, and harvesters. Hostile human players now use enemy palettes even though their faction remains `player`; allies use friendly palettes.
- Kept this change presentation-only. No simulation rules, save schemas, multiplayer messages, protocol versions, or authority boundaries changed.

## Documentation

- Added [Player Navigation and Visual Identity](player-navigation-and-identity.md) and updated the architecture, repository map, project README, and project-architecture playbook.

## Validation

See [Release Validation v1.16.59](release-validation-v1.16.59.md) for the commands actually executed.
