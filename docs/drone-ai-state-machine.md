# Drone Flight Policy and State Machine

## The governing rule

There are only two combat states: `PATROL` (no valid hostile target) and `ATTACK` (one valid hostile target). Defense and escort are home policies, not extra combat states. A single flight controller is used in every policy and for every waypoint; do not add independent movement implementations for patrol, escort, target orbit, or A* route following.

The active flight centre is recalculated each simulation tick:

1. `DEFENSE` without a valid hostile: the centre is the connected friendly/allied building compound's computed centre. Its circular radius is the larger of the compound route's X/Y radii, so the patrol ring conservatively encloses the footprint.
2. `ESCORT` without a valid hostile: the centre is the assigned live commander. Its current position and velocity are read again every tick, so following a moving commander never depends on a cached centre position.
3. A valid hostile inside the doctrine's acquisition envelope becomes the centre. The drone orbits that entity/building while it remains valid and in range. If it dies, disappears, becomes non-hostile, turns into an inert orphan structure, or leaves the permitted envelope, the previous home centre is restored on that same update.
4. **Universal invariant:** every ordinary-flight tick computes acceleration from the current centre, radius, orbit direction, current velocity, and current waypoint. No normal route branch teleports a drone or bypasses the shared physical integrator.

## Shared flight equation

`src/game/ai/droneAI/DroneFlightController.ts` owns the flight law. For position `p`, centre `c`, distance `rho = |p-c|`, outward radial unit vector `r`, orbit tangent `t`, centre velocity `vc`, orbit speed `s`, waypoint `w`, and current velocity `v`:

- `vDesired = vc + s * t`.
- `a = 2.25 * (vDesired - v) + 1.15 * (radius - rho) * r + 0.62 * (w - p) - 0.15 * v`.
- Acceleration magnitude is clamped to the station's configured acceleration. Velocity is integrated using simulation `dt`, clamped to the speed limit, and position is advanced with collision-aware movement.

The radial term is a spring: it pulls outward below the desired radius and inward above it. The tangent term maintains smooth circular travel; waypoint attraction bends the same motion around obstacles; damping prevents uncontrolled oscillation. A deterministic per-drone orbit direction avoids all drones choosing the same turn direction. Phase advances from the current orbit speed and radius; it is not reset to a random point each frame.

These are tuning constants in `DRONE_FLIGHT_TUNING`. Tests assert the actual numerical equation, the spring sign on both sides of the target radius, finite changing velocity vectors, live centre updates, and the speed/acceleration limits. Do not duplicate these formulas in `DroneAIUpdate.ts` or in an A* movement branch.

## A* and performance rules

`DroneAIUpdate.ts` supplies the current centre and `DroneFlightController.ts` performs this per-tick sequence with help from `DroneFlightPathPlanner.ts`:

1. Derive a look-ahead point on the orbit from the current centre and phase.
2. Test the direct air corridor against a short-lived cached grid of building clearance cells.
3. If the corridor is clear, use the look-ahead point directly; do not launch A* work.
4. If blocked, request an obstacle-aware A* path and follow its waypoints using the exact same acceleration and integration law as direct flight.


Waypoint capture must stay below half a grid cell; the previous tolerance larger than a full cell could skip an orthogonal corner and steer diagonally into a wall. Each physical micro-step is collision-tested and the remaining tick continues with axis sliding, rather than aborting at the first blocked X step. If a drone starts inside the expanded clearance ring but outside the actual building footprint, it receives a short four-connected escape route; A* must never relocate its start cell to the other side of a wall without physically connecting the drone to that cell. Creating this escape route invalidates any older pending long-range result. While following a route, a 0.65-second no-progress watchdog invalidates a route that fails to reduce distance to its waypoint and emits a rate-limited `[navigation]` warning before replanning.


