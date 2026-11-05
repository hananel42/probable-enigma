# Release Validation — v1.16.42

Validation was run against the source tree packaged in the v1.16.42 drone movement fix.

## Commands and results

| Check | Result |
|---|---|
| `npm test` | Passed: 289 tests, 0 failures, 0 skipped. |
| Focused strict TypeScript check for the drone/pathfinding changes | Passed for `src/game/ai/droneAI.ts`, `src/game/movement.ts`, `src/game/rules.test.ts`, and their imported dependency graph using the available compiler and an isolated type-root directory. |
| `npm run typecheck` | Blocked by `TS2688`: cannot find type definition file for `node`. |
| `npm run lint` | Not run separately; it aliases `npm run typecheck` and would encounter the same missing type package. |
| `npm run build` | Not run; it starts with the same blocked typecheck and would not reach Vite. |
| Live browser/Web Worker test | Not performed in this environment. |
| ZIP integrity | Verified after packaging. |

No npm installation was attempted. The archive does not include installed `node_modules` or a lockfile. Run `npm install`, commit the generated lockfile, then `npm ci` and `npm run check` in a network-enabled development environment before production release.
