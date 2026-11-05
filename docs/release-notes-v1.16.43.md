# Release Notes — v1.16.43

## Drone combat rebalance

- Reduced combat drone weapon range from 390 world units to 2.8 grid cells (about 134 world units).
- Increased standard drone shot damage from 20 to 32 before station upgrades, making the short firing window more meaningful.
- Drones at or below 20% HP commit to a one-way kamikaze run against the nearest hostile entity or structure.
- On impact, the drone deals up to 220 splash damage, scaled by its station damage multiplier. The blast radius is exactly three grid cells (144 world units); quadratic falloff sharply reduces damage with distance and reaches zero at the edge.
- Splash damage affects hostile entities and structures only. The drone is consumed on detonation.
- Effect Tower mechanics were intentionally left unchanged.

## Validation

- Regression suite: 290 tests passed.
- Full typecheck/build and live browser testing were not run because project dependencies are not installed in this workspace.
