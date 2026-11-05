# Release notes — v1.16.47

- Corrected kamikaze drone speed: it is now exactly 120% of the drone’s current normal flight speed (`drone.speed`).
- Drone Station speed upgrades apply to kamikaze flight because they update the drone’s normal speed first.
- The hostile target’s speed is never used to calculate kamikaze speed.
- No weapon range, firing-rate, or simulation-clock behavior was changed in this correction.
