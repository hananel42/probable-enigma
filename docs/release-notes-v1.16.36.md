# v1.16.36 — Safe return-to-room lifecycle

## Fixed

- Returning from an active world to the persistent room no longer sends key-up or pointer-up gameplay commands during renderer disposal. The world replica can be cleared before React tears down the previous renderer; teardown is now explicitly non-interactive.
- A guest command attempted while disconnected or without a current authoritative frame is rejected with `false`. This is a normal non-playable state, not a wire-protocol violation, so the room connection is not isolated over late local input.
- Room-status, chat, defeat, connection-health, world-frame, snapshot, and readiness subscribers are isolated. A failing local/UI subscriber is logged with its diagnostic, while the incoming peer message continues through the protocol handler rather than being mislabeled as invalid transport data.
- React resource cleanup continues through every disposer and reports an `AggregateError` for diagnosis without throwing from the React teardown lifecycle. This prevents a cleanup failure from causing a second uncaught error during unmount.
- Renderer references are cleared before `stop()` is invoked, preventing other synchronous state callbacks from accessing a half-disposed renderer.

## Regression coverage

- `game-world-ended` can clear world state while teardown-style key-up and pointer-up commands are attempted; those commands are rejected without throwing or being sent over the room connection.
- The same room session remains usable for chat and a second world after returning to the room.
- Resource disposal runs all cleanup actions after a failure and reports diagnostics without throwing.

## Validation

See [Release Validation v1.16.36](release-validation-v1.16.36.md) for exact command results. Unit/in-memory protocol tests cannot replace a live two-browser WebRTC verification.
