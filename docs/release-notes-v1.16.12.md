# v1.16.12 Release Notes

## Enemy Commander economy and defense
- When its Core is damaged, a Commander repairs it when affordable; otherwise it attacks an immediate local threat, then gathers station stock or mines nearby resources needed for repair. It does not spend its repair budget on construction or upgrades while recovering.
- The Commander only holds a defensive position if no suitable nearby resource can be reached.
- Construction now treats the first Harvester Station as an early economic milestone and builds extra stations only after base growth, an operational station, sufficient funds, and low pressure. Resource-poor states no longer automatically trigger unnecessary extra stations.

## Autonomous Harvester reliability
- Harvester bots skip resource types whose station stockpiles are full.
- If both station stockpiles are full, bots wait instead of extracting cargo they cannot deposit.
- If capacity fills while a bot is travelling to or mining a resource, it abandons that trip without losing cargo.

## Multiplayer defeat lifecycle
- CO-OP remains terminal after the shared Core is destroyed; restart is rejected in the engine and server, not merely hidden in the HUD.
- TEAM/FFA restart is denied while any connected participant still has a live Core.
- Once all connected participants are defeated, the host can restart the entire room. The restart preserves mode and connected participant/commander/Core IDs, keeping the remote client protocol session valid.
- Defeated guests cannot restart the room, and the host no longer sees a restart action while a teammate is still alive.

## Verification
- Simulation and integration test suite: run with `node scripts/test-simulation.mjs`.
- Signaling room-code tests: run with `node --test signaling-server/src/roomCodes.test.js`.
- Full Vite build requires installing project dependencies; this environment did not complete `npm install`, so no successful production build is claimed.
