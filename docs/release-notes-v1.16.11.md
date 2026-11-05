# v1.16.11 Release Notes

## AI
- Enemy commanders now apply a simple hard-priority state machine every simulation tick when their Core is damaged: repair if affordable, attack a threat near the Core if repair is not affordable, otherwise guard the Core. This prevents stale economy/build goals from overriding defense.
- Harvester resource choice now considers usable load relative to estimated outbound-plus-return distance, rather than choosing the first nearest reachable deposit.

## Multiplayer and HUD
- In COOPERATIVE mode, destroying the shared Core permanently ends the room run. Restart is hidden in the defeat screen and rejected by the authoritative server. Create a new room for a fresh run.
- Room code, copy button, sync status, and leave action now sit compactly inside the existing top HUD bar rather than a separate floating panel.

## Validation
- Includes a server regression test ensuring a defeated cooperative run cannot be restarted through either player or trusted local command dispatch.
