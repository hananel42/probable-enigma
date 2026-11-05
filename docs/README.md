# Documentation Index

## Start here

- [Development Policy](development-policy.md) — mandatory no-backwards-compatibility rule for all active development.
- [AI Agent Guide](../AGENTS.md) and [Project Skills](../skills/README.md) — task routing, subsystem rules, test expectations, and self-maintenance requirements.

- [Project README](../README.md) — setup, quality commands, and code map.
- [Contributing and Maintenance](../CONTRIBUTING.md) — ownership boundaries, coding rules, and required checks.
- [Game Architecture](architecture.md) — simulation, rendering, AI, economy, and module ownership.
- [Repository Structure](repository-structure.md) — detailed source map, current entry points, focused helper modules, and file-size guidelines.
- [Multiplayer Runtime Map](multiplayer-runtime-map.md) — boundaries, room/world lifecycle, and synchronization order.
- [Host-Authoritative Multiplayer](host-authoritative-multiplayer.md) — authority and player command flow.
- [Client/Server Boundary](client-server-boundary.md) — UI-to-command and server-to-snapshot contract.
- [Transport Adapter Contract](transport-adapter-contract.md) — message envelope, reliable delivery, backpressure, and recovery rules.
- [PeerJS/WebRTC](peerjs-webrtc.md) — signaling, IDs, direct channels, network limits, and troubleshooting.
- [Multiplayer Modes](multiplayer-modes.md) — FFA, Team, and Cooperative semantics.
- [Production Readiness](production-readiness.md) — release checklist, operations, and known network limits.
- [AI Handoff: Peer Cleanup](AI_HANDOFF_MULTIPLAYER_PEER_CLEANUP.md) — historical handoff and its results.

## Implementation guides

- [Adding Game Content](adding-content.md)
- [Building Neighborhood API](building-neighborhoods.md)
- [Interactive Guidance Framework](interactive-guidance.md)
- [Building Modules](BUILDING_MODULES.md)
- [Progression and Upgrades](progression-and-upgrades.md)
- [Modular Systems v1.16.3](modular-systems-v1.16.3.md)
- [State Replication](state-replication.md)
- [Multi-Client Sessions](multi-client-sessions.md)
- [Worker Tasks](worker-tasks.md)
- [Groups and Alliances](groups-and-alliances.md)
- [Player Navigation and Visual Identity](player-navigation-and-identity.md)
- [Combat and Damage](combat-and-damage.md)
- [Structure Targeting and AI](structure-targeting-and-ai.md)
- [Drone AI Flight Policy and State Machine](drone-ai-state-machine.md)
- [Performance Diagnostics](performance-diagnostics.md)
- [Local World Persistence](world-persistence.md)
- [HUD Console](hud-console.md)

## Releases

Per-version release notes are the canonical change log. Current release: [v1.16.59](release-notes-v1.16.59.md), which adds local-home and participant-Core navigation indicators and alliance-aware rendering for human commanders and their units. The current validation record is [v1.16.59](release-validation-v1.16.59.md). Single-player world persistence was introduced in [v1.16.55](release-notes-v1.16.55.md); pathway type validation remains documented in [v1.16.53](release-notes-v1.16.53.md). Earlier release and validation records remain available as historical records only; they describe prior implementations and create no compatibility obligations or permission to retain obsolete code.

## Source of truth

When documentation conflicts, follow this order:

1. Current implementation and regression tests.
2. The current architecture/transport contract documents linked above.
3. Current-version release notes.
4. Archived historical notes.

Keyboard/navigation architecture: [Escape Navigation](escape-navigation.md).
