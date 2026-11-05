# v1.16.33 — Shared transport validation and production maintenance

## Transport safety and ownership

- Added `peerMessageEnvelope.ts` as the single owner of plain-object envelope checks, bounded message types, UTF-8 JSON-envelope size validation, and transport-derived sender identity. PeerJS BinaryPack and the text-based RTCDataChannel adapter retain distinct wire formats and size ceilings.
- Outbound messages are checked before fan-out, preventing a malformed or oversized state from reaching only a subset of peers. Inbound parse/validation failures and protocol-listener exceptions are logged and isolate the affected WebRTC peer instead of escaping a DOM event callback.
- PeerJS internal trace logging is enabled only in Vite development builds. Application-owned warnings and failures remain visible in production.

## Simulation and project hygiene

- Simulation overload reporting now coalesces repetitive tick-drop warnings into a five-second diagnostic window while reporting both interval and cumulative dropped-tick counts. Persistent overload remains observable without generating one warning per scheduler callback.
- The engine regression runner discovers `*.test.ts` automatically, runs suites serially to avoid cross-suite simulation-clock contention, applies per-test and whole-process timeouts, and reports the number of test files. It uses TypeScript `--noCheck` only for test transpilation; `npm run lint` remains the required strict project type-check. Newly added tests cannot be omitted merely because a static array was not updated.
- Added regression coverage for shared message-envelope validation, transport-derived sender identity, UTF-8 byte limits, non-JSON values, per-peer malformed-data isolation, and rate-limited simulation-overload diagnostics. The recorded run passed all 249 assertions/tests in the Node test runner.
- Tightened TypeScript casing/override checks, added repository/editor defaults, documented production deployment and live-network verification requirements, and shortened the root README to a current entry point with a documentation index.
- The Vite development/preview servers bind to loopback by default. The viewport no longer blocks browser zoom.

## Validation limits

The exact commands and outcomes for this archive are recorded in `release-validation-v1.16.33.md`. A clean production build and real two-browser WebRTC validation are only reported as passing when executed successfully. The project has no committed npm lockfile in this environment; a lockfile must be generated and committed from a network-enabled checkout before a production release is considered reproducible.
