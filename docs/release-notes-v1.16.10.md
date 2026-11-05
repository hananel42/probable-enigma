# v1.16.10 — Core defeat and gray-structure salvage

- Core destruction now triggers defeat for the owning participant.
- Multiplayer modes isolate defeat by Core ownership; COOPERATIVE shares the defeat condition.
- Defeated participants cannot respawn without a Core or continue issuing gameplay commands. Restart remains allowed.
- Remote client overlays derive defeat from that client's assigned Core.
- Orphaned gray structures can be dismantled for the established HP-proportional salvage refund; live enemy structures remain non-dismantleable.
- Regression coverage added for single-player, multiplayer, cooperative, remote-client, and salvage behavior.
