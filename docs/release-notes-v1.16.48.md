# Release Notes — v1.16.48

## AI-agent maintainability and documentation consistency

- Added root `AGENTS.md` with a required workflow for AI code changes and explicit self-maintenance rules.
- Added `skills/` playbooks for architecture, gameplay AI, multiplayer protocol, and testing/documentation.
- Added `npm run docs:check`, which checks relative Markdown links, release-version consistency, skill front matter and index coverage, and selected stale active-runtime claims. Added it to `npm run check`.
- Corrected `docs/multiplayer-engine-integration.md` to describe the current PeerJS signalling plus direct WebRTC data path. Marked older modular-system documents as historical design notes.
- Expanded the architecture document with authority, time, ownership, protocol, AI, worker, and refactoring rules.
- Added a regression test ensuring a low-health kamikaze drone waits without detonating when no hostile exists, then acquires a target when one appears.
- Preserved the v1.16.47 rule: kamikaze speed is 1.2× the drone's current speed, including Drone Station speed upgrades and independent of hostile speed.
