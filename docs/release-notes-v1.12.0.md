# Craftbound Survival 1.12.0

## Simulation and multiplayer
- The authoritative host simulation now owns both participants' commanders, participant-specific input contexts, and per-player resource ledgers. The guest is a read-only world replica and sends sequenced commands to the host over the peer data channel.
- The three multiplayer rulesets are represented in the simulation: Free-for-All, Team, and Cooperative.
- Guest input is executed through the host's `dispatchForPlayer` context, and world frames are sent to the guest replica.

## Structure targeting
- The same `resolveContextBuilding` rule is used by the renderer, HUD, and structure actions: a hovered structure in range wins; otherwise the nearest live structure in interaction range is selected.
- The current context structure receives a cyan footprint outline in the world view, matching the structure shown in the HUD.

## AI reliability
- Commander goal evaluation checks damaged Core health at a short interval and prioritizes Core repair. If repair is not affordable, it holds/defends the Core rather than returning to routine mining or construction.
- Drone movement includes embedded-unit recovery, collision-aware movement, and a stuck-recovery path for escort flight.

## Signaling server
- Room-code generation uses `node:crypto.randomBytes` with rejection sampling. It does not reference an undefined `randomInt` symbol.
- The signaling server remains a signaling service only; the host is authoritative and game state travels directly over the WebRTC data channel.

## Verification
- `node --test signaling-server/src/roomCodes.test.js` passes (3 tests).
- The full TypeScript/game test suite was not run in this environment because project dependencies are not installed here.

## v1.13.0 multiplayer and economy fixes

- A room host starts the simulation immediately after room creation; joining players enter the already-running match.
- Multiplayer commands and authoritative snapshots are relayed through the signaling WebSocket. The game no longer waits for a WebRTC direct-peer negotiation, which could stall even between tabs on one computer.
- Increased the signaling server's incoming message limit to accommodate larger serialized world snapshots.
- Fixed a wallet-context regression: commands issued by the local controller now execute in that participant's scoped engine context, and the participant wallet is restored into the published snapshot. Previously, the next simulation tick could overwrite a construction cost with the old wallet.
