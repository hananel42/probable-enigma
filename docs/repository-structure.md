# Repository Structure and Module Boundaries

This document is the detailed source map. The root [README](../README.md) stays short; `docs/README.md` is the documentation index.

## Development policy

No backwards compatibility is maintained during active development. See [Development Policy](development-policy.md): old save/protocol versions, field aliases, migration code, and facades retained only for obsolete callers are removed rather than supported.

## Application and presentation

- `src/App.tsx` is the composition root. It should coordinate screens rather than own screen-level markup or multiplayer lifecycle logic.
- `src/app/home/HomePage.tsx` renders the main menu.
- `src/app/singleplayer/SinglePlayerGame.tsx` owns the single-player screen composition and connects the renderer to the local game service.
- `src/app/multiplayer/MultiplayerLobby.tsx` and `RoomManagementPanel.tsx` render room entry/management. `RoomPlayerRow.tsx` owns one roster row.
- `src/app/multiplayer/MultiplayerGame.tsx` composes the live multiplayer screen. `useMultiplayerSessionLifecycle.ts` owns the connect/start/teardown lifecycle; `useRoomActions.ts` owns UI-triggered host actions, chat submission, and command dispatch; `roomMessages.ts` maps failures to readable UI copy. Keep simulation or transport policy out of these React files.
- `src/components/HUD.tsx` composes the in-world HUD. `HUDStructureActions.tsx`, `HUDConstructionBar.tsx`, and `HUDGameOverOverlay.tsx` own separate view sections; `HUDShared.tsx` contains the small shared glyph, meter, and cost primitives. UI should project the authoritative snapshot and emit commands, not change simulation state directly.
- `src/guidance/` owns shared interactive guidance definitions, persistence, navigation and overlays. Screens should provide stable guide anchors rather than duplicating guide state.

## Simulation contracts and reusable mechanics

- `src/game/engine.ts` is the current in-repository entry point and exports the contracts used by current callers; it is not a backwards-compatibility promise. Update all imports directly when its shape changes.
- `src/game/engine/EngineState.ts` owns mutable world state, shared caches, and initialization. `EngineContract.ts` defines the internal method contract; `model.ts` defines the public engine-state/player shapes.
- Engine behavior is split by responsibility: `EngineWorldSetup.ts` (world/chunks and spawn setup), `EngineParticipants.ts` (human participant lifecycle), `EngineCommands.ts` (scoped command dispatch), `EngineInput.ts` (pointer/keyboard intent), `EnginePlacement.ts` (building selection and placement), `EngineEconomyActions.ts` (repair/upgrade/dismantle transactions), `EngineGroups.ts` (group identity and alliances), `EngineSimulation.ts` (fixed-step orchestration and world updates), `EngineSinglePlayer.ts` (player-specific simulation), `EngineAutonomousSystems.ts` (autonomous units/buildings), `EngineEnemyBases.ts` (enemy outpost simulation), `EngineCombat.ts` (damage and combat target resolution), `EngineProjectileRuntime.ts` (projectiles, effects, and floating combat feedback), and `EngineLifecycle.ts` (restart/results and lifecycle transitions). The class layers share state through the base classes; preserve their inheritance/update order when refactoring.
- `src/game/rules.ts` is the current rules entry point. Implementations in `src/game/rules/` are separated by responsibility: constants, resource/economy rules, geometry, placement, entity factories, and building/resource spatial indexes.
- `src/game/types.ts` is the current type entry point. Files in `src/game/types/` group ownership/economy contracts, building data, status effects, entities/navigation state, and world objects. A serializable contract change must update every current producer, consumer, validator, and regression fixture together; protocol versions are exact and older versions are rejected.
- `src/game/movement.ts` is the current movement entry point. `src/game/movement/collision.ts` handles collision and embedded recovery; `smoothMotion.ts` handles acceleration-limited steering; `pathMovement.ts` owns asynchronous path requests, retry state, and waypoint traversal. `src/game/pathWaypointValidation.ts` parses `unknown` worker payloads into canonical, fully validated waypoint objects shared by ground and drone navigation.
- `src/game/ai/` owns the decision policies for commanders, drones, enemy commanders, and harvesters. `droneAI.ts`, `commanderAI.ts`, and `harvesterAI.ts` remain stable entry points; their implementation layers live in `droneAI/`, `commanderAI/`, and `harvesterAI/`. For ordinary drones, `DroneAIUpdate.ts` resolves home/hostile centre policy; `DroneFlightController.ts` owns one acceleration law, phase, route goal, collision-aware integration, and A* waypoint following; `DroneAIWeapons.ts` owns firing. Orbit-planning, orbit-navigation, patrol-navigation, and state-transition modules remain active layers in the drone AI flow; they plan routes and orbit-entry phases consumed by the shared flight controller. Commander layers separate combat, economy/mining, building actions, strategy planning, and update orchestration. Keep the layer order intact because inherited methods share mutable policy state and call each other through the class contract. `src/game/buildings/<building>/` owns per-building behavior, upgrade definitions, and drawing. `src/game/upgrades/` applies typed upgrade effects.
- `src/game/runtime/` owns bounded workers and asynchronous task protocols. Worker messages must be cloneable data, never live simulation instances.
- `src/game/client/` and `src/game/drawers/` own Canvas input/presentation and visual drawing. `CanvasGameRenderer.ts` invokes the screen-space navigation overlay; `playerPresentation.ts` derives home/other-player Core targets and friendly relationships from participant identity and alliances; `playerBaseHUDIndicators.ts` draws the navigation arrows; `EntityDrawer` applies those relationships to unit palettes. Rendering must not become an authority for gameplay outcomes.

