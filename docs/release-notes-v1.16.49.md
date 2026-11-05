# Release Notes — v1.16.49

## Drone AI rebuilt around one physical flight controller

- Replaced the ordinary drone movement branch in `DroneAIUpdate.ts` with one shared centre/radius policy and one second-order flight controller.
- Defence drones orbit the connected structure compound; escort drones consume the live commander position/velocity every simulation tick. An eligible hostile becomes the active centre, and a dead, invalid, out-of-range, or out-of-tether target restores the prior home centre immediately.
- Centralized the acceleration equation: tangential velocity correction, radial spring, waypoint attraction, damping, acceleration clamp, speed clamp, and collision-aware position integration.
- Extracted `DroneFlightPathPlanner.ts` to own the short-lived obstacle-clearance cache, A* worker lifecycle, waypoint progression, stale-result rejection, and bounded retries. A* is requested only if the direct air corridor intersects the building-clearance grid; open-air movement does not launch pathfinding work.
- Extracted `DroneFlightTuning.ts` so path thresholds and physical gains have one source of truth without a circular import between the controller and planner.
- Added direct numeric regression tests for acceleration equation terms, spring direction on either side of the radius, live centre changes, finite vector velocity updates, and speed limits.
- Updated the drone AI policy document, architecture guide, targeting guide, repository map, and the Gameplay AI skill to remove the old orbit-entry movement contract.
- Preserved target-priority, defense alerts, target tether, obstacle collision, and 1.2× upgraded-speed kamikaze behavior.
