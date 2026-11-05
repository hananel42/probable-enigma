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

test('Enemy commander AI salvages inert structures after its Core is gone', () => {
  const commander = createCommander('enemy', 120, 120, 'salvager-commander');
  const abandoned = createBuildingInstance('WALL', 'enemy', 2, 2, 'salvage-wall', 'enemy-dead-core');
  const buildings = [abandoned];
  const wallet = { wood: 0, stone: 0 , diamonds: 0 };
  const ai = new CommanderAI();
  const expected = getBuildingSalvageRefund(abandoned);
  ai.updateCommander(commander, wallet, buildings, [], [commander], [], [], 0.016);
  // The commander starts directly on the orphaned wall, so selecting and
  // executing the dismantle goal can complete in the same update.
  assert.ok(!buildings.some(building => building.id === abandoned.id));
  assert.strictEqual(wallet.wood, expected.wood);
  assert.strictEqual(wallet.stone, expected.stone);
});

test('Disconnected participants are never used as procedural enemy outpost spawn anchors', () => {
  const engine = new GameEngine();
  const guest = engine.addHumanParticipant('guest-anchor-regression');
  const guestCommander = engine.state.entities.find(entity => entity.id === guest.commanderId);
  if (!guestCommander) throw new Error('The guest commander must exist before testing disconnection.');
  guestCommander.x = 500_000;
  guestCommander.y = 500_000;
  assert.equal(engine.setHumanParticipantConnected(guest.playerId, false), true);

  engine.state.gameTime = 260;
  (engine as unknown as { updateEnemyBases(dt: number): void }).updateEnemyBases(1 / 30);

  assert.equal(engine.state.enemyBases.length, 2, 'both scheduled outposts should spawn');
  for (const outpost of engine.state.enemyBases) {
    assert.ok(Math.hypot(outpost.x - guestCommander.x, outpost.y - guestCommander.y) > 100_000,
      'outposts must be anchored to connected participants, never the disconnected guest');
  }
});

test('Simulation remains live when the first procedural enemy outpost spawns in the shared simulation', () => {
  const engine = new GameEngine();
  for (let i = 0; i < 182; i++) engine.step(0.5);
  assert.ok(engine.state.enemyBases.length >= 1, 'the first hostile outpost should spawn after the opening delay');
  const before = engine.state.gameTime;
  engine.step(0.25);
  assert.ok(engine.state.gameTime > before, 'simulation must continue advancing after enemy creation');
  assert.ok(engine.state.entities.some(entity => entity.id === engine.state.enemyBases[0].commanderId), 'spawned commander remains in the world');
});
test('A rejected asynchronous drone flight path clears its pending lock and enables patrol recovery', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  interface FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    onmessageerror: (() => void) | null;
    postMessage: (message: { id: number; type: string }) => void;
    terminate: () => void;
  }
  const fakeWorkers: FakePathWorker[] = [];
  class FakeWorker implements FakePathWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    constructor() { fakeWorkers.push(this); }
    postMessage(_message: { id: number; type: string }) {}
    terminate() {}
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker });
  try {
    // The pathfinding scheduler is lazy, so the fake Worker is only observed when
    // this request starts. No application-wide Worker state is changed otherwise.
    const drone = createCombatDrone(
      createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'failed-path-station'),
      { x: 0, y: 0 },
      'failed-path-drone'
    );
    const building = createBuildingInstance('WALL', 'enemy', 20, 20, 'failed-path-obstacle');
    const moved = moveEntityAlongPath(drone, 1200, 0, [building], [], 0.05, 12, 345, 'smooth');
    assert.strictEqual(moved, false, 'A drone awaiting its first route should not teleport or claim movement');
    assert.strictEqual(isEntityPathPending(drone), true, 'The worker request must be tracked while pending');
    assert.strictEqual(fakeWorkers.length, 1, 'The pathfinding worker should be created lazily when the first path is requested');
    fakeWorkers[0].onerror?.({ message: 'simulated pathfinding worker crash' } as ErrorEvent);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.strictEqual(isEntityPathPending(drone), false, 'A rejected path must release the pending lock rather than freezing orbit entry forever');
    assert.strictEqual(drone.pathFailureCount, 1, 'A rejected path enters the existing bounded retry/backoff policy');
    assert.ok(errors.length > 0, 'Worker and entity path failures must remain visible to developers');
  } finally {
    console.error = originalConsoleError;
    if (originalDescriptor) Object.defineProperty(globalThis, 'Worker', originalDescriptor);
    else delete (globalThis as { Worker?: typeof Worker }).Worker;
  }
});
