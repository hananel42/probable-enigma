# Contributing and maintenance rules

## Change boundaries

- `src/game/engine.ts` is the current in-repository simulation entry point; it has no external API stability or backwards-compatibility guarantee. The implementation in `src/game/engine/` owns deterministic gameplay and shared world state; it must not depend on React, the DOM, PeerJS, or a browser renderer.
- `src/game/server/LocalGameServer.ts` owns the authoritative fixed-step simulation clock, command admission, session sequencing, and publishing world frames. Rendering and React state must never be required to advance the simulation or multiplayer replication.
- `src/game/multiplayer/HostRoomController.ts` owns room membership, host authority, room/world lifecycle, participant policy, replication baselines, acknowledgements, and bounded recovery.
- `src/game/multiplayer/RemoteGameClientPort.ts` owns the guest-side protocol state machine, authoritative assignment, snapshot application, delta validation, and presentation projection.
- `src/game/multiplayer/PeerJsRoomClient.ts` owns PeerJS signalling and direct data connection lifecycles. It must not implement gameplay rules or silently switch to a second data plane.
- `src/guidance/` owns the generic guide model, versioned progress storage, keyboard navigation, and shared coach-mark overlay. UI screens should provide stable `data-guide-target` anchors instead of duplicating tour or persistence logic.
- `src/game/upgrades/` owns the typed effect interpreter; individual building folders own the upgrade data and visual cues. Upgrade IDs are current-schema identifiers, not permanent compatibility promises. Rename them directly across definitions, runtime consumers, and tests; bump the world-save schema when serialized data changes. Diamonds are combat rewards only and may only be spent by Core upgrades. See [`docs/progression-and-upgrades.md`](docs/progression-and-upgrades.md) before changing progression or balance.
- `src/game/spawnLayout.ts` computes deterministic FFA spawn slots. Apply the complete layout once after the host knows the full participant roster; do not reposition players incrementally as guests join.
- Transport adapters validate envelopes and byte budgets, establish sender identity from the connection registry, handle backpressure, and isolate malformed peers. Payload-specific protocol validation belongs above the transport abstraction.
- UI components display state and dispatch user intent. They must not create an authoritative world as a side effect of joining a room or render a local single-player fallback inside a multiplayer session.

## No backwards compatibility

This is an active development project. Do not add old-save migrations, dual-schema readers, legacy field/ID aliases, deprecated API shims, compatibility facades, missing-field defaults, or version heuristics. When a contract changes, update all current producers and consumers in one change, bump the persisted/wire schema as applicable, and reject older or malformed artifacts. Required values must be validated, not fabricated. See [`docs/development-policy.md`](docs/development-policy.md).

## File and module organization

- Aim for **300 lines or fewer per source file**, counting imports and comments. When a file grows past that, split it by a stable responsibility (not arbitrary line ranges) and keep each new module independently understandable.
- Do not create one-file-per-trivial-helper by default. Keep small helpers together when they share a single purpose; create a module when it owns a clear contract, lifecycle, data family, or test boundary.
- Keep a barrel only when it is the canonical entry point used by the current architecture. It may be refactored or removed at any time if all in-repository callers are updated together; never retain it solely for old or external callers.
- Split regression suites by behavior or protocol phase and move shared fixtures into a non-test support module. The runner discovers `*.test.ts` recursively, so naming a support file with the `.test.ts` suffix would execute it as a suite.
- A few stateful AI and multiplayer protocol owners still exceed the target. The engine is already separated into inheritance layers, so preserve that shared-state and update-order contract. For other large modules, do not perform a mechanical line-based split: extract one cohesive policy/service with regression coverage before continuing.

See [`docs/repository-structure.md`](docs/repository-structure.md) for the current map and known follow-up candidates.

## Coding rules

- Keep code, comments, diagnostics, and public UI text in English. Keep functions focused and state ownership explicit.
- Prefer one shared validator/policy over slightly different copies in each adapter.
- Never swallow a failed send, cleanup, room transition, or recovery attempt. Expected stale packets may be deduplicated; real protocol and resource failures must remain observable and actionable.
- All peer-provided strings, IDs, message types, payload sizes, sequences, and revisions are untrusted. Validate them at the boundary and keep retries/timeouts bounded.
- Use fixed-step simulation time for gameplay. Wall-clock timers may schedule work, but rendering frequency must not affect authoritative simulation or replication state.
- Add or update a neighbouring `*.test.ts` file for every behavior or protocol change. Prefer state-based waits with finite deadlines over narrow fixed sleeps in asynchronous integration tests.
- Update `docs/release-notes-v*.md` and the relevant architecture/contract document when behavior changes. Keep the root README as an entry point, not a second architecture manual.

## Required local checks

Run these commands from the repository root and retain their exit codes:

```sh
npm install
npm run lint
npm test
npm run build
```

`npm run lint` currently runs the strict TypeScript check; it is not an ESLint invocation. The test runner discovers all `src/**/*.test.ts` suites automatically, transpiles their dependency graph to a temporary directory, and executes them with bounded concurrency and timeouts. The type-check command remains the source of truth for test and production TypeScript diagnostics.

Before publishing, follow the live-network and deployment checklist in [`docs/production-readiness.md`](docs/production-readiness.md). Unit tests cannot prove real PeerJS signalling, ICE negotiation, NAT traversal, mobile browser behavior, or production hosting headers.
