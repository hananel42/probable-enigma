# Game Architecture

## Development policy

This codebase is under active development and has no backwards-compatibility commitments. Follow [Development Policy](development-policy.md): contracts change directly; all current producers/consumers are updated together; old save and protocol versions are rejected; no aliases, migrations, shims, or guessed defaults are added.

## Runtime and client/server boundary

The application begins at a minimal home screen and supports both Single Player and host-authoritative multiplayer. The runtime composes these boundaries:

- `src/game/engine.ts` — current in-repository `GameEngine` entry point. The implementation in `src/game/engine/` separates mutable state/initialization, world setup, participant lifecycle, command/input handling, placement/economy actions, fixed-step orchestration, autonomous systems, combat/projectiles, and match lifecycle. It has no canvas or DOM event listeners, accepts explicit input/interaction methods, and exposes `step(dt)` for deterministic stepping. Keep the layer inheritance order stable because they share the same authoritative state.
- `src/game/server/LocalGameServer.ts` — simulation authority adapter. In Single Player it is the local authority; in multiplayer it runs only in the room creator's browser. It owns the engine, receives typed `GameCommand` intents, publishes snapshots/world frames, and owns the simulation clock/loop.
- `src/game/multiplayer/HostRoomController.ts` — host-side transport controller. It assigns each guest a participant identity, validates protocol envelopes and command sequence/revision metadata, and routes valid commands into that guest's authoritative participant context.
- `src/game/multiplayer/RemoteGameClientPort.ts` — guest-side read-only replica. It never creates or advances a local gameplay world. It requires a participant assignment and a real authoritative host frame before exposing a session/snapshot.
- `src/game/multiplayer/PeerJsRoomClient.ts` — default PeerJS Cloud signalling plus direct WebRTC game-data connections. The unused localhost WebSocket relay and developer-mode UI have been removed. Room signalling uses PeerJS Cloud; live game traffic uses direct reliable WebRTC data connections.
- `src/game/client/CanvasGameClient.ts` and `CanvasGameRenderer.ts` — presentation/input. They translate DOM events and world coordinates into commands and render the latest state; they do not decide whether actions succeed or mutate game rules directly.
- `src/game/persistence/WorldSaveStore.ts` and `worldSaveCodec.ts` — browser-local world persistence. They own IndexedDB metadata/state records, versioned export files, strict import validation, compact snapshots, and the separation between transient effects and durable simulation state. The engine receives a validated current-schema snapshot through an explicit restore API; React does not mutate authoritative engine state.

`src/game/server/protocol.ts` defines the shared semantic command, snapshot, and versioned `GameWorldFrame` contracts. The host's frame is the sole authority for multiplayer state. Join/recovery uses a full frame with the deterministic world seed; ordinary replication uses exact-base deltas with stable-key collection updates. Each guest validates `baseRevision`, ACKs applied revisions, and explicitly requests a full state on a gap or failed patch. The guest projection is derived from the authoritative frame plus the explicit participant assignment; assignment/state ordering may race, so a real initial frame is buffered until identity is known rather than synthesizing a placeholder state. The PeerJS room-code prefix is public and the five-letter suffix is a locator rather than authentication. The implementation includes bounded state-recovery retries, heartbeat-based removal, command/resync rate limits, and fresh participant creation after a new join; it is still not a hardened public-network security boundary. Authentication, room access control, TURN configuration, and real-network browser tests remain outstanding before broad public exposure. See [Client / Server Boundary](client-server-boundary.md) and [Host-authoritative multiplayer](host-authoritative-multiplayer.md).

For a responsibility-by-responsibility multiplayer runtime map, message lifecycle, authority handoff, and error boundaries, see [Multiplayer Runtime Map](multiplayer-runtime-map.md).

Rendering modules remain under `src/game/drawers/` and are invoked only from the client renderer. `src/game/client/playerPresentation.ts` derives screen-only base navigation targets from the local participant identity, participant `coreId` values, and alliance IDs; `playerBaseHUDIndicators.ts` draws screen-space arrows and `CanvasGameRenderer` invokes it for the local Core and each distinct other participant Core. Shared-Core participants receive one marker, not duplicates. `EntityDrawer` receives the resolved local relationship so player-controlled commanders, drones, and harvesters use friendly or enemy palettes even though every human Commander belongs to the `player` faction. This is presentation-only and does not alter damage, targeting, or network authority.

