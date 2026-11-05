# Release Notes — v1.16.41

## Drone AI and navigation stability

- Replaced implicit combat/navigation combinations with a two-state drone AI policy: `ATTACK` when a valid hostile target exists, otherwise `PATROL`.
- Kept station doctrine (`DEFENSE` or `ESCORT`) separate from the high-level AI state. Defense patrols orbit the connected building compound; escort patrols orbit the commander.
- Clear stale combat waypoints, target IDs, orbit approach phases, and patrol-entry stall timers at state transitions.
- Escort targeting now checks both the commander's tether and the drone's own pursuit envelope. A target outside either envelope is not reacquired indefinitely from the drone's wider sensor radius.
- Ensured combat orbiting only runs while the drone is in `ATTACK`; without a valid target, the drone continues along its doctrine patrol route.
- Fixed a target-acquisition guard that previously prevented an escort drone already in `ATTACK` from using commander-centered target selection after its previous target became invalid.
- Fixed asynchronous path-request rejection handling so a failed Worker request releases the pending-path lock. This restores stuck-path watchdogs and bounded retry for drones affected by worker failure.
- Added per-entity rate-limited path-request diagnostics and bounded retry delays.
- Added worker task deadlines and worker-slot retirement for crashed or unresponsive workers, allowing later jobs to use replacement slots.
- Corrected the HUD drone-mode shortcut to `C`; `T` is labeled for chat.

## Tests

- Added explicit tests for the `ATTACK` / `PATROL` state policy and station-doctrine behavior.
- Added coverage for escort break-off when a target leaves tether or pursuit range.
- Added worker timeout/replacement coverage and a regression test proving that a rejected async path request clears the entity's pending lock.

See [Drone AI State Machine](drone-ai-state-machine.md) for the behavior contract and module responsibilities.
