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

test('embedded drones escape newly placed buildings smoothly instead of teleporting', () => {
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'smooth-recovery-wall');
  const buildings: Building[] = [wall];
  const station = createBuildingInstance('DRONE_STATION', 'player', 3, 0, 'smooth-recovery-station');
  const drone = createCombatDrone(station, { x: wall.x, y: wall.y }, 'smooth-recovery-drone');
  const initialX = drone.x;
  const initialY = drone.y;

  assert.equal(recoverEmbeddedEntity(drone, buildings, []), true);
  assert.deepEqual({ x: drone.x, y: drone.y }, { x: initialX, y: initialY }, 'smooth recovery must preserve the starting position');
  const target = getSmoothEmbeddedRecoveryTarget(drone);
  assert.ok(target, 'a smooth recovery target must be recorded');
  assert.ok(Math.hypot(target!.x - initialX, target!.y - initialY) > 0, 'the recovery target must be outside the blocked tile');

  let maxStep = 0;
  for (let i = 0; i < 360 && getSmoothEmbeddedRecoveryTarget(drone); i++) {
    recoverEmbeddedEntity(drone, buildings, []);
    const beforeX = drone.x;
    const beforeY = drone.y;
    const goal = getSmoothEmbeddedRecoveryTarget(drone);
    if (!goal) break;
    moveEntityTowardSmoothly(drone, goal.x, goal.y, buildings, [], 1 / 60, 100, 400, 24);
    const step = Math.hypot(drone.x - beforeX, drone.y - beforeY);
    maxStep = Math.max(maxStep, step);
    assert.ok(step <= (100 / 60) + 0.05, `recovery step ${step} exceeded the speed limit`);
  }

  assert.ok(maxStep > 0, 'the drone must physically move toward the free cell');
  assert.equal(getSmoothEmbeddedRecoveryTarget(drone), null, 'recovery must finish after leaving building geometry');
  assert.equal(isCellInsideBuildingFootprint(Math.floor(drone.x / GRID_SIZE), Math.floor(drone.y / GRID_SIZE), buildings), false);
});

test('Enemy commander construction checks building footprints and avoids living units', () => {
  const commander = createCommander('enemy', 600, 600, 'builder-commander');
  commander.teamId = 'enemy-base-builder';
  commander.aiGoal = 'IDLE';
  commander.aiDecisionTimer = 2;
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'builder-core', 'enemy-base-builder');
  const buildings: Building[] = [core];
  const entities = [commander];

  new CommanderAI().updateCommander(
    commander, { wood: 300, stone: 300 , diamonds: 0 }, buildings, [], entities, [],
    [createTestEnemyBase('enemy-base-builder', 'FORTIFYING')], 0.016
  );

  assert.ok(buildings.length > 1, 'The commander should construct an affordable structure');
  assert.ok(buildings.some(building => building.type === 'HARVESTER_STATION'),
    'When the outpost has no harvester and no immediate emergency, economy should be built before defensive filler walls');
  for (let i = 0; i < buildings.length; i++) {
    const occupied = new Set(getBuildingOccupiedCells(buildings[i]).map(cell => `${cell.gx},${cell.gy}`));
    for (let j = i + 1; j < buildings.length; j++) {
      assert.ok(!getBuildingOccupiedCells(buildings[j]).some(cell => occupied.has(`${cell.gx},${cell.gy}`)));
    }
  }
  const unitGx = Math.floor(commander.x / GRID_SIZE);
  const unitGy = Math.floor(commander.y / GRID_SIZE);
  assert.strictEqual(isCellBlockedForGround(unitGx, unitGy, buildings, []), false, 'No structure should be built on the commander');
});
test('Fortress construction preserves resources already committed to an active Commander build goal', () => {
  const teamId = 'reserve-planned-investment';
  const base = createTestEnemyBase(teamId, 'FORTIFYING');
  base.level = 1;
  base.coreId = `${teamId}-core`;
  base.commanderId = `${teamId}-commander`;
  base.buildTimer = 0.01;
  base.repairTimer = 999;
  base.resources = { wood: 100, stone: 100 , diamonds: 0 };
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, teamId);
  const blueprint = getFortressBlueprint(1);
  const missing = blueprint.find(slot => slot.type === 'AUTO_TURRET');
  assert.ok(missing, 'Test blueprint must contain a turret slot');
  const buildings: Building[] = [core, ...blueprint
    .filter(slot => slot !== missing)
    .map(slot => createBuildingInstance(slot.type, 'enemy', base.gx + slot.relGx, base.gy + slot.relGy,
      `${teamId}-${slot.type}-${slot.relGx}-${slot.relGy}`, teamId))];
  const commander = createCommander('enemy', 450, 450, base.commanderId);
  commander.teamId = teamId;
  commander.aiGoal = 'BUILD_STRUCTURE';
  commander.aiBuildType = 'HARVESTER_STATION';

  enemyCommanderAI.updateBase(base, buildings, [commander], [], 1, 0.016);

  assert.strictEqual(buildings.length, blueprint.length, 'The turret must not be built by consuming the funds reserved for the first Harvester Station');
  assert.deepStrictEqual(base.resources, { wood: 100, stone: 100 , diamonds: 0 });
});

