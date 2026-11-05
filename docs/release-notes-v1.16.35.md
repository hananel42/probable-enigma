# v1.16.35 — Persistent room return and player-facing removal notices

## Room lifecycle

- Returning to the room ends the active world but keeps the room membership and data connection alive. The host sends an explicit world-ended event followed by a participant assignment with `worldId: null`; a later start announces a new world over the same room session.
- The guest render loop is stopped as soon as its session becomes not-ready, before it can query a deliberately cleared world replica. This prevents the transition gap from becoming a runtime error or being misreported as a connection failure.
- Added regression coverage that returns a guest to the room, sends room chat over the still-live connection, and starts a second world in the same room session.

## Removing participants

- A host kick now sends a bounded, idempotent `game-room-removed` notice before closing the participant connection.
- The guest shows a fixed, human-readable message and sends `game-room-removal-ack`; duplicate notice deliveries are acknowledged but shown only once.
- The host waits briefly for the acknowledgement, then performs the usual participant and asset cleanup. If the connection is already unavailable, it cleans up without throwing an avoidable UI error and reports that the notice may not have reached the participant. If delivery was queued but the guest never acknowledges, the host is told that notice receipt could not be confirmed.
- Regression tests cover the acknowledgement path, the room roster, cleanup reason, and the stale/disconnected-peer race.

## User-facing messages

- Replaced the room protocol callback's raw error text with a clear recovery message. Full diagnostics remain in the developer console.
- Updated the disconnected guest and unavailable-removal paths to avoid exposing PeerJS/WebRTC implementation details in the player UI.

## Verification

The current archive's exact `npm test`, `npm run lint`, and `npm run build` outcomes are recorded in [Release Validation v1.16.35](release-validation-v1.16.35.md). A passing in-memory regression suite is not a substitute for a live two-browser test.
