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
  advanceEmbeddedEntityRecovery,
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

test('Air path-following honours the same hard speed cap as direct drone movement', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'path-speed-station');
  const drone = createCombatDrone(station, { x: 24, y: 24 }, 'path-speed-drone');
  const beforeX = drone.x;
  const beforeY = drone.y;
  moveEntityAlongPath(drone, 24 + 1000, 24 + 650, [], [], 0.1, 12, 96);
  const moved = Math.hypot(drone.x - beforeX, drone.y - beforeY);
  assert.ok(moved <= 9.61, `Air path movement was ${moved.toFixed(2)} px in 0.1s, above its 96 px/s limit`);
});

test('Procedural enemy outposts have non-overlapping structures and do not spawn units inside buildings', () => {
  const generated = generateProceduralEnemyBase(2, 3);
  for (let i = 0; i < generated.buildings.length; i++) {
    const cellsA = new Set(getBuildingOccupiedCells(generated.buildings[i]).map(cell => `${cell.gx},${cell.gy}`));
    for (let j = i + 1; j < generated.buildings.length; j++) {
      const cellsB = getBuildingOccupiedCells(generated.buildings[j]);
      assert.ok(!cellsB.some(cell => cellsA.has(`${cell.gx},${cell.gy}`)),
        `${generated.buildings[i].id} overlaps ${generated.buildings[j].id}`);
    }
  }

  for (const entity of generated.entities) {
    const gx = Math.floor(entity.x / GRID_SIZE);
    const gy = Math.floor(entity.y / GRID_SIZE);
    if (entity.isFlying) {
      assert.strictEqual(isCellBlockedForAir(gx, gy, generated.buildings), false, `${entity.id} spawned inside a building`);
    } else {
      assert.strictEqual(isCellBlockedForGround(gx, gy, generated.buildings, []), false, `${entity.id} spawned inside a building`);
    }
  }
});

test('Spawn placement moves outside a sealed station perimeter when nearby cells are blocked', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'sealed-station');
  const buildings: Building[] = operationalBuildingSet(station);
  for (let gx = -1; gx <= 2; gx++) {
    for (let gy = -1; gy <= 2; gy++) {
      const insideStation = gx >= 0 && gx <= 1 && gy >= 0 && gy <= 1;
      if (!insideStation && (gx === -1 || gx === 2 || gy === -1 || gy === 2)) {
        buildings.push(createBuildingInstance('WALL', 'player', gx, gy, `seal-${gx}-${gy}`));
      }
    }
  }
  const spawn = findFreeAdjacentSpawnPosition(station, true, buildings, []);
  assert.strictEqual(isCellBlockedForAir(Math.floor(spawn.x / GRID_SIZE), Math.floor(spawn.y / GRID_SIZE), buildings), false);
});


test('Destroying an outpost Core leaves surviving structures inert and salvageable', () => {
  const generated = generateProceduralEnemyBase(0, 2);
  const buildings = [...generated.buildings];
  const entities = [...generated.entities];
  const unrelatedDeadBuilding = createBuildingInstance('WALL', 'player', 100, 100, 'unrelated-dead-wall', 'player');
  unrelatedDeadBuilding.hp = 0;
  buildings.push(unrelatedDeadBuilding);
  const core = buildings.find(building => building.id === generated.base.coreId);
  if (!core) throw new Error('Generated outpost is missing its core');
  core.hp = 0;

  enemyCommanderAI.updateBase(generated.base, buildings, entities, [], 2, 0.016);
  assert.strictEqual(generated.base.isDestroyed, true);
  assert.strictEqual(buildings.some(building => building.id === generated.base.coreId), false,
    'The destroyed Core itself is removed');
  const survivingStructures = buildings.filter(building => building.teamId === generated.base.teamId);
  assert.ok(survivingStructures.length > 0, 'Surviving structures must remain for salvage');
  assert.ok(survivingStructures.every(building => isOrphanedStructure(building, buildings)),
    'Every surviving structure must be inert/orphaned after its Core is gone');
  assert.strictEqual(entities.some(entity => entity.id === generated.base.commanderId && entity.kind === 'COMMANDER'), false,
    'The commander is destroyed when its Core is destroyed');
  assert.strictEqual(entities.some(entity => entity.teamId === generated.base.teamId && entity.kind !== 'COMMANDER'), false,
    'Dependent drones and harvesters are removed when their outpost Core is destroyed');
  assert.ok(buildings.some(building => building.id === unrelatedDeadBuilding.id),
    'Outpost cleanup must not delete unrelated structures; the normal engine cleanup owns those');
});


