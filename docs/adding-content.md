# Adding Game Content

This guide is the implementation checklist for new structures, robot units, and visual variants. The goal is to keep balance, UI metadata, target behavior, and presentation close together instead of hiding them across unrelated modules.

## Maintain the built-in building types

The game intentionally ships with a fixed set of built-in building types. It does not support custom building types or runtime-added modules. Each built-in building is a self-contained module under `src/game/buildings/<camelCaseName>/`; keep changes to that building in its folder instead of scattering its behavior across UI, rendering, and engine files.

For normal changes to an existing building, edit its `definition.ts` (cost, health, footprint, name and presentation), `behavior.ts` (behavior settings and simulation logic), `upgradeScaling.ts`, `upgrades.ts`, `inspect.ts`, and/or `draw.ts` as appropriate. Its `index.ts` composes the module, and `src/game/buildings/registry.ts` is the static mapping for the fixed set. The content catalog and upgrade adapter derive their views from that mapping; avoid duplicate data entries.

If a future development change intentionally adds or removes a built-in type, that is a source-code change—not a custom/runtime extension. Update `BuildingType` in `src/game/types.ts`, the module folder, the static registry, and relevant catalogs/tests together. Keep shared construction, repair, upgrade, salvage, occupancy, and damage rules generic. Existing automated weapons should use `findPriorityHostileTarget` and shared damage helpers.
5. **Draw from actual state.** Implement `draw.ts` as a procedural recipe using Canvas paths, polygons, shapes, materials, colors, upgrade IDs, live stats and deterministic `timeSeconds` supplied by the renderer for animation. It may be composed from helper functions in `src/game/buildings/shared/drawing.ts`; avoid representing all buildings as the same square. Add visually distinct details for meaningful branches (for example, armor plates vs a larger structural frame, longer or twin barrels, extra drone pads, or stronger emitter rings).
6. **Expose live stats.** `inspect.ts` supplies building-specific rows; the common upgrade system adds health, damage reduction and self-repair. Explanations for similar-looking stats should say what happens to a concrete hit or production cycle.
7. **Test the complete lifecycle.** Check catalog registration, affordability, placement, behavior, damage/death, upgrade effects, AI recommendation, renderer registration, and salvage. Test both player and enemy ownership when relevant.

A built-in building should be understandable by reading its folder and then checking its static registry entry. Prefer module-local behavior and small generic shared services over building-specific branches in the central engine.

## Add an entity or robot unit

1. Add its literal to `EntityKind` and any state fields required by its behavior in `src/game/types.ts`.
2. Add one complete entry to `ENTITY_CATALOG` in `src/game/content/entityCatalog.ts`. This owns its display name, category, combat capability, target tier, and player/enemy palettes. The target-profile map is derived automatically.
3. Add a factory in `src/game/rules.ts` that initializes every field deterministically. Avoid putting AI decisions in the factory.
4. Add a focused controller module under `src/game/ai/` if it needs autonomous behavior. Pass simulation state into the controller rather than reaching into global state.
5. Wire the controller into `GameEngine.updateAutonomousUnits`, and let it use the shared hostility / targeting / damage helpers. Every damage path must clamp HP through the shared helpers; never subtract from `hp` directly.
6. Add or reuse a renderer in `src/game/drawers/entityDrawer.ts`. Read colors from `ENTITY_CATALOG` rather than adding owner colors in multiple branches.
7. Test spawn legality, death cleanup, team identity, targeting, speed limits, and recovery from blocked movement.

## Shared combat contract

- `findPriorityHostileTarget` is the only target-acquisition policy for automated weapons and AI attack goals. It uses this priority: closest armed hostile entity; closest hostile weapon structure; Core/spawn; support infrastructure; ordinary structures; harmless units. Distance breaks ties within a tier.
- A defending drone can send a short-lived reinforcement alert. Allies with a valid local fight keep it; otherwise drones respond to the alert and an idle enemy commander adopts it as an attack goal.
- The player-controlled commander's weapon remains cursor-aimed by design. All automatic weapons use the shared priority policy.
- Use `applyEntityDamage` or `applyBuildingDamage`, not direct HP subtraction. HP bottoms out at zero. Commanders enter their respawn state at zero; ordinary units are cleaned up by the engine; structures are removed by the building update pass.
- Commanders and combat units fight until destroyed; low health or being outnumbered must not trigger strategic retreat. Short collision-aware dodges are allowed, but must not cancel the current combat goal.
- Automated combat must use the shared target selector and validate stored targets before acting. Avoid a `filter` + `sort` + `map` pipeline on every frame for each unit; prefer a single pass and throttle expensive scans where reaction time permits.

## Drone doctrine extension points

Drone station tuning is centralized in `src/game/buildings/droneStation/behavior.ts`; the controller is `src/game/ai/droneAI.ts`. Avoid adding doctrine logic to React or the Canvas renderer.

