# Client / Server Boundary

## Current Single Player startup

1. `src/App.tsx` shows the home page. The **Single Player** button mounts the game screen.
2. The game screen creates `LocalGameServer`, opens one controller `GameClientPort` session, attaches `CanvasGameClient` to that session, subscribes the UI to authoritative snapshots, mounts input listeners, starts client rendering, and starts the local simulation.
3. The client sends semantic `GameCommand` values. It never directly edits health, resources, buildings, AI targets, or projectile state.
4. `LocalGameServer` dispatches commands to public entry points on `GameEngine` and publishes state changes.
5. `CanvasGameRenderer` renders a snapshot. Drawing reads state and should not alter simulation rules.

## Responsibilities

- `src/game/engine.ts` plus `src/game/engine/`: public engine API and the behavior-layer implementation for world state, command entry points, simulation stepping, and lifecycle; no Canvas or DOM event listeners.
- `src/game/server/protocol.ts`: semantic commands, versioned client-command envelopes, world-frame metadata, and server/client port contracts.
- `src/game/server/LocalGameServer.ts`: local authoritative adapter, world identity/revision, session registry, command sequencing, and simulation lifecycle. It also exposes commands to update group identity and diplomacy through the same authority boundary.
- `src/game/client/CanvasGameClient.ts`: browser event handling, key mapping, pointer-to-world conversion, and drawing lifecycle.
- `src/game/client/CanvasGameRenderer.ts`: Canvas-only presentation.
- `src/App.tsx`: screen routing and lifecycle composition; not a place for gameplay rules.

## Adding an action

1. Add a narrow semantic command to `GameCommand` in `protocol.ts` (for example, request a specific interaction rather than sending arbitrary state changes).
2. Route it through `LocalGameServer.dispatch` to a named `GameEngine` entry point.
3. Keep validation, costs, range checks, cooldowns, and mutation in the engine / rules layer.
4. Connect the client input or HUD control to the command. Do not let UI components change state objects directly.
5. Add a test for both accepted and rejected commands at the rules/engine boundary.

## Current peer-hosted adapter and remaining hardening

`GameServerPort` remains the simulation boundary. The room creator runs the only `LocalGameServer`; the guest sends sequenced commands through a reliable PeerJS-managed direct WebRTC data connection and receives authoritative `GameWorldFrame` snapshots. The local WebSocket relay and developer-mode UI have been removed. The host router assigns a unique participant identity per peer and routes gameplay commands through that participant's commander, input state, and private wallet. The guest adapter projects the authoritative frame onto its own commander and camera. Full state is sent on join/resynchronization; compact revision-based deltas synchronize at 30 Hz, and aim commands are throttled to avoid flooding the direct data channel. Free-for-all, Team, and Cooperative rules are connected to the engine for a host plus up to seven guests.

This is not a hardened public-network protocol. Before public use, validate every command's complete schema, rate-limit input, bound message sizes, handle malformed snapshots and timeouts, and test malicious peers. The room supports up to seven guests; reconnect, host migration, and snapshot resumption are not implemented. A signalling-service outage does not tear down an established direct gameplay connection: the client retries signalling in the background, existing peer data channels remain active, and the room displays a retry action when new participants cannot join. A guest departure removes that participant’s Commander and personal ledger; in CO-OP the shared Core, group, structures, drones, and miners remain in the world. A client must never be trusted to report damage, mining yields, construction success, or its own position as fact. Group identity and diplomacy commands are restricted for guest clients in the current adapter.

One remaining presentation coupling is audio: simulation/AI modules call the shared browser `sound` service directly. Particles and floating combat text are also part of the replicated state. Those boundaries should be separated before moving the authority into a worker or dedicated process. The current transport uses direct WebRTC data channels after PeerJS signalling. Keep the protocol boundary transport-neutral so transport lifecycle changes do not leak into command handling or frame projection.

## Groups and alliances

`GameGroup` separates ownership (`id`) from diplomacy (`allianceId`). Renaming a group or commander changes display metadata only; changing an alliance changes hostility for entities, buildings, projectiles, target selection, and defensive support. Distinct group IDs remain distinct economies and ownership records. Groups with at least one ally use the alliance green presentation color. `SET_GROUP_IDENTITY` and `SET_GROUP_ALLIANCE` are semantic host commands; neither command is a network authentication mechanism by itself. Multiplayer must bind each group ID to an authenticated session and authorize these commands on the host. Allied defensive buildings can select hostile targets without treating the allied group as hostile, and defensive coverage clusters can include buildings owned by allied groups.
