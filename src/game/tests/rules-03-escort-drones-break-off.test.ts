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

test('Escort drones break off a fleeing target instead of reacquiring it beyond drone pursuit range', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'escort-range-station');
  station.droneMode = 'ESCORT';
  const commander = createCommander('player', 0, 0, 'escort-range-commander');
  station.escortCommanderId = commander.id;
  const drone = createCombatDrone(station, { x: -100, y: 0 }, 'escort-range-drone');
  const hostile = createCommander('enemy', 80, 0, 'escort-range-hostile');
  const entities = [drone, commander, hostile];
  const ai = new DroneAI();
  drone.droneCombatCheckTimer = 0;

  ai.updateDrone(drone, commander, operationalBuildingSet(station), entities, [], 0.05, [], 1);
  assert.equal(drone.droneTargetEntityId, hostile.id, 'The drone should initially engage a nearby hostile');

  hostile.x = 450; // Still inside the commander's 10-tile tether, but outside this drone's pursuit envelope.
  drone.droneCombatCheckTimer = 0;
  ai.updateDrone(drone, commander, operationalBuildingSet(station), entities, [], 0.05, [], 1.05);

  assert.equal(drone.droneTargetEntityId, null, "The same out-of-range target must not be reacquired from the commander's tether");
  assert.equal(drone.droneCombatOrbitTargetId, null, 'Breakoff must release the previous combat orbit');
  assert.equal(drone.droneFlightCenterId, 'escort:escort-range-commander', 'Breakoff must immediately restore the live commander as the active flight centre');

  let travelledDistance = 0;
  let largestStep = 0;
  for (let step = 0; step < 36; step++) {
    const oldX = drone.x;
    const oldY = drone.y;
    ai.updateDrone(drone, commander, operationalBuildingSet(station), entities, [], 0.05, [], 1.1 + step * 0.05);
    const movementStep = Math.hypot(drone.x - oldX, drone.y - oldY);
    travelledDistance += movementStep;
    largestStep = Math.max(largestStep, movementStep);
  }
  assert.ok(travelledDistance > 35, 'An escort drone must physically return toward the commander after breaking off a chase');
  assert.ok(largestStep <= Math.min(drone.speed, 345) * 0.05 + 1,
    `An escort drone must return at capped flight speed, not teleport ${largestStep.toFixed(2)} px in one 50ms step`);
});

test('Proportional repair cost math strictly matches damaged HP fraction', () => {
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 0, 0);
  const maxHp = turret.maxHp;
  const bpCost = BUILDING_BLUEPRINTS.AUTO_TURRET.cost;

  // 100% health -> 0 cost
  turret.hp = maxHp;
  const fullCost = getRepairCost(turret);
  assert.strictEqual(fullCost.wood, 0);
  assert.strictEqual(fullCost.stone, 0);

  // 50% damage -> exactly 50% cost
  turret.hp = Math.round(maxHp * 0.5);
  const halfCost = getRepairCost(turret);
  assert.strictEqual(halfCost.wood, Math.round(bpCost.wood * 0.5));
  assert.strictEqual(halfCost.stone, Math.round(bpCost.stone * 0.5));

  // 100% damage -> full cost
  turret.hp = 1;
  const deadCost = getRepairCost(turret);
  assert.strictEqual(deadCost.wood, bpCost.wood);
  assert.strictEqual(deadCost.stone, bpCost.stone);
});

test('Salvage refund is half the invested value and scales with remaining HP, including upgrades', () => {
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 0, 0, 'salvage-turret');
  const baseCost = BUILDING_BLUEPRINTS.AUTO_TURRET.cost;
  const fullRefund = getBuildingSalvageRefund(turret);
  assert.strictEqual(fullRefund.wood, Math.floor(baseCost.wood * 0.5));
  assert.strictEqual(fullRefund.stone, Math.floor(baseCost.stone * 0.5));

  turret.level = 2;
  turret.maxHp = 330;
  turret.hp = 165;
  const halfHealthRefund = getBuildingSalvageRefund(turret);
  const investedWood = baseCost.wood + Math.round(baseCost.wood * 1.75);
  const investedStone = baseCost.stone + Math.round(baseCost.stone * 1.75);
  assert.strictEqual(halfHealthRefund.wood, Math.floor(investedWood * 0.5 * 0.5));
  assert.strictEqual(halfHealthRefund.stone, Math.floor(investedStone * 0.5 * 0.5));
});

