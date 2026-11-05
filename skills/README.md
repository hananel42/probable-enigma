# Project Skills Index

This directory contains repository-specific playbooks for AI coding agents. They describe current ownership and maintenance rules; they are not substitutes for the source code, tests, or canonical architecture contracts.

## Required reading

- [`../docs/development-policy.md`](../docs/development-policy.md) — mandatory no-backwards-compatibility rule for every code and data-contract change.

- [`project-architecture/SKILL.md`](project-architecture/SKILL.md) — read before cross-cutting refactors or when ownership is unclear.
- [`gameplay-ai/SKILL.md`](gameplay-ai/SKILL.md) — read for commander, drone, harvester, movement, combat, and balancing changes.
- [`multiplayer-protocol/SKILL.md`](multiplayer-protocol/SKILL.md) — read for rooms, host authority, WebRTC, messages, snapshots, synchronization, and cleanup.
- [`testing-and-docs/SKILL.md`](testing-and-docs/SKILL.md) — read for regression strategy, documentation, release validation, and self-maintenance.
- [`world-persistence/SKILL.md`](world-persistence/SKILL.md) — read for world saves, IndexedDB, autosave lifecycle, restore invariants, and import/export validation.

## Selection rules

1. Read `AGENTS.md` first, then this index.
2. Read the playbook matching the touched subsystem and its linked canonical contract.
3. For a change spanning multiple subsystems, read every relevant playbook; do not choose one and ignore the others.
4. Current runtime contracts in `docs/architecture.md`, `docs/world-persistence.md`, `docs/multiplayer-runtime-map.md`, `docs/transport-adapter-contract.md`, and `CONTRIBUTING.md` take precedence over historical design notes.

## How this directory maintains itself

- Every `skills/*/SKILL.md` file must have `name` and `description` front matter and be linked from this index.
- When a playbook is added, renamed, split, or removed, update this index and the root `AGENTS.md` if routing rules change.
- When code ownership or a contract changes, update the affected playbook in the same change.
- Run `npm run docs:check` after any documentation or skill change. The checker validates Markdown links, current version metadata, skill index coverage, and selected stale claims.
- Keep instructions actionable and specific. Avoid duplicating whole architecture documents; link to the canonical contract and summarize only the decisions an agent must preserve.