`Escape` opens the pause/session menu. In single-player it stops the `LocalGameServer` simulation clock and disables gameplay input until Continue; leaving gameplay saves the world and returns to the world selector. Autosave requests are serialized to prevent an older asynchronous IndexedDB write from overwriting a newer snapshot. In multiplayer the same menu disables only local input while the host authority and network frame exchange continue uninterrupted.

The only entity kinds are:

- `COMMANDER`: the player-controlled robot or an enemy outpost's central commander. Enemy commanders share combat, mining, repair, and construction systems.
- `DRONE`: a combat unit produced by a drone station. Its station selects either `DEFENSE` or `ESCORT` behavior.
- `HARVESTER_BOT`: an autonomous ground rover that mines a resource node and returns its cargo to its parent station.


## Participant lifecycle, defeat, and reconnection

A Core defeat and a network disconnect are different lifecycle events. Core defeat stamps `defeatedAtGameTime` once, disables the participant's gameplay input, removes its Commander from simulation/render entities, and sends a reliable host-authored defeat notice. It does **not** unregister the participant or close its peer; the player may remain in the room and use room chat until the host restarts the match. A real peer disconnect removes that participant, input controls, personal resource ledger, and Commander. In CO-OP, the shared Core, group, stations, drones, miners, and other shared world structures remain. In FFA/TEAM, that participant’s individually owned structures are removed according to the mode lifecycle. Gray structures orphaned by an earlier Core defeat are explicitly preserved as salvage and cannot be removed as active player-owned assets. A reconnect is a fresh participant assignment and never inherits the prior connection's defeat timestamp.

The multiplayer HUD resolves a participant by the projected Commander identity or its `ownerPlayerId`, then resolves the Core by that participant's `coreId`. If identity cannot be resolved, it renders no Core-health value rather than substituting another player's Core. The survival timer reads the participant's first defeat timestamp when present; a room restart creates fresh participants with that timestamp cleared. Connection UI progresses through peer connection, assignment/state synchronization, and a subsequent authoritative frame before controls become active. A failed initial connection shows explicit recovery guidance and a leave-to-lobby action; an already-established direct gameplay connection remains alive through signalling-service outages while signalling retries run in the background.

Room chat is an independent UI interaction: `T` opens the composer, Enter submits and closes it, and Escape closes it. Chat sends a bounded, normalized message to the host; the host derives sender identity/name from the assigned participant, validates message size and per-peer rate, and rebroadcasts the canonical event. Chat remains available to defeated participants, but does not restore gameplay control.

## Combat teams and damage

`src/game/combat.ts` is the shared combat identity, target-selection, and damage layer. The player and player structures belong to team `player`. Each enemy outpost has a distinct `enemy-base-N` team id. Faction controls presentation, while team identity decides hostility, so outposts can fight one another without friendly fire within the same team.

Every automated weapon calls the shared `findPriorityHostileTarget` selector. Target tiers are armed hostile entities, weapon structures, Core/spawn, support infrastructure, ordinary structures, and harmless units; distance breaks ties within a tier. The selector and each cached-target/alert validation require a building to be operational, which means its owning Core is alive. Inert gray orphan structures are excluded from acquisition and projectile collision but remain salvageable. Auto-Turret and Fire Tower behavior perform a real initial shared-priority scan, then resolve/revalidate their cached target between scans. `applyEntityDamage` and `applyBuildingDamage` clamp lethal HP to zero and throw on non-finite/negative damage or invalid HP/armor state.

## Performance and spatial queries

`src/game/rules.ts` is the current rules entry point. The building-footprint and resource-cell spatial indexes live in `src/game/rules/buildingSpatialIndex.ts` and `resourceSpatialIndex.ts`; movement, collision checks, route planning, and projectile collision query nearby buckets instead of scanning the entire world list for every cell or projectile. The indexes refresh when their source array identity/size changes, while live HP and resource amounts remain read from the indexed objects.

