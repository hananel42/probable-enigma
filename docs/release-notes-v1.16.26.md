# Release v1.16.26 — Full-screen room control center

## Room creation and mode selection

- Removed game-mode selection from the main menu. Creating a room starts with a provisional default mode, then the host chooses the actual rules from room management before starting the match.
- Rebuilt room management as a full-viewport control center with responsive invitation, roster, and match-settings sections.
- Made the room code and complete direct invitation URL visible within room management, with dedicated copy controls and immediate success/failure feedback.
- Kept the authoritative `HostRoomController` as the only source of truth for room phase and mode. The mode selector is only available to the host during the lobby phase.
- Documented the host/guest permissions, lobby-to-match-to-results lifecycle, difference between returning to gameplay and leaving the room, and the behavior of defeated participants.

## Validation

- Run `npm test`, `npm run lint`, and `npm run build` in the project environment before deployment.
- Browser-level verification should check room creation, full-screen manager layout at desktop/mobile sizes, code/link copying, host mode changes before match start, direct-link joining, and guest return-to-game behavior.
