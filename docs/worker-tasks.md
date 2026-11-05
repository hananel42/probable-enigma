# Asynchronous Worker Tasks

## Purpose

`src/game/runtime/workerTaskScheduler.ts` is the shared off-main-thread task layer. Register a task kind once, provide its module-worker factory, and submit data-only snapshots with a priority. The scheduler creates workers lazily and caps concurrency per task kind (1–8 workers).

## Priorities

- `critical`: work needed soon for immediate gameplay decisions.
- `normal`: routine pathfinding or planning work.
- `background`: optional analysis, precomputation, or diagnostics.

Queued jobs are dispatched by priority, preserving submission order within the same priority. A busy pool can queue tasks without blocking the game loop.

## Worker contract

Messages use `WorkerTaskRequest<T>` and `WorkerTaskResponse<R>` from `workerProtocol.ts`. Each result must echo the `id` and `type` of its request. Return a serializable `result`, or an `error` string. Payloads should contain only structured-cloneable values: do not pass engine instances, DOM nodes, Canvas objects, functions, or mutable state references.

## Adding a worker task

1. Define the serializable payload/result in a small module shared with the worker through type-only imports.
2. Add a dedicated module worker that handles its task type and echoes the request id/type.
3. Register the task type in the runtime with a factory and concurrency cap.
4. Submit from the main-thread controller using an explicit priority.
5. Never `await` the result inside `GameEngine.step()`. Keep simulating and apply the result only if its request/entity version is still current.
6. Add tests for queue priority, malformed results, cancellation/staleness, unavailable Worker API behavior, and explicit failure propagation.

`requestPathInWorker` currently uses the scheduler with a two-worker cap. If the Worker API itself is unavailable, it returns `null`, and the deterministic synchronous A* path is used in that explicitly non-worker environment. A Worker constructor, message, protocol, or runtime failure is not treated as API unavailability: it is logged and surfaced as a rejection, and the app's runtime error handler stops normal simulation/rendering. Never retry a failed worker task via a hidden synchronous fallback.

## Current boundary and future work

Only pathfinding is offloaded today; the whole simulation still runs on the main thread. Moving `GameEngine` into a dedicated worker later will require separating browser audio from AI/rules, deciding whether visual particles belong in the authoritative state, introducing serializable snapshots/commands, and testing deterministic handling of user input. The scheduler is the reusable asynchronous foundation, not a claim that the full engine already runs in a Worker.