`src/game/engine/EngineProjectileRuntime.ts` builds a spatial hash of living entities once per projectile collision pass. Each projectile checks nearby entity buckets and only the building buckets intersecting its local collision area. Particle and floating-combat-text collections have explicit caps so dense combat cannot create unbounded visual work.

`src/game/ai/droneAI.ts` caches team/station lookups and escort formation positions for each entity-list snapshot, caches air-obstacle cells and connected-building clusters for short bounded intervals, staggers combat target scans, and coalesces repeated reinforcement alerts. `src/game/ai/commanderAI.ts` staggers projectile-evasion scans by deterministic phase. These caches are optimizations only: target validity, health, hostility, and movement collisions are still checked before acting.

## Movement and pathfinding

`src/game/pathfinding.ts` uses A* with a binary min-heap and four-direction grid movement. Ground units treat live building footprints and resource nodes as obstacles; drones route around building footprints with a two-tile safety clearance. The safety ring is a planning preference, not a physical wall: a drone starting inside the ring exits at capped movement speed rather than being teleported. Drones check direct paths and use collision-aware movement around structures. Continuous movement is substepped to at most one-quarter grid cell per collision check; unsafe moves exceeding the bounded substep count fail explicitly instead of tunnelling through a wall. Search limits scale with route distance instead of imposing a fixed travel range.

`src/game/movement.ts` is the current movement entry point. `src/game/movement/collision.ts` owns solid-cell checks and embedded-unit recovery, `smoothMotion.ts` owns acceleration-limited steering, and `pathMovement.ts` owns worker requests, path retries, and waypoint following. Spawn selection searches outside station footprints, and construction avoids placing structures over living units. Autonomous harvesters load new chunks as they travel and detect stationary stalls and movement loops. If a resource or return route stays unreachable, the rover retries with a cooldown or safely recovers while preserving cargo.

## Commander decision loop

`src/game/ai/commanderAI.ts` reevaluates combat pressure, repairs, construction, resource deficits, and attack priorities. It may mine resource nodes directly using the normal extraction timer and batch size. Automated harvesters place cargo in station storage; when that stock is useful, the commander walks to the station and transfers it through the same `collectStationResources` helper as the player. The commander is not credited with unattended station cargo automatically. Commanders evade projectiles with short collision-aware strafes and use stand-off positions instead of pathfinding into enemy building footprints. They **never retreat because of low health or numerical disadvantage**: if a commander is able to act, it keeps fighting and returning fire until destroyed. Tactical dodging is not a retreat and does not cancel its strategic goal.

Building placement is scored around the team's command core: industry is preferred closer to the core, defensive towers are spaced apart and shifted toward current threats, and harvesters favour resource-rich routes. Candidate footprints must be free of buildings, resources, and living units.

`src/game/ai/enemyCommanderAI.ts` coordinates each outpost's defensive stance, repairs, threat-facing fortress expansion, and periodic assaults. Nearby hostiles trigger local defensive priorities; once the perimeter is clear, the base resumes fortification and its raid schedule. Low HP does not trigger a retreat or a low-health regroup window. There are no separate raid or mob entities: the central commander leads an assault and its drones switch to escort mode.

## Drone behavior

`src/game/ai/droneAI.ts` is the stable entry point. `DroneAIUpdate.ts` chooses the live centre and target policy; `DroneFlightController.ts` applies one second-order flight law to defense, escort, hostile-centred flight, and A* waypoints.

- **DEFENSE with no target:** the centre is the connected friendly/allied building compound. The patrol radius is the larger compound-route radius, so it conservatively encloses the footprint.
- **ESCORT with no target:** the centre is the assigned live commander. Position and velocity are read every simulation tick.
- **Valid hostile:** if the hostile is inside the defence envelope or the escort tether, it immediately becomes the centre. A dead, invalid, non-hostile, inert, or out-of-envelope target is discarded and the prior home centre is restored on that same update. Defensive target acquisition is measured from the home centre, not from the roaming drone.

