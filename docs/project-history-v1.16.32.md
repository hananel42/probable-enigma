# Craftbound: Survival Outpost

Version 1.16.32. A browser-based real-time survival and base-building game built with React, TypeScript, Vite, and a Canvas 2D renderer. The player controls a commander robot, gathers wood and stone, builds automated defenses, and competes with hostile machine outposts.

## v1.16.32 — Stable in-game room controls and large-snapshot transport

- Room management is now a user-controlled overlay during a live match: periodic room-status refreshes no longer close it after the player opens it. Phase/world transitions still open or close it deliberately.
- The multiplayer Escape menu includes a **ROOM MANAGEMENT** action. The global Enter shortcut that previously launched Single Player from unrelated focus locations has been removed; Single Player starts only through its own button activation.
- Centralized host room lifecycle transitions enforce valid `lobby`, `playing`, `paused`, and `results` transitions and the invariant that only `lobby` has no active world.
- PeerJS game connections explicitly use BinaryPack (`serialization: 'binary'`) instead of JSON serialization, allowing PeerJS's large-payload chunking path to carry full authoritative snapshots. The app enforces a 16 MiB encoded-envelope limit and documents the transport contract.
- Added regression coverage for room-panel visibility, binary transport policy, and invalid room lifecycle actions.

See [v1.16.32 release notes](release-notes-v1.16.32.md), [release validation report](release-validation-v1.16.32.md), [multiplayer runtime map](multiplayer-runtime-map.md), and [PeerJS/WebRTC transport](peerjs-webrtc.md).

## v1.16.31 — Persistent rooms, explicit world lifecycle, and smoother replication

- A room is separate from a world: guests joining a new room receive a room assignment with `worldId: null` and no game snapshot. The host explicitly starts a fresh world; pause/resume keeps that same world; returning to the room stops publication and preserves membership; a new world receives a new identity; TEAM/FFA participants can be revived with a distinct new Core.
- Room status now has a monotonic room-scoped revision, and is accepted only after the matching participant assignment establishes `roomSessionId`. Delayed status cannot undo a newer pause, restart, or lobby transition. Heartbeat, chat and roster ordering remain room-scoped and do not reset on a world switch.
- Expected packets from retired worlds/sessions are debug diagnostics, not repeated warning-level errors. Identical stale world-status reports are deduplicated. Malformed protocol messages and real recovery failures remain visible.
- Raised delta publication from 20 Hz to 30 Hz while keeping the authoritative simulation at fixed 60 Hz. Guest interpolation stores 18 recent samples (about 600 ms at the new cadence); rendering and simulation remain independent.
- Added regressions for room status before assignment, delayed old-world status, lobby-only connection, pause/resume, Core revival, and the room-preserving next-world lifecycle.

See [v1.16.31 release notes](release-notes-v1.16.31.md), [release validation report](release-validation-v1.16.31.md), [multiplayer runtime map](multiplayer-runtime-map.md), and [transport adapter contract](transport-adapter-contract.md).

## v1.16.30 — Idempotent peer cleanup and resilient room-status delivery

- Fixed the disconnect race shown in the console logs: a peer can disappear from PeerJS's registry before the host liveness timer runs. `closePeer` now treats an already-absent peer as successfully closed, and host cleanup always calls the idempotent close operation so a closed-but-still-registered `DataConnection` is also removed.
- The host reconciles missing transport peers before publishing deltas, removes stale participants and active assets promptly, and keeps the room roster limited to active participants. A departed guest no longer remains as a ghost row or receives repeated state-delta send attempts.
- Room-status delivery is tracked per guest. Failed sends or thrown transport errors are logged, are not marked delivered, and are retried. A room-status UI subscriber or a single peer send failure cannot prevent status delivery to other peers or escape the host's publication tick.
- A transport cleanup race is isolated to the affected peer and surfaced through console diagnostics and the room error UI; a generic unhandled multiplayer error no longer automatically stops rendering or the authoritative simulation.
- Added regression coverage for already-removed peer cleanup, room-status send exceptions/retry, and active-roster reconciliation.

See [v1.16.30 release notes](release-notes-v1.16.30.md), the [transport adapter contract](transport-adapter-contract.md), and the [multiplayer runtime map](multiplayer-runtime-map.md) for the explicit world-handoff protocol and the responsibility of each layer.

