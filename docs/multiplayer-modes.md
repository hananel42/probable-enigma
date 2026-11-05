# Multiplayer Modes — Local Domain Foundation

Status: **host-authoritative multi-participant prototype integrated (up to eight players per room)**. The room creator hosts the simulation and guests connect directly over PeerJS-managed WebRTC data channels. The unused local WebSocket relay has been removed. Reconnection/resume is not supported. The host enforces heartbeat/liveness and bounded state-recovery deadlines; Core defeats are reliably signaled and acknowledged. The `GameDataTransport` interface keeps the command/frame protocol independent from transport details.

## Room setup flow

1. From the main menu, the host selects **Create Room**; no game mode is selected on that screen. A joining player enters the five-letter code or opens the direct invitation link.
2. Both host and guests land in the full-screen Room Control Center. The invite code/link and current roster remain visible here.
3. The host chooses the game mode in the manager, then starts the match. The selected mode is authoritative and cannot be changed after the simulation starts.
4. During a match, living players may return from the manager to gameplay without leaving the room. Defeated players remain connected in the manager and may chat or wait. When results are finalized, only the host can create a new lobby.
5. **Leave Room** disconnects the peer; closing the manager or returning to gameplay does not.

## Modes

| Rule | Free-for-all | Team | Cooperative |
|---|---|---|---|
| Human-vs-human damage | Allowed between different players | Disabled | Disabled |
| Cores | One per player | One per player | One shared core |
| Human alliance identity | One unique alliance per player | One shared human alliance | One shared human alliance |
| Structure access | Owner only | Same-alliance players may access | All participants may access |
| Resource ledger | Private per player | Private per player | Private per player |
| Enemy spawn anchors | Every connected participant | Every connected participant/team | Every connected participant/team |

“Shared core” does not imply a shared wallet. In cooperative mode each participant still pays from their own ledger for actions they initiate. A later gameplay integration must explicitly define how an action is authorized if the acting participant cannot afford it; this layer never silently charges another participant.

## Code map

- `src/game/multiplayer/types.ts` — stable IDs and mode/domain types.
- `src/game/multiplayer/modeRules.ts` — pure mode-specific targeting, structure access, core access, and spawn-anchor rules; resource charging helpers.
- `src/game/multiplayer/worldModel.ts` — constructs a validated local world model containing participants, their private ledgers, and core ownership.
- `src/game/multiplayer/modeRules.test.ts` — ruleset, ownership, economy isolation, validation, and disconnected-anchor tests.
- `src/game/engine.ts` — creates live participant commanders, per-player input contexts and private wallets.
- `src/game/multiplayer/RemoteGameClientPort.ts` — projects host snapshots to the guest's commander and view.
- `src/game/server/LocalGameServer.ts` — executes host and guest commands on the authoritative host simulation.

## Invariants

1. `playerId`, `groupId`, and `commanderId` are stable identifiers and must not be empty; player IDs must be unique within a world.
2. Each participant has a distinct mutable resource ledger in every mode.
3. Free-for-all participants receive distinct alliance IDs. Team and cooperative participants share an alliance ID.
4. Free-for-all and team modes create one core per participant. Cooperative mode creates exactly one shared core.
5. Structure access does not transfer ownership. Resource payment always targets the acting participant's ledger.
6. Disconnected participants are omitted from enemy spawn-anchor selection, but their identity, core reference, and inventory remain in the model.
7. These rules are pure domain functions; no browser globals, Canvas, React, sockets, or network calls are used.

## Current integration boundary / known limitations

`state.player` and `state.resources` are the authoritative boundary’s current host-view projection; `humanPlayers` stores all participant records and the guest projection is derived from its assigned commander and personal wallet. Human commands and per-frame movement use isolated participant contexts. The room UI supports up to eight players; full automated browser testing is still needed. Enemy spawning rotates between participant positions; enemy AI and combat continue to use the shared world entities and alliance IDs.

The current `LocalGameServer` controller/observer sessions remain single-player scoped. The session envelope's sequence and revision fields are local safeguards, not authentication, anti-cheat protection, or a complete serialized network contract.

## Validation

```bash
npm test
npm run lint
npm run build
```

The test suite includes both existing simulation-rule tests and the new multiplayer-domain tests.