test('repairBuilding restores HP and properly deducts resources', () => {
  const wall = createBuildingInstance('WALL', 'player', 1, 1);
  wall.hp = Math.round(wall.maxHp * 0.5);

  const wallet: Resources = { wood: 50, stone: 50 , diamonds: 0 };
  const res = repairBuilding(wall, wallet);

  assert.strictEqual(res.building.hp, wall.maxHp, 'Repaired building should have max HP');
  assert.ok(res.wallet.wood < wallet.wood, 'Wallet wood should be deducted');
  assert.ok(res.wallet.stone < wallet.stone, 'Wallet stone should be deducted');
});

test('snapToGrid correctly aligns world coordinates to 48px grid cells', () => {
  const snapped = snapToGrid(50, 99, 48);
  assert.strictEqual(snapped.gx, 1);
  assert.strictEqual(snapped.gy, 2);
  assert.strictEqual(snapped.x, 1 * 48 + 24);
  assert.strictEqual(snapped.y, 2 * 48 + 24);
});

test('Ground units are blocked by both resources and buildings', () => {
  const dummyBuildings: Building[] = [
    createBuildingInstance('WALL', 'player', 3, 3)
  ];
  const dummyResources: ResourceNode[] = [
    { id: 'tree-1', type: 'wood', gx: 4, gy: 4, x: 4 * 48 + 24, y: 4 * 48 + 24, amount: 50, maxAmount: 50, radius: 20, seed: 1 }
  ];

  // Cell with building
  assert.strictEqual(isCellBlockedForGround(3, 3, dummyBuildings, dummyResources), true);
  // Cell with resource
  assert.strictEqual(isCellBlockedForGround(4, 4, dummyBuildings, dummyResources), true);
  // Empty cell
  assert.strictEqual(isCellBlockedForGround(5, 5, dummyBuildings, dummyResources), false);
});

test('Aerial Drones fly over resources freely but are blocked by buildings and walls', () => {
  const dummyBuildings: Building[] = [
    createBuildingInstance('WALL', 'player', 2, 2)
  ];
  const dummyResources: ResourceNode[] = [
    { id: 'rock-1', type: 'stone', gx: 3, gy: 3, x: 3 * 48 + 24, y: 3 * 48 + 24, amount: 80, maxAmount: 80, radius: 20, seed: 2 }
  ];

  // Drones are blocked by buildings/walls
  assert.strictEqual(isCellBlockedForAir(2, 2, dummyBuildings), true);
  // Resources do not obstruct flight once outside the building clearance area.
  assert.strictEqual(isCellBlockedForAir(5, 5, dummyBuildings), false);
  assert.strictEqual(isCellBlockedForAir(1, 2, dummyBuildings), true, 'Air navigation should preserve a wide clearance from walls');
  assert.strictEqual(isCellBlockedForAir(0, 2, dummyBuildings), true, 'A second clearance tile should keep drones away from tight structure corners');
  assert.strictEqual(isCellBlockedForAir(5, 2, dummyBuildings), false, 'Air clearance should end beyond the two-tile safety buffer');
});

test('isCellBuildable forbids building on cells with resources or existing buildings', () => {
  const dummyBuildings: Building[] = [
    createBuildingInstance('AUTO_TURRET', 'player', 0, 0)
  ];
  const dummyResources: ResourceNode[] = [
    { id: 'tree-1', type: 'wood', gx: 1, gy: 1, x: 1 * 48 + 24, y: 1 * 48 + 24, amount: 40, maxAmount: 40, radius: 20, seed: 3 }
  ];

  assert.strictEqual(isCellBuildable(0, 0, dummyBuildings, dummyResources), false, 'Cannot build on existing building');
  assert.strictEqual(isCellBuildable(1, 1, dummyBuildings, dummyResources), false, 'Cannot build on resource cell');
  assert.strictEqual(isCellBuildable(2, 2, dummyBuildings, dummyResources), true, 'Can build on clear terrain');
});