Every ordinary-flight tick combines tangential orbit-velocity correction, a radial spring, attraction to the current route waypoint, and velocity damping. Acceleration and speed are bounded; position advances only through collision-aware movement. Open-air routes use the direct goal. A* is requested only for a corridor that intersects the cached building-clearance grid, and its waypoints use the exact same physics integrator. Goals have movement thresholds/cooldowns and at most one pending worker request per drone. Defensive alerts and the shared target-priority policy remain active. Low-health kamikaze remains a dedicated one-way action at 1.2× the drone's current upgraded speed.

Human players can change doctrine only for a live, operational Drone Station that is authorized for the active participant and is the current contextual building target: the hovered structure if it is in interaction range, otherwise the nearest structure in range. The `C` hotkey and compact top-bar control use the same resolver as the ordinary cyan interaction outline. Doctrine changes do not require persistent station selection or a separate highlight frame.

The Drone Station baseline target cruise speed is 300 pixels per second with a hard cap of 390 pixels per second; formation and orbit steering use lower tuned speeds. Acceleration and braking are bounded, formation targets are smoothed, and the directional hull plus speed-scaled exhaust trail make motion easier to read. Route recovery avoids stationary drones, speed caps apply on both direct movement and path-following branches, and target/alert identity is checked before firing. Low-health kamikaze commitment uses 1.2× the drone’s current normal cruise speed. Drone Station speed upgrades therefore affect kamikaze speed proportionally, while the hostile target’s speed and buffs never affect it. The baseline drone firing interval is 0.28 s (3.6 shots/s before modifiers); its 2.8-grid-cell weapon range is unchanged.

Operational building checks use a weakly cached structural index of Core IDs and Cores by team; HP is read live, so Core destruction/reactivation is immediate. This avoids rescanning the full building array for every enemy structure during each target scan. When the simulation clock drops wall-clock ticks, its warning remains enabled and reports engine-step durations plus world unit/structure counts to distinguish simulation cost from other main-thread blocking.

Drones, auto-turrets, Fire Tower pulse focus, commander self-defense, and active commander attack goals use the same target policy. Every building folder owns its definition, behavior configuration, upgrade tree, stat inspector, and procedural renderer. The building registry composes these modules, while the current aggregate catalog derives its data from them; unit palettes and combat profiles come from the entity catalog. Main structure telemetry (identity, status/HP, group, live stats, and context-targeted Drone Station doctrine) lives in the top HUD row. The compact side proximity panel is action-focused: upgrade choices/costs/effects, repair, and salvage. Do not duplicate upgrade history, costs, or structure footprint dimensions in the top row. Clicking a structure does not open a modal.

## Balance and procedural world

The player starts with 125 wood and 125 stone to build an early economy or defenses. The first hostile outpost appears after the opening window, and its first coordinated assault happens after an additional preparation period. Enemy outposts are placed farther from the player than in the earlier build, and the global difficulty increases gradually.

## Salvaging structures

Press **X** to dismantle the nearest friendly non-Core structure while close to it, or use the proximity panel's **Salvage** action to target a specific building. Refund is half the total invested construction and upgrade value, multiplied by the structure's remaining HP fraction. The Core cannot be dismantled.

## Content and rendering catalog

Each folder under `src/game/buildings/` owns a building's definition, behavior configuration, upgrade tree, stat inspector, and procedural drawing module. `src/game/buildings/registry.ts` composes modules; `src/game/content/buildingCatalog.ts` is the current aggregate catalog that derives blueprints and combat metadata from the registry. Renderers consume live stats and installed upgrade IDs, and can progressively compose vectors, shapes, decals, effects, and animation without sprite replacement. `src/game/content/entityCatalog.ts` does the same for unit names, combat capability/target tier, and faction palettes. Simulation factories and behavior remain in focused modules. Follow [Adding Game Content](adding-content.md) for the implementation checklist.

## Lethal damage sequence

HP is clamped to exactly zero by shared damage helpers. Lethal commander damage starts the reboot/respawn flow at the impact point, including when burning damage causes the final hit. Dead commanders do not continue taking status damage. Drones, rovers, and structures are removed through their regular cleanup pass once HP reaches zero. See [Combat and Damage](combat-and-damage.md).

