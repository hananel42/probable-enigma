# v1.16.0 — Modular buffs and transport boundary

- Added a data-driven buff/status-effect system with optional health, speed, power, fire-rate and periodic health modifiers.
- Added generic visual effects (particle color/rate/size and marker color/shape) and reapplication policies.
- Migrated fire-tower burning into the buff system while retaining one-time compatibility for older burn fields.
- Buffs now tick through a shared system for player and autonomous entities; health changes use the regular damage/healing path.
- Applied speed modifiers in shared movement primitives and fire-rate/power modifiers to commander and drone weapons.
- Added buff cleanup on lethal commander damage so temporary health modifiers cannot leak into respawn.
- Introduced a transport-neutral `GameDataTransport` interface, making `RemoteGameClientPort` independent of the signaling WebSocket implementation.
- Added unit tests for burn damage/particles, optional modifiers, health scaling, expiry, invalid delta time and legacy migration.

- Extracted `HostRoomController` so React no longer owns guest assignment, command sequencing, and participant routing.
- Increased room capacity to eight participants, added unique peer-to-player mapping, targeted player assignment, runtime command validation, per-peer sequence checks, and disconnect input cleanup.
- Added tests for multiple guest identity/input isolation and duplicate-command rejection.
