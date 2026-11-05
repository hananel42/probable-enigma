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

test('Non-turret upgrades have real gameplay effects and current stats are exposed to the inspector', () => {
  const wall = createBuildingInstance('WALL', 'player', 0, 0);
  const armoredWall = upgradeBuildingStats(wall, 'reactive-armor');
  const applied = applyBuildingDamage(armoredWall, 100);
  assert.strictEqual(applied.damage, 82, 'Reactive armor reduces incoming damage by 18%');

  const harvesterStation = createBuildingInstance('HARVESTER_STATION', 'player', 1, 1);
  const cargoUpgrade = upgradeBuildingStats(harvesterStation, 'deep-silo');
  assert.ok((cargoUpgrade.maxCapacity || 0) > (harvesterStation.maxCapacity || 0));
  const extractionUpgrade = upgradeBuildingStats(cargoUpgrade);
  const fasterRovers = upgradeBuildingStats(extractionUpgrade, 'rapid-extraction');
  assert.ok((fasterRovers.miningSpeedMultiplier || 1) > 1, 'The extraction upgrade sets a multiplier consumed by rover AI');
  const activeRover = createHarvesterBot(fasterRovers);
  assert.ok((activeRover.cargoCapacity || 0) >= 20, 'Cargo capacity remains valid after station upgrades');

  const droneStation = createBuildingInstance('DRONE_STATION', 'player', 2, 2);
  const hardenedStation = upgradeBuildingStats(droneStation, 'hardened-drone-frames');
  const drone = createCombatDrone(hardenedStation);
  assert.ok(drone.maxHp > 70, "The drone station health upgrade affects newly deployed drones");
  assert.ok((drone.damage || 0) > 0 && (drone.speed || 0) > 0);

  const fireTower = createBuildingInstance('FIRE_TOWER', 'player', 3, 3);
  const infernoTower = upgradeBuildingStats(fireTower, 'flashover-coils');
  assert.ok((infernoTower.burnDamagePerSecond || 0) > (fireTower.burnDamagePerSecond || 0));
  assert.ok((infernoTower.effectDuration || 0) > (fireTower.effectDuration || 0));
  assert.ok(getBuildingStatLines(infernoTower).some(line => line.label === 'WAVE RADIUS'));
  assert.ok(getBuildingStatLines(armoredWall).some(line => line.label === 'DAMAGE REDUCTION'));
});
test('Drone-station upgrades propagate to deployed drones without free full healing', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'live-upgrade-drone-station');
  const drone = createCombatDrone(station, { x: 400, y: 400 }, 'live-upgrade-drone');
  drone.hp = 35;
  const originalMaxHp = drone.maxHp;
  const upgraded = upgradeBuildingStats(station, 'hardened-drone-frames');
  Object.assign(station, upgraded);

  const player = createCommander('player', 900, 900, 'live-upgrade-player');
  new DroneAI().updateDrone(drone, player, operationalBuildingSet(station), [drone, player], [], 0.016, [], 1);
  assert.strictEqual(drone.maxHp, 88);
  assert.strictEqual(drone.hp, 44, 'The max-HP increase must preserve the existing 50% health ratio');
  assert.ok(drone.maxHp > originalMaxHp);
  assert.deepStrictEqual(getAppliedUpgradeNames(station), ['Hardened Drone Frames']);
});

test('A* pathfinding routes ground units around wall obstacles', () => {
  const dummyBuildings: Building[] = [
    createBuildingInstance('WALL', 'player', 1, 0)
  ];
  const dummyResources: ResourceNode[] = [];

  // Path from (0, 0) to (2, 0) where (1, 0) has a wall
  const path = findPath(0, 0, 2 * 48, 0, false, dummyBuildings, dummyResources);
  assert.ok(path.length > 0, 'Path should be found');
  // Confirm no node in path passes through the blocked cell (1, 0)
  const hitsWall = path.some((node: any) => node.gx === 1 && node.gy === 0);
  assert.strictEqual(hitsWall, false, 'Path must not step on the wall');
});

test('A* pathfinding allows aerial units (isFlying=true) to fly over resource nodes', () => {
  const dummyBuildings: Building[] = [];
  const dummyResources: ResourceNode[] = [
    { id: 'tree-1', type: 'wood', gx: 1, gy: 0, x: 1 * 48 + 24, y: 0 * 48 + 24, amount: 50, maxAmount: 50, radius: 20, seed: 1 }
  ];

  // For air units, resources are not obstacles
  const airPath = findPath(0, 0, 2 * 48, 0, true, dummyBuildings, dummyResources);
  assert.ok(airPath.length > 0);
  // Air path can fly directly through (1, 0)
  const stepsOnTree = airPath.some((node: any) => node.gx === 1 && node.gy === 0);
  assert.strictEqual(stepsOnTree, true, 'Flying drone path can cross resource node cell');
});


