# v1.16.32 — Stable room controls, explicit lifecycle transitions, and large snapshots

## Room manager while playing

- Opening room management during a live world is now a deliberate user choice. Repeated one-second room-status refreshes for the same world/phase no longer force the panel closed.
- Actual lifecycle changes retain deliberate behavior: no-world, paused and results states show room management; entering an active world hides it for a ready host and shows it to a guest until the authoritative stream is ready.
- `ESC` opens the multiplayer session menu, which now has a **ROOM MANAGEMENT** action in addition to continue and leave-room actions. Returning to room management does not leave the room or pause the shared simulation.
- Removed the global `Enter` key listener that could start Single Player while focus was outside an input/button. Native keyboard activation of the focused Single Player button remains available; Enter in unrelated UI no longer launches another game mode.

## Host room state machine

- `HostRoomController` now changes `roomPhase` and `hasWorld` through a single transition method. Legal edges are `lobby -> playing`, `playing -> paused/results/lobby`, `paused -> playing/lobby`, and `results -> playing/lobby` (results-to-playing is used when the host revives a participant).
- The lifecycle method rejects impossible phase/world combinations and detects an already-broken invariant instead of silently rewriting it. Pause/resume preserves the same world ID, return-to-room clears world state while retaining room peers, and a later start creates a new world.
- Regression assertions cover invalid pause/resume/start calls, preserving the world on pause/resume, returning to a room, and starting the next world.

## PeerJS transport and snapshot recovery

- Replaced JSON DataConnection serialization with explicit PeerJS BinaryPack serialization. PeerJS's JSON serializer cannot use its large-message chunking path; this caused `Message too big for JSON channel` when the host sent a full world snapshot. The chosen wire format is negotiated by the initiating data connection and used by both peers.
- Kept envelope validation but set an explicit 16 MiB maximum serialized JSON-envelope size. That JSON representation is used only for size validation; the actual data-channel encoding is binary.
- Added a shared transport-policy constant and regression test so a future change cannot accidentally revert the game connection to JSON serialization.

## Verification

See [release validation](release-validation-v1.16.32.md) for exact command outcomes. Automated test success does not replace a real two-browser WebRTC test; the environment used to produce this archive has no installed project dependencies, so full lint and production build remain blocked until dependencies are installed.