test('Fortress AI saves the routine construction reserve instead of spending it on a non-emergency wall', () => {
  const teamId = 'reserve-routine-wall';
  const base = createTestEnemyBase(teamId, 'FORTIFYING');
  base.level = 1;
  base.coreId = `${teamId}-core`;
  base.buildTimer = 0.01;
  base.repairTimer = 999;
  base.resources = { wood: 45, stone: 50 , diamonds: 0 };
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, base.coreId, teamId);
  const blueprint = getFortressBlueprint(1);
  const missing = blueprint.find(slot => slot.type === 'WALL');
  assert.ok(missing);
  const buildings: Building[] = [core, ...blueprint
    .filter(slot => slot !== missing)
    .map(slot => createBuildingInstance(slot.type, 'enemy', base.gx + slot.relGx, base.gy + slot.relGy,
      `${teamId}-${slot.type}-${slot.relGx}-${slot.relGy}`, teamId))];

  enemyCommanderAI.updateBase(base, buildings, [], [], 1, 0.016);

  assert.strictEqual(buildings.length, blueprint.length, 'Routine fortification must keep a reserve instead of building this wall');
  assert.deepStrictEqual(base.resources, { wood: 45, stone: 50 , diamonds: 0 });
});

test('An active commander attack continuously applies the shared target priority', () => {
  const teamId = 'enemy-base-retarget-active';
  const commander = createCommander('enemy', 24, 24, 'retargeting-commander');
  commander.teamId = teamId;
  commander.aiGoal = 'ATTACK_TARGET';
  commander.aiDecisionTimer = 0;
  commander.aiTargetBuildingId = 'closer-player-turret';

  const ownCore = createBuildingInstance('CORE', 'enemy', -4, -4, 'retarget-own-core', teamId);
  const closerTurret = createBuildingInstance('AUTO_TURRET', 'player', 2, 0, 'closer-player-turret', 'player');
  const armedEnemy = createCommander('player', 420, 24, 'priority-player-commander');
  const base = createTestEnemyBase(teamId, 'FORTIFYING');

  new CommanderAI().updateCommander(
    commander,
    { wood: 0, stone: 0 , diamonds: 0 },
    [ownCore, closerTurret],
    [],
    [commander, armedEnemy],
    [],
    [base],
    0.016
  );

  assert.strictEqual(commander.aiTargetEntityId, armedEnemy.id,
    'An active attack must retarget to an armed hostile unit instead of keeping an older turret order');
  assert.strictEqual(commander.aiTargetBuildingId, null);
});

test('Assaulting commanders prioritize a hostile armed unit over closer infrastructure', () => {
  const commander = createCommander('enemy', 24, 24, 'closest-commander');
  commander.teamId = 'enemy-base-near';
  commander.aiDecisionTimer = 2;
  const ownCore = createBuildingInstance('CORE', 'enemy', -4, 0, 'closest-own-core', 'enemy-base-near');
  const hostileWall = createBuildingInstance('WALL', 'enemy', 3, 0, 'closest-hostile-wall', 'enemy-base-far');
  const farHostile = createCommander('player', 450, 24, 'far-hostile-unit');
  const buildings: Building[] = [ownCore, hostileWall];

  new CommanderAI().updateCommander(
    commander, { wood: 0, stone: 0 , diamonds: 0 }, buildings, [], [commander, farHostile], [],
    [createTestEnemyBase('enemy-base-near', 'ASSAULT')], 0.016
  );

  assert.strictEqual(commander.aiGoal, 'ATTACK_TARGET');
  assert.strictEqual(commander.aiTargetEntityId, 'far-hostile-unit');
  assert.strictEqual(commander.aiTargetBuildingId, null);
});

test('Unified defense flight keeps one home centre and remains smooth as world geometry changes', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'cached-ellipse-station');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 24, y: -100 }, 'cached-ellipse-drone');
  const player = createCommander('player', -900, -900, 'cached-ellipse-player');
  const buildings: Building[] = operationalBuildingSet(station);
  const ai = new DroneAI();
  let minStep = Number.POSITIVE_INFINITY;
  let maxStep = 0;
  let previousPhase: number | undefined;
  for (let i = 1; i <= 80; i++) {
    const oldX = drone.x;
    const oldY = drone.y;
    previousPhase = drone.droneFlightPhase;
    ai.updateDrone(drone, player, buildings, [drone, player], [], 0.05, [], i * 0.05);
    const step = Math.hypot(drone.x - oldX, drone.y - oldY);
    minStep = Math.min(minStep, step);
    maxStep = Math.max(maxStep, step);
  }
  assert.strictEqual(drone.droneFlightCenterId, `station:${station.id}`);
  assert.ok(Number.isFinite(drone.droneFlightPhase) && drone.droneFlightPhase !== previousPhase,
    'The orbit phase advances without a separate patrol state machine');
  assert.ok(maxStep < 20, `Flight must stay acceleration/speed bounded; observed ${maxStep.toFixed(2)} px step`);
  assert.ok(minStep >= 0, 'Movement sampling remains finite even when collision briefly constrains a step');

  buildings.push(createBuildingInstance('WALL', 'enemy', 80, 80, 'unrelated-far-wall', 'unrelated-hostile-outpost'));
  for (let i = 81; i <= 100; i++) ai.updateDrone(drone, player, buildings, [drone, player], [], 0.05, [], i * 0.05);
  assert.strictEqual(drone.droneFlightCenterId, `station:${station.id}`,
    'Unrelated hostile structures do not steal the base patrol centre');
  assert.ok(Number.isFinite(drone.x) && Number.isFinite(drone.y));
});
