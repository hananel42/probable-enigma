# Craftbound: Survival Outpost

**Version 1.16.59** — a browser-based real-time survival and base-building strategy game built with React, TypeScript, Vite, and Canvas 2D. The project supports Single Player and host-authoritative multiplayer over direct WebRTC data channels.

## Quick start

Requirements: Node.js 22.12 or newer and npm 10 or newer.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The development server binds to `127.0.0.1` by default. Network access is deliberately not enabled unless you change the Vite host setting.

## Quality commands

| Command | Purpose |
|---|---|
| `npm run typecheck` | Run the strict TypeScript project check. |
| `npm run lint` | Alias for the typecheck; this project does not currently use ESLint. |
| `npm test` | Discover, compile, and run every `src/**/*.test.ts` regression suite. |
| `npm run build` | Type-check and create the production Vite bundle in `dist/`. |
| `npm run preview` | Serve the built bundle locally on `127.0.0.1:4173`. |
| `npm run check` | Run lint/typecheck, tests, and the production build. |

The engine test runner uses the local TypeScript installation when available and otherwise uses `tsc` on `PATH`. It compiles tests to a temporary directory and removes that directory afterward. The project bundle itself still requires the declared npm dependencies to be installed.

## Project map

| Path | Responsibility |
|---|---|
| `src/game/engine.ts` + `src/game/engine/` | Current `GameEngine` entry point plus focused world setup, participants, commands, input, construction/economy, simulation, AI/combat, projectile, and lifecycle layers sharing one state contract. |
| `src/game/server/LocalGameServer.ts` | Authoritative simulation clock, sessions, command boundary, and world-frame publication. |
| `src/game/client/` | Canvas client, rendering, sizing, input mapping, guest presentation, and alliance-aware player-base navigation indicators (`playerPresentation.ts`). |
| `src/app/` | Screen-level React composition, single-player flow, multiplayer UI, and room/session hooks. |
| `src/components/HUD.tsx` + `src/components/HUD*.tsx` | HUD composition, structure actions, construction bar, overlays, and shared small display primitives. |
| `src/game/multiplayer/HostRoomController.ts` | Room membership, host authority, room/world lifecycle, validation, replication, ACKs, and recovery. |
| `src/game/multiplayer/RemoteGameClientPort.ts` | Guest session, assignment validation, world synchronization, delta application, prediction, and interpolation. |
| `src/game/multiplayer/PeerJsRoomClient.ts` | PeerJS signaling lifecycle and direct WebRTC connection ownership. It does not own game rules. |
| `src/game/multiplayer/peerMessageEnvelope.ts` | Shared transport-level message-envelope validation and UTF-8 size checks. |
| `src/game/multiplayer/transport.ts` | Narrow transport-neutral interface used by the room protocol. |
| `src/game/buildings/` | Building-owned definitions, behavior, upgrades, inspection, procedural drawing, and cardinal-neighbor context. |
| `src/game/upgrades/` | Typed, data-driven upgrade effects, purchase descriptions, and Core-to-Commander progression rules. |
| `docs/progression-and-upgrades.md` | Current Diamond economy, all upgrade trees, effects, costs, visual cues, and balancing rules. |
| `src/game/spawnLayout.ts` | Deterministic Free-for-All spawn layout, kept independent from room and rendering UI. |
| `src/game/rules.ts` + `src/game/rules/` | Current rules entry point plus focused economy, placement, geometry, entity creation, and spatial-index modules. |
| `src/game/types.ts` + `src/game/types/` | Current type entry point plus ownership, building, entity, status-effect, and world-object contracts. |
| `src/game/movement.ts` + `src/game/movement/` | Current movement entry point plus collision recovery, smooth steering, and path following. |
| `src/game/tests/` + `src/game/rulesTestSupport.ts` | Focused simulation-rule regression suites and shared fixture builders. |
| `src/game/engine/` | Behavior-oriented `GameEngine` implementation layers; `src/game/engine.ts` is the current in-repository entry point, not a backwards-compatibility promise. |
| `src/guidance/` | Data-driven first-run and contextual guides, shared overlay, keyboard navigation, and versioned progress persistence. |
| `src/game/persistence/` | Versioned local-world save codec, import validation, compact durable snapshots, and IndexedDB-backed world metadata/state storage. |
| `src/app/worlds/WorldSelectScreen.tsx` | Single-player world library UI for create, enter, duplicate, rename, import, export, and delete actions. |
| `src/game/client/escapeRouting.ts` | Pure policy for Escape navigation across Single Player and Multiplayer. |
| `docs/escape-navigation.md` | Escape event ownership, simulation lifecycle, and regression expectations. |
| `src/game/ai/` | Commander, drone, enemy commander, and harvester decision policies. |
| `src/game/ai/droneStateMachine.ts` | Pure high-level drone target-state policy (`ATTACK` or `PATROL`). |
| `src/game/ai/droneAI/DroneFlightController.ts` | Shared drone acceleration equation and collision-aware integration. |
| `src/game/ai/droneAI/DroneFlightPathPlanner.ts` + `DroneFlightTuning.ts` | Obstacle-aware A* lifecycle, waypoint following, path throttles, and physical tuning constants. |
| `src/game/runtime/` | Bounded asynchronous worker scheduling and pathfinding-worker protocol. |
| `docs/development-policy.md` | No-backwards-compatibility policy for active development. |
| `CONTRIBUTING.md` | Code ownership boundaries, style, and required checks. |
| `AGENTS.md` + [`skills/README.md`](skills/README.md) | AI-agent entry point and subsystem-specific maintenance playbooks; `npm run docs:check` validates their index and internal documentation links. |
| `docs/README.md` | Documentation index and canonical references. |
| `docs/drone-ai-state-machine.md` | Drone state transitions, patrol doctrine, path-recovery guarantees, and control bindings. |
| `docs/performance-diagnostics.md` | Console performance telemetry, stage names, slow-frame warnings, and bottleneck triage. |
| `docs/world-persistence.md` | Local world save format, IndexedDB ownership, autosave lifecycle, restore invariants, and import/export validation. |
| `docs/release-notes-v1.16.59.md` | Current release changes and checks. |
| `docs/release-validation-v1.16.59.md` | Current release validation record. |
| `docs/repository-structure.md` | Detailed module map, naming conventions, and file-size guidance. |