test('Combat teams let different enemy outposts fight without friendly fire inside one outpost', () => {
  const alpha = createCommander('enemy', 0, 0, 'alpha-commander');
  alpha.teamId = 'enemy-base-alpha';
  const alphaDrone = createCommander('enemy', 30, 0, 'alpha-support');
  alphaDrone.teamId = 'enemy-base-alpha';
  const beta = createCommander('enemy', 100, 0, 'beta-commander');
  beta.teamId = 'enemy-base-beta';

  assert.strictEqual(areHostile(alpha, alphaDrone), false);
  assert.strictEqual(areHostile(alpha, beta), true);
  const result = findClosestHostileEntity(alpha, [alphaDrone, beta]);
  assert.strictEqual(result?.entity.id, 'beta-commander');
});

test('Commander projectile evasion predicts a dangerous hit and selects a lateral dodge', () => {
  const commander = createCommander('player', 100, 100, 'dodge-source');
  const projectile = {
    id: 'incoming-shot', x: 170, y: 100, vx: -200, vy: 0,
    damage: 20, rangeOriginX: 170, rangeOriginY: 100, maxRange: 1000,
    faction: 'enemy' as const, teamId: 'enemy-team',
    color: '#f00', radius: 4, life: 1, maxLife: 1
  };
  const dodge = getProjectileDodgeDirection(commander, [projectile]);
  assert.ok(dodge, 'A direct incoming shot should be detected before impact');
  assert.ok(Math.abs(dodge!.x) < 1e-6, 'Dodge should be perpendicular to horizontal fire');
  assert.ok(Math.abs(Math.abs(dodge!.y) - 1) < 1e-6, 'Dodge direction should be normalized');
  assert.ok(dodge!.timeToClosestApproach > 0 && dodge!.timeToClosestApproach < 0.58);
});

test('Combat targeting chooses an armed enemy before a closer harmless unit', () => {
  const source = createCommander('player', 24, 24, 'target-source');
  const enemyStation = createBuildingInstance('HARVESTER_STATION', 'enemy', 2, 0, 'enemy-mining-hub', 'enemy-base-target');
  const harmless = createHarvesterBot(enemyStation, { x: 40, y: 24 }, 'nearby-harvester');
  const armed = createCommander('enemy', 140, 24, 'armed-enemy');
  armed.teamId = 'enemy-base-target';
  const target = findPriorityHostileTarget(source, [source, harmless, armed], [], 400);
  assert.strictEqual(target?.kind, 'ENTITY');
  if (target?.kind === 'ENTITY') assert.strictEqual(target.entity.id, 'armed-enemy');
});

test('Combat targeting chooses a hostile weapon building before the enemy Core', () => {
  const source = createCommander('player', 24, 24, 'turret-priority-source');
  const core = createBuildingInstance('CORE', 'enemy', 2, 0, 'enemy-spawn', 'enemy-target-team');
  const turret = createBuildingInstance('AUTO_TURRET', 'enemy', 4, 0, 'enemy-defense-turret', 'enemy-target-team');
  const target = findPriorityHostileTarget(source, [source], [core, turret], 600);
  assert.strictEqual(target?.kind, 'BUILDING');
  if (target?.kind === 'BUILDING') assert.strictEqual(target.building.id, 'enemy-defense-turret');
});

test('After enemy weapons are absent, the hostile Core/spawn outranks closer infrastructure', () => {
  const source = createCommander('player', 24, 24, 'spawn-priority-source');
  const nearbyStation = createBuildingInstance('HARVESTER_STATION', 'enemy', 1, 0, 'nearby-enemy-industry', 'enemy-target-team');
  const core = createBuildingInstance('CORE', 'enemy', 5, 0, 'priority-enemy-spawn', 'enemy-target-team');
  const target = findPriorityHostileTarget(source, [source], [nearbyStation, core], 700);
  assert.strictEqual(target?.kind, 'BUILDING');
  if (target?.kind === 'BUILDING') assert.strictEqual(target.building.id, 'priority-enemy-spawn');
});

