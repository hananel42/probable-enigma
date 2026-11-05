# v1.16.40 — Diamond-Gated Progression and Modular Combat Upgrades

## Economy and Core progression

- Added Diamonds to the resource wallet and HUD. A Diamond is awarded only when a hostile Commander Core is destroyed; the authoritative engine tracks Core IDs and rewards the lethal hit once. Diamonds cannot be mined, collected from ordinary buildings, or obtained through dismantling.
- Reserved Diamonds for Core upgrades. The cost resolver requires at least one Diamond for every Core upgrade and rejects Diamond costs on non-Core buildings.
- Added four staged Core choice tiers. Early choices focus on Core durability, Commander movement, mining speed and mining yield. Commander damage, fire rate, and weapon range appear only at Core levels 4 and 5. Each option has a Wood/Stone cost, trade-off, stable ID, and English description.
- Core maximum-HP upgrades increase capacity without acting as a free repair. Commander-only Core upgrades modify the living Commander through the shared stat-effect interpreter.

## Modular building upgrades

- Defined four cumulative Auto-Turret choice tiers: range vs damage, twin shots vs bounded homing, high-velocity vs explosive payloads, and rapid cycling vs heavier armor. Different choices can be combined across tiers; upgrade history remains serialized by stable option IDs.
- Preserved unupgraded Commander/Turret weapon parity at 30 damage, 0.18-second interval, 360 range, and 450 projectile speed. The turret has 280 HP versus the Commander's 150 HP. Compared with the previous baseline, turret range increased from 220 to 360 so it can respond to long-range Commander fire. Enemy AI now prioritizes the long-barrel range upgrade to make hostile defenses harder to kite.
- Renamed the public building label to **Effect Tower** while retaining the serialized `FIRE_TOWER` type for snapshot compatibility. The existing effect registry supports Burning, Cryogenic Slow, Signal Suppression, Weakened Shots, Radio Jamming, and Corrosion; upgrade combinations can add several modes without hard-coded combination branches.
- Added composable Wall branches for extra HP, damage reduction, projectile reflection, self-repair, and mixed fortification. Reflected projectiles inherit the wall's team and alliance, reverse direction, receive a bounded return range, and continue through the shared damage path.
- Fixed the High-Velocity Rounds drawing ID mismatch so the correct cyan projectile module is rendered. Added distinct procedural Core visuals for all eight Core upgrade choices, plus visible copper coils for Flashover, faster pulse animation for Rapid Wave, and outer spectral rings for Wide-Spectrum Effect Towers.
- Kept Drone Station and Harvester Station upgrade trees unchanged.

## Architecture and validation

- Added `docs/progression-and-upgrades.md` as the reference for economy invariants, exact choice tiers and costs, effect behavior, renderer cues, and how to extend the system.
- Added regression coverage for upgrade ID uniqueness, names/descriptions/cost validity, Core visual cues, each Auto-Turret upgrade's visual cue, and the enemy AI's preference for the range branch.
- The shared `BuildingUpgradeEffect` interpreter remains responsible for numeric effects and clamping. Building-owned modules continue to own upgrade data, rendering and live stat inspection; new combinations do not require new per-combination engine branches.
- No package installation was attempted for this release.

## Validation

See [`release-validation-v1.16.40.md`](release-validation-v1.16.40.md) for exact test results and the focused TypeScript check. Full `npm run lint`/production build and live-browser gameplay should be run by the release integrator after dependencies are installed.
