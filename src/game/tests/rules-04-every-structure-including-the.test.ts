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

test('Every structure, including the Core, has a documented four-tier upgrade tree with intentional branching', () => {
  const types = ['CORE', 'WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'] as const;
  const expectedModes: Record<(typeof types)[number], Array<'CHOICE' | 'LINEAR'>> = {
    CORE: ['CHOICE', 'CHOICE', 'CHOICE', 'CHOICE'],
    WALL: ['CHOICE', 'LINEAR', 'CHOICE', 'CHOICE'],
    AUTO_TURRET: ['CHOICE', 'CHOICE', 'CHOICE', 'CHOICE'],
    HARVESTER_STATION: ['CHOICE', 'LINEAR', 'CHOICE', 'LINEAR'],
    DRONE_STATION: ['CHOICE', 'LINEAR', 'CHOICE', 'LINEAR'],
    FIRE_TOWER: ['CHOICE', 'CHOICE', 'CHOICE', 'CHOICE']
  };
  for (const type of types) {
    const tree = BUILDING_UPGRADE_TREES[type];
    assert.deepStrictEqual(tree.map(tier => tier.targetLevel), [2, 3, 4, 5], `${type} has all progression tiers`);
    assert.deepStrictEqual(tree.map(tier => tier.mode), expectedModes[type], `${type} has the intended progression and choice cadence`);
    for (const tier of tree) {
      assert.ok(tier.title.length > 0);
      assert.strictEqual(tier.options.length, tier.mode === 'CHOICE' ? 2 : 1);
      for (const option of tier.options) {
        assert.ok(option.id && option.name && option.description, `${type} tier ${tier.targetLevel} options are documented`);
        assert.ok((option.effects?.length || 0) > 0 || (option.commanderEffects?.length || 0) > 0,
          `${option.id} has a structure or Commander effect`);
        if (type === 'CORE') {
          assert.ok((getBuildingUpgradeCost(createBuildingInstance('CORE', 'player', 0, 0), option.id).diamonds ?? 0) >= 1,
            `${option.id} requires at least one Diamond`);
        }
      }
    }
  }
});

test('Core upgrades improve the associated Commander, preserve Core damage, and gate combat upgrades behind progression', () => {
  const core = createBuildingInstance('CORE', 'player', 0, 0, 'player-upgrade-core');
  core.level = 2;
  core.upgradeIds = ['core_mining_accelerator'];
  core.hp = 610;
  const commander = createCommander('player', 180, 48, 'core-upgrade-commander');
  const initialSpeed = commander.speed;
  const initialDamage = commander.damage || 0;
  const options = getBuildingUpgradeOptions(core);
  assert.strictEqual(options.length, 2);
  assert.strictEqual(getUpgradeOptionForHotkey(core, 'Q')?.id, options[0].id);
  assert.strictEqual(getUpgradeOptionForHotkey(core, 'E')?.id, options[1].id);
  assert.ok(options.every(option => option.commanderEffects?.length), 'Core options explicitly contain Commander effects');
  assert.ok(options.every(option => (option.cost?.diamonds ?? 0) >= 1), 'Every Core upgrade costs a Diamond');
  assert.ok(!getBuildingUpgradeOptions({ ...core, level: 1 }).some(option => (option.commanderEffects || []).some(effect => effect.stat === 'damage')),
    'Direct combat damage is not offered in the opening Core tier');

  const chosen = options.find(option => option.id === 'core_swift_frame');
  assert.ok(chosen);
  const upgradedCore = upgradeBuildingStats(core, chosen!.id);
  assert.strictEqual(upgradedCore.level, 3);
  assert.strictEqual(upgradedCore.hp, 610, 'A Core specialization must not repair the Core for free');
  applyCommanderUpgradeEffects(commander, chosen!);
  assert.ok(commander.speed > initialSpeed, 'Swift Frame changes actual Commander movement speed');
  assert.strictEqual(commander.damage, initialDamage, 'A speed specialization does not also grant weapon damage');
  const coreStats = getBuildingStatLines(core, [commander]);
  assert.ok(coreStats.some(line => line.label === 'MOVE SPEED' && line.value.includes('218')));
  assert.ok(coreStats.some(line => line.label === 'COMMANDER DAMAGE REDUCTION'),
    'Commander armor must be distinguished from the Core building armor stat');
  assert.strictEqual(new Set(coreStats.map(line => line.label)).size, coreStats.length,
    'Core HUD stat labels must be unique to avoid duplicate React keys');
});

