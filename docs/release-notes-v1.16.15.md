# v1.16.15 — Multiplayer transport, drone breakoff, compact HUD

## Multiplayer runtime

- Replaced per-simulation-tick full-world WebSocket transmission with latest-revision coalescing and a 10 Hz publication cadence. Local simulation timing and local rendering remain independent from network publication.
- Added client and server WebSocket backpressure controls. Replaceable snapshots are skipped under congestion rather than accumulating an unbounded send queue; reliable commands are not treated as replaceable state.
- Enforced a room-message size limit with explicit console errors.
- Added a dedicated `SignalingRelayTransport` adapter and a `WebRtcDataChannelTransport` adapter implementing the same game-data contract. WebSocket remains the active transport; the WebRTC adapter is ready for use after a peer-link negotiation layer attaches data channels.

## Drone AI

- Defense drones now abandon cached targets outside their sensor envelope and clear stale combat-orbit/path state before returning to their patrol.
- Escort drones enforce both commander tether and drone-relative pursuit limits, preventing a fleeing target near the tether edge from being reacquired indefinitely.

## HUD

- Reduced scrollbar thickness, removed unnecessary block-footprint dimensions and nearby distance telemetry, and removed duplicate upgrade-cost/choice information from the top bar.
- Construction and repair/salvage controls use compact icon buttons with accessible names/tooltips; resource prices remain visible and use more readable type.
- Room-code copy now gives visible success/failure feedback. The in-game top bar no longer repeats the Leave Room action; ESC remains the way to open the leave/continue menu.

## Validation

- Simulation/integration suite and signaling room-code tests are run as part of `npm test`.
- Added regression coverage for latest-frame coalescing and drones breaking off from out-of-range targets.
