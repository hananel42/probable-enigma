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

test('Enemy commander must physically collect automated-miner stockpiles using the shared station transfer', () => {
  const teamId = 'enemy-collection-team';
  const base = createTestEnemyBase(teamId, 'FORTIFYING');
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, teamId);
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', -2, -2, 'enemy-collection-station', teamId);
  station.storedWood = 25;
  station.storedStone = 18;
  const commander = createCommander('enemy', 28, -48, 'enemy-collection-commander');
  commander.teamId = teamId;
  commander.aiDecisionTimer = 2;
  base.resources = { wood: 0, stone: 0 , diamonds: 0 };

  new CommanderAI().updateCommander(
    commander,
    base.resources,
    [core, station],
    [],
    [commander],
    [],
    [base],
    0.016
  );

  assert.deepStrictEqual(base.resources, { wood: 25, stone: 18 , diamonds: 0 }, 'Wallet gains must equal the station stockpile, not an AI-generated amount');
  assert.strictEqual(station.storedWood, 0);
  assert.strictEqual(station.storedStone, 0);
  assert.strictEqual(commander.aiGoal, 'IDLE', 'Collection finishes once the stockpile is transferred');
});

test('Enemy commander can mine directly while still using stations for physical stockpile pickup', () => {
  const teamId = 'direct-mining-team';
  const base = createTestEnemyBase(teamId, 'FORTIFYING');
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, teamId);
  const emptyStation = createBuildingInstance('HARVESTER_STATION', 'enemy', -2, -2, 'direct-mining-empty-station', teamId);
  const node: ResourceNode = {
    id: 'commander-mining-node', type: 'wood', gx: 6, gy: 6,
    x: 6 * GRID_SIZE + GRID_SIZE / 2, y: 6 * GRID_SIZE + GRID_SIZE / 2,
    amount: 100, maxAmount: 100, radius: 20, seed: 29
  };
  const commander = createCommander('enemy', node.x - 55, node.y, 'direct-mining-commander');
  commander.teamId = teamId;
  commander.aiDecisionTimer = 2;
  base.resources = { wood: 0, stone: 0 , diamonds: 0 };
  const ai = new CommanderAI();

  ai.updateCommander(commander, base.resources, [core, emptyStation], [node], [commander], [], [base], 0.05);
  for (let i = 0; i < 80 && base.resources.wood === 0; i++) {
    ai.updateCommander(commander, base.resources, [core, emptyStation], [node], [commander], [], [base], 0.05);
  }

  assert.ok(base.resources.wood > 0, 'The commander can harvest a nearby node directly just as before');
  assert.ok(node.amount < 100, 'Direct mining must remove the harvested amount from the real node');
});

test('Harvester return failure never teleports to the station or deposits cargo from a distance', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'player', 20, 20, 'no-teleport-station');
  const bot = createHarvesterBot(station, { x: 24, y: 24 }, 'no-teleport-bot');
  bot.x = 24;
  bot.y = 24;
  bot.harvesterState = 'RETURNING';
  bot.cargoType = 'wood';
  bot.cargoAmount = 20;
  bot.navigationRetryCount = 3;
  bot.navigationGoalProgressTimer = 2.09;
  bot.navigationLastGoalDistance = Math.hypot(station.x - bot.x, station.y - bot.y);
  bot.lastProgressX = bot.x;
  bot.lastProgressY = bot.y;
  const before = { x: bot.x, y: bot.y };
  const ai = new HarvesterAI();

  ai.updateBot(bot, operationalBuildingSet(station), [], 0.016);

  const displacement = Math.hypot(bot.x - before.x, bot.y - before.y);
  assert.ok(displacement <= 3, `Harvester moved ${displacement.toFixed(2)} px in 16ms; it must not teleport`);
  assert.strictEqual(bot.harvesterState, 'RETURNING');
  assert.strictEqual(bot.cargoAmount, 20, 'Failed navigation must preserve the full cargo');
  assert.strictEqual(station.storedWood || 0, 0, 'Cargo is deposited only when the bot physically reaches the station');
  assert.ok(Math.hypot(bot.x - station.x, bot.y - station.y) > 88);
});
test('Enemy commander empties a saturated station even when its wallet is already stocked', () => {
  const teamId = 'full-station-pickup-team';
  const base = createTestEnemyBase(teamId, 'FORTIFYING');
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, teamId);
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', -2, -2, 'full-station-pickup-station', teamId);
  station.maxCapacity = 75;
  station.storedWood = 75;
  const commander = createCommander('enemy', station.x + 76, station.y, 'full-station-pickup-commander');
  commander.teamId = teamId;
  commander.aiDecisionTimer = 2;
  base.resources = { wood: 220, stone: 220 , diamonds: 0 };

  new CommanderAI().updateCommander(commander, base.resources, [core, station], [], [commander], [], [base], 0.016);

  assert.strictEqual(station.storedWood, 0, 'A saturated station must be emptied so haulers are not blocked forever');
  assert.strictEqual(base.resources.wood, 295, 'Only the real station stockpile is transferred');
  assert.strictEqual(commander.aiGoal, 'IDLE');
});

