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

test('Worker scheduler retires timed-out jobs and creates a replacement worker for later tasks', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  const fakeWorkers: Array<{
    sent: Array<{ id: number; type: string; payload: { label: string } }>;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    postMessage: (message: { id: number; type: string; payload: { label: string } }) => void;
    terminate: () => void;
    respond: (message: { id: number; type: string; result: { done: string } }) => void;
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
    const scheduler = new WorkerTaskScheduler(12);
    scheduler.registerTaskType('recoverable-task', () => {
      const worker = new FakeWorker();
      fakeWorkers.push(worker);
      return worker as unknown as Worker;
    }, 1);

    const hanging = scheduler.submit<{ label: string }, { done: string }>('recoverable-task', { label: 'hang' });
    assert.ok(hanging);
    await assert.rejects(hanging, /deadline/i, 'A worker that never responds must reject instead of owning a task forever');
    assert.strictEqual(scheduler.getStats().inFlight, 0);
    assert.strictEqual(scheduler.getStats().failedTaskTypes.length, 0, 'A single timed-out worker must not poison the task type');
    assert.strictEqual(fakeWorkers.length, 1);

    const retry = scheduler.submit<{ label: string }, { done: string }>('recoverable-task', { label: 'retry' });
    assert.ok(retry);
    assert.strictEqual(fakeWorkers.length, 2, 'Subsequent work must use a replacement worker slot');
    const replacement = fakeWorkers[1];
    replacement.respond({ id: replacement.sent[0].id, type: 'recoverable-task', result: { done: 'recovered' } });
    assert.deepStrictEqual(await retry, { done: 'recovered' });
    assert.ok(errors.length > 0, 'The timed-out task must be reported for diagnostics');
    scheduler.dispose();
  } finally {
    console.error = originalConsoleError;
    if (originalDescriptor) Object.defineProperty(globalThis, 'Worker', originalDescriptor);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});

test('Worker scheduler rejects non-cloneable payloads before creating a job or worker', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    postMessage() {}
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    const scheduler = new WorkerTaskScheduler();
    scheduler.registerTaskType('clone-check', () => new FakeWorker() as unknown as Worker);
    assert.throws(() => scheduler.submit('clone-check', { callback: () => 'not cloneable' }));
    assert.deepStrictEqual(scheduler.getStats(), { queued: 0, inFlight: 0, workers: 0, failedTaskTypes: [] },
      'Clone errors must happen before the scheduler allocates a promise, queue entry, or worker slot');
    scheduler.dispose();
  } finally {
    if (originalDescriptor) Object.defineProperty(globalThis, 'Worker', originalDescriptor);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});

test('Alliance changes invalidate cached defensive coverage between separately owned groups', () => {
  const stationA = createBuildingInstance('DRONE_STATION', 'enemy', 0, 0, 'allied-coverage-a', 'coverage-group-a');
  const stationB = createBuildingInstance('DRONE_STATION', 'enemy', 2, 0, 'allied-coverage-b', 'coverage-group-b');
  stationA.allianceId = 'coverage-group-a';
  stationB.allianceId = 'coverage-group-b';
  const buildings = [stationA, stationB];
  const ai = new DroneAI();
  assert.strictEqual(ai.getConnectedBuildingCluster(stationA, buildings).length, 1,
    'Independent groups do not share one defensive compound before alliance');

  stationA.allianceId = 'shared-coverage-alliance';
  stationB.allianceId = 'shared-coverage-alliance';
  ai.invalidateGroupRelations();
  assert.strictEqual(ai.getConnectedBuildingCluster(stationA, buildings).length, 2,
    'The alliance now shares defensive coverage after cache invalidation');
});


test('Allied outposts do not mistake a partner commander for a local hostile', () => {
  const base = createTestEnemyBase('allied-outpost-a', 'FORTIFYING');
  base.allianceId = 'shared-outpost-alliance';
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, base.id);
  core.allianceId = base.allianceId;
  const allyCommander = createCommander('enemy', 120, 24, 'allied-outpost-commander');
  allyCommander.teamId = 'allied-outpost-b';
  allyCommander.allianceId = 'shared-outpost-alliance';
  const ai = new EnemyCommanderAI();
  ai.updateBase(base, [core], [allyCommander], [], 1, 0.05);
  assert.strictEqual(base.stance, 'FORTIFYING', 'Alliance members are not treated as local hostile threats');
});



test('Simulation step preserves elapsed time with bounded substeps and rejects invalid deltas', () => {
  const engine = new GameEngine();
  engine.step(0.25);
  assert.ok(Math.abs(engine.state.gameTime - 0.25) < 1e-8,
    'A 250ms frame should advance the simulation by 250ms, not silently drop 150ms');
  const before = engine.state.gameTime;
  assert.throws(() => engine.step(Number.NaN), /finite and non-negative/);
  assert.throws(() => engine.step(Number.POSITIVE_INFINITY), /finite and non-negative/);
  assert.throws(() => engine.step(-1), /finite and non-negative/);
  assert.strictEqual(engine.state.gameTime, before, 'Invalid deltas must fail before mutating simulation time');
  engine.step(5);
  assert.ok(Math.abs(engine.state.gameTime - (before + 0.5)) < 1e-8,
    'A long suspension is capped to a bounded 500ms catch-up');
});

