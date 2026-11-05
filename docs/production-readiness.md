# Production Readiness Checklist

This checklist distinguishes automated checks from operational guarantees. Completing unit tests alone is not evidence that public WebRTC networking works across real networks.

## Before each release

- [ ] Use a clean checkout and install the declared npm dependencies. Generate and commit a lockfile in a network-enabled environment before treating builds as reproducible; this repository package currently has no committed `package-lock.json`.
- [ ] Run `npm run check` and retain the exit codes/logs.
- [ ] Run `npm run preview` against the actual production bundle.
- [ ] Verify the browser console and Network tab have no failed local assets, unhandled errors, or unintended debug logs.
- [ ] Open two independent browser profiles. Create a room in one, join in the other, and verify that joining does not start a world.
- [ ] Start the world from the host; verify a matching assignment and full state arrive before the guest accepts commands.
- [ ] Test movement, building, state delta recovery, a forced full-state resync, pause/resume, return-to-room, a new world, a guest leaving, and host shutdown.
- [ ] Repeat the WebRTC test with peers on different network paths (for example, home broadband and a mobile hotspot). In-memory transport tests do not cover ICE/NAT traversal.
- [ ] Profile the host while the world is active with expected entity/building counts. Investigate dropped-tick diagnostics rather than hiding them.
- [ ] Test narrow/mobile screens, keyboard-only navigation, browser zoom, tab backgrounding, and visibility restoration.

## Deployment requirements

- Serve the built `dist/` directory over HTTPS. Secure contexts are required for normal WebRTC use outside localhost.
- Configure hosting response headers for MIME sniffing protection, a restrictive referrer policy, and a Content Security Policy that explicitly allows the chosen PeerJS signaling endpoint and any required font source. Validate the policy against the actual built assets before enforcing it.
- Set cache policy deliberately: fingerprinted Vite assets may be cached for a long time; `index.html` should revalidate so clients receive the current entry point.
- Publish only `dist/`. Do not expose source maps, temporary test outputs, local environment files, or development configuration unless the release explicitly intends to.
- Keep the development server bound to loopback by default. Enable `--host`/network access only when deliberately testing a LAN device.

## Multiplayer trust and availability

- The host browser is the authoritative simulation and the room is a small star topology. Current limit: one host and up to seven guests.
- The five-letter room code is a locator, **not authentication**. The current game has no account system or room-password system; do not use it to protect private or sensitive information.
- PeerJS Cloud is a shared signaling service. The data plane is direct WebRTC; this release configures STUN but has no TURN relay. Some networks will be unable to connect. The app must report failure rather than silently switching transport.
- PeerJS IDs, room codes, peer-supplied fields, and protocol messages are untrusted. Keep sender identity derived from the established connection; preserve envelope size checks, per-peer rate limits, sequence/revision checks, bounded resync attempts, and idempotent cleanup.
- Treat full-state messages as resource-intensive input. Check both serialized size and recovery retry bounds, and profile actual binary payloads during a live two-browser test.
- Browser state is ephemeral. Reload-based session restoration is not part of the current protocol. A reconnect should be represented as a new handshake, not assumed to restore the previous local client process.

## Diagnostics policy

Expected stale packets may be deduplicated and logged at debug level. Actual protocol violations, send failures, dropped simulation ticks, failed cleanup, and exhausted recovery retries must remain visible and actionable. Rate limiting diagnostics must preserve counters/recent context so it does not erase evidence of a continuing problem.