test('The player can upgrade the nearby Core only with a Diamond and the engine deducts all costs', () => {
  const core = createBuildingInstance('CORE', 'player', -1, -1, 'engine-player-core');
  core.ownerPlayerId = 'player-host';
  core.hp = 700;
  const commander = createCommander('player', 140, 48, 'engine-player-commander');
  commander.ownerPlayerId = 'player-host';
  const wallet: Resources = { wood: 1000, stone: 1000, diamonds: 0 };
  const engine = Object.create(GameEngine.prototype) as any;
  engine.state = { player: commander, entities: [commander], buildings: [core], resources: wallet, humanPlayers: [], multiplayerMode: 'TEAM' };
  engine.activePlayerId = 'player-host';
  engine.createSparks = () => {};
  engine.triggerStateChange = () => {};
  core.level = 2;
  core.upgradeIds = ['core_mining_accelerator'];
  const beforeSpeed = commander.speed;
  const beforeWood = wallet.wood;
  const beforeStone = wallet.stone;

  engine.attemptUpgradeNearby(core.id, 'core_swift_frame');
  assert.strictEqual(core.level, 2, 'A Core upgrade must be rejected when the wallet has no Diamonds');
  assert.strictEqual(wallet.wood, beforeWood);
  assert.strictEqual(wallet.stone, beforeStone);

  wallet.diamonds = 1;
  engine.attemptUpgradeNearby(core.id, 'core_swift_frame');

  assert.strictEqual(core.level, 3);
  assert.strictEqual(core.hp, 700, 'Core upgrade does not repair the structure');
  assert.ok(commander.speed > beforeSpeed, 'The selected Commander effect is applied to the living player');
  assert.ok(engine.state.resources.wood < beforeWood && engine.state.resources.stone < beforeStone,
    'The same building-upgrade cost is deducted from the player wallet');
  assert.strictEqual(engine.state.resources.diamonds, 0, 'Exactly one Diamond is consumed for the Core upgrade');
});

test('Enemy Commander AI can purchase an advanced Core combat upgrade only when it owns a Diamond', () => {
  const teamId = 'enemy-core-upgrade-team';
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'enemy-core-upgrade', teamId);
  // Start at level 4: weapon upgrades must remain gated until industrial progression is complete.
  core.level = 4;
  core.upgradeIds = ['core_reinforced_matrix', 'core_efficient_extraction', 'core_weapon_calibration'];
  core.hp = core.maxHp;
  const commander = createCommander('enemy', 160, 48, 'enemy-core-upgrader');
  commander.teamId = teamId;
  commander.aiGoal = 'UPGRADE_STRUCTURE';
  commander.aiTargetBuildingId = core.id;
  const wallet: Resources = { wood: 1000, stone: 1000, diamonds: 1 };
  const beforeDamage = commander.damage || 0;

  new CommanderAI().updateCommander(commander, wallet, [core], [], [commander], [], [], 0.016);

  assert.strictEqual(core.level, 5, 'AI should upgrade the Core through the shared upgrade path');
  assert.strictEqual(core.hp, core.maxHp, 'Upgrading the Core must preserve its current health');
  assert.ok((commander.damage || 0) > beforeDamage, 'AI-selected Heavy Pulse must increase real Commander damage');
  assert.ok(wallet.wood < 1000 && wallet.stone < 1000, 'The AI must pay the same resource cost as the player');
  assert.strictEqual(wallet.diamonds, 0, 'AI Core upgrades also consume one Diamond');
  assert.deepStrictEqual(core.upgradeIds, ['core_reinforced_matrix', 'core_efficient_extraction', 'core_weapon_calibration', 'core_heavy_pulse']);
});

