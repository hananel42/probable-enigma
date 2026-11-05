# Release Notes — v1.16.53

## Runtime-safe path waypoint validation

- Added `src/game/pathWaypointValidation.ts` to parse worker messages from `unknown`, validate object shape, require safe-integer grid coordinates and finite world coordinates, and construct canonical `PathWaypoint` values. No caller relies on `Number.isInteger` or `Number.isFinite` to narrow fields declared through `Partial<PathWaypoint>`.
- Updated drone A* validation to apply cell-centre and four-connected-continuity invariants to parsed waypoints. The validator now returns the validated route instead of using an assertion signature that claimed the original input was valid without constructing a safe value.
- Applied the same parser to general entity pathfinding, removing a second unsound route assertion at the worker boundary.
- Replaced number assertions after `Number.isSafeInteger` checks in host/guest protocol handling and guidance-progress validation with explicit `typeof value === 'number'` guards. Room-management validation now checks untrusted numeric and phase values before comparing them.
- Added regression coverage for worker paths with missing `gx`/`gy`, visible validation diagnostics, and pending-request release/retry after malformed output.

## Compatibility

- Public game commands, authoritative world state, serialized game saves, and valid path shapes remain unchanged.
- Empty routes remain a representable A* result; callers decide whether an empty route reaches a goal. Malformed route objects are rejected explicitly and are not converted into guessed coordinates.
