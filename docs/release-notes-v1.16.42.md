# Release Notes — v1.16.42

## Drone movement reliability

- Defense patrol no longer requests asynchronous A* solely because its first orbit waypoint is more than two grid tiles away. The entire direct segment is checked against the air-clearance map; clear segments use smooth, acceleration-limited steering at any distance.
- Escort orbit entry follows the same rule: direct steering is used for a verified-clear route, while A* is reserved for routes that actually intersect the air-clearance envelope.
- Drone navigation invalidates stale pending-path tokens when a state or route changes. A late worker result cannot overwrite the current patrol/attack goal after a state transition.
- The patrol route is cleared when its geometry changes, preventing an old path from surviving a new orbit plan.
- Added regression coverage asserting that new defensive drones and escort drones with a clear entry corridor move on their first update without creating a pathfinding worker.

## Design constraints preserved

- The high-level combat FSM remains exactly `PATROL` and `ATTACK`.
- Defense and escort remain route/acquisition doctrines, not additional combat states.
- Direct flight is used only after the full segment is checked against the air-clearance envelope. Obstructed segments still use the shared A* path service.
- A failed or stale worker result is not silently converted into an unvalidated route.