test('The actual building-placement entry point rejects a dead or respawning Commander', () => {
  // Exercise the engine method without creating a browser canvas: its dead-state guard
  // must run before it reads placement coordinates, resources, or the world arrays.
  const engine = Object.create(GameEngine.prototype) as any;
  const commander = createCommander('player', 0, 0, 'dead-placement-commander');
  commander.hp = 0;
  commander.isDead = true;
  engine.state = { player: commander, selectedBuildingType: 'WALL' };
  engine.isPointerDown = true;

  engine.attemptPlaceSelectedBuilding();

  assert.strictEqual(engine.state.selectedBuildingType, null, 'Pending construction is cancelled on death');
  assert.strictEqual(engine.isPointerDown, false, 'A held pointer does not leave a placement command queued');
});

test('Dead or respawning Commanders are not operational, and station placements have no range preview', () => {
  const commander = createCommander('player', 0, 0, 'dead-builder');
  assert.strictEqual(isCommanderOperational(commander), true);
  commander.hp = 0;
  commander.isDead = true;
  assert.strictEqual(isCommanderOperational(commander), false);
  commander.hp = commander.maxHp;
  assert.strictEqual(isCommanderOperational(commander), false, 'Respawn state is authoritative even if HP was restored too early');
  commander.isDead = false;
  assert.strictEqual(isCommanderOperational(commander), true);
  assert.strictEqual(shouldDrawRangePreview('DRONE_STATION'), false);
  assert.strictEqual(shouldDrawRangePreview('HARVESTER_STATION'), false);
  assert.strictEqual(shouldDrawRangePreview('AUTO_TURRET'), true);
  assert.strictEqual(shouldDrawRangePreview('FIRE_TOWER'), true);
});

test('All harvesting uses integral batches and cannot leave fractional resource stock', () => {
  const node: ResourceNode = { id: 'fractional-node', type: 'wood', gx: 0, gy: 0, x: 24, y: 24, amount: 4.2, maxAmount: 20, radius: 20, seed: 2 };
  const first = takeWholeResourceBatch(node, 2.1);
  assert.strictEqual(first, 3, 'Requested extraction is rounded upward to a whole number');
  assert.strictEqual(node.amount, 2);
  const second = takeWholeResourceBatch(node, 8);
  assert.strictEqual(second, 2);
  assert.strictEqual(node.amount, 0);
  assert.strictEqual(Number.isInteger(first) && Number.isInteger(second), true);

  const tinyRemainder = { ...node, amount: 0.01 };
  assert.strictEqual(takeWholeResourceBatch(tinyRemainder, 1), 1, 'A positive fractional remainder is rounded up to one whole unit');
  assert.strictEqual(tinyRemainder.amount, 0);
});

test('All structures can complete their complete upgrade path using the AI recommendation policy', () => {
  const types = ['CORE', 'WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'] as const;
  for (const type of types) {
    let building = createBuildingInstance(type, 'enemy', 0, 0, `${type}-upgrade-path`);
    while (building.level < 5) {
      const options = getBuildingUpgradeOptions(building);
      const id = getRecommendedBuildingUpgradeId(building);
      assert.ok(id, `${type} level ${building.level} has an AI-compatible upgrade`);
      assert.ok(options.some(option => option.id === id));
      const upgraded = upgradeBuildingStats(building, id);
      assert.strictEqual(upgraded.level, building.level + 1);
      if (type === 'CORE') {
        assert.strictEqual(upgraded.hp, building.hp, 'Core upgrades increase capacity or Commander stats without granting a free repair');
      } else {
        assert.strictEqual(upgraded.hp, upgraded.maxHp);
      }
      building = upgraded;
    }
    assert.strictEqual(getBuildingUpgradeOptions(building).length, 0, `${type} is capped at level 5`);
  }
});