test('A returning harvester visibly walks to its station and deposits only on arrival', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'player', 0, 0, 'walk-home-station');
  const bot = createHarvesterBot(station, { x: 720, y: station.y }, 'walk-home-bot');
  bot.harvesterState = 'RETURNING';
  bot.cargoType = 'stone';
  bot.cargoAmount = 20;
  bot.harvesterReturnX = station.x;
  bot.harvesterReturnY = station.y;
  const ai = new HarvesterAI();
  let largestStep = 0;
  let delivered = false;

  for (let tick = 0; tick < 300; tick++) {
    const beforeX = bot.x;
    const beforeY = bot.y;
    ai.updateBot(bot, operationalBuildingSet(station), [], 0.05);
    largestStep = Math.max(largestStep, Math.hypot(bot.x - beforeX, bot.y - beforeY));
    if ((bot.cargoAmount || 0) === 0) {
      delivered = true;
      break;
    }
  }

  assert.ok(delivered, "A reachable station should eventually receive the returning bot cargo");
  assert.strictEqual(station.storedStone, 20);
  assert.strictEqual(bot.harvesterState, 'IDLE');
  assert.ok(largestStep <= bot.speed * 0.05 + 0.1,
    `The harvester moved ${largestStep.toFixed(2)} px in one 50ms frame, suggesting a teleport`);
});

test('A full station accepts only available capacity and the harvester keeps the overflow', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'player', 0, 0, 'capacity-station');
  station.maxCapacity = 75;
  station.storedWood = 74;
  const bot = createHarvesterBot(station, { x: station.x + 72, y: station.y }, 'capacity-bot');
  bot.harvesterState = 'RETURNING';
  bot.cargoType = 'wood';
  bot.cargoAmount = 20;
  const ai = new HarvesterAI();

  ai.updateBot(bot, operationalBuildingSet(station), [], 0.016);
  assert.strictEqual(station.storedWood, 75);
  assert.strictEqual(bot.cargoAmount, 19, 'The overflow remains in the harvester instead of being destroyed');
  assert.strictEqual(bot.cargoType, 'wood');
  assert.strictEqual(bot.harvesterState, 'RETURNING');
});

test('Drone patrol targets move smoothly instead of racing around an enlarged base', async () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'smooth-patrol-station');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 24, y: -100 }, 'smooth-patrol-drone');
  const player = createCommander('player', 900, 900, 'smooth-patrol-player');
  const ai = new DroneAI();
  let largestGoalStep = 0;
  ai.updateDrone(drone, player, operationalBuildingSet(station), [drone, player], [], 0.05, [], 0.05);
  for (let i = 2; i <= 100; i++) {
    const beforeX = drone.droneFlightGoalX!;
    const beforeY = drone.droneFlightGoalY!;
    ai.updateDrone(drone, player, operationalBuildingSet(station), [drone, player], [], 0.05, [], i * 0.05);
    largestGoalStep = Math.max(largestGoalStep, Math.hypot(drone.droneFlightGoalX! - beforeX, drone.droneFlightGoalY! - beforeY));
  }
  assert.ok(largestGoalStep < 20, `The continuously advancing orbit target jumped ${largestGoalStep.toFixed(2)} px in one 50ms tick`);
});
