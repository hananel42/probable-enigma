# Release Notes — v1.16.51

## Collision safety and explicit failures

- Introduced bounded substepped collision integration for drone flight, kamikaze flight, smooth movement, and path following. Each collision segment is at most one-quarter grid cell. An unsafe request over 64 substeps fails with an explicit `RangeError` before mutating the entity rather than skipping obstacles or teleporting.
- Strengthened finite-state checks for drone simulation deltas, positions/velocities, home-centre values, path timers, retry delays, kamikaze targets, target collision radii, and damage values. A non-DRONE_STATION behavior contract now throws rather than returning silently.
- Validated A* worker route payloads and fixed a silent failure path where a thrown route-processing error could reach a `.catch` after the request lock had already been deleted and be ignored.
- Kept worker failures visible and bounded; the explicit non-Worker test/runtime path warns once and caps synchronous drone A* at 650 expanded nodes. Worker runtime failures never silently switch execution back to the main thread.

## Performance monitoring

- Added five-second aggregate performance windows and rate-limited `[perf:slow]` warnings, with instrumentation for simulation stages, enemy commander/drone/harvester AI, target acquisition, defence alerts, embedded recovery, A* preparation and worker latency, chunk generation/resource filtering, enemy outpost generation/loading/pruning/total, snapshot serialization/publication, and Canvas rendering.
- A newly generated outpost reports its generation and world counts. The existing simulation-clock overload warning records dropped ticks, while a deliberate large-delta cap now has an explicit warning and duration metric.
- Browser console controls: `window.craftboundPerformance.reportNow()`, `window.craftboundPerformance.setEnabled(false)`, `window.craftboundPerformance.setEnabled(true)`.
- Added regression tests for collision tunnelling, oversized integration rejection, invalid acceleration input, and diagnostic reporting behavior.