## Project checks

- `npm test`: gameplay rules, targeting, and navigation tests.
- `npm run lint`: TypeScript type-check.
- `npm run build`: production Vite build.


## Harvester recovery and delivery

`src/game/ai/harvesterAI.ts` uses the same A* mover for outbound and return trips. A failed route triggers a bounded watchdog and a reachable station-perimeter search. The watchdog must never move a harvester to its station or deposit cargo remotely. Cargo is retained if a station is full and is delivered only after the unit is physically within the station interaction radius. This keeps movement visible and prevents silent cargo loss.

## Drone flight smoothing

`src/game/ai/droneAI/DroneFlightController.ts` owns all ordinary drone movement. Its orbit goal is regenerated from the current centre and continuous phase; velocity is corrected toward the orbit tangent while a radial spring keeps the drone near the configured radius. Waypoint attraction steers around obstacles without switching to a second movement law. The same acceleration, speed limit, collision-aware integration, and live centre updates apply in open air and while following A* waypoints. A* is skipped when the direct clearance corridor is open and throttled when it is blocked. See [Drone Flight Policy and State Machine](drone-ai-state-machine.md) for the equation and invariants.

## Keyboard upgrade selection

When the player is near an upgradeable friendly structure, **Q** selects the first option and **E** selects the second option; **E** also applies a one-option linear tier. Upgrade selection is keyboard-only, and arrow keys remain movement controls. Placement is cancelled and proximity actions are disabled whenever the Commander is dead or respawning.

## Data-driven building upgrade trees

Building upgrades are separated into content, rules, simulation effects, and presentation:

- Each `src/game/buildings/<building>/upgrades.ts` defines that structure's tier order, branch choices, names, descriptions, AI preference scores, and effects. `src/game/upgrades/upgradeCatalog.ts` is only a derived aggregate catalog. Every non-Core building currently has a level-2 choice, a level-3 universal systems upgrade, a level-4 choice, and a level-5 universal upgrade. The Core has two choices at each of levels 2–5; its option effects are applied to the living Commander on the same combat team, while the Core stores progression history. Core upgrades do not repair a damaged Core.
- `src/game/upgrades/upgradeSystem.ts` resolves the next tier, applies generic numeric effects, selects an AI recommendation, and adds shared HP / damage-reduction rows for the nearby inspector. It contains no React or canvas drawing code.
- `src/game/rules.ts` remains the entry point for upgrade costs and applying a selected option. Branches require an explicit option id; linear tiers can be applied without one.
- `src/game/engine/EngineCombat.ts` and `EngineProjectileRuntime.ts` consume runtime stats directly. Turret damage, firing interval, shot count, fire-tower cooldown/burn, wall armour/repair, rover extraction/cargo/production, and drone stats are not presentation-only bonuses.
- `src/components/HUD.tsx` renders live structure stats in the top telemetry row and branch descriptions, effects, costs, and available actions in the compact corner panel. It intentionally omits redundant installed-upgrade history and footprint dimensions. It does not maintain a separate balance table.

`Building.upgradeIds` records the chosen path. The nearby panel explicitly distinguishes a larger health pool from lower damage per hit: at base wall stats, Reinforced Plating raises the pool from 400 to 580 HP, while Reactive Armor turns a 100-point hit into 82 HP lost. The two mechanics can be combined by later branches, but affect different parts of the damage equation. The building level is still the total progression step, so salvage pricing and max-level checks remain shared. Structure upgrades are applied to the existing building object in place; this preserves object identity for simulation indexes and ensures already-deployed drones can observe station upgrades. When drone health capacity changes, the drone keeps its current health ratio instead of receiving a free full heal.

## Economy invariants

All resource extraction calls `takeWholeResourceBatch` from `src/game/rules.ts`. It rounds requested batches upward, normalizes any pre-existing fractional node remainder upward, and returns whole-number quantities. Automated harvesters still deposit only after reaching their real station interaction radius. Harvester and drone stations do not display weapon-radius placement rings; those structures use resource seeking and friendly-compound patrol rules, not a fixed attack range.