test('Enemy outposts never launch an assault while a local hostile forces defense mode', () => {
  const generated = generateProceduralEnemyBase(1, 2);
  generated.base.stance = 'FORTIFYING';
  generated.base.raidTimer = 0.01;
  generated.base.raidInterval = 120;
  const hostile = createCommander('player', generated.base.x + 90, generated.base.y, 'defense-interrupt-hostile');
  const entities = [...generated.entities, hostile];
  const droneStations = generated.buildings.filter(building => building.type === 'DRONE_STATION');

  enemyCommanderAI.updateBase(generated.base, generated.buildings, entities, [], 2, 0.1);

  assert.strictEqual(generated.base.stance, 'DEFENDING');
  assert.ok(generated.base.raidTimer > 0, 'A defensive alert should pause the raid timer');
  for (const station of droneStations) {
    assert.strictEqual(station.droneMode, 'DEFENSE', 'Station drones should guard the threatened outpost');
  }
});

test('Enemy commanders upgrade owned structures with the same resource and stat rules', () => {
  const commander = createCommander('enemy', 24, 24, 'upgrade-commander');
  commander.teamId = 'enemy-base-upgrade';
  commander.aiGoal = 'UPGRADE_STRUCTURE';
  commander.aiTargetBuildingId = 'upgrade-turret';

  const turret = createBuildingInstance('AUTO_TURRET', 'enemy', 0, 0, 'upgrade-turret', 'enemy-base-upgrade');
  const buildings: Building[] = [turret];
  const wallet: Resources = { wood: 250, stone: 250 , diamonds: 0 };
  const selectedUpgradeId = getRecommendedBuildingUpgradeId(turret);
  assert.ok(selectedUpgradeId);
  const cost = getBuildingUpgradeCost(turret, selectedUpgradeId);

  new CommanderAI().updateCommander(
    commander, wallet, buildings, [], [commander], [],
    [createTestEnemyBase('enemy-base-upgrade', 'DEFENDING')], 0.016
  );

  assert.strictEqual(buildings[0].level, 2);
  assert.strictEqual(buildings[0].hp, buildings[0].maxHp);
  assert.strictEqual(wallet.wood, 250 - cost.wood);
  assert.strictEqual(wallet.stone, 250 - cost.stone);
});

test('Commander fights to the death instead of retreating when critically hurt and outnumbered', () => {
  const commander = createCommander('enemy', 220, 220, 'outnumbered-commander');
  commander.teamId = 'outpost-outnumbered';
  commander.hp = 2; // Critical HP must never suppress an otherwise valid attack.
  commander.aiDecisionTimer = 2;
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'outnumbered-core', 'outpost-outnumbered');
  const enemies = [
    createCommander('player', 520, 220, 'outnumbering-player-one'),
    createCommander('player', 545, 238, 'outnumbering-player-two')
  ];
  const beforeCoreDistance = Math.hypot(commander.x - core.x, commander.y - core.y);
  new CommanderAI().updateCommander(
    commander,
    { wood: 0, stone: 0 , diamonds: 0 },
    [core],
    [],
    [commander, ...enemies],
    [],
    [createTestEnemyBase('outpost-outnumbered', 'ASSAULT')],
    0.05
  );
  assert.strictEqual(commander.aiGoal, 'ATTACK_TARGET', 'Low health and being outnumbered must not cancel an assault');
  assert.ok(commander.aiTargetEntityId, 'The commander must keep a hostile combat target');
  assert.ok(Math.hypot(commander.x - enemies[0].x, commander.y - enemies[0].y) < Math.hypot(220 - enemies[0].x, 220 - enemies[0].y), 'The commander should advance toward the fight, not retreat to its Core');
  assert.ok(Math.hypot(commander.x - core.x, commander.y - core.y) >= beforeCoreDistance, 'The commander must not move home because of low health');
});

