# Release Notes — v1.16.46

## Kamikaze speed correction

- Removed the dynamic link between kamikaze speed and the hostile Commander's effective speed. At this release, kamikaze flight used a fixed baseline speed.
- The next correction in v1.16.47 changes this fixed value to 120% of the drone’s own current normal speed, including Drone Station speed upgrades.
- Retained the v1.16.45 drone firing interval (0.28 seconds), unchanged 2.8-cell weapon range, cached Core-status lookup, and simulation-clock diagnostics.

## Validation

- The v1.16.47 regression coverage checks that kamikaze speed scales with the drone’s current speed and is independent of target speed.
- The full simulation test suite was run for this release; see `release-validation-v1.16.46.md` for its result.
- A production build was not run.
