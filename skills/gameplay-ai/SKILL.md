---
name: gameplay-ai
description: Use for commander, enemy commander, drone, harvester, target selection, movement, combat, building behavior, and upgrade changes.
---
# Gameplay and AI Playbook

## Read first

- [`docs/architecture.md`](../../docs/architecture.md)
- [`docs/drone-ai-state-machine.md`](../../docs/drone-ai-state-machine.md) for drone behavior
- [`docs/structure-targeting-and-ai.md`](../../docs/structure-targeting-and-ai.md) for target policy
- [`docs/combat-and-damage.md`](../../docs/combat-and-damage.md) for damage semantics
- [`docs/progression-and-upgrades.md`](../../docs/progression-and-upgrades.md) for upgrades and balance

## Ownership map

- `src/game/ai/commanderAI/`: player commander economy, construction, strategy, and combat layers.
- `src/game/ai/enemyCommanderAI.ts` and related modules: enemy commander decisions. Preserve core-defense and economy priorities.
- `src/game/ai/droneAI.ts` plus `src/game/ai/droneAI/`: stable entry point, policy, one shared flight controller, and weapon execution. `DroneAIUpdate.ts` chooses the live home/hostile centre; `DroneFlightController.ts` owns the single acceleration law, velocity integration, and collision-safe movement; `DroneFlightPathPlanner.ts` owns A* requests and waypoint progression; `DroneFlightTuning.ts` is the shared tuning source. `src/game/pathWaypointValidation.ts` is the runtime boundary parser for worker-produced routes: never replace its `unknown`-to-validated-data conversion with `Partial<PathWaypoint>` plus `Number.isFinite`/`Number.isInteger`, because those checks do not narrow optional fields in TypeScript.
- `src/game/ai/harvesterAI.ts`: harvester decision logic.
- `src/game/movement/`: collision, smooth steering, and path following/recovery. Movement entry points must use bounded substepped collision integration; no caller may skip collision checks for a long delta or snap a moving drone to a waypoint.
- `src/game/combat.ts`, `combatTuning.ts`, and shared rules: common target/damage policies and balance constants.
- `src/game/buildings/<building>/`: building-owned behavior, upgrade definitions, and drawing.
- `src/game/upgrades/`: typed upgrade-effect interpreter. Treat upgrade IDs as current-schema identifiers; rename them directly and update all current consumers and tests in the same change.

## AI invariants

- Make player and enemy actions use shared engine rules where their semantics are meant to match; put faction-specific choices in policy, not duplicate mechanics.
- Validate target existence, life state, hostility, and mode/tether constraints before using cached targets.
- For ordinary drones, defence, escort, target orbit, and A* waypoints must all use `DroneFlightController.ts`; do not add state-specific movement or direct position assignments. The defence centre is the connected structure compound, escort reads the live commander centre each tick, and valid in-range hostiles temporarily become the centre. Invalid/out-of-envelope targets restore home on that update. Measure acquisition range from the home centre, not the roaming drone.
- Keep the acceleration equation centralized. Its radial spring, tangent velocity, waypoint attraction, and damping all contribute to each tick; bound acceleration, speed, and `dt`. Recalculate moving centres every tick but keep A* requests stable with goal thresholds, caching, one pending request per drone, and bounded retry backoff. Keep waypoint capture below half a grid cell (never skip a four-direction corner), invalidate stale long-range requests when creating a local clearance escape route, and preserve the escape route as a physically connected sequence. If distance to a current waypoint does not decrease for 0.65 seconds, invalidate and replan with a rate-limited diagnostic rather than continuing to press against a wall.
- Use simulation `dt`; bound acceleration, movement, retry loops, and path recovery. Invalid state must throw or log an explicit failure; never turn malformed A* output into an unreported empty route or silent direct-flight fallback.
- Do not let a target's speed or stats affect a unit's movement unless the design explicitly specifies that dependency. For kamikaze drones, speed is `drone.speed * BASE_DRONE_TUNING.kamikazeSpeedMultiplier`; the current multiplier is 1.2 and `drone.speed` already reflects Drone Station upgrades.
- Keep HP/death transitions consistent: dead entities must not keep acting, HP must not remain negative after damage resolution, and no-target behavior must be explicit.
- Keep target-priority rules centralized. If changing a target policy, test entities and structures, dead/unhostile candidates, equal/nearest distances, and invalidated cached targets as relevant.

## Test strategy

Use the nearest behavior-focused `src/game/tests/*.test.ts` suite or the relevant AI/movement test file. Prefer deterministic fixture builders from `src/game/rulesTestSupport.ts`. Cover baseline behavior, upgraded behavior, target changes, missing targets, and lifecycle transitions. Do not assert private implementation details if observable movement/state is sufficient.

## Completion checklist

- [ ] Drone decision policy (`DroneAIUpdate.ts`), shared movement (`DroneFlightController.ts`), and weapons (`DroneAIWeapons.ts`) remain distinct.
- [ ] The same physical integrator follows both open-air goals and A* waypoints; no duplicate orbit/escort movement path was introduced.
- [ ] Normal and edge-case behavior are covered by regression tests, including long-step obstacle tunnelling, invalid numeric state, and worker routes missing required waypoint fields. Worker route validation returns canonical `PathWaypoint[]`; do not use type assertions to skip the parser.
- [ ] For stutters, consult `docs/performance-diagnostics.md`; add a measured stage before optimizing speculative hot paths.
- [ ] Shared constants and upgrade effects remain consistent between creation and runtime.
- [ ] Update `docs/drone-ai-state-machine.md`, targeting/combat docs, or progression docs when the contract changes.
