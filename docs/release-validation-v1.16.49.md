# Release Validation — v1.16.49

- Simulation regression suite: **306 passed, 0 failed** (`node scripts/test-simulation.mjs`). The runner discovered and transpiled 58 TypeScript regression test files.
- Drone formula tests verify tangential velocity correction, live centre velocity, waypoint attraction, damping, radial spring restoring direction, and per-tick vector velocity updates.
- Mode-transition regression tests cover defensive home centre, live escort centre, target-centred combat, break-off from range/tether, and immediate return to the prior home centre.
- The flight-path tests cover direct open-air movement without worker creation, blocked air corridors, one pending A* request per drone, stale-centre route invalidation, asynchronous worker rejection/retry, collision-aware recovery, and bounded movement. A resource node placed under a flying drone is not treated as a physical barrier.
- Documentation/maintenance check: **passed** (`npm run docs:check`): 117 Markdown files scanned, four skill playbooks indexed, version consistency verified, and relative links checked.
- Full project typecheck and production bundle were not run; this archive does not include installed `node_modules`, and the earlier typecheck attempt stopped before checking application source because `@types/node` was unavailable.
- Live browser rendering and real peer-to-peer/network connectivity were not tested. In-memory simulation tests do not prove WebRTC/ICE connectivity.
