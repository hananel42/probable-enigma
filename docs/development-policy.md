# Development Policy: No Backward Compatibility

Craftbound is actively under development. The codebase, local save format, multiplayer wire protocol, identifiers, module layout, and internal APIs are allowed to change directly. **Backward compatibility is not a project requirement.**

## Prohibited compatibility work

Do not add or retain code solely to support an older version, older data shape, previous field name, previous identifier, previous import path, or previous protocol revision. This includes:

- Save-file or IndexedDB migrations, dual-version readers, old-schema parsers, and version-specific data conversion.
- Legacy aliases, forwarding facades, adapters, deprecated fields, or duplicate representations kept only for old callers.
- Missing-field defaults, guessed values, timestamp/order heuristics, or synthetic objects that make obsolete snapshots or messages appear valid.
- Conditional branches that preserve old command, entity, building, resource, projectile, or multiplayer message shapes.
- Keeping old upgrade IDs or serialized building IDs just because earlier development artifacts used them.

Do not add a fallback and label it "temporary" or "defensive" when its actual purpose is to keep obsolete data or callers working. Archived release notes may describe compatibility code that existed at the time; that text is historical evidence, not a current requirement. Remove obsolete code and update all current producers, consumers, tests, and documentation together.

## Required approach for a breaking change

1. Change the canonical type or protocol definition directly.
2. Update every producer, consumer, UI projection, serializer, validator, and test fixture in the same change.
3. If the persisted or network contract changes, increment its schema/protocol version and accept only the exact current version. Reject older or malformed data with a clear error; do not migrate it.
4. Remove superseded fields, aliases, adapters, comments, tests, and documentation that no longer describe current behavior.
5. Update the package version, current architecture/contract documentation, release notes, and validation record.
6. Fail fast when a required current invariant is missing. Never conceal a broken invariant by fabricating a value.

## What is not a compatibility fallback

A fallback that is part of the current, explicitly designed gameplay or runtime behavior is not automatically a backward-compatibility layer. Examples include obstacle-aware route replanning, preserving established direct peer connections while signalling retries, retaining shared CO-OP world assets after one participant disconnects, or projecting a defeated player’s intentionally removed Commander as a HUD-only tombstone. Such behavior must serve a current contract, be documented and tested, and must not parse or preserve an obsolete format/API. Do not broaden these examples into generic defaulting or silent recovery.

## Canonical modules and refactoring

A currently used barrel or adapter may remain when it is the canonical entry point for the current architecture. It is not a promise of API stability: refactors may change or remove it, provided all in-repository callers are updated in the same change. Never preserve a module path, export, or facade solely for external or historical consumers.
