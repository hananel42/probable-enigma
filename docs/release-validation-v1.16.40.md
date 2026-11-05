# v1.16.40 — Release validation record

## Checks run in this workspace

- `node scripts/test-simulation.mjs`: **passed — 285 tests, 0 failures, 0 skipped**. The runner discovered every `src/**/*.test.ts` regression suite and ran them serially with bounded per-test timeouts.
- Focused strict TypeScript check for the changed procedural drawing modules:
  `tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck --strict src/game/buildings/core/draw.ts src/game/buildings/autoTurret/draw.ts src/game/buildings/fireTower/draw.ts`: **passed**.
- The test suite includes checks for one Diamond per hostile Core, Diamond-only Core upgrade costs, utility-first Core progression, weapon baseline parity, explosion/reflect behavior, tower debuffs, stable upgrade identifiers/descriptions/costs, Core visual profiles, Auto-Turret visual profiles, and hostile AI range-upgrade preference.
- `npm run lint` and `npm run build`: **not run for this archive**. No dependency installation was attempted at the user's request; this workspace has no `node_modules` or lockfile. The release integrator should run the full checks after installing dependencies and reviewing the generated lockfile.
- Live browser/network gameplay: **not performed**. In-memory tests cannot verify real Canvas rendering, a complete match balance pass, or WebRTC behavior.

## Manual playtest checklist

1. Destroy one enemy Core with a direct projectile and verify exactly `+1 DIAMOND`; damage to the same destroyed Core, a normal building, or an allied Core must not grant another Diamond.
2. Attempt a Core upgrade without a Diamond: the purchase must be denied without consuming Wood/Stone. Complete one with a Diamond and verify the Diamond and materials are deducted.
3. Confirm the opening Core options are Reinforced Matrix / Mining Accelerator, followed by Efficient Extraction / Swift Frame. Weapon options must not be offered until Core level 4.
4. Use a turret range build path (Long-Barrel Optics → Guided Rounds → Explosive Ordnance) and a different path (Overcharged Rounds → Twin-Barrel Assembly → High-Velocity Rounds) to confirm cumulative choices, effects, costs, and procedural rendering.
5. Fire at a Wall with Reactive Armor/Mirror Weave installed. Confirm reflected projectiles change owner to the wall team, can damage a hostile attacker, and never damage an allied target.
6. Combine Effect Tower modes and verify the chosen mode IDs, pulse interval/radius, and status-effect durations shown by the inspector match the selected upgrades.
7. Verify hostile turrets pursue the range branch when the AI upgrades at level 2, and test whether the increase to 360-unit baseline range plus the 35% Long-Barrel upgrade prevents easy long-range kiting in a real match.

## Known release limitations

- `npm ci` cannot be used until a real `package-lock.json` is generated and committed in a network-enabled environment. Do not commit a partial lockfile.
- Build output and browser smoke tests remain an integration responsibility; do not treat the passing in-memory suite as proof of a production bundle.
