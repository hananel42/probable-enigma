# AI Agent Instructions

Before editing this repository, read [`docs/development-policy.md`](docs/development-policy.md) and follow its strict no-backwards-compatibility rule. Then read [`skills/README.md`](skills/README.md) and choose the playbook that matches the files being changed. Read the current architecture/contract document linked by that playbook; for local save changes also read `docs/world-persistence.md`; do not rely on historical release notes as the current design.

## Required workflow

1. Map the behavior to its authoritative owner before editing. Keep UI, simulation, transport, and protocol responsibilities separate.
2. Inspect the existing implementation and neighboring tests. Preserve only current architectural invariants and update order; do not preserve obsolete APIs, fields, formats, or paths for compatibility.
3. Make the smallest cohesive change that improves correctness. Avoid speculative rewrites and mechanical line-based splitting.
4. Add regression tests for the behavior and its important edge cases. Run `npm test` and `npm run docs:check`; run `npm run lint` and `npm run build` only in an environment with project dependencies installed.
5. Update the canonical contract/architecture doc and release notes whenever behavior or ownership changes. Update the current validation record with only checks actually run.
6. Before finishing, verify links, current version references, and the skills index with `npm run docs:check`.

## Development compatibility policy

This project is under active development and has no backwards-compatibility commitments. Never add migrations, old-schema readers, legacy aliases/facades, dual-shape parsers, guessed defaults, or protocol fallbacks for previous versions. Change the canonical contract and all in-repository producers, consumers, validators, and fixtures together; bump persisted/wire versions and reject old versions. See [`docs/development-policy.md`](docs/development-policy.md).

## Skills self-maintenance

The `skills/` directory is part of the maintained product documentation, not disposable prompt text. When architecture, file ownership, testing commands, protocol behavior, or release workflow changes, update the relevant playbook and `skills/README.md` in the same change. Add new playbooks to the index. Remove obsolete instructions instead of layering contradictory advice. The `scripts/check-maintenance-docs.mjs` script enforces skill front matter, index coverage, canonical version consistency, internal Markdown links, and selected known-stale runtime claims. Extend that checker when adding a new documentation invariant.