The enemy Commander AI scores economic construction, combat structures, and upgrades against the same resource wallet and costs. If the base has no Harvester Station and there is no immediate emergency, the first station outranks defensive filler. It preserves a resource reserve during routine construction, elevates weapons under pressure, considers upgrades instead of always placing something new, and may directly mine or collect station stock when the wallet is short. The separate fortress-layout builder also respects resources committed to an in-progress Commander build/upgrade goal; it only spends that reserve when a local defense emergency requires it, and routine walls cannot drain the last reserve.


## Asynchronous worker tasks

CPU-heavy, serializable work can be registered with `src/game/runtime/workerTaskScheduler.ts`. Each task type provides a module-worker factory and concurrency cap. The scheduler orders queued work by `critical`, `normal`, then `background` priority, keeps a bounded pool, routes replies by task id/type, and reports worker failures. The simulation loop must not await worker promises: submit a snapshot, continue simulation, and apply the result only if the entity/request token is still current. `requestPathInWorker` is the first consumer. When the Worker API is unavailable it returns `null`, allowing the documented synchronous A* path in non-worker runtimes. Worker creation, messaging, or runtime failures are logged and surfaced; they never switch silently to another backend. The documented no-Worker environment uses an explicit one-time warning and caps synchronous drone A* at 650 node expansions. Worker payloads must be data-only structured-cloneable snapshots; do not send live engine/entity instances or browser/UI objects.

## Drone patrols

The connected building compound supplies the defence home centre and enclosing radius. The flight phase advances from the current orbit speed/radius; it is not frozen for a special orbit-entry state. Each tick checks a cached air-clearance corridor to the look-ahead point. Only blocked corridors trigger A*, and path nodes are followed by the shared physical controller. Waypoint capture remains below half a grid cell so it cannot skip orthogonal corners. If a drone starts in the expanded clearance ring, it follows a connected local escape route before long-range A*; stale worker results cannot replace that route. Collision substeps continue axis-wise along a wall, and a 0.65-second no-progress watchdog invalidates a physically blocked route with a rate-limited diagnostic. Requests are bounded to one pending path per drone, use goal-change/refresh thresholds, and apply retry backoff after failure. A centre/target identity change invalidates its previous path token; late results cannot overwrite the new route. See the drone policy document for the complete lifecycle and formula.

## Named groups and alliances

Every ownership group has a stable id, display name, commander callsign, faction, alliance id and color. `SET_GROUP_IDENTITY` updates display metadata; `SET_GROUP_ALLIANCE` updates hostility relationships on all active members, buildings, bases and projectiles. Members retain independent ownership/economies. Allied groups render in green and cannot damage each other; their static defenses and defensive drone logic can still engage third-party hostiles. The local Canvas presentation resolves the local participant through its Commander identity and treats the same group or same alliance as friendly. Distinct hostile human-player groups use the enemy red palette; faction alone is not a valid multiplayer hostility test.

## Runtime error policy

Invalid simulation deltas, damage/HP/armor values, economy values, status-effect timers/modifiers, malformed signaling messages, and worker protocol failures are surfaced as exceptions or explicit protocol errors and written to the console. Do not introduce empty `catch` blocks, ignored promise rejections, error-to-empty-result conversion, fabricated guest snapshots, or retry paths that conceal a worker/network failure. Expected gameplay rejections (for example, insufficient resources or an illegal placement) remain normal command results rather than runtime errors.


## Room management UI

The multiplayer main menu exposes only Create Room and Join Room. Mode selection is postponed until the host enters the full-screen Room Control Center, which is the unified place for the room code, direct invite URL, clipboard feedback, live roster, game mode, match start, participant removal, and results. The host's `HostRoomController` owns the actual mode and room phase; UI state is a view over authoritative room status, not a second source of truth. Guests may return to gameplay from the manager during a live match without leaving the room. Defeated players can stay in the manager, and only an explicit Leave Room action disconnects them.

## Building presentation topology

