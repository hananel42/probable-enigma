# Release Validation — v1.16.43

Validation was run against the source tree packaged in the v1.16.43 drone combat rebalance.

- `npm test`: 290/290 regression tests passed using the globally available TypeScript compiler; no package installation was performed.
- `tsc --noEmit`: not available as a meaningful project typecheck in this workspace because project dependencies and the `@types/node` definitions are not installed.
- Production build: not run.
- Live browser gameplay: not run.

The new regression case verifies impact detonation, hostile splash damage, drone consumption, and zero damage at the three-grid-cell blast boundary.