test('Enemy commanders can fire while advancing toward a hostile unit', () => {
  const commander = createCommander('enemy', 24, 24, 'advancing-commander');
  commander.teamId = 'enemy-base-attacker';
  commander.aiGoal = 'ATTACK_TARGET';
  commander.aiTargetEntityId = 'player-target';
  commander.lastFireTime = 0.4;
  const target = createCommander('player', 315, 24, 'player-target');
  const projectiles: import('../types').Projectile[] = [];

  new CommanderAI().updateCommander(
    commander, { wood: 0, stone: 0 , diamonds: 0 }, [], [], [commander, target], projectiles, [], 0.016
  );

  assert.ok(commander.x > 24, 'Commander should advance toward the target');
  assert.strictEqual(projectiles.length, 1);
  assert.strictEqual(projectiles[0].teamId, 'enemy-base-attacker');
});


test('Embedded commanders and drones recover through bounded movement without teleporting, even while idle', () => {
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'recovery-wall');
  const buildings: Building[] = [wall];
  const commander = createCommander('player', wall.x, wall.y, 'embedded-commander');
  const station = createBuildingInstance('DRONE_STATION', 'player', 3, 0, 'recovery-station');
  const drone = createCombatDrone(station, { x: wall.x, y: wall.y }, 'embedded-drone');
  const commanderStart = { x: commander.x, y: commander.y };
  const droneStart = { x: drone.x, y: drone.y };

  assert.strictEqual(recoverEmbeddedEntity(commander, buildings, []), true);
  assert.strictEqual(recoverEmbeddedEntity(drone, buildings, []), true);
  assert.deepStrictEqual({ x: commander.x, y: commander.y }, commanderStart, 'Commander recovery must not snap coordinates');
  assert.deepStrictEqual({ x: drone.x, y: drone.y }, droneStart, 'Drone recovery must not snap coordinates');
  assert.ok(getSmoothEmbeddedRecoveryTarget(commander));
  assert.ok(getSmoothEmbeddedRecoveryTarget(drone));

  for (let tick = 0; tick < 240 && getSmoothEmbeddedRecoveryTarget(commander); tick++) {
    const before = { x: commander.x, y: commander.y };
    assert.equal(advanceEmbeddedEntityRecovery(commander, buildings, [], 1 / 60, commander.speed), true);
    assert.ok(Math.hypot(commander.x - before.x, commander.y - before.y) <= commander.speed / 60 + 1e-4,
      'Commander recovery must obey its movement speed rather than teleport');
  }
  for (let tick = 0; tick < 240 && getSmoothEmbeddedRecoveryTarget(drone); tick++) {
    const before = { x: drone.x, y: drone.y };
    assert.equal(advanceEmbeddedEntityRecovery(drone, buildings, [], 1 / 60, drone.speed), true);
    assert.ok(Math.hypot(drone.x - before.x, drone.y - before.y) <= drone.speed / 60 + 1e-4,
      'Drone recovery must obey its movement speed rather than teleport');
  }

  assert.equal(getSmoothEmbeddedRecoveryTarget(commander), null);
  assert.equal(getSmoothEmbeddedRecoveryTarget(drone), null);
  assert.strictEqual(isCellBlockedForGround(Math.floor(commander.x / GRID_SIZE), Math.floor(commander.y / GRID_SIZE), buildings, []), false);
  assert.strictEqual(
    isCellInsideBuildingFootprint(Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), buildings),
    false,
    'Recovery must move the drone outside the physical footprint; route-planning clearance is not a solid wall'
  );
});
