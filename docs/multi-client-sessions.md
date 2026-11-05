# Multi-client World Sessions (Infrastructure Only)

## Current guarantee

A `LocalGameServer` identifies one world with a stable-in-process `worldId` and publishes a monotonically revisioned `GameWorldFrame`. Multiple `GameClientPort` sessions may connect to the same world and subscribe to that same authoritative world stream.

- The first/default controller session is bound to the current player Commander entity.
- Additional sessions default to `observer`; observers can inspect the same world frame but their `dispatch()` calls are rejected.
- A second simultaneous `controller` session is rejected while the first controller is connected.
- Every client command is wrapped as `ClientCommandEnvelope` with protocol version, world ID, client ID, sequence number and observed revision. The local server validates the session, world, role and sequence before accepting it.
- Disconnecting a session releases its ID and subscriptions. Disconnecting the controller frees the single-player command seat for a future controller session.

This is only a server/client infrastructure seam. The game still has one player-controlled Commander, the home page still offers only **Single Player**, and no network transport or multiplayer gameplay is enabled.

## Known boundaries before real multiplayer

1. Add one authoritative controllable entity per player and map each authenticated session to that entity. Commands currently operate on the original player Commander.
2. Move transient presentation/input state (camera, selected building, cursor aim, held keys and pointer state) out of the shared simulation state into per-client contexts. The current observer API intentionally shares the one world's snapshot and camera.
3. Define explicit JSON-safe wire DTOs rather than treating `GameSnapshot` as a complete network schema.
4. Add authentication, rate limits, command authorization by entity/group ownership, reconnect policy and host-disconnect behavior.
5. Replicate snapshots/deltas at a controlled rate. Do not send mutable entity references, browser objects, or unbounded visual-effect data.

## Example

```ts
const host = new LocalGameServer();
const playerClient = host.connectClient({ clientId: 'local-player', role: 'controller' });
const observerClient = host.connectClient({ clientId: 'debug-viewer', role: 'observer' });

// Both sessions share one world and see the same revision stream.
console.assert(playerClient.session.worldId === observerClient.session.worldId);
console.assert(playerClient.getWorldFrame().snapshot === observerClient.getWorldFrame().snapshot);

// The controller's semantic action is accepted; an observer's action is rejected.
playerClient.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' });
observerClient.dispatch({ type: 'SELECT_BUILDING', buildingType: 'AUTO_TURRET' });
```

The in-process command envelope is groundwork for a future transport adapter, not a security boundary against arbitrary browser code. A networked host must authenticate the sender independently of any client-supplied ID.