The previous world-handoff fix declared `worldId` in participant assignment and held full states until an explicit authority announcement. Version 1.16.31 builds on that boundary with room-scoped status ordering and independent room/world lifecycles. Current automated tests and static build results are recorded in the versioned release notes. See [world-handoff fix and verification](multiplayer-world-handoff-fix.md).

## v1.16.29 — Stable peer synchronization and lifecycle isolation

- Full-state recovery retries a fixed immutable baseline until its revision is ACKed. A slow client can ACK the original frame and then receive all accumulated changes as deltas; retries no longer move the revision target on each attempt.
- Increased full-state retry tolerance and liveness lease to handle transient latency, background-tab throttling, and slow frame parsing without early eviction. Stale heartbeat echoes no longer renew the liveness lease unless the guest acknowledges a newer host response.
- A WebRTC `error` event no longer closes a direct data channel by itself. The transport watches the actual `RTCPeerConnection`/ICE state, allows transient `disconnected` states a 12-second recovery window, and closes only after a terminal failure or an expired recovery window.
- `HostRoomController` depends on the narrow `RoomGameAuthority` contract instead of the concrete `LocalGameServer`, separating room/network protocol ownership from simulation implementation.

- Fixed the rendering regression that drew terrain, resources, and buildings but omitted all game entities. The local Commander is now explicitly included in the draw set, and visible Commanders, drones, and harvesters are rendered with their faction/group presentation.
- Restored visible projectiles, particles, floating combat text, placement previews, structure selection highlights, and screen-space enemy-base indicators.
- Fixed an unbalanced Canvas `save()` scope: each world-render pass now restores the transform/state in a `finally` block, preventing the Canvas state stack from growing indefinitely and contributing to main-thread stalls.
- Added renderer regression tests that verify the local Commander and autonomous entities reach the drawing path and that two consecutive frames leave the Canvas state stack balanced.
- Kept the simulation scheduler's overdue-tick warning visible. It is a performance signal, not the cause of entity invisibility; after the renderer leak fix, verify the warning rate in an actual browser workload before deciding whether the simulation needs a separate worker.

See [v1.16.29 release notes](release-notes-v1.16.29.md).


Creating or joining a multiplayer room now opens a dedicated full-screen room manager. The main menu has no game-mode selector: the host creates the room first, then chooses Free for All, Team, or Cooperative in room management before starting the match. The room manager keeps the five-letter code, direct invitation URL, copy feedback, connected roster, participant states, match clock, host kick controls, and start/results actions in one place. Guests can see the selected rules and wait for the host; during a live match, living players can return to gameplay while the room remains open for defeated players and spectators.

See [v1.16.26 release notes](release-notes-v1.16.26.md), [host-authoritative multiplayer](host-authoritative-multiplayer.md), and [multiplayer modes](multiplayer-modes.md).

## v1.16.25 — Smooth drone recovery and managed, resilient rooms

Defense drones re-enter their existing patrol ellipse through obstacle-aware pathfinding and speed-capped curve following; they do not snap to an orbit point when combat breaks off. Escort drones abandon out-of-range targets and move back toward the commander using the same bounded flight movement. The `C` key changes the doctrine of the Drone Station under the cursor, or the nearest in-range Drone Station when the cursor is not over one; the command uses exactly the same contextual-target resolver as the ordinary cyan interaction outline and does not require a separate selection frame.

Multiplayer now has a host-managed lobby, active-match roster, and results phase. Hosts can select a mode in the lobby, start a match, remove a connected guest, and create a fresh lobby after results. The room status stream publishes roster/phase changes immediately and its survival clock at most once per second. Client heartbeats run every two seconds for connected players whether alive or defeated; the host removes a participant only after its 25-second bidirectional liveness lease expires. Guests remain in the room after Core defeat and may chat while waiting; defeat does not become a permanent session flag, and rejoining creates a fresh alive participant. PeerJS signalling reconnection uses bounded exponential backoff while preserving existing direct data channels where possible. True session resumption after a browser reload is not implemented, and TURN is still not configured.

See [v1.16.25 release notes](release-notes-v1.16.25.md), [room protocol](host-authoritative-multiplayer.md), and [PeerJS/WebRTC transport](peerjs-webrtc.md).

## v1.16.24 — Player lifecycle, connection recovery, and room chat

