# v1.16.5 — Multiplayer synchronization and ownership fixes

- Increased authoritative state/UI synchronization from roughly 10 Hz to up to 30 Hz by using bounded ~33 ms simulation substeps and a 30 Hz UI sync threshold.
- Fixed host React state updates to publish a fresh outer snapshot object; previously React could skip renders because the same mutable snapshot reference was reused.
- Throttled pointer aim commands to 30 Hz, preventing high-frequency mousemove events from flooding the room relay.
- Added a shared ownership policy for structure management. In TEAM and FREE_FOR_ALL, only the owner may repair, upgrade, dismantle, or configure a structure; COOPERATIVE shares player structures. This is enforced by the engine and reflected in the HUD.
- Disconnect now removes the remote participant, commander, owned live units, projectiles, and group from the authoritative world, rather than merely marking the participant disconnected.
- Improved host peer-presence status when one guest leaves a room with other guests still connected.
- Added regression tests for ownership policy and participant cleanup.
