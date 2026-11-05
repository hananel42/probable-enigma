# v1.16.34 — Release validation record

Validation date: 2026-10-27. Environment: Node.js v22.16.0, npm 10.9.2, Linux container. No `node_modules/` or committed npm lockfile was present.

## Automated commands

| Command | Result | Evidence / limitation |
|---|---|---|
| `node --check scripts/test-simulation.mjs` | **PASS** | Test-runner script parses successfully. |
| `npm test` | **PASS** | Exit code 0. Automatically discovered 30 TypeScript regression suites. **249 passed, 0 failed, 0 skipped**. Node test-runner duration was 32.7 seconds; the overall command also performs test-graph transpilation and setup. |
| `npm run lint` | **BLOCKED** (exit 2) | `tsc --noEmit` reported `TS2688: Cannot find type definition file for 'node'`. The required `@types/node` package is listed in `devDependencies` but is not installed. A full semantic type-check is therefore not complete. |
| `npm run build` | **BLOCKED** (exit 2) | The configured build stops at the same `TS2688` type-check error. Vite did **not** run and no successful production bundle is claimed. |
| npm lockfile generation | **UNAVAILABLE** | A previous attempt to access `registry.npmjs.org` failed with `EAI_AGAIN` / DNS resolution failure. No lockfile was fabricated. |

The 249-test result is from the completed `npm test` process; the report does not treat the type-only transpilation step as a semantic type-check. `npm run lint` remains authoritative for project TypeScript diagnostics.

## Additional limits

- The ZIP is checked with `unzip -t` after packaging.
- A live two-browser PeerJS/WebRTC test was not performed. Automated tests cannot prove real signaling, ICE negotiation, NAT traversal, or browser rendering.

## Release decision

**Not yet production-validated.** The regression suite passes, but dependency installation, strict type-checking, production bundle creation, and real-network verification remain release blockers. In a network-enabled checkout, generate and commit `package-lock.json`, then run `npm ci`, `npm run check`, and the two-browser checklist in [Production Readiness](production-readiness.md).