The HUD resolves Core health and survival time from the local participant identity; it does not substitute the host Core when identity cannot be resolved. Survival time freezes at that participant’s defeat timestamp and resets on room restart. A destroyed Core leaves its player defeated but connected, allowing them to wait in the room and chat; a real disconnect removes their participant and active assets, while gray orphan structures remain salvageable. A later join creates a fresh participant and does not inherit an old defeat state. Multiplayer waits for assignment, an initial authoritative frame, and a follow-up frame before enabling controls; connection failures display recovery guidance instead of a black screen. Player display names are validated or generated from the English robot-name catalog, and the room chat is host-validated and rate-limited. See [v1.16.24 release notes](release-notes-v1.16.24.md), [host-authoritative multiplayer](host-authoritative-multiplayer.md), and [PeerJS/WebRTC room design](peerjs-webrtc.md).

## v1.16.23 — Production multiplayer lifecycle

PeerJS Cloud provides room signalling; live game traffic uses reliable, ordered direct WebRTC data channels. Room IDs combine the fixed application prefix with a cryptographically random five-letter code. A direct link such as `?room=ABCDE` is validated and auto-joins only when it contains exactly one valid room code. Core-defeat notices are retried until acknowledged, guests expire after a missed bidirectional-heartbeat lease, full-state recovery attempts are bounded, and peers are disconnected if they exceed the command-rate budget. Disconnect and host-room shutdown remove participants and active assets while preserving gray abandoned salvage. The unused local WebSocket relay and developer option have been removed. Direct peer connectivity remains best-effort because this release does not configure TURN. See [PeerJS/WebRTC room design](peerjs-webrtc.md), [host-authoritative multiplayer](host-authoritative-multiplayer.md), and [v1.16.23 release notes](release-notes-v1.16.23.md).

## v1.16.20 — Independent multiplayer replication and participant lifecycle

The host now owns an independent 30 Hz delta-publication timer, so network replication is not driven by React, canvas rendering, or window-resize callbacks. A separate 60 Hz fixed-step simulation clock continues independently of rendering. Fullscreen/window focus recovery restores canvas keyboard control when it is safe to do so. Defeated Commanders are removed from the world; eliminated players cannot send commands, their live structures become abandoned gray salvage, and disconnect removes their active structures while preserving gray salvage. Restart is published atomically after every participant has lost their Core. See [v1.16.20 release notes](release-notes-v1.16.20.md), [v1.16.19 release notes](release-notes-v1.16.19.md), and [the state replication design](state-replication.md).

## v1.16.19 — Lightweight multiplayer render interpolation

Remote presentation history stores compact render poses rather than retaining complete world snapshots. The client composes interpolated poses onto the authoritative state and predicts only its own visible Commander movement, reconciling to the host. See [v1.16.19 release notes](release-notes-v1.16.19.md).

## v1.16.18 — Fullscreen canvas sizing and smooth multiplayer presentation

Canvas drawing now uses CSS-pixel coordinates with an appropriately sized high-DPI backing bitmap. Fullscreen, viewport and visualViewport changes trigger a resize; pointer mapping, camera extents, and world-grid coverage share the same logical dimensions. Multiplayer guests interpolate remote entities between timestamped authoritative snapshots and predict only the local commander’s visible movement, reconciling to the host without making the client authoritative. Nearby-structure telemetry is limited to type, HP, and level, with selected drone-station mode controls kept compact.

## v1.16.17 — Seeded initial state and delta-only multiplayer replication

- Multiplayer sends a complete authoritative state only when a guest joins, during explicit recovery, or to retry a state/ACK that did not complete. Regular updates are `game-state-delta` patches bound to an exact `baseRevision`; unchanged state fields are not retransmitted.
- The room seed is sent with the initial/full state and is omitted from routine deltas. Acknowledgements verify the received revision; a missing delta is detected by a base-revision mismatch and triggers a logged, targeted full-state resynchronization.
- Delta collections use stable entity IDs and insertion indexes, so adding/removing one entity does not require resending the entire entity list. Empty deltas are not sent when only the frame revision/time advances without any replicated state changes.
- Kept the 10 Hz publication cadence and bounded transport queues. The host still runs the authoritative simulation at native speed; the cadence limits replication work, not simulation accuracy.
- Added regression tests for seeded world generation, compact delta operations, missed update recovery, and reliable initial-state retry.

See [v1.16.17 release notes](release-notes-v1.16.17.md), [state replication architecture](state-replication.md), [v1.16.16 release notes](release-notes-v1.16.16.md), and [the architecture guide](architecture.md).

