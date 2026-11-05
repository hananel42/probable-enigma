# Performance Diagnostics

## Browser console

Diagnostics are enabled by default and emit an aggregate report approximately every five seconds while the local authoritative simulation is ticking. The browser console API is exposed as `window.craftboundPerformance`:

```js
window.craftboundPerformance.reportNow();
window.craftboundPerformance.setEnabled(false); // stop timing and performance logs
window.craftboundPerformance.setEnabled(true);  // reset counters and resume
window.craftboundPerformance.isEnabled();
```

`reportNow()` prints and clears the current aggregate window. Re-enabling diagnostics also clears old samples so reports do not combine measurements from before and after a toggle.

## Log meanings

- `[perf] Simulation performance window.`: a five-second summary sorted by total accumulated milliseconds, showing calls, total, average, maximum, and last duration. Only the 18 highest-total stages are printed to keep the console useful.
- `[perf:slow] Expensive operation detected.`: a rate-limited warning when one synchronous stage exceeds 4 ms. `client.renderFrameInterval` uses a 34 ms threshold because a normal 60 Hz frame interval is approximately 16.7 ms and should not be mislabeled as slow work.
- `[perf] Enemy outpost spawned.`: one structured event at each outpost creation with total wall duration and before/after world sizes. It is disabled together with performance telemetry.
- `[simulation clock]`: scheduler-level overload or explicit large-delta caps. `droppedTicksSinceLastDiagnostic`, `maxEngineStepMs`, or `discardedElapsedSeconds` help distinguish slow simulation from slow rendering.
- `[navigation]`: visible path-planning failures. A failed route is not replaced with an unannounced direct path. In a runtime without `Worker`, synchronous A* uses a 650-node expansion limit and emits a warning once.

## Stage index

| Stage | What it isolates |
|---|---|
| `simulation.engineStep`, `simulation.update*` | Authoritative simulation and its major update phases. |
| `ai.drone.update`, `ai.drone.scanHostileTargets`, `ai.drone.kamikaze.scanHostileTargets` | Drone update cost and target acquisition immediately after new enemies appear. |
| `ai.drone.entityIndex`, `ai.drone.buildingIndex`, `ai.drone.resolveHomeCluster` | Lazy indexes and home-centre/connected-building geometry. |
| `drone.pathPlanner.workerSubmit`, `drone.pathPlanner.boundedSynchronousAStar`, `worker.queueWait`, `worker.executionAndReturn` | Main-thread request preparation, bounded non-worker search, queueing, and worker turnaround. |
| `drone.flight.collisionIntegration`, `drone.kamikaze.collisionIntegration`, `ai.drone.embeddedRecovery` | Physical integration and embedded-entity recovery. |
| `enemyBase.generate`, `enemyBase.loadChunks`, `world.generateChunk`, `world.filterChunkResources`, `enemyBase.spawn.total` | Outpost creation, remote chunk creation, resource filtering, and aggregate spawn work. |
| `enemyBase.aiUpdateOne`, `ai.enemyCommander.update` | Per-base and per-commander AI costs after a spawn. |
| `server.captureWorldFrame.serializeClone`, `server.publishState` | Snapshot cloning and listener publication. |
| `client.snapshotRead`, `client.canvasDraw`, `render.*`, `client.renderFrameInterval` | Snapshot access, Canvas stages, rendering phases, and missed-frame intervals. |

## How to capture a useful report

Start a game, leave the developer console open, and note the in-game time around the first enemy outpost (the base-spawn logic starts around 90 seconds). When a hitch occurs, copy the nearest `[perf:slow]`, `[perf] Simulation performance window.`, `[perf] Enemy outpost spawned.`, and `[simulation clock]` entries together. Compare `simulation.updateEnemyBases`, `world.generateChunk`, `enemyBase.loadChunks`, and `server.captureWorldFrame.serializeClone` with `ai.drone.scanHostileTargets` and `ai.enemyCommander.update`.

Instrumentation itself is bounded: normal samples are aggregated, slow warnings are rate-limited per stage, and the report keeps the 18 highest-total stages. Disable telemetry when you no longer need the measurements. Console timing alone cannot prove the absence of stalls; repeat the test with the same world size and browser while watching both frame and simulation timings.
