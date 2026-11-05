# Release Notes — 1.8.0

## Core destruction and salvage

- Non-Core structures remain in the world after their owning Core is destroyed.
- Orphaned structures are rendered in grayscale and stop running their building behavior.
- Drones and harvesters whose station becomes inert are deactivated.
- Any commander can dismantle an orphaned structure and receive the existing HP-prorated salvage refund in their own resource wallet.
- Core destruction no longer freezes the simulation, so the remaining commander can still salvage structures.

## Commander AI

- A damaged home Core is repaired before launching an attack objective whenever repair is affordable.
- While the Core is damaged, the AI does not pursue attack goals; it can gather resources or salvage to recover repair materials.
- The AI only repairs operational structures.

## Escort drones

- Escort drones clear stale combat-approach state when a target leaves the commander's leash.
- With no eligible enemy, drones return to continuous orbit around their commander rather than stopping.

## Multiplayer groundwork

- Documented the current boundary: host-authoritative WebRTC transport exists, but separate playable commanders and per-player economies are not yet fully wired into `GameEngine`.
- No TURN support was added.

## Validation

- TypeScript checking passed for the modified game engine, AI, renderer, and regression-test files using the globally available TypeScript compiler.
- Signaling room-code tests passed.
- Full `npm test`, lint, and production build could not be run because npm dependency installation timed out in this environment.