## v1.16.3 — Module-owned building behavior

Active built-in mechanics now live beside their building modules: Auto-Turret, Fire Tower, Harvester Station, and Drone Station each provide their own update callback. The generic building runtime handles lifecycle invariants and dispatch only. The simulation test suite currently covers module registration plus the existing authoritative multiplayer movement, construction, firing, and damage flows. See `docs/modular-systems-v1.16.3.md` and `docs/release-notes-v1.16.3.md`.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Vite prints the local development URL after startup. The default port is `3000`.

## Validate the project

```bash
npm test
npm run lint
npm run build
```

### Engine-only tests without installing the full app

```bash
node scripts/test-simulation.mjs
```

The simulation test runner compiles only the engine/test dependency graph into a temporary folder and uses Node's built-in test runner. It does not need React, Vite, Tailwind, `tsx`, or the signaling server packages. It uses the project's local TypeScript compiler when present, or a `tsc` executable on `PATH`. The temporary build is deleted after the run.

The current engine suite includes an in-memory room-protocol integration test, multi-guest identity/input routing, disconnect cleanup, runtime command validation, guest movement/firing/building placement, separate resource ledgers, and guest-view projection; it also includes actual projectile collision tests for Team and Free-for-all and a bounded stress workload. The stress workload runs 240 simulation ticks with 72 extra structures and 160 projectiles; it checks finite state, time progress, and projectile cleanup. This is a repeatable smoke/stress test, not a substitute for a browser test using two real PeerJS/WebRTC clients on separate networks.

## Controls

- **WASD / Arrow keys:** Move the commander
- **Mouse aim + left click / Space:** Fire
- **Click a tree or rock / F:** Mine resources
- **1–5:** Select a building to place
- **Click an open cell / Space / Enter:** Place the selected building
- **R:** Repair a nearby damaged friendly structure
- **Q / E:** Select the first / second branch of a nearby upgrade; **E** installs a linear upgrade. These are the only upgrade selection keys; arrow keys remain movement controls.
- **X:** Dismantle the nearest friendly non-Core structure; orphaned structures whose Core was destroyed can be salvaged by any commander for the normal HP-scaled refund
- **C:** Toggle the contextual in-range Drone Station between Zone Defense and Player Escort
- **Escape:** Open the pause/session menu (single-player pauses simulation; multiplayer keeps running)
- **Right click:** Cancel building placement

## Performance safeguards

- Projectile collisions use a spatial hash for living units and local building-bucket queries, avoiding a full-scene scan for every projectile.
- Building footprint queries and route planning reuse a spatial index rather than repeatedly checking every structure.
- Drone AI caches station/team/formation data, staggers expensive target scans, and coalesces duplicate reinforcement alerts.
- Commander projectile-evasion scans are staggered, while particle and floating combat-text counts are capped.
- Stale drone goals and unreachable harvester routes trigger bounded recovery attempts instead of endless per-frame retries. Harvester watchdogs never teleport units or deposit cargo remotely; drones settle at their firing offset instead of orbiting a stale goal.
- Simulation time is advanced in bounded substeps and caps catch-up at 500ms after a delayed frame. A zero delta is a no-op; negative or non-finite deltas throw immediately. Invalid HP, damage, economy values, and buff data also fail loudly rather than being converted to defaults.
- Resource helpers reject non-finite economy values, repair helpers refuse to resurrect zero-HP structures, and building placement rejects non-integer or invalid footprints.
- Destroyed Cores no longer cause surviving structures to be deleted. The Core is removed, dependent non-commander units are cleaned up, surviving structures become gray/inert and remain salvageable, and the surviving commander can dismantle them for HP-scaled refunds.
- Commanders and combat units fight until destroyed; low health does not trigger strategic fleeing.

## Game systems

The simulation has three entity kinds: commander robots, combat drones, and autonomous mining rovers. See [the architecture notes](architecture.md), [combat and damage contract](combat-and-damage.md), and [adding content guide](adding-content.md) for team identity, target priority, reinforcement alerts, lethal damage, content catalogs, and extension points.


## Modular status effects / buffs

Buff runtime logic lives in `src/game/statusEffects/buffSystem.ts`; definitions live separately in `buffDefinitions.ts`. A definition can include any subset of duration, health-per-second (positive heals, negative damages), health/speed/power/fire-rate multipliers, particle color/rate/size and marker style. Reapplication behavior is configurable (`REFRESH`, `EXTEND`, `STRONGEST`, `STACK`). At the time of this historical note, Burning kept one-time migration support for legacy burn fields. That migration has since been removed; the current world-save schema rejects old snapshots and uses only the current buff representation. See [`docs/modular-systems-v1.16.0.md`](modular-systems-v1.16.0.md) for examples and extension points.

