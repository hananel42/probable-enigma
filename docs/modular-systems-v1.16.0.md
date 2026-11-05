> **Historical design note:** This document records an earlier architecture stage. For current runtime behavior, follow [Game Architecture](architecture.md), [Multiplayer Runtime Map](multiplayer-runtime-map.md), and [Transport Adapter Contract](transport-adapter-contract.md). Do not treat future-tense transport plans in this document as current behavior.

# v1.16.0 — Modular gameplay systems

## Design goals

- Behavior and content data are separate: tune a rule in a definition file without editing the simulation loop.
- Engine systems depend on narrow interfaces and plain data, not React, Canvas, or a specific network technology.
- Every new behavior should have a focused unit test plus at least one engine-level regression test when it affects simulation.

## Buffs and status effects

The status-effect runtime lives in `src/game/statusEffects/buffSystem.ts`; data-only definitions live in `buffDefinitions.ts`.

To add a buff:

1. Add an entry to `BUFF_DEFINITIONS` with a unique ID and duration.
2. Include only the fields it needs: `healthPerSecond` (positive heals, negative damages), any of `healthMultiplier`, `speedMultiplier`, `powerMultiplier`, `fireRateMultiplier`, and/or `effect` visual settings.
3. Choose `reapply`: `REFRESH`, `EXTEND`, `STRONGEST`, or `STACK`.
4. Add focused tests for its duration, reapplication, modifier and effect behavior.

Effects use seconds. The runtime rejects invalid/non-positive durations, bounds multiplier values, applies health changes through the normal damage path, proportionally adjusts current and maximum health for health-multiplier changes, and clears buffs on lethal commander damage. Particle generation is capped by the engine's existing particle budget. At v1.16.0, legacy entity-level `burnDuration` fields were migrated once. That historical migration has since been removed: the current v3 world-save schema rejects older snapshots and no longer stores entity-level burn fields.

Example:

```ts
const haste: BuffDefinition = {
  id: 'haste', name: 'Haste', durationSeconds: 4,
  modifiers: { speedMultiplier: 1.25, fireRateMultiplier: 1.1 },
  effect: { particleColor: '#a3e635', particleRate: 3, markerColor: '#bef264', markerShape: 'ring' },
  reapply: 'REFRESH'
};
applyBuff(entity, haste);
```

## Multiplayer transport boundary

`src/game/multiplayer/transport.ts` defines `GameDataTransport`, the minimal interface used by `RemoteGameClientPort`: `sendData` and `subscribeData`. The current `SignalingClient` implements it using the WebSocket relay. A future `WebRTCDataChannelTransport` can implement the same interface; game commands, snapshots and `RemoteGameClientPort` should not import or branch on WebSocket/WebRTC details.

Room creation/joining and server-relay membership still belong to `SignalingClient`. To switch the data plane later, keep the signaling socket for room discovery and peer negotiation, but inject a separate `GameDataTransport` into the remote port. This avoids rewriting simulation commands or frame projection.

## Other extension points

- Building data/behavior/rendering: `src/game/buildings/<building>/` and `src/game/buildings/registry.ts`.
- Upgrades: `src/game/upgrades/` and each building's `upgrades.ts`.
- Combat rules: `src/game/combat.ts`.
- Multiplayer rules: `src/game/multiplayer/modeRules.ts`.
- Simulation orchestration: `src/game/engine.ts`; keep new content rules outside this file whenever possible.
