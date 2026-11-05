# v1.16.3 — Module-owned building simulation

- Reduced `src/game/buildings/runtime.ts` to generic lifecycle work: destroyed/inert handling, universal passive repair, and module callback dispatch.
- Moved Auto-Turret firing, Fire Tower pulse/damage-over-time, Harvester Station bot production/cargo pickup, and Drone Station production into the corresponding module `behavior.ts` files.
- Expanded the module contract with a shared authoritative target query and state-change notification.
- Added a registry contract test asserting that active built-in mechanics are owned by their modules.
- Preserved the existing host-authoritative multiplayer integration coverage for remote movement, building, firing, and damage.

Validation performed in the available environment: simulation suite passes. A production Vite build and real browser/WebSocket multi-client run were not performed because dependencies/browser harness are not available in this environment.
