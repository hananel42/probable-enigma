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

test('Blocked defense flight waits safely for a sealed route, then escapes when a real corridor opens', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'sealed-orbit-station');
  station.droneMode = 'DEFENSE';
  // Start in a physically free cell. Starting at station.x/station.y would
  // overlap the station and test embedded recovery rather than blocked routing.
  const drone = createCombatDrone(station, {
    x: GRID_SIZE * 2 + GRID_SIZE / 2,
    y: GRID_SIZE / 2
  }, 'sealed-orbit-drone');
  const player = createCommander('player', 900, 900, 'sealed-orbit-player');
  const buildings = operationalBuildingSet(station);

  // A closed perimeter makes every route to the outer patrol impossible. The
  // correct behavior is to advance the abstract orbit phase without applying
  // thrust through a wall; demanding physical movement here contradicted the
  // collision contract and made the old regression test invalid.
  for (let gx = -3; gx <= 3; gx++) {
    buildings.push(createBuildingInstance('WALL', 'player', gx, -3, `sealed-north-${gx}`, 'player'));
    buildings.push(createBuildingInstance('WALL', 'player', gx, 3, `sealed-south-${gx}`, 'player'));
  }
  for (let gy = -2; gy <= 2; gy++) {
    buildings.push(createBuildingInstance('WALL', 'player', -3, gy, `sealed-west-${gy}`, 'player'));
    buildings.push(createBuildingInstance('WALL', 'player', 3, gy, `sealed-east-${gy}`, 'player'));
  }

  const ai = new DroneAI();
  const startingPhase = drone.droneFlightPhase;
  const sealedStartX = drone.x;
  const sealedStartY = drone.y;
  for (let tick = 1; tick <= 60; tick++) {
    ai.updateDrone(drone, player, buildings, [drone, player], [], 0.05, [], tick * 0.05);
    assert.ok(Number.isFinite(drone.x) && Number.isFinite(drone.y), 'A blocked route must preserve finite coordinates');
    assert.ok(!isCellInsideBuildingFootprint(Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), buildings),
      'A blocked drone must never enter a solid building footprint');
  }

  assert.notStrictEqual(drone.droneFlightPhase, startingPhase,
    'The abstract orbit phase must keep advancing while a physical route is unavailable');
  assert.ok(Math.hypot(drone.x - sealedStartX, drone.y - sealedStartY) < GRID_SIZE,
    'A physically sealed route must hold position safely instead of repeatedly pushing into the perimeter');

  // Open a five-cell corridor. In the expanded air-clearance grid this leaves a
  // traversable cell between both wall bands; changing world geometry must cause
  // route planning to refresh and resume physical movement.
  const openingIds = new Set(Array.from({ length: 5 }, (_, index) => `sealed-north-${index - 2}`));
  let removedWalls = 0;
  for (let index = buildings.length - 1; index >= 0; index--) {
    if (openingIds.has(buildings[index].id)) {
      buildings.splice(index, 1);
      removedWalls++;
    }
  }
  assert.equal(removedWalls, openingIds.size, 'Test setup must open the intended corridor');
  const openedX = drone.x;
  const openedY = drone.y;
  for (let tick = 61; tick <= 160; tick++) {
    ai.updateDrone(drone, player, buildings, [drone, player], [], 0.05, [], tick * 0.05);
    assert.ok(Number.isFinite(drone.x) && Number.isFinite(drone.y), 'Route recovery must preserve finite coordinates');
    assert.ok(!isCellInsideBuildingFootprint(Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), buildings),
      'Replanned flight must not cross a solid building footprint');
  }
  assert.ok(Math.hypot(drone.x - openedX, drone.y - openedY) > 5,
    'The drone must resume physical movement once a valid route through the opened corridor exists');
});

test('Group identities can be changed through the authoritative engine command API', () => {
  const engine = new GameEngine();
  const group: GameGroup = {
    id: 'named-group-test', name: 'Old Name', commanderName: 'OLD-COMMANDER',
    faction: 'enemy', allianceId: 'named-group-test', color: '#123456'
  };
  engine.state.groups.push(group);
  engine.state.enemyBases.push({
    ...createTestEnemyBase('named-group-test', 'FORTIFYING'),
    teamId: group.id, groupName: group.name, commanderName: group.commanderName, groupColor: group.color
  });

  assert.strictEqual(engine.setGroupIdentity(group.id, 'Azure Nomads', 'NOVA-7', '#22aa77'), true);
  assert.strictEqual(group.name, 'Azure Nomads');
  assert.strictEqual(group.commanderName, 'NOVA-7');
  assert.strictEqual(group.color, '#22aa77');
  assert.strictEqual(engine.state.enemyBases[0].groupName, 'Azure Nomads');
  assert.strictEqual(engine.state.enemyBases[0].commanderName, 'NOVA-7');
  assert.strictEqual(engine.setGroupIdentity(group.id, '   ', 'No Name'), false, 'Blank identities are rejected');
  assert.strictEqual(engine.setGroupIdentity(group.id, 'x'.repeat(100), 'y'.repeat(100)), true);
  assert.strictEqual(group.name.length, 36);
  assert.strictEqual(group.commanderName.length, 24);
});

