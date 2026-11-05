# Release Notes — v1.16.56

## Regression test corrections

- Changed the commander speed-buff movement assertion to use a tight floating-point tolerance, avoiding a false failure from `149.99999999999997` versus `150`. Production movement behavior was not changed.
- Replaced an invalid drone regression fixture that placed a drone at the centre of its station and demanded movement through a fully sealed wall perimeter. The test now starts in a physically free cell, verifies the phase advances while a route is impossible without tunnelling through walls, then opens a five-cell corridor and verifies the drone physically resumes movement after route replanning.
- Added per-tick checks that drone coordinates remain finite and never enter a solid building footprint in both the sealed and reachable phases.

## Scope

- No gameplay or persistence format changed.
- This release fixes regression assertions and validates the existing blocked-route recovery contract.