## Building upgrade system

Every non-Core structure has a data-driven four-step path: a first specialization choice, a universal systems boost, a second specialization choice, and a final universal boost. The Core also has four two-option branches, but those choices upgrade its Commander: mobility or weapon damage, durability or armor, firing rate or mining speed, then extraction yield or adaptive combat/economy stats. For example, an Auto-Turret can choose stronger rounds or a faster firing cycle, later improve all applicable stats, then choose longer range or a twin-barrel volley. Walls, Fire Towers, Harvester Stations, and Drone Stations have their own meaningful choices too.

The HUD uses a minimal robot-console layout: compact top telemetry for Core/Commander health and resources plus the selected/nearby structure identity, integrity, and relevant live stats; a focused side panel contains upgrade choices/effects and repair/salvage actions; a short build hotbar uses SVG icons. See [the HUD layout guide](hud-console.md) for visual rules and extension points. On walls, maximum HP is the total health pool; damage reduction lowers every incoming hit (for example, 18% reduction changes a 100-damage hit to 82 HP lost). The two effects stack but are not interchangeable. Each structure owns its definition, behavior, upgrade tree, inspector rows, and procedural renderer under `src/game/buildings/<building>/`. The shared upgrade engine remains under `src/game/upgrades/upgradeSystem.ts`; upgrades are selected only with Q/E near the structure. Dead or respawning commanders cannot build or perform proximity actions, and stations do not draw meaningless weapon-radius rings. Mining batches and deposit depletion use whole-number quantities with fractional resource remnants rounded upward. Building renderers read live stats and installed upgrades to alter shape details rather than swapping static sprites.

## Client / authoritative simulation boundary

The app opens on a minimal home page with one **Single Player** action. Single Player creates a `LocalGameServer` in the browser and attaches a `CanvasGameClient` to it. The client owns DOM events, coordinate conversion, keyboard mapping, and rendering; it does not make gameplay decisions or write directly to simulation state. It sends typed semantic commands through `GameServerPort`. The local server owns the `GameEngine`, validates/dispatches commands through engine entry points, owns the simulation clock, calls `step(dt)`, and publishes state snapshots. The engine itself is clock-agnostic. Details and extension rules are in [Client / Server Boundary](client-server-boundary.md).

The multiplayer room prototype uses the same boundary through PeerJS-managed direct WebRTC: the room creator owns the only `LocalGameServer`, guest commands are executed in a participant-specific context, and the guest renders host-authoritative frames projected onto its own commander and view. The application uses PeerJS Cloud signalling and direct reliable WebRTC data channels; there is no local relay mode in the production project. Rooms now support up to eight participants and use a host-side protocol controller with per-peer identities, targeted assignment, sequence deduplication, runtime command-shape validation, disconnect input cleanup, and bounded/coalesced state-frame publication. Reconnection/resume, browser-level network tests, and hardened public-network reliability remain future work.

### Multiplayer engine integration (v1.9.0)

The room creator runs the sole authoritative simulation. Each guest controls a separate commander through the default PeerJS-managed direct WebRTC connection. The engine models per-participant commander/core identities, private resource ledgers, participant-scoped input, and the three selectable modes: Free-for-all, Team, and Cooperative. See [`docs/multiplayer-engine-integration.md`](multiplayer-engine-integration.md).

This release supports one host and up to seven guests. PeerJS Cloud is the default signalling broker and game messages travel over direct WebRTC data channels. A real two-browser test across different networks is still required before treating NAT traversal as fully verified.

## Multiplayer mode domain foundation

The engine now creates separate live commanders and private resource ledgers for the host and guest, supports separate cores in Free-for-all and Team modes and a shared core in Cooperative, and routes commands through the correct participant context. Read [Multiplayer Modes](multiplayer-modes.md) and [Multiplayer Engine Integration](multiplayer-engine-integration.md) for rules and current limitations.

The game runs entirely in the browser; it does not require a Gemini API key or a server-side AI service.


## Simulation runtime and multiplayer architecture

