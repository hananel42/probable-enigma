# Escape Navigation

## Ownership

`Escape` is application navigation, not a world command. `src/game/client/escapeRouting.ts` provides the pure policy; the screen components execute the resulting action. `CanvasGameClient` does not pause, open a room, or mutate gameplay in response to Escape. It only prevents the browser's default action as a defensive fallback.

## Single Player

- The application-level keyboard handler remains mounted independently of renderer focus.
- Escape toggles the pause menu. The local `LocalGameServer` clock is stopped while paused and started again when the player resumes or toggles the menu closed.
- The Main Menu button unmounts Single Player; normal resource cleanup stops the server.
- When first-visit guidance is active, the guidance overlay owns Escape. Text-entry controls keep their own key behavior.

## Multiplayer

- Escape navigates to room management and never calls `LocalGameServer.start()` or `stop()`, nor any host-controller pause/resume operation.
- With an active world, Escape toggles the room panel. Opening it releases the local player's held inputs to avoid movement/fire sticking while focus changes.
- Without a world (lobby or after returning to the room), Escape ensures the room panel remains visible instead of exposing an empty game canvas.
- Escape from the room-chat input closes chat in the input's local handler. Other text fields are left alone.
- The application handler is installed before a gameplay renderer is mounted, and consumes handled Escape events before the renderer can treat them as in-game input. It stays mounted even when multiplayer has no renderer.

## Regression Tests

`src/game/client/escapeRouting.test.ts` verifies the route policy for both modes, active guidance, text-entry focus, chat, and lobby/no-world state. The policy is intentionally framework-free so it can be tested without a browser DOM. A real browser check is still recommended for focus ordering and multiplayer transport behavior.
