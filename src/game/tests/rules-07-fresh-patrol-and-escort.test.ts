import * as support from '../rulesTestSupport';
const assert: typeof support.assert = support.assert;

const {
  test,
  operationalBuildingSet,
  createTestEnemyBase,
  GRID_SIZE,
  BUILDING_BLUEPRINTS,
  snapToGrid,
  canAfford,
  deductCost,
  getRepairCost,
  getBuildingUpgradeCost,
  getBuildingSalvageRefund,
  repairBuilding,
  upgradeBuildingStats,
  isCellBlockedForGround,
  isCellBlockedForAir,
  isCellInsideBuildingFootprint,
  isCellBuildable,
  isAreaBuildable,
  createBuildingInstance,
  createCombatDrone,
  createHarvesterBot,
  createCommander,
  collectStationResources,
  findFreeAdjacentSpawnPosition,
  getBuildingOccupiedCells,
  getBuildingCandidatesInCellBounds,
  takeWholeResourceBatch,
  isCommanderOperational,
  findPath,
  applyBuildingDamage,
  applyEntityDamage,
  areHostile,
  findClosestHostileEntity,
  findPriorityHostileTarget,
  getProjectileDodgeDirection,
  isProjectileHostileTo,
  BUILDING_CATALOG,
  BUILDING_COMBAT_PROFILES,
  ENTITY_CATALOG,
  ENTITY_COMBAT_PROFILES,
  DroneAI,
  resolveDroneAIState,
  LocalGameServer,
  generateProceduralEnemyBase,
  HarvesterAI,
  CommanderAI,
  getSmoothEmbeddedRecoveryTarget,
  isEntityPathPending,
  moveEntityAlongPath,
  moveEntityTowardSmoothly,
  recoverEmbeddedEntity,
  EnemyCommanderAI,
  enemyCommanderAI,
  getFortressBlueprint,
  BUILDING_UPGRADE_TREES,
  applyCommanderUpgradeEffects,
  getAppliedUpgradeNames,
  getBuildingStatLines,
  getBuildingUpgradeOptions,
  getRecommendedBuildingUpgradeId,
  getUpgradeOptionForHotkey,
  shouldDrawRangePreview,
  BUILDING_MODULES,
  isBuildingOperational,
  isOrphanedStructure,
  buildingDrawer,
  GameEngine,
  WorkerTaskScheduler
} = support;
type Building = support.Building;
type EnemyBase = support.EnemyBase;
type GameGroup = support.GameGroup;
type Projectile = support.Projectile;
type ResourceNode = support.ResourceNode;
type Resources = support.Resources;

test('Fresh defense and escort drones accelerate immediately in open air without creating A* workers', () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let workerCreations = 0;
  class CountingWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() { workerCreations++; }
    postMessage() {}
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true, writable: true, value: CountingWorker
  });
  try {
    const defenseStation = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'first-move-defense-station');
    defenseStation.droneMode = 'DEFENSE';
    const defenseDrone = createCombatDrone(
      defenseStation, { x: 24, y: -100 }, 'first-move-defense-drone'
    );
    const defenseWorld = operationalBuildingSet(defenseStation);
    const remotePlayer = createCommander('player', 1200, 900, 'first-move-defense-player');
    const defenseStart = { x: defenseDrone.x, y: defenseDrone.y };
    new DroneAI().updateDrone(
      defenseDrone, remotePlayer, defenseWorld, [defenseDrone, remotePlayer], [], 0.05, [], 0.05
    );
    const defenseStep = Math.hypot(defenseDrone.x - defenseStart.x, defenseDrone.y - defenseStart.y);
    assert.ok(defenseStep > 0.5,
      `A defense drone with a clear route must begin moving in its first update; moved ${defenseStep.toFixed(2)} px`);

    const escortStation = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'first-move-escort-station');
    escortStation.droneMode = 'ESCORT';
    const escortDrone = createCombatDrone(
      escortStation, { x: 200, y: -100 }, 'first-move-escort-drone'
    );
    const escortPlayer = createCommander('player', 600, 300, 'first-move-escort-player');
    escortStation.escortCommanderId = escortPlayer.id;
    // The shared flight controller must not create a worker when its current
    // look-ahead point has a clear air corridor.
    const escortStart = { x: escortDrone.x, y: escortDrone.y };
    new DroneAI().updateDrone(
      escortDrone, escortPlayer, operationalBuildingSet(escortStation), [escortDrone, escortPlayer], [], 0.05, [], 0.05
    );
    const escortStep = Math.hypot(escortDrone.x - escortStart.x, escortDrone.y - escortStart.y);
    assert.ok(escortStep > 0.5,
      `An escort drone with a clear air corridor must move immediately; moved ${escortStep.toFixed(2)} px`);
    assert.strictEqual(workerCreations, 0,
      'Clear open-air segments must not stall movement while an asynchronous path worker is running');
  } finally {
    if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});

