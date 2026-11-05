# v1.16.16 — Multiplayer backpressure, transport adapter boundary, drone recovery, and compact HUD

## Multiplayer reliability

- The authoritative host still runs the simulation at native speed but publishes only the newest world snapshot at 10 Hz. Intermediate revisions are coalesced instead of serialized and queued for every simulation tick.
- Snapshot publication uses bounded, retryable backpressure. If a send queue is congested, obsolete snapshots are skipped; the broadcaster retains the newest revision for its next attempt. Reliable commands are not silently coalesced.
- The signaling relay has explicit buffered-byte and message-size limits and emits console diagnostics for congestion and rejected writes.
- Added `SignalingRelayTransport` and `WebRtcDataChannelTransport` around the shared `GameDataTransport` interface. The latter supports validated, already-negotiated `craftbound-game` data channels and is tested independently. Room creation and peer negotiation still use the signaling relay in this release; the new adapter is the data-plane seam, not a complete ICE/SDP negotiation implementation.

## Drone recovery

- When a drone loses its combat target outside the allowed pursuit envelope, all combat path/orbit locks are cleared.
- Defensive drones re-anchor their patrol phase using their actual post-chase position and pathfind toward the fixed defense ellipse, rather than relying on the pre-chase orbit phase.
- Added multi-tick regression coverage requiring defense and escort drones to accumulate actual movement after breaking off a chase.

## HUD

- Reduced the visual weight of scrollbars and made drone doctrine controls icon-only, with accessible labels and tooltips.
- Raised nearby-structure statistic and action-description legibility, removed redundant installed-upgrade history and nonessential cargo instructions, and kept structural footprint dimensions out of the build controls.
- The room-code control shows success/failure iconography and explicit feedback after clipboard attempts. The in-game top bar has no separate leave button; ESC provides the session menu.

## Verification

- 157 simulation and integration tests pass, including transport-adapter, snapshot coalescing/backpressure, WebRTC channel routing, and drone breakoff-motion regression tests.
- Full Vite production build and complete project `tsc --noEmit` still require the project's npm development dependencies, which are not installed in the build workspace.
