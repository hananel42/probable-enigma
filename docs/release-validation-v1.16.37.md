# v1.16.37 — Release validation record

## Automated tests

| Check | Result | Details |
|---|---|---|
| `npm test` | PASS | 264 tests passed; 0 failed, 0 skipped. Test runner discovered and transpiled 33 regression suites. |
| TypeScript/TSX syntax transpilation | PASS | All 154 non-declaration `.ts`/`.tsx` source files transpiled without syntax diagnostics using the installed global TypeScript compiler. |
| Targeted strict game type-check | PASS | The changed spawn layout, engine, authoritative local server, building neighborhood index, drawing module, and Canvas renderer passed strict TypeScript checking. |
| Targeted strict guidance-model type-check | PASS | Guidance types, progress persistence, step navigation, spawn layout, and building-neighborhood model passed strict TypeScript checking. |
| `npm run lint` | BLOCKED | `tsc --noEmit` exits with `TS2688: Cannot find type definition file for 'node'` because `node_modules/@types/node` is not installed. |
| `npm run build` | BLOCKED | The build script runs type-checking first and stops at the same missing `@types/node` error; Vite does not run. |
| `npm install --package-lock-only --ignore-scripts --fetch-retries=0 --fetch-timeout=8000` | INCOMPLETE | The command did not complete within the execution window. No partial `package-lock.json` is included. |
| Live browser/WebRTC verification | NOT RUN | This environment did not run two real browsers through signaling, ICE negotiation, and interactive rendering. |

## Feature-specific coverage

- Eight-player FFA placement checks spacing, Core/Commander proximity, resource/Core overlap, and initial host camera position.
- Single-player FFA retains its central opening; TEAM does not use the FFA ring.
- Building neighborhood tests cover four cardinal directions, multiple neighbors touching one edge, duplicate removal, destroyed structures, diagonal exclusion, and renderer-context delivery.
- Guidance tests cover guide/version-scoped persistence, resume behavior, malformed saved progress, unique/non-empty guide definitions, and navigation boundaries.

## Reproducible release steps

This source archive intentionally does not claim a complete production build. In a network-enabled environment:

1. Run `npm install` to install the declared dependencies and generate `package-lock.json`.
2. Review and commit the lockfile with the source.
3. Run `npm ci` followed by `npm run check`.
4. Complete the two-browser multiplayer and responsive onboarding checks described in `docs/production-readiness.md`.

No `lint`, production build, or live WebRTC result is marked as passed unless that command/test has actually completed successfully.
