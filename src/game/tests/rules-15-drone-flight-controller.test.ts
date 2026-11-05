import * as support from '../rulesTestSupport';
import {
  calculateDroneFlightAcceleration,
  DRONE_FLIGHT_TUNING,
  updateDroneFlight
} from '../ai/droneAI/DroneFlightController';
import { getNavigationPoint, invalidateDroneFlightPath, maintainDronePath } from '../ai/droneAI/DroneFlightPathPlanner';
import { moveWithGridCollisionSubstepped } from '../movement/collision';

const { test, createBuildingInstance, createCombatDrone, moveEntityAlongPath } = support;
const assert: typeof support.assert = support.assert;

const closeTo = (actual: number, expected: number, epsilon = 1e-6): void => {
  assert.ok(Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`);
};

test('Drone flight acceleration follows the documented tangential, centre-velocity, waypoint and damping equation', () => {
  const acceleration = calculateDroneFlightAcceleration({
    x: 100, y: 0, vx: 10, vy: 20,
    centerX: 0, centerY: 0, centerVx: 5, centerVy: -4,
    radius: 100, orbitSpeed: 200, orbitDirection: 1, phase: 0,
    waypointX: 100, waypointY: 100
  });

  // desired velocity = (5, 196); radial spring is zero; waypoint delta = (0, 100).
  closeTo(acceleration.ax, -12.75);
  closeTo(acceleration.ay, 455);
});

test('Drone flight spring restores an undershooting radius and pushes back an overshooting radius', () => {
  const base = {
    y: 0, vx: 0, vy: 0, centerX: 0, centerY: 0,
    orbitSpeed: 0, orbitDirection: 1 as const, phase: 0,
    waypointY: 0
  };
  const inside = calculateDroneFlightAcceleration({ ...base, x: 75, radius: 100, waypointX: 75 });
  const outside = calculateDroneFlightAcceleration({ ...base, x: 125, radius: 100, waypointX: 125 });

  closeTo(inside.ax, 25 * DRONE_FLIGHT_TUNING.radialSpringGain);
  closeTo(outside.ax, -25 * DRONE_FLIGHT_TUNING.radialSpringGain);
  closeTo(inside.ay, 0);
  closeTo(outside.ay, 0);
});

test('Every flight tick integrates a changing velocity vector and uses the live centre position', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'flight-physics-station');
  const drone = createCombatDrone(station, { x: 100, y: 0 }, 'flight-physics-drone');
  drone.vx = 0;
  drone.vy = 0;
  drone.droneFlightOrbitDirection = 1;

  const first = updateDroneFlight(drone, { id: 'moving-centre', x: 0, y: 0 }, 100, 180, 390, 1950, 0.05, [], [], 0.05);
  const firstVelocity = { x: drone.vx, y: drone.vy };
  assert.ok(Number.isFinite(first.phase), 'An undefined stored phase must initialize from the drone position');
  assert.ok(Number.isFinite(first.ax) && Number.isFinite(first.ay));
  assert.ok(Math.hypot(first.ax, first.ay) > 0, 'The first tick must apply a non-zero acceleration vector');
  assert.ok(Math.hypot(drone.vx, drone.vy) <= 390 + 1e-6, 'Velocity must respect the configured speed cap');

  updateDroneFlight(drone, { id: 'moving-centre', x: 30, y: -10, vx: 20, vy: 5 }, 100, 180, 390, 1950, 0.05, [], [], 0.1);
  assert.notStrictEqual(drone.droneFlightGoalX, first.waypointX,
    'The next route goal must derive from the centre supplied on the current tick');
  assert.ok(Math.hypot(drone.vx - firstVelocity.x, drone.vy - firstVelocity.y) > 1e-5,
    'The velocity vector must be updated by subsequent physical ticks');
  assert.ok(Number.isFinite(drone.vx) && Number.isFinite(drone.vy));
});


test('The physical controller clamps the acceleration vector before integrating velocity', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'flight-accel-clamp-station');
  const drone = createCombatDrone(station, { x: 20, y: 0 }, 'flight-accel-clamp-drone');
  drone.vx = 0;
  drone.vy = 0;
  drone.droneFlightOrbitDirection = 1;
  const maxAcceleration = 35;
  const result = updateDroneFlight(
    drone, { id: 'clamped-centre', x: 0, y: 0 }, 300, 300, 390, maxAcceleration, 0.05, [], [], 0.05
  );
  assert.ok(Math.hypot(result.ax, result.ay) <= maxAcceleration + 1e-6,
    `The applied acceleration should be clamped to ${maxAcceleration}, got ${Math.hypot(result.ax, result.ay)}`);
});


test('Blocked A* flight has one outstanding worker per drone and discards an invalidated centre route', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalConsoleError = console.error;
  console.error = () => {};
  interface FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    postMessage: (message: unknown) => void;
    terminate: () => void;
  }
  const workers: FakePathWorker[] = [];
  class FakeWorker implements FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() { workers.push(this); }
    postMessage(_message: unknown) {}
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'a-star-flight-station');
    const drone = createCombatDrone(station, { x: -500, y: 0 }, 'a-star-flight-drone');
    const wall = createBuildingInstance('WALL', 'player', 0, 0, 'a-star-flight-wall');
    const buildings = [wall];
    drone.droneFlightPathRefreshTimer = 1;

    maintainDronePath(drone, 500, 0, buildings, [], 1);
    assert.strictEqual(workers.length, 1, 'A blocked air corridor should schedule one worker request');
    drone.droneFlightPathRefreshTimer = 10;
    maintainDronePath(drone, 600, 0, buildings, [], 1.1);
    invalidateDroneFlightPath(drone);
    maintainDronePath(drone, 650, 0, buildings, [], 1.2);
    assert.strictEqual(workers.length, 1,
      'Goal movement and centre invalidation must not queue duplicate requests while the old worker is unsettled');

    workers[0].onerror?.({ message: 'simulated stale flight path failure' } as ErrorEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    drone.droneFlightPathRefreshTimer = 10;
    maintainDronePath(drone, 650, 0, buildings, [], 1.3);
    assert.strictEqual(workers.length, 2,
      'After the stale request settles, the planner must release its lock so a current route can be requested');
    workers[1].onerror?.({ message: 'simulated replacement path failure' } as ErrorEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(drone.path, [], 'A stale worker result must never install an old-centre waypoint route');
  } finally {
    console.error = originalConsoleError;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});


test('Drone collision integration cannot tunnel through a building when a long tick crosses it', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'continuous-collision-station');
  const drone = createCombatDrone(station, { x: -100, y: 24 }, 'continuous-collision-drone');
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'continuous-collision-wall');
  const wallSet = [wall];
  assert.equal(drone.isFlying, true, 'The fixture must exercise the flight collision policy.');
  assert.equal(support.isCellInsideBuildingFootprint(0, 0, wallSet), true,
    `Fixture wall must block its own grid cell (hp=${wall.hp}, gx=${wall.gx}, gy=${wall.gy}, w=${wall.widthInCells}, h=${wall.heightInCells}).`);

  const moved = moveWithGridCollisionSubstepped(drone, 100, 24, wallSet, []);

  assert.equal(moved, true);
  assert.ok(drone.x < 0, `The drone must remain on the near side of the wall; x=${drone.x}`);
  assert.ok(drone.x > -100, 'Collision integration should move up to the obstacle rather than freezing early.');
  assert.ok(Math.hypot(drone.x + 100, drone.y - 24) <= 200,
    'The actual displacement must never exceed the requested continuous segment.');
});

test('Malformed generic A* worker results are surfaced and release the path lock', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  interface FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    lastRequest?: { id: number; type: string; payload: unknown };
    postMessage: (message: unknown) => void;
    terminate: () => void;
  }
  const workers: FakePathWorker[] = [];
  class FakeWorker implements FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    lastRequest?: { id: number; type: string; payload: unknown };
    constructor() { workers.push(this); }
    postMessage(message: unknown) { this.lastRequest = message as FakePathWorker['lastRequest']; }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'generic-malformed-station');
    const drone = createCombatDrone(station, { x: -500, y: 0 }, 'generic-malformed-route-drone');
    const wall = createBuildingInstance('WALL', 'player', 0, 0, 'generic-malformed-route-wall');

    moveEntityAlongPath(drone, 500, 0, [wall], [], 1 / 60, 12, 390);
    assert.ok(workers.length > 0, 'Blocked generic navigation must request a worker route');
    const worker = workers[workers.length - 1];
    const request = worker.lastRequest;
    assert.ok(request && Number.isSafeInteger(request.id));
    worker.onmessage?.({ data: {
      id: request.id,
      type: request.type,
      result: [{ gx: undefined, gy: 0, x: 24, y: 24 }]
    } } as MessageEvent);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(errors.some(args => String(args[0]).includes('Path request for entity') &&
      String(args[1]).includes('gx and gy must be safe integers')),
    'A waypoint missing grid coordinates must be rejected and reported instead of being treated as a valid route');
  } finally {
    console.error = originalConsoleError;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
    for (const worker of workers) worker.onerror?.({ message: 'retire generic malformed-route test worker' } as ErrorEvent);
  }
});

test('Drone collision integration rejects impossible oversized segments instead of skipping collision checks', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'oversized-collision-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'oversized-collision-drone');
  assert.throws(() => moveWithGridCollisionSubstepped(drone, 100_000, 0, [], []), RangeError);
  assert.equal(drone.x, 0, 'A rejected move must not partially mutate the entity.');
  assert.equal(drone.y, 0, 'A rejected move must not partially mutate the entity.');
});

test('Drone acceleration rejects non-finite state instead of silently substituting a centre velocity', () => {
  assert.throws(() => calculateDroneFlightAcceleration({
    x: 100, y: 0, vx: 0, vy: 0, centerX: 0, centerY: 0,
    centerVx: Number.NaN, centerVy: 0, radius: 100, orbitSpeed: 100,
    orbitDirection: 1, phase: 0, waypointX: 100, waypointY: 0
  }), RangeError);
});


test('Malformed A* worker results are reported instead of silently becoming an empty path', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  interface FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    lastRequest?: { id: number; type: string; payload: unknown };
    postCount: number;
    postMessage: (message: unknown) => void;
    terminate: () => void;
  }
  const workers: FakePathWorker[] = [];
  class FakeWorker implements FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    lastRequest?: { id: number; type: string; payload: unknown };
    postCount = 0;
    constructor() { workers.push(this); }
    postMessage(message: unknown) {
      this.postCount += 1;
      this.lastRequest = message as FakePathWorker['lastRequest'];
    }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'malformed-route-station');
    const drone = createCombatDrone(station, { x: -500, y: 0 }, 'malformed-route-drone');
    const wall = createBuildingInstance('WALL', 'player', 0, 0, 'malformed-route-wall');
    drone.droneFlightPathRefreshTimer = 1;
    maintainDronePath(drone, 500, 0, [wall], [], 1);

    assert.equal(workers.length, 1);
    const request = workers[0].lastRequest;
    assert.ok(request && Number.isSafeInteger(request.id), 'Worker request should be registered with a stable ID');
    workers[0].onmessage?.({ data: {
      id: request.id,
      type: request.type,
      result: [{ gx: undefined, gy: 0, x: 24, y: 24 }]
    } } as MessageEvent);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.ok(errors.some(args => String(args[0]).includes('A* result processing failed') &&
      String(args[2]).includes('gx and gy must be safe integers')),
    'A drone route missing required grid coordinates must produce an explicit validation error');
    assert.equal(drone.flightPathActive, false, 'A malformed route must never be installed as active navigation');
    drone.droneFlightPathRefreshTimer = 10;
    maintainDronePath(drone, 500, 0, [wall], [], 1.1);
    assert.equal(workers.reduce((total, worker) => total + worker.postCount, 0), 2,
      'Rejecting an invalid route must release the pending slot so a bounded retry can start.');
    const retryRequest = workers[workers.length - 1].lastRequest;
    assert.ok(retryRequest && retryRequest.id !== request.id,
      'The retry must be a distinct request after the malformed response has released its lock.');
    workers[workers.length - 1].onmessage?.({ data: {
      id: retryRequest.id,
      type: retryRequest.type,
      result: []
    } } as MessageEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
  } finally {
    console.error = originalConsoleError;
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
    for (const worker of workers) worker.onerror?.({ message: 'retire malformed-response test worker' } as ErrorEvent);
  }
});


test('A* waypoint capture cannot skip a corner and command a diagonal wall cut', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'waypoint-corner-station');
  const drone = createCombatDrone(station, { x: 30, y: 24 }, 'waypoint-corner-drone');
  drone.droneFlightPathNeedsAStar = true;
  drone.path = [
    { gx: 0, gy: 0, x: 24, y: 24 },
    { gx: 1, gy: 0, x: 72, y: 24 },
    { gx: 1, gy: 1, x: 72, y: 72 }
  ];
  drone.pathIndex = 0;

  const waypoint = getNavigationPoint(drone, 200, 200);
  assert.deepStrictEqual(waypoint, { x: 72, y: 24 },
    'The controller must capture the next orthogonal waypoint rather than skip the turn and aim diagonally through a wall.');
  assert.strictEqual(drone.pathIndex, 1);
});

test('Substepped collision movement slides around a wall instead of aborting the rest of the tick', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'wall-slide-station');
  const drone = createCombatDrone(station, { x: -60, y: 24 }, 'wall-slide-drone');
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'wall-slide-obstacle');

  moveWithGridCollisionSubstepped(drone, 120, 50, [wall], []);

  const gx = Math.floor(drone.x / support.GRID_SIZE);
  const gy = Math.floor(drone.y / support.GRID_SIZE);
  assert.strictEqual(support.isCellInsideBuildingFootprint(gx, gy, [wall]), false,
    'Sliding must never put the drone in a solid building cell.');
  assert.ok(drone.y > support.GRID_SIZE,
    `A blocked X step must still allow safe Y progress past the wall edge; got y=${drone.y}.`);
  assert.ok(drone.x > -support.GRID_SIZE,
    'The drone must make physical progress instead of stopping at the first collision substep.');
});

test('A drone already in an air-clearance ring gets a connected escape route before long-range A*', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'clearance-escape-station');
  const drone = createCombatDrone(station, { x: -24, y: 24 }, 'clearance-escape-drone');
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'clearance-escape-wall');
  const buildings = [wall];

  maintainDronePath(drone, 240, 24, buildings, [], 1);

  assert.strictEqual(drone.droneFlightEscapingClearance, true,
    'A drone inside the planning-clearance ring must first take a physically connected escape path.');
  assert.ok(drone.path && drone.path.length > 0, 'The local escape path must contain waypoints.');
  let previousGx = Math.floor(drone.x / support.GRID_SIZE);
  let previousGy = Math.floor(drone.y / support.GRID_SIZE);
  for (const waypoint of drone.path) {
    const delta = Math.abs(waypoint.gx - previousGx) + Math.abs(waypoint.gy - previousGy);
    assert.strictEqual(delta, 1, 'Escape waypoints must be adjacent; the first waypoint cannot be on the far side of a wall.');
    assert.strictEqual(support.isCellInsideBuildingFootprint(waypoint.gx, waypoint.gy, buildings), false);
    previousGx = waypoint.gx;
    previousGy = waypoint.gy;
  }
});

test('Waypoint-directed acceleration takes priority over orbit tangent while following an A* detour', () => {
  const input = {
    x: 100, y: 0, vx: 0, vy: 0,
    centerX: 0, centerY: 0,
    radius: 100, orbitSpeed: 200, orbitDirection: 1 as const, phase: 0,
    waypointX: 0, waypointY: 0
  };
  const orbitAcceleration = calculateDroneFlightAcceleration(input);
  const routeAcceleration = calculateDroneFlightAcceleration({ ...input, followWaypoint: true });

  assert.ok(orbitAcceleration.ay > 0, 'The ordinary orbit force should point along the positive tangent.');
  assert.ok(routeAcceleration.ax < 0, 'During a detour, acceleration should lead toward the safe waypoint rather than continue into the obstacle.');
});


test('A stale long-range A* result cannot overwrite a connected clearance-escape route', async () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  interface FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    lastRequest?: { id: number; type: string; payload: unknown };
    postMessage: (message: unknown) => void;
    terminate: () => void;
  }
  const workers: FakePathWorker[] = [];
  class FakeWorker implements FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    lastRequest?: { id: number; type: string; payload: unknown };
    constructor() { workers.push(this); }
    postMessage(message: unknown) { this.lastRequest = message as FakePathWorker['lastRequest']; }
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'escape-invalidation-station');
    const drone = createCombatDrone(station, { x: -500, y: 0 }, 'escape-invalidation-drone');
    const wall = createBuildingInstance('WALL', 'player', 0, 0, 'escape-invalidation-wall');
    const buildings = [wall];
    drone.droneFlightPathRefreshTimer = 1;
    maintainDronePath(drone, 500, 0, buildings, [], 1);
    assert.strictEqual(workers.length, 1, 'The first blocked corridor should create one long-range worker request.');
    const request = workers[0].lastRequest;
    assert.ok(request && Number.isSafeInteger(request.id));

    // Simulate a centre change/physical drift that places the drone inside the
    // clearance ring while the previous long-range request is still outstanding.
    drone.x = -24;
    drone.y = 24;
    drone.droneFlightPathRefreshTimer = 10;
    maintainDronePath(drone, 240, 24, buildings, [], 1.1);
    assert.strictEqual(drone.droneFlightEscapingClearance, true);
    const escapeRoute = drone.path?.map(point => ({ ...point }));
    assert.ok(escapeRoute && escapeRoute.length > 0);

    workers[0].onmessage?.({ data: { id: request.id, type: request.type, result: [] } } as MessageEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepStrictEqual(drone.path, escapeRoute,
      'A stale worker result must not replace the route physically connected to the drone.');
    assert.strictEqual(drone.droneFlightEscapingClearance, true);
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});
