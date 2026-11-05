import * as support from '../rulesTestSupport';

const assert: typeof support.assert = support.assert;
type ResourceNode = support.ResourceNode;

const {
  test,
  createBuildingInstance,
  createCombatDrone,
  createCommander,
  operationalBuildingSet,
  isCellBlockedForAir,
  DroneAI,
  GRID_SIZE
} = support;

test('Distant escort drones use the shared acceleration law while following the live commander centre', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -90, -90, 'smooth-entry-station');
  station.droneMode = 'ESCORT';
  const drone = createCombatDrone(station, { x: 3500, y: 3500 }, 'smooth-entry-drone');
  const commander = createCommander('player', 0, 0, 'smooth-entry-commander');
  station.escortCommanderId = commander.id;
  const buildings = operationalBuildingSet(station);
  const ai = new DroneAI();
  const startDistance = Math.hypot(drone.x - commander.x, drone.y - commander.y);
  let phaseBefore: number | undefined;
  let totalTravel = 0;
  for (let tick = 1; tick <= 20; tick++) {
    const oldX = drone.x;
    const oldY = drone.y;
    phaseBefore = drone.droneFlightPhase;
    ai.updateDrone(drone, commander, buildings, [drone, commander], [], 0.05, [], tick * 0.05);
    const step = Math.hypot(drone.x - oldX, drone.y - oldY);
    totalTravel += step;
    assert.ok(step <= 390 * 0.05 + 0.5, `One flight tick moved ${step.toFixed(2)} px beyond the speed cap`);
    assert.ok(Number.isFinite(drone.vx) && Number.isFinite(drone.vy));
  }
  assert.strictEqual(drone.droneFlightCenterId, `escort:${commander.id}`);
  assert.ok(totalTravel > 50, `The unified controller should keep moving while far from home; travelled ${totalTravel.toFixed(1)} px`);
  assert.ok(Number.isFinite(phaseBefore) && Number.isFinite(drone.droneFlightPhase));
  assert.notStrictEqual(drone.droneFlightPhase, phaseBefore, 'The orbit phase advances during long-distance recovery');
  commander.x += 96;
  const oldGoalX = drone.droneFlightGoalX!;
  ai.updateDrone(drone, commander, buildings, [drone, commander], [], 0.05, [], 2.1);
  assert.ok(Math.abs(drone.droneFlightGoalX! - oldGoalX) > 30,
    'A moving commander updates the flight centre immediately instead of using a cached old centre');
  assert.ok(Math.hypot(drone.x - commander.x, drone.y - commander.y) < startDistance,
    'The drone should converge toward the commander over the long flight');
});

test('A drone in an air-clearance cell still follows bounded physical flight over resource nodes', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'safe-hover-station');
  station.droneMode = 'DEFENSE';
  const buildings = operationalBuildingSet(station);
  const drone = createCombatDrone(station, { x: GRID_SIZE * 2 + GRID_SIZE / 2, y: GRID_SIZE / 2 }, 'safe-hover-drone');
  const commander = createCommander('player', 1200, 900, 'safe-hover-commander');
  const startX = drone.x;
  const startY = drone.y;
  const resources: ResourceNode[] = [{
    id: 'resource-under-drone', type: 'wood', gx: Math.floor(drone.x / GRID_SIZE),
    gy: Math.floor(drone.y / GRID_SIZE), x: drone.x, y: drone.y,
    amount: 50, maxAmount: 50, radius: 18, seed: 1
  }];

  // This cell belongs to the wider A* safety envelope, not the physical
  // building footprint. The controller must apply bounded motion, not snap out.
  assert.strictEqual(isCellBlockedForAir(2, 0, buildings), true,
    'Test setup must put the drone in the expanded air-clearance grid');
  const ai = new DroneAI();
  let largestStep = 0;
  for (let tick = 1; tick <= 36; tick++) {
    const beforeX = drone.x;
    const beforeY = drone.y;
    ai.updateDrone(drone, commander, buildings, [drone, commander], [], 0.05, resources, tick * 0.05);
    largestStep = Math.max(largestStep, Math.hypot(drone.x - beforeX, drone.y - beforeY));
  }

  const travelled = Math.hypot(drone.x - startX, drone.y - startY);
  assert.ok(travelled > GRID_SIZE,
    `A drone in a non-solid safety ring should continue physical flight, travelled ${travelled.toFixed(1)} px`);
  assert.ok(largestStep <= 390 * 0.05 + 0.5, `Flight must not teleport when the air-clearance grid marks the cell; largest step ${largestStep.toFixed(2)} px`);
  assert.ok(Number.isFinite(drone.x) && Number.isFinite(drone.y), 'The flight integrator must preserve finite world coordinates');
  assert.ok(Math.hypot(drone.vx, drone.vy) <= 390 + 1, 'The flight integrator must respect the drone speed cap');
});


test('escort drones follow the commander explicitly assigned to the station, not the engine active-player argument', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'explicit-escort-owner-station');
  station.droneMode = 'ESCORT';
  const assignedCommander = createCommander('player', 0, 0, 'escort-assigned-commander');
  const unrelatedCommander = createCommander('player', 1400, 1400, 'escort-unrelated-commander');
  station.escortCommanderId = assignedCommander.id;
  const drone = createCombatDrone(station, { x: 180, y: 0 }, 'explicit-escort-owner-drone');
  const ai = new DroneAI();
  ai.updateDrone(drone, unrelatedCommander, operationalBuildingSet(station),
    [drone, assignedCommander, unrelatedCommander], [], 0.05, [], 0.05);
  assert.strictEqual(drone.droneFlightCenterId, `escort:${assignedCommander.id}`,
    'The station’s persisted escort commander assignment must take priority over the active-player context');
});

test('player ESCORT stations reject a missing assigned commander instead of inferring one', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'missing-escort-assignment-station');
  station.droneMode = 'ESCORT';
  const unrelatedCommander = createCommander('player', 0, 0, 'unrelated-escort-commander');
  const drone = createCombatDrone(station, { x: 180, y: 0 }, 'missing-escort-assignment-drone');
  const ai = new DroneAI();
  assert.throws(
    () => ai.updateDrone(drone, unrelatedCommander, operationalBuildingSet(station),
      [drone, unrelatedCommander], [], 0.05, [], 0.05),
    /ESCORT mode without an assigned commander ID/
  );
});