test('Drone Station and Harvester Station factories initialize correct properties', () => {
  const hStation = createBuildingInstance('HARVESTER_STATION', 'player', 0, 0);
  assert.strictEqual(hStation.spawnTimer, 10.0, 'Harvester station should produce first robot in 10s');
  assert.strictEqual(hStation.storedWood, 0);
  assert.strictEqual(hStation.storedStone, 0);

  const dStation = createBuildingInstance('DRONE_STATION', 'player', 1, 1);
  assert.strictEqual(dStation.droneMode, 'DEFENSE', 'Default drone mode should be DEFENSE');

  const drone = createCombatDrone(dStation);
  assert.strictEqual(drone.isFlying, true, 'Drone must have isFlying=true');

  const bot = createHarvesterBot(hStation);
  assert.strictEqual(bot.isFlying, false, 'Harvester bot must be a ground unit (isFlying=false)');
});
test('Procedural turret branches require a choice and support range, guidance, and explosive payload combinations', () => {
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 0, 0);
  const initialRange = turret.range;
  const initialHp = turret.maxHp;
  const initialDamage = turret.damage || 0;
  assert.strictEqual(getBuildingUpgradeOptions(turret).length, 2);

  const noChoice = upgradeBuildingStats(turret);
  assert.strictEqual(noChoice.level, 1, 'The simulation must not silently select a branch for the player');

  const longBarrel = upgradeBuildingStats(turret, 'long-barrel');
  assert.strictEqual(longBarrel.level, 2);
  assert.ok(longBarrel.range > initialRange, 'Long-Barrel Optics increases the actual range');
  assert.ok((longBarrel.damage || 0) < initialDamage, 'Long-Barrel Optics trades direct damage for reach');
  assert.strictEqual(longBarrel.hp, longBarrel.maxHp);

  const noSecondChoice = upgradeBuildingStats(longBarrel);
  assert.strictEqual(noSecondChoice.level, 2, 'A branching tier remains unchanged without an explicit option');

  const guided = upgradeBuildingStats(longBarrel, 'guided-rounds');
  assert.strictEqual(guided.level, 3);
  assert.ok((guided.projectileHomingStrength || 0) > 0, 'Guidance is a live projectile attribute');
  assert.ok(guided.range > initialRange, 'Later upgrades preserve the selected earlier range module');

  const explosive = upgradeBuildingStats(guided, 'explosive-ordnance');
  assert.strictEqual(explosive.level, 4);
  assert.ok((explosive.explosionRadius || 0) > 0, 'Explosive payloads add a working blast radius');
  assert.ok((explosive.explosionDamageMultiplier || 0) > 0, 'Explosive payloads add a splash damage multiplier');
  assert.ok((explosive.projectileHomingStrength || 0) > 0, 'The procedural path supports guidance followed by explosives');
  assert.ok(explosive.range > initialRange, 'The earlier range investment remains in effect');

  const twinBarrel = upgradeBuildingStats(turret, 'overcharged-rounds');
  const twinChoice = upgradeBuildingStats(twinBarrel, 'twin-barrel');
  assert.strictEqual(twinChoice.level, 3);
  assert.strictEqual(twinChoice.shotsPerAttack, 2, 'Twin-barrel choice must unlock an actual second shot');
  assert.ok((twinChoice.projectileSpeed || 0) < (turret.projectileSpeed || 450), 'The earlier overcharged-rounds penalty remains active after the later module');
  assert.ok((twinChoice.damage || 0) > 0, 'The combined branch still deals positive damage');
  assert.ok(initialHp > 0);
});
