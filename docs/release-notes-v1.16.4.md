# v1.16.4 — Fixed built-in building modules

- Removed the `CUSTOM` building behavior descriptor and its arbitrary ID/config shape. Building types and behavior descriptors are a closed, compile-time set.
- Kept each existing building's definition, simulation behavior, upgrades, inspector, and renderer in its own module folder.
- Kept `engine.ts` and the shared building runtime responsible for shared simulation/lifecycle concerns, not per-building mechanics.
- Rewrote the current module guide and content-maintenance docs to describe the intended architecture: modular source code for maintainers, not runtime extensibility or custom building plugins.
- Added a registry test that asserts the exact built-in building set and rejects custom behavior descriptors.
