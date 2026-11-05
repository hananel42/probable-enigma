# v1.16.39 — Release validation record

## Automated validation results

- `npm test`: **passed — 272 tests, 0 failures, 0 skipped**.
- Focused strict TypeScript check for `src/game/ai/commanderAI.ts` and `src/game/ai/commanderAI.test.ts`: **passed**.
- Test transpilation: **passed** for all discovered regression suites.
- `npm run lint`: **blocked** by `TS2688: Cannot find type definition file for 'node'`. This archive does not contain installed `node_modules`, so the configured `@types/node` package is unavailable.
- `npm run build`: **blocked** by the same TypeScript setup error before Vite starts. No production bundle was generated.
- Live browser gameplay: **not performed** in this environment.

## Manual regression to verify in a browser

1. Start a match with enemy commanders and damage one enemy Core so the AI must gather resources for a repair.
2. Observe the commander mining a nearby resource deposit. It should complete an extraction, the deposit amount should decrease, and the enemy base's resource wallet should increase.
3. Deplete or remove its current target. The commander should abandon the old target and select another reachable deposit when one is available.
4. Place a hostile unit near the damaged Core. The commander must still interrupt mining to defend the Core according to the existing emergency priorities.

## Reproducible release checks

In a network-enabled development environment, install dependencies (`npm install` and commit the generated lockfile), then run `npm ci`, `npm run lint`, `npm test`, and `npm run build`. Do not treat the missing-dependency failures above as a successful lint or build.
