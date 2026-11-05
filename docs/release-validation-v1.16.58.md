# Release Validation — v1.16.58

## Executed checks

- `node scripts/test-simulation.mjs`: **333 passed, 0 failed** across 62 TypeScript regression suites.
- `node scripts/check-maintenance-docs.mjs`: passed; documentation indexes, required current release files, and internal links validated.
- The test runner transpiled the TypeScript regression dependency graph before executing the suite.
- ZIP archive integrity was checked after packaging.

## Not executed

- Full `npm run typecheck` was not completed because the extracted environment does not have project dependencies installed; the global TypeScript installation cannot resolve the project-declared `@types/node` package.
- Production Vite build was not run because the project dependencies are not installed.
- PeerJS Cloud signalling recovery and browser-to-browser WebRTC behavior were not exercised with two real browsers. Simulation tests do not prove real signalling availability, ICE negotiation, or NAT traversal.

## Contract checks added

- World-save imports reject schema version 2 and accept only schema 3.
- Host and guest regressions reject the previous state-sync protocol v2 and old world-frame protocol v2; the active world-state sync protocol is v3. The PeerJS application handshake is v2 and accepts only an exact version match. The command protocol remains independently versioned at v2.
- `clientSessionId` is mandatory in `game-hello` and heartbeat messages; messages that omit it are rejected.
- Persisted buildings without the required `upgradeIds` array are rejected.
- Effect Tower snapshots missing required current runtime fields are rejected rather than repaired.
- Effect Tower runtime validation rejects incomplete state and does not rely on the removed `burnDuration` representation.