test('Player and enemy collection use the same resource transfer helper', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'player', 0, 0, 'shared-transfer-station');
  station.storedWood = 13;
  station.storedStone = 9;
  const wallet: Resources = { wood: 40, stone: 70 , diamonds: 0 };

  const collected = collectStationResources(station, wallet);

  assert.deepStrictEqual(collected, { wood: 13, stone: 9 , diamonds: 0 });
  assert.deepStrictEqual(wallet, { wood: 53, stone: 79 , diamonds: 0 });
  assert.strictEqual(station.storedWood, 0);
  assert.strictEqual(station.storedStone, 0);
});

test('Harvester navigation watchdog abandons a sealed unreachable resource instead of retrying forever', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'player', -4, -4, 'watchdog-station');
  const targetGx = 10;
  const targetGy = 0;
  const node: ResourceNode = {
    id: 'sealed-resource', type: 'stone', gx: targetGx, gy: targetGy,
    x: targetGx * GRID_SIZE + GRID_SIZE / 2, y: targetGy * GRID_SIZE + GRID_SIZE / 2,
    amount: 50, maxAmount: 50, radius: 20, seed: 11
  };
  const walls: Building[] = operationalBuildingSet(station);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      walls.push(createBuildingInstance('WALL', 'enemy', targetGx + dx, targetGy + dy, `sealed-${dx}-${dy}`, 'enemy-seal'));
    }
  }
  const bot = createHarvesterBot(station, { x: 24, y: 24 }, 'watchdog-rover');
  bot.harvesterState = 'NAVIGATING_TO_RESOURCE';
  bot.targetResourceId = node.id;
  const ai = new HarvesterAI();
  for (let i = 0; i < 32; i++) ai.updateBot(bot, walls, [node], 0.1);
  assert.strictEqual(bot.harvesterState, 'IDLE');
  assert.strictEqual(bot.targetResourceId, null);
  assert.strictEqual(bot.harvesterFailedResourceId, node.id);
  assert.ok((bot.harvesterFailureCooldown || 0) > 0);
});

test('Building spatial queries stay local and refresh when the building array grows', () => {
  const nearby = createBuildingInstance('WALL', 'player', 11, 0, 'spatial-nearby');
  const farAway = createBuildingInstance('WALL', 'enemy', 80, 80, 'spatial-far');
  const buildings: Building[] = [nearby, farAway];

  const localCandidates = getBuildingCandidatesInCellBounds(buildings, 10, -1, 12, 1);
  assert.deepStrictEqual(localCandidates.map(building => building.id), ['spatial-nearby']);

  const negativeCoordinate = createBuildingInstance('WALL', 'enemy', -13, 0, 'spatial-negative');
  buildings.push(negativeCoordinate);
  const negativeCandidates = getBuildingCandidatesInCellBounds(buildings, -14, -1, -12, 1);
  assert.ok(negativeCandidates.some(building => building.id === 'spatial-negative'));
  assert.ok(!negativeCandidates.some(building => building.id === 'spatial-far'));
});

test('Drones respect a fixed movement speed cap while catching up to a distant escort target', async () => {
  const { DroneAI } = await import('../ai/droneAI');
  const station = createBuildingInstance('DRONE_STATION', 'player', -90, -90, 'speed-test-station');
  station.droneMode = 'ESCORT';
  const drone = createCombatDrone(station, { x: 3500, y: 3500 }, 'speed-capped-drone');
  const commander = createCommander('player', 0, 0, 'speed-capped-commander');
  station.escortCommanderId = commander.id;
  const beforeX = drone.x;
  const beforeY = drone.y;
  new DroneAI().updateDrone(drone, commander, operationalBuildingSet(station), [drone, commander], [], 0.1, []);
  const moved = Math.hypot(drone.x - beforeX, drone.y - beforeY);
  assert.ok(moved <= 34.61, `Drone travelled ${moved} px in 0.1s, exceeding its 345 px/s cap`);
});

