# Release Notes — v1.16.50

## Drone flight type-safety repair

- Fixed strict TypeScript control-flow typing for the persisted drone flight phase. The controller now explicitly validates the stored phase as a finite number and otherwise initializes it from the drone's current position relative to the active centre.
- Fixed TS2775 assertion-signature errors in `rules-15-drone-flight-controller.test.ts` by assigning the imported assertion API to an explicitly annotated binding.
- No gameplay constants or intended movement rules changed. The flight equation, centre selection, A* planner lifecycle, resource pass-through, and 1.2× upgraded-speed kamikaze behavior remain as documented in v1.16.49 and earlier releases.
