# v1.16.36 — Release validation record

## Changes under test

This release fixes the client teardown path when the host returns a world to the room: renderer stop must not send gameplay commands into a cleared guest replica, non-playable guest command attempts are rejected normally, local subscriber exceptions cannot become peer-protocol failures, and React cleanup errors are reported without an uncaught `AggregateError`.

## Commands run

- `npm test` — **passed: 255 tests, 0 failures, 0 skipped**.
- Targeted strict TypeScript check of the changed multiplayer/client/lifecycle implementation and regression tests — **passed**.
- `npm run lint` — **blocked** before full-project type-checking because `@types/node` is not installed in this workspace (`TS2688`).
- `npm run build` — not expected to pass until dependencies are installed; build script runs the same typecheck before Vite.
- Live two-browser WebRTC validation — **not run** in this environment.

## Environment limitations

The supplied archive has no `node_modules` directory and does not include a package lockfile. The test runner uses the available system TypeScript compiler with `--noCheck` to transpile tests and then runs the full Node test suite. This confirms behavior covered by tests, but is not a replacement for strict type checking or a Vite production bundle. Run `npm install`, then `npm run check` in a network-enabled checkout and perform the two-browser steps in `docs/production-readiness.md` before publishing.
