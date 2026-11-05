import { GRID_SIZE } from '../../rules';

/** Stable and deliberately small tuning surface for the unified drone controller. */
export const DRONE_FLIGHT_TUNING = {
  /** A* is refreshed only when its goal materially changes or the route is consumed. */
  routeRefreshSeconds: 0.9,
  routeGoalMoveThreshold: GRID_SIZE * 1.75,
  // Must remain below half a grid cell: a larger radius skips adjacent A* corners and cuts through walls.
  routeWaypointTolerance: GRID_SIZE * 0.4,
  /** Desired phase advances continuously; the A* target stays ahead on the same orbit. */
  routeLookAheadRadians: Math.PI / 3,
  /** Acceleration controller coefficients (px, seconds). */
  tangentVelocityGain: 2.25,
  radialSpringGain: 1.15,
  waypointAttractionGain: 0.62,
  centerVelocityGain: 1.0,
  dampingGain: 0.15,
  maxDt: 0.08
} as const;

