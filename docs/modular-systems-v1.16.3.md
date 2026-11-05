> **Historical design note:** This document records an earlier architecture stage. For current runtime behavior, follow [Game Architecture](architecture.md), [Multiplayer Runtime Map](multiplayer-runtime-map.md), and [Transport Adapter Contract](transport-adapter-contract.md). Do not treat future-tense transport plans in this document as current behavior.

# Modular building runtime

The generic building runtime owns lifecycle invariants only: destroyed structure cleanup, Core-operational gating, passive repair capability, and dispatching the registered module update. It does not branch on individual building types or built-in behavior kinds.

Active behavior is owned by each building folder: `autoTurret/behavior.ts`, `fireTower/behavior.ts`, `harvesterStation/behavior.ts`, and `droneStation/behavior.ts`. The module receives a shared `BuildingRuntimeContext` containing authoritative world state, entity/projectile spawning, damage, target selection, effects, resource nodes, and state-change notification. The same context is used regardless of whether the structure belongs to a human participant or AI.

The building set is intentionally fixed at compile time: `CORE`, `WALL`, `AUTO_TURRET`, `HARVESTER_STATION`, `DRONE_STATION`, and `FIRE_TOWER`. There is no custom behavior descriptor or runtime plugin API. For changes to an existing building, edit its dedicated module and tests. The static registry in `buildings/registry.ts` maps these known types to their modules; changing the set itself requires a source-code change and rebuild.