test('A* supports long-distance routes beyond the old 200-step ceiling', () => {
  const path = findPath(24, 24, 250 * GRID_SIZE + 24, 24, false, [], []);
  assert.ok(path.length > 200, `Expected more than 200 waypoints, got ${path.length}`);
  assert.strictEqual(path[path.length - 1].gx, 250);
  assert.strictEqual(path[path.length - 1].gy, 0);
});

test('Autonomous harvesters select known resources beyond the former local radius', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', 0, 0, 'remote-station', 'enemy-base-remote');
  const node: ResourceNode = {
    id: 'remote-tree', type: 'wood', gx: 30, gy: 0,
    x: 30 * GRID_SIZE + GRID_SIZE / 2, y: GRID_SIZE / 2,
    amount: 50, maxAmount: 50, radius: 20, seed: 7
  };
  const bot = createHarvesterBot(station, { x: 2 * GRID_SIZE + GRID_SIZE / 2, y: GRID_SIZE / 2 }, 'remote-bot');
  const ai = new HarvesterAI();

  ai.updateBot(bot, operationalBuildingSet(station), [node], 0.016);
  assert.strictEqual(bot.targetResourceId, 'remote-tree');
  assert.strictEqual(bot.harvesterState, 'NAVIGATING_TO_RESOURCE');
});

test('Autonomous harvesters skip a resource type whose station stockpile is full', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', 0, 0, 'partly-full-station', 'enemy-partly-full');
  station.maxCapacity = 75;
  station.storedWood = 75;
  station.storedStone = 0;
  const bot = createHarvesterBot(station, { x: 120, y: 24 }, 'partly-full-bot');
  const woodNode: ResourceNode = { id: 'wood-no-room', type: 'wood', gx: Math.floor(130 / GRID_SIZE), gy: 0, x: 130, y: 24, amount: 50, maxAmount: 50, radius: 18, seed: 1 };
  const stoneNode: ResourceNode = { id: 'stone-room', type: 'stone', gx: Math.floor(145 / GRID_SIZE), gy: 0, x: 145, y: 24, amount: 50, maxAmount: 50, radius: 18, seed: 2 };
  new HarvesterAI().updateBot(bot, operationalBuildingSet(station), [woodNode, stoneNode], 0.016);
  assert.equal(bot.targetResourceId, 'stone-room', 'the bot should choose a resource the station can still store');
  assert.ok(bot.harvesterState === 'NAVIGATING_TO_RESOURCE' || bot.harvesterState === 'MINING', 'the bot should work only on the storable stone resource');
});

test('Autonomous harvesters wait instead of starting trips when both station stockpiles are full', () => {
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', 0, 0, 'full-station', 'enemy-full-station');
  station.maxCapacity = 75;
  station.storedWood = 75;
  station.storedStone = 75;
  const bot = createHarvesterBot(station, { x: 120, y: 24 }, 'full-station-bot');
  const node: ResourceNode = { id: 'unstoreable-resource', type: 'wood', gx: Math.floor(130 / GRID_SIZE), gy: 0, x: 130, y: 24, amount: 50, maxAmount: 50, radius: 18, seed: 3 };
  new HarvesterAI().updateBot(bot, operationalBuildingSet(station), [node], 0.016);
  assert.equal(bot.harvesterState, 'IDLE');
  assert.equal(bot.targetResourceId, null);
  assert.equal(node.amount, 50, 'the bot must not extract material that cannot be deposited');
});

test('Enemy harvesters deposit only into station storage; they do not mint wallet resources', () => {
  const teamId = 'enemy-economy-team';
  const station = createBuildingInstance('HARVESTER_STATION', 'enemy', -2, -2, 'enemy-economy-station', teamId);
  const bot = createHarvesterBot(station, { x: 24, y: -48 }, 'enemy-economy-bot');
  bot.harvesterState = 'RETURNING';
  bot.cargoType = 'wood';
  bot.cargoAmount = 17;

  const ai = new HarvesterAI();
  ai.updateBot(bot, operationalBuildingSet(station), [], 0.016);

  assert.strictEqual(station.storedWood, 17, 'The bot should deposit its cargo at the shared station inventory');
  assert.strictEqual(station.storedStone, 0);
  assert.strictEqual(bot.cargoAmount, 0, 'Delivered cargo should be removed from the bot');
  assert.strictEqual(bot.cargoType, null);
  // There is deliberately no EnemyBase/wallet argument to the harvester API:
  // only a commander collecting this stockpile may transfer it to the wallet.
});
