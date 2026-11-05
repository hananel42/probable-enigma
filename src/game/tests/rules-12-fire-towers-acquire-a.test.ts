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

test('Fire Towers acquire a real target and damage it when the expanding pulse reaches it', () => {
  const engine = new GameEngine();
  const playerCore = createBuildingInstance('CORE', 'player', -4, -4, 'fire-tower-live-core', 'group-host');
  playerCore.allianceId = 'alliance-humans';
  playerCore.coreId = playerCore.id;
  const tower = createBuildingInstance('FIRE_TOWER', 'player', 0, 0, 'live-fire-tower', 'group-host');
  tower.allianceId = 'alliance-humans';
  tower.coreId = playerCore.id;
  const hostile = createCommander('enemy', tower.x + 100, tower.y, 'fire-tower-hostile');
  engine.state.buildings = [playerCore, tower];
  engine.state.entities = [engine.state.player, hostile];
  const beforeHp = hostile.hp;
  const updateBuildings = (engine as unknown as { updateBuildings(dt: number): void }).updateBuildings.bind(engine);

  for (let tick = 0; tick < 360; tick++) updateBuildings(1 / 60);

  assert.equal(tower.targetEntityId, hostile.id, 'Fire Tower target scans must acquire the live hostile');
  assert.ok(hostile.hp < beforeHp, 'the pulse ring must apply damage after reaching the hostile');
});


test('Drones discard cached and alerted targets when a hostile structure turns gray', () => {
  const core = createBuildingInstance('CORE', 'player', -4, -4, 'drone-cache-live-core', 'group-host');
  core.allianceId = 'alliance-humans';
  core.coreId = core.id;
  const station = createBuildingInstance('DRONE_STATION', 'player', 0, 0, 'drone-cache-station', 'group-host');
  station.allianceId = 'alliance-humans';
  station.coreId = core.id;
  const abandonedWall = createBuildingInstance('WALL', 'enemy', 1, 0, 'drone-cache-gray-wall', 'enemy-dead-team');
  abandonedWall.coreId = 'missing-enemy-core';
  const drone = createCombatDrone(station, { x: station.x + 30, y: station.y + 30 }, 'drone-cache-test');
  drone.droneTargetBuildingId = abandonedWall.id;
  drone.combatAlertBuildingId = abandonedWall.id;
  drone.combatAlertTimer = 4;
  drone.droneCombatCheckTimer = 0.18;
  drone.lastFireTime = 1;
  const player = createCommander('player', 0, 75, 'drone-cache-player');
  player.teamId = 'group-host';
  player.allianceId = 'alliance-humans';
  const entities = [player, drone];
  const buildings = [core, station, abandonedWall];
  const projectiles: Projectile[] = [];
  const droneAI = new DroneAI();

  droneAI.updateDrone(drone, player, buildings, entities, projectiles, 0.01, [], 1);
  droneAI.updateDrone(drone, player, buildings, entities, projectiles, 0.01, [], 1.01);

  assert.equal(drone.droneTargetBuildingId, null, 'the next target scan must clear an inert cached target');
  assert.equal(drone.combatAlertBuildingId, abandonedWall.id, 'an alert may remain recorded until it expires, but resolution must reject the gray target');
  assert.equal(projectiles.length, 0, 'a drone must never shoot an inert orphaned structure');
});

test('Structures remain salvageable and become inert when their owning Core is destroyed', () => {
  const core = createBuildingInstance('CORE', 'player', -1, -1, 'test-core');
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 3, 3, 'test-turret');
  const buildings = [core, turret];
  assert.strictEqual(isBuildingOperational(turret, buildings), true);
  assert.strictEqual(isOrphanedStructure(turret, buildings), false);
  core.hp = 0;
  assert.strictEqual(isBuildingOperational(turret, buildings), false);
  assert.strictEqual(isOrphanedStructure(turret, buildings), true);
});


