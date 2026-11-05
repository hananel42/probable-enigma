---
name: project-architecture
description: Use for cross-cutting refactors, choosing module ownership, or understanding the application-to-simulation dependency direction.
---
# Project Architecture Playbook

## Read first

- [`docs/architecture.md`](../../docs/architecture.md)
- [`docs/repository-structure.md`](../../docs/repository-structure.md)
- [`CONTRIBUTING.md`](../../CONTRIBUTING.md)

## System boundaries

- `src/app/` and `src/components/`: React composition and presentation. Dispatch user intent; do not implement authoritative game rules.
- `src/game/engine.ts` and `src/game/engine/`: current simulation entry point and deterministic gameplay orchestration. Preserve only active ownership and layer/update-order contracts.
- `src/game/server/LocalGameServer.ts`: fixed-step authority, command admission, session sequencing, world-frame publication.
- `src/game/ai/`, `movement/`, `rules/`, `buildings/`, `upgrades/`: policy, movement, shared rules, building-owned behavior, and typed effects.
- `src/game/multiplayer/`: host/guest protocol, replication, and PeerJS connection ownership. Read the multiplayer playbook before touching it.
- `src/game/client/` and `src/game/drawers/`: rendering and input mapping. `playerPresentation.ts` owns participant-derived Core markers and local alliance presentation policy; `playerBaseHUDIndicators.ts` draws those targets in screen space and the Canvas renderer invokes it. Human faction is not sufficient to determine whether a human player is hostile in FFA. Visual outcomes must not become gameplay authority.
- `src/game/runtime/`: bounded async tasks and worker protocols; pass cloneable data, never live mutable engine instances.

## Refactoring rules

The project is in active development and has no backwards-compatibility commitments. Do not preserve an old API, field, identifier, schema, or module path for historical callers. Follow [`docs/development-policy.md`](../../docs/development-policy.md).

1. Trace the call path and data ownership before extracting code. Search imports and tests, not only the target file.
2. Keep dependencies pointing toward lower-level contracts: simulation must not import React, DOM rendering, or PeerJS.
3. Keep only entry points required by current in-repository callers. Refactor or remove obsolete facades directly; update every current import in the same change and do not retain compatibility shims.
4. Split by cohesive behavior or lifecycle boundary. The 300-line target is a warning, not a reason to create trivial modules or alter behavior mechanically.
5. Keep shared state ownership explicit. Inheritance-based engine/AI layers may depend on ordering; inspect all overrides before moving a method.
6. Add tests before or with a refactor and compare behavior at boundary conditions.

## Completion checklist

- [ ] Ownership boundary remains clear and lower layers have no new UI/transport dependency.
- [ ] Every current in-repository import uses the canonical contract; obsolete imports and shims are removed.
- [ ] Tests cover the changed contract and edge cases.
- [ ] Architecture map and the relevant skill are updated if ownership changed.
- [ ] `npm run docs:check` passes.
