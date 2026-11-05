# Built-in building modules

The game has a fixed, compile-time set of building types: `CORE`, `WALL`, `AUTO_TURRET`, `HARVESTER_STATION`, `DRONE_STATION`, and `FIRE_TOWER`. There are no custom building types, user-defined behavior descriptors, or runtime plugin-loading mechanism.

Each built-in building has a dedicated folder under `src/game/buildings/`. Its `index.ts` composes the definition, fixed behavior descriptor, upgrade tiers and scaling, renderer, inspector, and (when needed) its own simulation `update(building, context)` callback. Change a building's mechanics in that building's folder; shared lifecycle rules remain in `src/game/buildings/runtime.ts`, and the overall simulation loop is orchestrated by `src/game/engine/EngineSimulation.ts`, through the public engine API in `src/game/engine.ts`.

`src/game/buildings/registry.ts` is a static, typed map for the built-in types used by rendering, upgrades, and simulation. It is ordinary source code—not a dynamic extension API. Changing the set of built-in types requires a code change and a new build. For normal balance or behavior changes to an existing building, edit its own module and add/update focused tests. Upgrade names, descriptions, choice costs, and declarative effects live in that module's `upgrades.ts`; current IDs are serialized in `Building.upgradeIds`; they may be renamed directly during development, with the world-save schema bumped and older saves rejected whenever serialized data changes. See [Progression and Upgrades](progression-and-upgrades.md) for the current Diamond economy, balance values, exact trees, and effect extension rules. For any upgrade that changes the building's appearance, add a stable-ID-driven cue in `draw.ts` and cover the visual profile in `upgradeVisualProfiles.test.ts` or a neighboring test.

## Simulation and multiplayer tests

Run `npm test` in an environment with project dependencies installed. The standalone simulation suite compiles and executes engine, module, authority, combat, economy, multiplayer-routing, and stress tests via `node scripts/test-simulation.mjs`. The signaling-room tests run as part of the same command.
