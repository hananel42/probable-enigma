# v1.16.8 — Remove unused development dependency

- Removed `tsx` from root devDependencies. No project script or source file invokes it; simulation tests run through `node scripts/test-simulation.mjs`, and the signaling server uses Node directly.
- Kept the React, Vite, Tailwind, TypeScript, and type-definition packages because the current app, build config, CSS pipeline, and TypeScript configuration use them.
- Kept `ws` as a dependency of the separate signaling server.