test('Escort drones keep making progress over many updates instead of remaining idle at a stale goal', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'persistent-movement-station');
  station.droneMode = 'ESCORT';
  const drone = createCombatDrone(station, { x: 300, y: 300 }, 'persistent-movement-drone');
  const player = createCommander('player', 700, 300, 'persistent-movement-player');
  station.escortCommanderId = player.id;
  const ai = new DroneAI();
  const startX = drone.x;
  const startY = drone.y;

  for (let tick = 1; tick <= 80; tick++) {
    ai.updateDrone(drone, player, operationalBuildingSet(station), [drone, player], [], 0.05, [], tick * 0.05);
  }

  const progress = Math.hypot(drone.x - startX, drone.y - startY);
  assert.ok(progress > 80, `Escort drone made only ${progress.toFixed(1)} px of progress over 4 seconds`);
  assert.ok((drone.stuckTimer || 0) < 0.3, 'Escort drone should not remain in a stale stuck state');
});

test('Drone visuals smoothly turn toward changing movement/aim direction', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'turning-drone-station');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 120, y: 24 }, 'turning-drone');
  drone.visualAngle = 0;
  drone.droneCombatCheckTimer = 0;
  const hostile = createCommander('enemy', 120, 180, 'turning-drone-hostile');
  const ai = new DroneAI();

  ai.updateDrone(drone, createCommander('player', -500, -500, 'turning-drone-player'), operationalBuildingSet(station), [drone, hostile], [], 0.05, [], 1);

  const angularGap = Math.abs(Math.atan2(Math.sin((drone.angle || 0) - (drone.visualAngle || 0)), Math.cos((drone.angle || 0) - (drone.visualAngle || 0))));
  assert.ok(angularGap > 0.1, 'The rendered hull should turn gradually instead of snapping to the simulation aim');
  assert.ok(angularGap < Math.PI / 2, 'The rendered hull should make progress toward its current facing target');
});

test('A drone in the safety buffer leaves at capped speed instead of being teleported', async () => {
  const { DroneAI } = await import('../ai/droneAI');
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'buffer-station');
  station.droneMode = 'ESCORT';
  const wall = createBuildingInstance('WALL', 'player', 2, 2, 'buffer-wall');
  const drone = createCombatDrone(station, { x: 72, y: 72 }, 'buffer-drone');
  const player = createCommander('player', 420, 24, 'buffer-player');
  station.escortCommanderId = player.id;
  const beforeX = drone.x;
  const beforeY = drone.y;
  new DroneAI().updateDrone(drone, player, [station, wall], [drone, player], [], 0.05, []);
  const moved = Math.hypot(drone.x - beforeX, drone.y - beforeY);
  assert.strictEqual(isCellBlockedForAir(1, 1, [station, wall]), true, 'The starting cell is inside the planning buffer');
  assert.strictEqual(isCellInsideBuildingFootprint(1, 1, [station, wall]), false, 'The drone is not physically inside the wall');
  assert.ok(moved <= 17.35, `Drone was displaced ${moved.toFixed(2)} px in 0.05s instead of moving at its 345 px/s capped speed`);
});
test('Drone flight proactively routes around structures and never enters the air-clearance zone', async () => {
  const { DroneAI } = await import('../ai/droneAI');
  const station = createBuildingInstance('DRONE_STATION', 'player', -5, -5, 'route-safety-station');
  station.droneMode = 'ESCORT';
  const wall = createBuildingInstance('WALL', 'player', 2, 0, 'route-safety-wall');
  const buildings = [station, wall];
  const drone = createCombatDrone(station, { x: -24, y: 120 }, 'route-safety-drone');
  const player = createCommander('player', 420, -44, 'route-safety-player');
  station.escortCommanderId = player.id;
  const ai = new DroneAI();
  let largestStep = 0;
  for (let i = 0; i < 90; i++) {
    const oldX = drone.x;
    const oldY = drone.y;
    ai.updateDrone(drone, player, buildings, [drone, player], [], 0.05, []);
    largestStep = Math.max(largestStep, Math.hypot(drone.x - oldX, drone.y - oldY));
    const gx = Math.floor(drone.x / GRID_SIZE);
    const gy = Math.floor(drone.y / GRID_SIZE);
    assert.strictEqual(isCellBlockedForAir(gx, gy, buildings), false, 'Drone must remain outside building clearance');
  }
  assert.ok(largestStep <= 17.35, `Drone moved ${largestStep.toFixed(2)} px in 0.05s, above the 345 px/s fixed speed cap`);
});