Path goals are not invalidated by every small centre movement. A* uses a move threshold and refresh cooldown; only one request per drone is pending at a time. Browser requests use the bounded asynchronous worker scheduler. A* runs synchronously only in environments where Worker path requests are not available, and only when a blocked corridor needs a route; that explicitly warned fallback is capped at 650 node expansions. Worker construction, messaging, and runtime failures do not switch to main-thread A*. Failed/rejected routes clear their pending lock and retry with bounded backoff. Worker results are shape-checked before they are accepted; invalid results log an explicit diagnostic. Unexpected result-processing failures are no longer hidden by a chained catch after the pending lock is removed. Late results for a replaced target/centre are discarded intentionally. Resources are intentionally not treated as physical barriers for flight.

Keep per-tick work bounded: target acquisition is rate-limited, but validation of the current target and home-centre selection happen every tick. The building grid is cached briefly, and home defence geometry is cached briefly by station. Never scan every possible path or rebuild the full obstacle grid for every drone on every frame.

## Target and return rules

- Target acquisition range is measured from the current **home centre**, not the drone's wandering position. Moving outside a base does not let a defensive drone extend its own aggro radius.
- Target priority is delegated to the shared combat priority policy; this controller only applies its home-centre envelope and doctrine leash.
- Escort pursuit must fit inside the commander's tether, including the target orbit radius. A target that no longer fits is dropped immediately; the live commander centre becomes active again on that update.
- Defensive alerts still broadcast through the existing group/commander alert layer.
- Low-health kamikaze is an intentional separate one-way combat action: speed is `drone.speed * 1.2`, and the target's speed never changes it. It bypasses ordinary orbit flight while committed.
- Orphaned/inert structures are not valid combat targets. Dead drones or drones whose station is not operational must not keep acting.

## Module ownership

- `DroneAIUpdate.ts`: resolves station/commander home centre, validates/acquires target, selects the active centre, and calls the single flight loop.
- `DroneFlightController.ts`: phase, route goal, shared acceleration equation, velocity/position integration, and collision-safe movement.
- `DroneFlightPathPlanner.ts`: cached air-clearance grid, direct-corridor checks, A* worker lifecycle, stale-result rejection, waypoint progression, and bounded retry.
- `DroneFlightTuning.ts`: one source of truth for physics gains and path thresholds.
- `DroneAIWeapons.ts`: aiming, projectile creation, cooldown, and firing.
- `DroneAIStateTransitions.ts` and its base layers: shared target validation, combat alert coordination, station/cluster indexes, and the committed kamikaze action. These layers remain part of the active patrol/combat orbit planning path; the acceleration-based flight controller executes their selected route and target.
- `src/game/runtime/asyncPathfinding.ts` and `src/game/runtime/workerTaskScheduler.ts`: bounded worker path requests and lifecycle.
- `src/game/movement/collision.ts`: physical collision, bounded substepped movement, and embedded-entity recovery. All smooth/path movement entry points use the substepped variant so long integration steps cannot cross an obstacle just because their endpoint is clear.
- `src/game/performance/PerformanceDiagnostics.ts`: low-overhead timing aggregates and visible slow-stage warnings; see [Performance Diagnostics](performance-diagnostics.md).

`DroneAIOrbit*`, `DroneAIPatrolNavigation`, and `DroneAIStateTransitions` are active parts of the current drone AI inheritance and planning flow. They own combat/escort orbit geometry, approach phases, patrol route state, and state transitions. `DroneFlightController` is the single movement integrator that executes those plans. Refactor these modules only by changing all current callers and regression tests together; do not keep obsolete code or APIs for historical consumers.

## Regression coverage

`src/game/tests/rules-02-defense-drones-stop-patrol.test.ts` and `rules-14-drone-orbit-navigation.test.ts` cover centre selection and mode switches: defence idle, escort idle/live commander movement, combat-centre entry, tether/range break-off, and immediate home-centre restoration after target death. `rules-15-drone-flight-controller.test.ts` checks the acceleration equation numerically, radial spring direction, and every-tick velocity updates. The remaining drone suites cover air-clearance collision, path rejection/retry, firing/alerts, damage, kamikaze, and route smoothness.

When a drone movement bug is fixed, add a regression assertion for the contract rather than for private state from the old orbit-entry implementation. If the policy or equation changes, update this document, `skills/gameplay-ai/SKILL.md`, the architecture summary, and the current release notes in the same change.