## Multiplayer ownership

- `src/game/server/LocalGameServer.ts` owns the fixed-step clock, command admission, and world-frame publication.
- `src/game/multiplayer/HostRoomController.ts`, `RemoteGameClientPort.ts`, and `PeerJsRoomClient.ts` are the current entry points used by the application. The host controller's `hostRoomController/` layers own room status, room lifecycle, message dispatch, state replication, heartbeat/chat and peer cleanup. The guest port's `remoteGameClientPort/` layers own session state, frame projection, protocol dispatch, sync, notices and lifecycle. `peerJsRoomClient/` separates room entry, peer actions, signalling, connection maps, data-channel dispatch and recovery. Update every current caller when changing these entry points, and preserve the layer inheritance order where shared state depends on it. Do not retain obsolete facades for historical imports.
- `transport.ts`, `peerMessageEnvelope.ts`, transport policy modules, and the WebRTC adapter keep raw connection handling separate from room/world semantics.
- `src/app/multiplayer/` is presentation glue only. The host controller and local server—not the React screen—decide whether commands, room transitions, or new worlds are valid.
- Multiplayer regression tests are grouped around protocol duties: host room setup/lifecycle, peer cleanup, state replication, guest world synchronization, and two-player integration. Shared fake transports are in files named `*TestSupport.ts` rather than `*.test.ts` so the recursive test runner does not execute helpers as suites.

## Simulation tests

- `src/game/tests/rules-01-*.test.ts` through `rules-13-*.test.ts` are focused, ordered suites split from the former monolithic rules test file. Each suite should test one coherent behavior cluster.
- `src/game/rulesTestSupport.ts` owns shared deterministic fixtures and helper builders. Keep assertion logic in the individual behavior test files so failing output points to the relevant suite.
- The test runner is `scripts/test-simulation.mjs`; it discovers all `src/**/*.test.ts` files, transpiles the relevant dependency graph to a temporary folder, runs with bounded concurrency/timeouts, and removes the temporary output.

## File-size and extraction policy

Aim for **300 lines or fewer** per source file. Split around behavior or lifecycle boundaries, not arbitrary line numbers. Avoid introducing tiny files for helpers that are used together and have no separate contract; a small module is justified when it has a stable API, lifecycle, data family, or isolated tests. A small barrel is justified only when it is the current canonical entry point; it carries no compatibility promise and may be changed with all current callers.

The engine, AI and multiplayer owners now use small public facades with implementation layers in focused subfolders. Most source modules are at or below the 300-line target. Remaining exceptions are explicit rather than hidden behind facade files: `src/game/server/LocalGameServer.ts` owns the tightly coupled local-authority lifecycle; `src/game/multiplayer/remoteGameClientPort/RemoteGameClientPortMessageDispatch.ts` and `src/game/multiplayer/hostRoomController/HostRoomMessageDispatch.ts` centralize protocol dispatch; and a few renderer/drawing/planning modules (`CanvasGameRenderer.ts`, `entityDrawer.ts`, `enemyCommanderAI.ts`, and `CommanderAIPlanning.ts`) remain slightly above the target. Avoid splitting these by arbitrary line count: extract independently testable phases while preserving AI decision order and authoritative state transitions. Newly extracted modules should normally stay at or below 300 lines.