test('Orphaned structures use a grayscale renderer and an explicit gray status overlay', () => {
  const orphaned = createBuildingInstance('AUTO_TURRET', 'enemy', 0, 0, 'gray-orphan-turret', 'destroyed-outpost');
  const assigned: Array<{ property: string; value: unknown }> = [];
  const state: Record<string, unknown> = { filter: 'none', globalAlpha: 1 };
  const gradient = { addColorStop: () => {} };
  const context = new Proxy(state, {
    get(target, property) {
      if (property in target) return target[String(property)];
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => gradient;
      if (property === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set(target, property, value) {
      target[String(property)] = value;
      if (property === 'filter' || property === 'fillStyle' || property === 'strokeStyle') {
        assigned.push({ property: String(property), value });
      }
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;

  buildingDrawer.draw(context, orphaned, 0, undefined, false, [orphaned]);
  assert.ok(assigned.some(item => item.property === 'filter' && item.value === 'grayscale(1)'),
    'The structure-specific renderer must be desaturated');
  assert.ok(assigned.some(item => item.property === 'fillStyle' && item.value === 'rgba(148, 163, 184, 0.56)'),
    'The inert structure must receive the gray status overlay');
  assert.ok(assigned.some(item => item.property === 'strokeStyle' && item.value === '#cbd5e1'),
    'The inert structure must have a neutral outline, not its old faction color');
});

test('Commander AI prioritizes repairing a damaged Core over pursuing a hostile target', () => {
  const commander = createCommander('enemy', 240, 160, 'repair-priority-commander');
  const core = createBuildingInstance('CORE', 'enemy', 2, 2, 'repair-priority-core');
  core.hp = core.maxHp * 0.55;
  const wallet = { wood: 1000, stone: 1000 , diamonds: 0 };
  const hostile = createCommander('player', 260, 160, 'repair-priority-hostile');
  const ai = new CommanderAI();
  ai.updateCommander(commander, wallet, [core], [], [commander, hostile], [], [], 0.016);
  assert.strictEqual(commander.aiGoal, 'REPAIR_STRUCTURE');
  assert.strictEqual(commander.aiTargetBuildingId, core.id);
});

test('Commander AI mines locally to afford Core repair when the damaged Core is not under immediate threat', () => {
  const commander = createCommander('enemy', 260, 260, 'unaffordable-core-repair-commander');
  const core = createBuildingInstance('CORE', 'enemy', 2, 2, 'unaffordable-core-repair-core');
  core.hp = Math.max(1, core.maxHp - 80);
  const wallet = { wood: 0, stone: 0 , diamonds: 0 };
  const nearbyResource: ResourceNode = {
    id: 'tempting-nearby-resource', type: 'stone', gx: Math.floor(280 / GRID_SIZE), gy: Math.floor(260 / GRID_SIZE), x: 280, y: 260,
    amount: 500, maxAmount: 500, radius: 18, seed: 7
  };
  commander.aiGoal = 'MINE_RESOURCE';
  commander.aiTargetResourceId = 'stale-target';
  commander.aiDecisionTimer = 1;
  const ai = new CommanderAI();
  ai.updateCommander(commander, wallet, [core], [nearbyResource], [commander], [], [], 0.2);
  assert.equal(commander.aiGoal, 'MINE_RESOURCE', 'Without an immediate threat, the Commander must gather what is needed for Core repair');
  assert.equal(commander.aiTargetResourceId, nearbyResource.id, 'The Commander must select a reachable local resource');
  assert.equal(commander.aiBuildType, null, 'The Commander must not start construction while saving for Core repair');
});

test('Commander AI stays near a damaged Core only when no local resource can be reached', () => {
  const commander = createCommander('enemy', 260, 260, 'core-no-resource-commander');
  const core = createBuildingInstance('CORE', 'enemy', 2, 2, 'core-no-resource', 'enemy');
  core.hp = 1;
  const ai = new CommanderAI();
  ai.updateCommander(commander, { wood: 0, stone: 0 , diamonds: 0 }, [core], [], [commander], [], [], 0.2);
  assert.equal(commander.aiGoal, 'GUARD_CORE', 'the fallback is defensive only when there is no reachable local income');
  assert.equal(commander.aiTargetBuildingId, core.id);
});

test('Commander AI does not spend a build-sized wallet on a new harvester while its Core repair is unaffordable', () => {
  const commander = createCommander('enemy', 260, 260, 'damaged-core-saving-commander');
  const core = createBuildingInstance('CORE', 'enemy', 2, 2, 'damaged-core-saving-core');
  core.hp = 1;
  const wallet = { wood: 65, stone: 65 , diamonds: 0 };
  const nearbyResource: ResourceNode = {
    id: 'repair-resource', type: 'stone', gx: Math.floor(280 / GRID_SIZE), gy: Math.floor(260 / GRID_SIZE), x: 280, y: 260,
    amount: 500, maxAmount: 500, radius: 18, seed: 9
  };
  const ai = new CommanderAI();
  ai.updateCommander(commander, wallet, [core], [nearbyResource], [commander], [], [], 0.2);
  assert.equal(commander.aiGoal, 'MINE_RESOURCE', 'Repair recovery must take priority over building a Harvester Station');
  assert.equal(commander.aiBuildType, null);
  assert.deepEqual(wallet, { wood: 65, stone: 65 , diamonds: 0 }, 'Resources must remain saved until repair is affordable');
});

test('Commander AI interrupts local resource recovery to attack an immediate threat to its damaged Core', () => {
  const commander = createCommander('enemy', 260, 260, 'threatened-core-commander');
  const core = createBuildingInstance('CORE', 'enemy', 2, 2, 'threatened-core', 'enemy');
  core.hp = 1;
  const hostile = createCommander('player', core.x + 30, core.y + 25, 'core-attacker');
  const wallet = { wood: 0, stone: 0 , diamonds: 0 };
  const resource: ResourceNode = { id: 'nearby-wood', type: 'wood', gx: Math.floor(280 / GRID_SIZE), gy: Math.floor(260 / GRID_SIZE), x: 280, y: 260, amount: 100, maxAmount: 100, radius: 18, seed: 11 };
  const ai = new CommanderAI();
  ai.updateCommander(commander, wallet, [core], [resource], [commander, hostile], [], [], 0.2);
  assert.equal(commander.aiGoal, 'ATTACK_TARGET', 'immediate Core threat must outrank resource recovery');
  assert.equal(commander.aiTargetEntityId, hostile.id);
});

test('A player can dismantle a gray orphaned enemy structure and receives its HP-scaled salvage refund', () => {
  const engine = new GameEngine();
  const commander = engine.state.player;
  const abandoned = createBuildingInstance('WALL', 'enemy', 0, 2, 'orphaned-enemy-wall', 'enemy-dead-core');
  abandoned.x = commander.x + 20;
  abandoned.y = commander.y + 20;
  abandoned.gx = 0;
  abandoned.gy = 2;
  engine.state.buildings.push(abandoned);
  const before = { ...engine.state.resources };
  const expected = getBuildingSalvageRefund(abandoned);
  engine.attemptDismantleNearby(abandoned.id);
  assert.ok(!engine.state.buildings.some(building => building.id === abandoned.id), 'a gray structure with no live Core can be dismantled');
  assert.equal(engine.state.resources.wood, before.wood + expected.wood, 'salvage returns the correct wood');
  assert.equal(engine.state.resources.stone, before.stone + expected.stone, 'salvage returns the correct stone');
});

test('Destroying the player Core ends the single-player run and prevents respawn', () => {
  const engine = new GameEngine();
  const core = engine.state.buildings.find(building => building.type === 'CORE' && building.id === 'player-core')!;
  core.hp = 0;
  engine.step(0.1);
  assert.equal(engine.state.isGameOver, true, 'the run ends when its Core reaches zero HP');
  const commander = engine.state.player;
  commander.isDead = true;
  commander.hp = 0;
  commander.respawnTimer = 0;
  const position = { x: commander.x, y: commander.y };
  engine.step(0.1);
  assert.equal(commander.isDead, true, 'the defeated commander must not respawn without a Core');
  assert.deepEqual({ x: commander.x, y: commander.y }, position, 'defeat must not move the commander to a fallback spawn');
});
