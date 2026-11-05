# Multiplayer Engine Integration

## Authority and transport

The room creator remains the sole simulation authority. The guest sends ordinary `GameCommand` messages through the default PeerJS-managed direct WebRTC connection; the host maps that peer to the stable `guest-player` identity and executes commands in that participant's engine context. The host publishes one authoritative world frame. The guest projects that frame onto its own commander, camera, resource ledger, aim point, and build selection.

PeerJS Cloud provides room signalling; live game traffic uses direct, reliable WebRTC data channels. PeerJS is not the simulation host and does not relay normal gameplay traffic. Keep transport details behind the transport adapter so room/world semantics and engine commands remain independent of the connection implementation.

## Participant model

`GameEngineState.humanPlayers` contains each participant's stable player ID, commander ID, core ID, group/alliance IDs, private resources, and client-side interaction state. Human commanders are ordinary world entities and carry `ownerPlayerId`. Player-built structures carry `ownerPlayerId` and `coreId` independently of faction and alliance.

Each participant has an isolated input context (movement keys, pointer state, aim, building selection, and station selection). `dispatchForPlayer` temporarily binds that context and wallet, executes the same engine command implementation used by the host, then stores the context back. The simulation steps each connected human commander using its own inputs. Resource costs, mining, repairs, upgrades, dismantling refunds, and station cargo are charged or credited to the relevant owner's wallet.

## Game modes

- **FREE_FOR_ALL**: separate cores, distinct alliances, private wallets. Enemy bases are generated around participant positions in rotation; human commanders are hostile to one another.
- **TEAM**: separate cores and private wallets; human commanders share an alliance and cannot damage each other. Allied structures can be used, but a teammate's core cannot be upgraded or repaired as if it were owned.
- **COOPERATIVE**: one shared core, private wallets. All participants can use shared structures. Shared-core upgrades apply to all human commanders; each action still pays from the acting participant's wallet.

The signaling flow supports one host and up to seven guests. The host runs the only authoritative simulation. Reconnection/resume is not implemented. Automated tests use in-memory transports and do not replace a live multi-browser WebRTC test.

## Ownership and core lifecycle

A structure's `coreId` determines which core gates its operation. When a core is destroyed, its structures remain present but become inoperable through the existing `isBuildingOperational` path. Orphaned structures can still be salvaged by any commander. A structure with a living core retains normal access rules for the selected mode.

## Validation

The focused TypeScript check covers the engine, host server adapter, remote client adapter, mode rules, core-status helpers, and procedural world generation. `src/game/multiplayer/engineParticipants.test.ts` covers the three core policies, participant creation, and private wallet isolation. Run the complete project checks on a machine with dependencies installed:

```bash
npm install
npm test
npm run lint
npm run build
```

A real two-browser test using PeerJS Cloud signalling and direct WebRTC data channels is still required. The current automated integration tests use in-memory transports and do not prove peer discovery, ICE/NAT traversal, or browser-to-browser reliability. The production project has no local WebSocket relay fallback; a failed direct WebRTC connection is surfaced explicitly.
