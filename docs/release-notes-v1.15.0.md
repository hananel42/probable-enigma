# Craftbound Survival v1.15.0 — Multiplayer Rules and Commander Lifecycle

## Engine fixes

- Enemy outposts now remove their commander and dependent units as soon as their Core is destroyed. Surviving structures remain in the world as inert, salvageable structures.
- Remote participant movement keys are written directly into that participant's persistent input state, avoiding loss during scoped command-context restoration.
- Team mode no longer grants interaction access to another player's structures. Cooperative mode remains the only mode with shared structure access.
- Allied players other than the locally viewed player's own group render in green; the local player's own group keeps its faction color.
- Updated regression tests to cover commander removal, remote movement key persistence, and exclusive Team-mode structure control.

## Multiplayer mode contract

- **Free-for-all:** participants have distinct teams/alliances and can damage one another; enemies remain hostile to every participant.
- **Cooperative:** one shared Core and shared structure access, while each participant keeps an independent resource ledger.
- **Team:** each participant owns a separate Core and structures; teammates are non-hostile and render green, shots pass through teammates and their structures, and structures owned by other players cannot be repaired, upgraded, toggled, or dismantled by the local player.

## Verification

- `node scripts/test-simulation.mjs`: 101 tests passed.
- This test runner compiles only the simulation modules and tests, without installing React/Vite/Tailwind. It requires a TypeScript compiler (`typescript` in the project or `tsc` on PATH).
- Browser-based two-client multiplayer and full production build were not run in this change.