## Multiplayer invariants

- **A room is not a world.** Joining creates membership only. An explicit host action creates and broadcasts a world.
- The host is authoritative. Guests submit versioned commands and consume validated authoritative frames; a guest never starts a second local simulation as a fallback.
- Room/session identity, room-status sequence, and world identity are separate scopes. A new world requires an explicit participant assignment before its initial state can be applied.
- Pause/resume preserves the world ID. Returning to the room stops the simulation but preserves connected peers. Starting again creates a new world ID.
- Each guest has a bounded, ACK-confirmed full-state recovery path. Invalid, oversized, or out-of-sequence traffic fails visibly; state is not fabricated to mask protocol errors.
- Direct PeerJS/WebRTC is the only game-data path. There is no hidden WebSocket relay fallback. Public PeerJS signaling and STUN do not guarantee connectivity behind every NAT/firewall; TURN is not configured in this release.

See [Building Neighborhoods](docs/building-neighborhoods.md), [Interactive Guidance](docs/interactive-guidance.md), [Contributing and Maintenance](CONTRIBUTING.md), [Multiplayer Runtime Map](docs/multiplayer-runtime-map.md), [Transport Adapter Contract](docs/transport-adapter-contract.md), [PeerJS/WebRTC Notes](docs/peerjs-webrtc.md), and [Production Readiness](docs/production-readiness.md).

## Documentation policy

The project is actively developed and makes no backwards-compatibility commitments. Follow [Development Policy](docs/development-policy.md): do not add old-format readers, migrations, aliases, API shims, or guessed defaults. Breaking changes must update all current producers/consumers and reject obsolete save/protocol versions.


`docs/README.md` is the documentation index. Per-version release notes are the canonical change history; the former long README is retained as [historical project notes](docs/project-history-v1.16.32.md) and should not be treated as a source of current runtime behavior when a newer architecture document disagrees.

## Release validation

The current release validation record is [Release Validation v1.16.59](docs/release-validation-v1.16.59.md). This archive has no `package-lock.json` or installed `node_modules`; in a network-enabled development environment, run `npm install`, commit the generated lockfile, then use `npm ci` and `npm run check` for repeatable releases. See [Local World Persistence](docs/world-persistence.md) for IndexedDB-backed single-player world storage, autosave, and validated import/export. See [Performance Diagnostics](docs/performance-diagnostics.md) for live timing instrumentation and the `window.craftboundPerformance` console controls. Follow the live-browser steps in [Production Readiness](docs/production-readiness.md) before publishing. In-memory tests cannot prove public signaling, ICE negotiation, NAT traversal, or real browser rendering.