- The game simulation is isolated from Canvas/DOM code; the local authority accepts semantic commands and publishes snapshots.
- `src/game/runtime/workerTaskScheduler.ts` provides a reusable priority-aware worker pool for expensive serializable tasks. Pathfinding uses it now; the main simulation never awaits worker results. Synchronous A* is used only when the Worker API is unavailable; worker creation/runtime failures are not hidden by a fallback.
- Named groups (`GameGroup`) carry a group name, commander callsign, faction, alliance id and presentation color. Group identity and alliance changes are explicit authoritative commands. Members of allied groups are non-hostile and share defensive targeting/coverage, while their ownership and economies remain separate.
- The default multiplayer transport is host-authoritative PeerJS/WebRTC for one host and up to seven guests. PeerJS Cloud provides signalling; state uses direct reliable data channels. The initial/full state is sent on join or explicit resync; regular state deltas are computed and published at 30 Hz with exact base revisions and bounded send queues. Signalling reconnection retries are implemented, but true session resumption, account authentication, and TURN are not implemented. See `docs/peerjs-webrtc.md`, `docs/host-authoritative-multiplayer.md`, and `docs/multiplayer-engine-integration.md`.

## Multiplayer room connection

The production workflow uses PeerJS Cloud for room discovery and reliable WebRTC data channels for game traffic. Select **Create Room** or join a code/link to open the full-screen room manager. The room manager is the single place to share the five-letter room code or direct invitation URL, review the roster, select a mode as host, and start the match. Mode selection is deliberately not part of the main menu. Opening a valid direct link automatically attempts to join the room. The local WebSocket relay and developer networking controls have been removed from the project. See [`docs/peerjs-webrtc.md`](peerjs-webrtc.md), [`docs/state-replication.md`](state-replication.md), and [`docs/release-notes-v1.16.26.md`](release-notes-v1.16.26.md).



## Host-authoritative multiplayer

The room creator runs the only simulation; guests send commands over reliable PeerJS-managed WebRTC data channels and render an authoritative initial state followed by revision-based deltas. `GameDataTransport` keeps the command protocol independent from transport details. No local WebSocket relay or developer networking option is shipped. See [the host-authoritative multiplayer notes](host-authoritative-multiplayer.md) and [PeerJS/WebRTC room design](peerjs-webrtc.md) for current limitations.


### v1.12.0 — interaction targeting and AI recovery

- Replaced signaling randomness with explicit `randomBytes`-based helpers so room and peer IDs do not depend on a `randomInt` binding.
- Commander AI now prioritizes repairing a damaged home Core; if it cannot afford the repair, it enters `GUARD_CORE`, returns to a defensive ring, and intercepts hostiles that threaten the Core instead of mining or launching an unrelated assault.
- Escort drones now monitor stalled orbit approaches and invalidate stuck navigation, re-anchor their orbit phase, and retry with a slightly expanded safe orbit.
- The structure shown in the HUD and outlined in the world now follows the same target rule: hovered structure if it is in interaction range, otherwise the nearest structure in range. Repair, dismantle, and upgrade hotkeys use that same contextual target rather than silently picking a different nearby structure.
- Added regression tests for contextual structure selection and documented the interaction/AI rules.


### Building module architecture

The building runtime and module-owned callbacks were introduced in earlier releases; the current design is a fixed set of built-in types, with each type maintained in its own source folder. Earlier release notes describe historical intermediate steps, not runtime extension support.


### v1.16.4 fixed built-in building modules

Building simulation dispatch lives in `src/game/buildings/runtime.ts`; behavior for each built-in type lives in its own module folder and is called through a shared runtime context. The building list is fixed at compile time: there are no custom building types or runtime plugins. See [`docs/BUILDING_MODULES.md`](BUILDING_MODULES.md) for the module layout and [`docs/release-notes-v1.16.4.md`](release-notes-v1.16.4.md) for the current architecture notes.


## Multiplayer reliability (v1.16.5)

Historically the v1.16.5 release raised state/UI synchronization to 30 Hz. The current v1.16.32 multiplayer protocol uses a 30 Hz delta publication cadence, sends full state only on join or resync, and keeps the existing owner-only structure management rules. See [`docs/release-notes-v1.16.5.md`](release-notes-v1.16.5.md) for the historical change and [`docs/state-replication.md`](state-replication.md) for the current protocol.


## v1.16.6 — Enemy-spawn render-loop resilience