test('Economy helpers reject malformed values and never resurrect destroyed structures', () => {
  const malformedWallet = { wood: Number.NaN, stone: 50, diamonds: 0 };
  assert.throws(() => canAfford(malformedWallet, { wood: 1, stone: 1, diamonds: 0 }), /Wallet wood must be finite/);
  assert.throws(() => deductCost(malformedWallet, { wood: 1, stone: 10, diamonds: 0 }), /Wallet wood must be finite/);
  assert.deepStrictEqual(deductCost({ wood: 20, stone: 50, diamonds: 0 }, { wood: 1, stone: 10, diamonds: 0 }), { wood: 19, stone: 40, diamonds: 0 });

  const deadWall = createBuildingInstance('WALL', 'player', 0, 0, 'dead-repair-wall');
  deadWall.hp = 0;
  const result = repairBuilding(deadWall, { wood: 1000, stone: 1000, diamonds: 0 });
  assert.strictEqual(result.healed, 0);
  assert.strictEqual(result.building.hp, 0, 'A stale repair command must not resurrect a destroyed building');

  assert.strictEqual(isAreaBuildable(Number.NaN, 0, 1, 1, [], []), false);
  assert.strictEqual(isAreaBuildable(0, 0, 0, 1, [], []), false);
  assert.strictEqual(isAreaBuildable(0.5, 0, 1, 1, [], []), false);
});

test('Automated target selection excludes gray structures whose Core is gone', () => {
  const source = createCommander('player', 0, 0, 'gray-target-test-source');
  source.teamId = 'player';
  const abandonedTurret = createBuildingInstance('AUTO_TURRET', 'enemy', 1, 0, 'abandoned-turret', 'enemy-dead-team');
  abandonedTurret.coreId = 'missing-enemy-core';

  assert.equal(isBuildingOperational(abandonedTurret, [abandonedTurret]), false);
  assert.equal(findPriorityHostileTarget(source, [source], [abandonedTurret], 500), undefined,
    'drones, commanders, and turrets share a target selector that ignores inert structures');
});

test('An already-flying projectile cannot damage an orphaned gray structure', () => {
  const engine = new GameEngine();
  const abandonedWall = createBuildingInstance('WALL', 'enemy', 1, 0, 'projectile-gray-wall', 'enemy-dead-team');
  abandonedWall.coreId = 'missing-enemy-core';
  engine.state.buildings = [abandonedWall];
  const beforeHp = abandonedWall.hp;
  const projectile: Projectile = {
    id: 'projectile-to-gray-wall', x: abandonedWall.x, y: abandonedWall.y,
    vx: 0, vy: 0, damage: 60, rangeOriginX: abandonedWall.x, rangeOriginY: abandonedWall.y, maxRange: 1000,
    faction: 'player', teamId: 'player', allianceId: 'player',
    color: '#38bdf8', radius: 4, life: 1, maxLife: 1
  };
  engine.state.projectiles = [projectile];

  (engine as unknown as { updateProjectiles(dt: number): void }).updateProjectiles(0.016);

  assert.equal(abandonedWall.hp, beforeHp, 'orphaned salvage remains inert and does not take combat damage');
  assert.equal(engine.state.projectiles.length, 1, 'the projectile passes through an inert structure');
});

test('Auto-turrets acquire a live target, fire, and skip nearer gray orphan structures', () => {
  const engine = new GameEngine();
  const playerCore = createBuildingInstance('CORE', 'player', -4, -4, 'live-player-core', 'player');
  playerCore.teamId = 'group-host';
  playerCore.allianceId = 'alliance-humans';
  playerCore.coreId = playerCore.id;
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 0, 0, 'live-player-turret', 'group-host');
  turret.allianceId = 'alliance-humans';
  turret.coreId = playerCore.id;
  const abandonedWall = createBuildingInstance('WALL', 'enemy', 1, 0, 'inert-enemy-wall', 'enemy-dead-team');
  abandonedWall.coreId = 'missing-enemy-core';
  const liveEnemyCore = createBuildingInstance('CORE', 'enemy', 3, 0, 'live-enemy-core', 'enemy-live-team');
  liveEnemyCore.coreId = liveEnemyCore.id;
  engine.state.buildings = [playerCore, turret, abandonedWall, liveEnemyCore];
  engine.state.entities = [engine.state.player];
  engine.state.projectiles = [];

  (engine as unknown as { updateBuildings(dt: number): void }).updateBuildings(0.5);

  assert.equal(turret.targetBuildingId, liveEnemyCore.id, 'target scanning must use the shared policy and reject the nearer gray structure');
  assert.ok(engine.state.projectiles.length > 0, 'an operational turret with a live hostile target must spawn projectiles');
  assert.ok(engine.state.projectiles.every(projectile => projectile.teamId === 'group-host'));
});
