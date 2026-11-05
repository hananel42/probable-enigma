# v1.16.33 — Release validation record

Validation date: 2026-10-27. Environment: Node.js v22.16.0, npm 10.9.2, Linux container. The repository was tested from the extracted project tree; no `node_modules/` or npm lockfile was present.

## Automated commands

| Command | Result | Evidence / limitation |
|---|---|---|
| `npm test` | **PASS** | Exit code 0. Automatically discovered 30 TypeScript test files. **249 passed, 0 failed, 0 skipped**. Node test-runner duration: 26.1 seconds; compilation plus setup took longer. |
| `npm run lint` | **BLOCKED** (exit 2) | `tsc --noEmit` stopped with `TS2688: Cannot find type definition file for 'node'`. The required `@types/node` package is not installed. A full project type-check was therefore not completed. |
| `npm run build` | **BLOCKED** (exit 2) | The configured build runs `npm run typecheck && vite build`; it stopped at the same `TS2688` error. Vite did **not** run and no successful production bundle is claimed. |
| `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000` | **UNAVAILABLE** | The isolated environment could not resolve `registry.npmjs.org` (`EAI_AGAIN` / DNS resolution failure). No lockfile was fabricated. |

The test runner uses TypeScript's `--noCheck` mode only to transpile the test dependency graph efficiently. The test assertions do execute, but this is not a substitute for the strict type-check required by `npm run lint`.

## Additional checks

- `node --check scripts/test-simulation.mjs`: passed.
- The ZIP was checked with `unzip -t` after packaging.
- A live two-browser PeerJS/WebRTC test was not performed in this environment.

## Release decision

**Not yet production-validated.** The automated regression suite passes, but release approval still requires generating and committing `package-lock.json` in a network-enabled checkout, then running `npm ci`, `npm run lint`, `npm test`, and `npm run build` successfully. Finally, follow the real-browser network checklist in [`production-readiness.md`](production-readiness.md) from two separate browser profiles on different network paths.