The browser render loop now schedules its next animation frame before attempting to draw. A rendering exception is reported once per distinct error message and does not permanently stop future frames. The local authoritative simulation loop uses the same schedule-first pattern and reports a failed simulation tick instead of silently terminating its clock. A regression test advances the simulation past the first procedural enemy outpost spawn and verifies that world time and spawned entities continue progressing.


## v1.16.7 — Fail-fast rendering and resize lifecycle

- Removed renderer/simulation error swallowing and per-object draw suppression. Runtime exceptions now stop the affected animation loop, reach the browser console with their original stack trace, and stop the other local game loop as well.
- Canvas sizing now follows the canvas element with `ResizeObserver` and only changes its backing dimensions when the measured size actually changes. This avoids unnecessary canvas resets and keeps resize handling aligned with the rendered element.
- Validation: simulation and signaling tests pass. The original browser-only freeze was not reproducible in the headless simulation tests, so this release makes failures visible instead of claiming the unobserved exception has been conclusively identified.


## v1.16.8 — Dependency cleanup

Removed the unused `tsx` development dependency after checking the root scripts and source tree. The app and signaling server retain their required dependencies.


## v1.16.9 — Enemy HUD crash fix

- Fixed the enemy-base HUD renderer calling an alliance predicate that was scoped only inside `draw()`. It now uses the shared `areGroupsAllied` helper.
- Gave the Core's commander armor statistic its own explicit label, and made HUD stat row keys unique even if future modules return duplicate labels.
- The production build now runs the TypeScript check before Vite, so unresolved identifiers fail the build instead of shipping and crashing at runtime.
- Added a local SVG favicon and corrected the visible app version.


## v1.16.10 — Core defeat and gray-structure salvage

- A participant loses when their assigned Core reaches zero HP or disappears; the defeat state is based on Core health, not Commander health.
- In TEAM and FREE_FOR_ALL, Core loss defeats only its owner. In COOPERATIVE, the shared Core loss defeats all participants.
- Defeated participants cannot move, respawn at a fallback location, or issue further authoritative commands. Restart remains available. Other players continue the simulation.
- Remote clients derive their defeat overlay from their own assigned Core, while the host view derives it from the host Core.
- Gray/orphaned structures whose Core is gone can be dismantled at interaction range, with the existing HP-proportional salvage refund. Live enemy structures remain protected.
- Added regression tests for single-player defeat, multiplayer isolation, cooperative shared defeat, remote defeat projection, and gray structure dismantling.


## v1.16.11 — Simpler commander priorities, smarter harvesting, and multiplayer HUD

- Added a hard-priority commander state-machine override: a damaged Core forces repair, interception of threats near the Core, or a defensive hold; stale mining/building goals cannot take precedence.
- Harvesters compare reachable deposits by useful cargo per estimated round-trip distance instead of always selecting the nearest reachable resource. Existing physical delivery and stuck-route recovery remain in place.
- Cooperative rooms can no longer restart after the shared Core is destroyed. The restriction is enforced by the authoritative server as well as the UI.
- Moved multiplayer room code, copy, sync status, and leave controls into the existing HUD top bar; removed the separate floating panel.


## v1.16.12 — Core recovery economy, storage-aware harvesters, and multiplayer defeat lifecycle

- Enemy Commanders now repair a damaged Core when affordable, attack an immediate threat, and otherwise collect nearby station stock or mine local resources needed for the repair. New structures and upgrades are deferred until the Core is restored; if no local income is reachable, the Commander holds near the Core.
- Harvester bots do not start or continue mining a resource type when its station stockpile has no room, and wait when both stockpiles are full. Their existing physical return and cargo-preservation behavior remains intact.
- TEAM/FFA room restart is permitted only after all connected participants have lost their Cores. Restart recreates the world while preserving the room mode, participant IDs, commander IDs, and Core IDs so connected remote sessions remain valid. CO-OP restart remains prohibited at both UI and authoritative engine/server layers.
- Multiplayer defeat UI only offers room restart to the host after a full TEAM/FFA defeat, and explains when other players can continue.
- Added regression coverage for Core-repair mining, immediate-threat interruption, no-resource defensive fallback, full harvester storage, CO-OP restart rejection, and end-to-end remote-session preservation across a room restart.

## Release 1.16.23

See [`docs/release-notes-v1.16.23.md`](release-notes-v1.16.23.md) for production multiplayer lifecycle hardening, explicit defeat delivery, heartbeat expiry, and direct room links.