test('Alliance members are non-hostile, share defensive target selection, and render with the alliance color', async () => {
  const { getGroupDisplayColor, areGroupsAllied } = await import('../groups');
  const engine = new GameEngine();
  const makeGroup = (id: string, name: string, allianceId: string, color: string): GameGroup => ({
    id, name, commanderName: `${id}-COMMANDER`, faction: 'enemy', allianceId, color
  });
  const first = makeGroup('alliance-test-a', 'First', 'alliance-test-a', '#f43f5e');
  const second = makeGroup('alliance-test-b', 'Second', 'alliance-test-b', '#a78bfa');
  const hostileGroup = makeGroup('alliance-test-c', 'Hostile', 'alliance-test-c', '#fb923c');
  engine.state.groups.push(first, second, hostileGroup);

  const commanderA = createCommander('enemy', 0, 0, 'alliance-commander-a');
  commanderA.teamId = first.id;
  commanderA.allianceId = first.id;
  const commanderB = createCommander('enemy', 24, 0, 'alliance-commander-b');
  commanderB.teamId = second.id;
  commanderB.allianceId = second.id;
  const hostileCommander = createCommander('enemy', 96, 0, 'alliance-commander-c');
  hostileCommander.teamId = hostileGroup.id;
  hostileCommander.allianceId = hostileGroup.id;
  engine.state.entities.push(commanderA, commanderB, hostileCommander);

  const turret = createBuildingInstance('AUTO_TURRET', 'enemy', 0, 2, 'alliance-shared-turret', first.id);
  turret.allianceId = first.id;
  engine.state.buildings.push(turret);
  assert.strictEqual(engine.setGroupAlliance(first.id, 'green-coalition'), true);
  assert.strictEqual(engine.setGroupAlliance(second.id, 'green-coalition'), true);
  assert.strictEqual(areHostile(commanderA, commanderB), false);
  assert.strictEqual(isProjectileHostileTo({
    id: 'alliance-projectile', x: 0, y: 0, vx: 1, vy: 0, damage: 5, rangeOriginX: 0, rangeOriginY: 0, maxRange: 1000,
    faction: 'enemy',
    teamId: first.id, allianceId: 'green-coalition', color: '#4ade80', radius: 2, life: 1, maxLife: 1
  }, commanderB), false, 'Projectiles do not hit allied groups');

  const target = findPriorityHostileTarget(turret, [commanderA, commanderB, hostileCommander], engine.state.buildings);
  assert.strictEqual(target?.kind, 'ENTITY');
  assert.strictEqual(target?.kind === 'ENTITY' ? target.entity.id : '', hostileCommander.id,
    'A shared defensive turret ignores an allied commander and can target a third hostile group');
  assert.strictEqual(getGroupDisplayColor(first, engine.state.groups), '#4ade80');
  assert.strictEqual(getGroupDisplayColor(second, engine.state.groups), '#4ade80');
  assert.strictEqual(getGroupDisplayColor(hostileGroup, engine.state.groups), hostileGroup.color);
});
test('Worker task scheduler is asynchronous, bounded, and dispatches queued tasks by priority', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const fakeWorkers: Array<{
    sent: Array<{ id: number; type: string; payload: { label: string } }>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    postMessage: (message: { id: number; type: string; payload: { label: string } }) => void;
    terminate: () => void;
  }> = [];
  class FakeWorker {
    sent: Array<{ id: number; type: string; payload: { label: string } }> = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage(message: { id: number; type: string; payload: { label: string } }) { this.sent.push(message); }
    terminate() {}
    respond(message: { id: number; type: string; result: { done: string } }) {
      this.onmessage?.({ data: message } as MessageEvent);
    }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const scheduler = new WorkerTaskScheduler();
    scheduler.registerTaskType('test-task', () => {
      const worker = new FakeWorker();
      fakeWorkers.push(worker);
      return worker as unknown as Worker;
    }, 1);

    const background = scheduler.submit<{ label: string }, { done: string }>('test-task', { label: 'background' }, 'background');
    assert.ok(background);
    assert.strictEqual(fakeWorkers.length, 1);
    const normal = scheduler.submit<{ label: string }, { done: string }>('test-task', { label: 'normal' }, 'normal');
    const critical = scheduler.submit<{ label: string }, { done: string }>('test-task', { label: 'critical' }, 'critical');
    assert.ok(normal && critical);

    const worker = fakeWorkers[0] as FakeWorker;
    worker.respond({ id: worker.sent[0].id, type: 'test-task', result: { done: 'background' } });
    assert.deepStrictEqual(await background, { done: 'background' });
    assert.strictEqual(worker.sent[1].payload.label, 'critical', 'Critical work is dispatched before queued normal/background tasks');
    worker.respond({ id: worker.sent[1].id, type: 'test-task', result: { done: 'critical' } });
    assert.deepStrictEqual(await critical, { done: 'critical' });
    assert.strictEqual(worker.sent[2].payload.label, 'normal');
    worker.respond({ id: worker.sent[2].id, type: 'test-task', result: { done: 'normal' } });
    assert.deepStrictEqual(await normal, { done: 'normal' });
    assert.strictEqual(scheduler.getStats().inFlight, 0);
    scheduler.dispose();
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'Worker', originalDescriptor);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});