The renderer creates one `BuildingNeighborhoodIndex` per frame and passes cardinal edge neighbors through `BuildingDrawContext`. Modules decide how their appearance uses neighbors; the simulation engine does not contain renderer-specific adjacency branches. See [Building Neighborhood API](building-neighborhoods.md).

## Reusable interactive guidance

The React application uses a data-driven guide provider with versioned per-guide progress and a shared coach-mark overlay. Screen components supply stable guide anchors; guide definitions and persistence remain centralized. See [Interactive Guidance Framework](interactive-guidance.md).


## Source-module layout

The root-level TypeScript barrels keep long-standing imports stable while implementation is grouped by responsibility: `src/game/rules/` for simulation primitives, `src/game/types/` for shared data contracts, and `src/game/movement/` for collision/steering/path movement. See [Repository Structure](repository-structure.md) for the complete map and file-size policy. The React screen layer lives under `src/app/`; shared HUD presentation is composed from small components under `src/components/`.


## Architecture rules for new work

Use a layered dependency direction: React screens and Canvas presentation dispatch intent and display snapshots; the local server owns fixed-step scheduling and command admission; the engine owns deterministic gameplay rules; transport adapters own connection lifecycle and byte-level delivery; multiplayer controllers own room/world protocol and authority; content folders own building-specific data and behavior. Keep lower layers independent of React and PeerJS.

- **Authority:** only the host `LocalGameServer` advances a multiplayer world. A guest may project validated authoritative frames but must not invent a fallback world.
- **Time:** gameplay and AI use the simulation `dt`; wall-clock timers are only for scheduling deadlines, retries, and connection health.
- **Ownership:** use `ownerPlayerId`, `coreId`, faction, and group/alliance as separate concepts. Do not infer one from another.
- **Persistence and protocol:** new replicated fields require updates to protocol schemas, sanitization, state replication, and protocol-contract and regression tests—not only the entity type.
- **AI:** keep decision policy, movement execution, and target validity separate. Add tests for invalid/dead targets, retargeting, no-target states, and upgrade-adjusted behavior when relevant.
- **Content:** add building behavior, upgrades, and visuals in the owning building module; use shared typed effect interpreters rather than one-off upgrade mutation logic.
- **Workers:** pass cloneable request/response data across worker boundaries, never live entity instances or mutable engine state.
- **Refactoring:** update all current in-repository imports and preserve required update ordering; no public API stability is promised. Extract a coherent policy with tests before splitting a large module; do not move code solely to satisfy a line-count target.

For task-specific instructions, begin at [`skills/README.md`](../skills/README.md).

## Single-player world persistence

The single-player flow opens `src/app/worlds/WorldSelectScreen.tsx`, which lists metadata only. It does not load every world snapshot into memory. `WorldSaveStore` uses IndexedDB with separate `worldMetadata` and `worldStates` object stores; there is no silent localStorage or in-memory fallback. Each world has a stable local ID and deterministic world seed. Creating a world opens it immediately; entering an existing world passes its validated snapshot and loaded chunk ledger into `LocalGameServer`/`GameEngine`.

`src/game/persistence/worldSaveCodec.ts` defines schema version 3 and the `craftbound-survival-outpost-world` import/export format. Imports are size-limited and validate the single-player mode, participant, economy, entity/building/resource arrays, IDs, world coordinates, seed, and loaded chunk list before storage. Autosaves occur every 10 seconds, when the tab becomes hidden, and when the game is paused or exited. The snapshot is cloned after transient particle, floating-text, projectile, selection, and aiming collections are replaced with empty/default values, avoiding copying effect bursts that have no durable gameplay value. A save failure is visible to the player and leaves the prior stored snapshot intact.

Restore intentionally rebuilds ephemeral engine runtime state: input keys and pointer state are cleared; per-player controls are reconstructed; loaded chunk keys are restored; harvest-worker chunk trackers and reward deduplication caches are reset; and the primary player reference is rebound to its canonical entity after JSON import/export. In-flight projectiles and visual effects are not persisted. Exported worlds use an exact schema version. A breaking format change increments the version and rejects all older files; migrations and old-format readers are prohibited.