- **DEFENSE** patrols an ellipse around the connected friendly building cluster. Keep patrol angle speed capped as radius grows, and keep each drone's radius variation deterministic from its ID so drones have different lanes without random frame-to-frame jitter.
- A live hostile interrupts patrol. The drone approaches and orbits a target position inside its weapon range, fires while orbiting, and broadcasts a reinforcement alert. The goal filter and world-space goal velocity cap apply both when entering combat and when returning to patrol; do not instantly teleport an idle target or goal back to the patrol path.
- **ESCORT** uses the associated commander as its formation anchor. It only keeps or acquires targets within the 10-tile commander leash. When a target leaves the leash, clear its combat-orbit lock and smoothly rejoin the moving formation.
- Whenever motion tuning changes, test movement in both free air and near structures. Confirm speed caps apply to direct flight and A* path following, that drones don't enter the building clearance ring, that the goal advances over multiple ticks, and that target-death recovery blends back toward patrol.

The controller exposes `updateDrone` to the engine and accepts simulation inputs explicitly. This makes its behavior testable without DOM or Canvas APIs. Current combat and alert semantics are documented in [Game Architecture](architecture.md#drone-behavior).

## Required checks

Run `npm test`, `npm run lint`, and `npm run build`. The first covers simulation rules; the second catches incomplete catalog entries and type mismatches; the third verifies the browser bundle and assets.


## Harvester delivery and drone motion

Keep resource production and resource transfer separate: bots must path back to their assigned station before depositing cargo, and a full station must not silently destroy cargo. Never use a watchdog to reposition a bot at its destination. If a return path fails, try reachable perimeter waypoints and preserve the cargo. For drone behaviors, update a smooth world-space goal and keep the speed cap in both direct motion and path-following. Scale orbit angular velocity inversely with patrol radius so larger compounds do not create faster-moving waypoints.

## Add or change a building upgrade

Building-specific upgrade data belongs in `src/game/buildings/<building>/upgrades.ts`; do not place upgrade branches inside the HUD or the shared drawing module. `src/game/upgrades/upgradeSystem.ts` provides generic application and inspection helpers.

1. Add the next tier to the structure's `upgrades.ts` module. Every building, including the non-buildable Core, can use tiers targeting levels 2–5. Use `mode: 'CHOICE'` with two options for a branch, and `mode: 'LINEAR'` with exactly one option for a standard upgrade. Core tiers are all choices because they specialize its living Commander instead of improving the Core's own combat stats.
2. Give every option a stable `id`, player-facing `name`, short `description`, an `effects` list, and an `aiPriority`. Core options may provide `commanderEffects` (`ADD`, `MULTIPLY`, or `SET`) for Commander stats such as speed, weapon damage, cooldown, maximum HP, armor, mining speed, or mining yield. The highest `aiPriority` is the default strategy for autonomous commanders; use this for a sensible fallback without changing the player choice.
3. Effects are typed data: `ADD`, `MULTIPLY`, `SET`, or `ALL_STATS`. Add a new stat to `BuildingUpgradeStat` and the `Building` model only when the simulation needs a persistent value. Keep numeric tuning and labels in the upgrade/content layer rather than adding special-case logic to the HUD.
4. Connect new stats to real behavior. For example, turret `damage`, `fireCooldown`, and `shotsPerAttack` are read by the firing loop; station multipliers are applied to both existing units and future spawns; `armor` changes `applyBuildingDamage`; `passiveRepairPerSecond` is processed by the common building update loop. A property that is only displayed but never consumed by simulation is not a gameplay upgrade.
5. If a building-specific stat must appear in the nearby inspector, add its formatted row to that building folder's `inspect.ts`. Shared HP, damage-reduction and self-repair rows are generated by `src/game/upgrades/upgradeSystem.ts`. Keep values sourced from the live object so the display cannot drift from the simulation.
6. Add tests for option availability, costs, invalid or missing branch selections, progression through every tier, the stat change, and its actual simulation effect. The AI recommendation path should be tested as well.

The HUD automatically renders options and costs from each building module, tracks installed upgrade names from `Building.upgradeIds`, and renders current stats from runtime objects. Upgrade selection is keyboard-only: Q chooses the first branch, E chooses the second branch, and E installs a one-option linear tier. Arrow keys remain movement controls. New branches do not need a new component or click handler.

## Core specializations

`src/game/buildings/core/upgrades.ts` defines four branching tiers. The Core records the selected option and progression level; the shared engine applies the option's `commanderEffects` to the living Commander on the same combat team. The Core must not be treated as a buildable structure, and upgrading it must not repair its missing HP for free. Player and enemy Core upgrades use the same option list, costs, stat application, inspector, and AI recommendation helper.

## Resource batches

All mining paths should call `takeWholeResourceBatch` from `src/game/rules.ts`. It normalizes fractional node remainders upward before subtraction and returns an integer, keeping the resource economy integral for the player, the direct-mining Commander, and automated rovers.

## Make a structure react to adjacent structures

Building modules receive `neighbors` through `BuildingDrawContext`. Query the north/east/south/west arrays in the module-owned drawing function rather than scanning the world from the renderer or adding type-specific code to the engine. See [Building Neighborhood API](building-neighborhoods.md) for footprint and multi-neighbor rules.
