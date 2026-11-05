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

test('LocalGameServer accepts semantic client commands without a DOM or Canvas dependency', () => {
  const server = new LocalGameServer();
  const snapshots: Array<{ selectedBuildingType: string | null }> = [];
  const unsubscribe = server.subscribe(snapshot => {
    snapshots.push({ selectedBuildingType: snapshot.selectedBuildingType });
  });

  server.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' });
  assert.strictEqual(server.getSnapshot().selectedBuildingType, 'WALL');
  server.dispatch({ type: 'SET_GROUP_IDENTITY', groupId: 'group-host', name: 'Test Collective', commanderName: 'NOVA-01', color: '#22aa77' });
  assert.strictEqual(server.getSnapshot().groups.find(group => group.id === 'group-host')?.commanderName, 'NOVA-01');
  assert.ok(snapshots.some(snapshot => snapshot.selectedBuildingType === 'WALL'),
    'The authoritative adapter should publish state after a semantic command');

  server.dispatch({ type: 'CANCEL_SELECTION' });
  assert.strictEqual(server.getSnapshot().selectedBuildingType, null);
  unsubscribe();
  server.stop();
});

test('A shared world supports multiple client sessions while single-player command authority stays exclusive', () => {
  const server = new LocalGameServer();
  const controller = server.connectClient({ clientId: 'test-controller', role: 'controller' });
  const observer = server.connectClient({ clientId: 'test-observer' });

  assert.strictEqual(controller.session.role, 'controller');
  assert.strictEqual(controller.session.controlledEntityId, server.getSnapshot().player.id);
  assert.strictEqual(observer.session.role, 'observer');
  assert.strictEqual(observer.session.controlledEntityId, null);
  assert.strictEqual(controller.session.worldId, observer.session.worldId);
  assert.strictEqual(controller.getWorldFrame().worldId, observer.getWorldFrame().worldId);
  assert.strictEqual(controller.getSnapshot(), observer.getSnapshot(), 'Sessions must address the same authoritative world');
  assert.strictEqual(server.getConnectedClients().length, 2);

  const seenRevisions: number[] = [];
  const unsubscribe = observer.subscribeWorldFrames(frame => seenRevisions.push(frame.revision));
  assert.strictEqual(controller.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' }), true);
  assert.strictEqual(server.getSnapshot().selectedBuildingType, 'WALL');
  assert.strictEqual(observer.getSnapshot().selectedBuildingType, 'WALL', 'Observers should receive the updated shared world');
  assert.ok(seenRevisions.some(revision => revision > 0), 'World frame updates must be broadcast to every connected session');

  assert.strictEqual(observer.dispatch({ type: 'SELECT_BUILDING', buildingType: 'AUTO_TURRET' }), false,
    'Observer clients cannot mutate the shared simulation in single-player mode');
  assert.strictEqual(server.getSnapshot().selectedBuildingType, 'WALL');
  assert.throws(() => server.connectClient({ clientId: 'second-controller', role: 'controller' }), /already has a controller/);

  unsubscribe();
  observer.disconnect();
  controller.disconnect();
  server.stop();
  assert.strictEqual(server.getConnectedClients().length, 0);
});

test('Drone Station doctrine follows the same hovered/nearest in-range context as the cyan outline', () => {
  const engine = new GameEngine();
  const core = engine.state.buildings.find(building => building.type === 'CORE')!;
  const makeStation = (id: string, gx: number, gy: number) => {
    const station = createBuildingInstance('DRONE_STATION', 'player', gx, gy, id, 'group-host');
    station.ownerPlayerId = 'player-host';
    station.coreId = core.id;
    station.teamId = 'group-host';
    station.allianceId = 'alliance-humans';
    return station;
  };
  const first = makeStation('context-first-pad', 1, 0);
  const second = makeStation('context-second-pad', 0, 3);
  engine.state.buildings.push(first, second);

  engine.setAimPoint(first.x, first.y);
  engine.setDroneStationMode(first.id, 'ESCORT');
  assert.strictEqual(first.droneMode, 'ESCORT', 'A hovered operational station can be configured without persistent selection');
  assert.strictEqual(first.escortCommanderId, 'player-host', 'Escort doctrine stores the commander of the participant who selected it');

  engine.setAimPoint(second.x, second.y);
  engine.setDroneStationMode(first.id, 'DEFENSE');
  assert.strictEqual(first.droneMode, 'ESCORT', 'A command targeting a station other than the context target must be rejected');
  engine.setDroneStationMode(second.id, 'ESCORT');
  assert.strictEqual(second.droneMode, 'ESCORT', 'The context-selected operational pad can change doctrine');

  engine.attemptToggleDroneMode();
  assert.strictEqual(second.droneMode, 'DEFENSE', 'C toggles the station under the cursor when it is in range');
  assert.strictEqual(second.escortCommanderId, undefined, 'Switching back to defense clears the escort commander assignment');
  assert.strictEqual(first.droneMode, 'ESCORT', 'C does not toggle a different, non-context station');
  engine.setAimPoint(10_000, 10_000);
  engine.attemptToggleDroneMode();
  assert.strictEqual(first.droneMode, 'ESCORT', 'C is a no-op when no Drone Station is inside interaction range');
});

test('Building blueprints exist for all 5 required types with valid Wood and Stone costs', () => {
  const types = ['WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'] as const;
  for (const type of types) {
    const bp = BUILDING_BLUEPRINTS[type];
    assert.ok(bp, `Blueprint for ${type} must exist`);
    assert.ok(bp.hp > 0, `${type} must have positive HP`);
    assert.ok(bp.cost.wood >= 0 && bp.cost.stone >= 0, `${type} must have non-negative resource costs`);
    assert.ok(bp.cost.wood > 0 || bp.cost.stone > 0, `${type} must cost resources`);
  }
});



test('The content catalog has complete data and presentation for every building and entity kind', () => {
  const expectedBuildings = ['CORE', 'WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'];
  assert.deepStrictEqual(Object.keys(BUILDING_CATALOG).sort(), [...expectedBuildings].sort());
  for (const type of expectedBuildings as Array<keyof typeof BUILDING_CATALOG>) {
    const definition = BUILDING_CATALOG[type];
    assert.ok(definition.name.length > 0 && definition.description.length > 0);
    assert.ok(definition.accentColor.startsWith('#'));
    assert.ok(BUILDING_COMBAT_PROFILES[type]);
  }
  assert.deepStrictEqual(Object.keys(ENTITY_CATALOG).sort(), ['COMMANDER', 'DRONE', 'HARVESTER_BOT'].sort());
  assert.deepStrictEqual(Object.keys(ENTITY_COMBAT_PROFILES).sort(), ['COMMANDER', 'DRONE', 'HARVESTER_BOT'].sort());
  assert.ok(ENTITY_CATALOG.DRONE.visual.player.primary.startsWith('#'));
});

test('Every building folder registers its definition, behavior, upgrades, stat inspector, and procedural renderer', () => {
  const expected = ['CORE', 'WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'];
  assert.deepStrictEqual(Object.keys(BUILDING_MODULES).sort(), [...expected].sort());
  for (const type of expected as Array<keyof typeof BUILDING_MODULES>) {
    const module = BUILDING_MODULES[type];
    assert.ok(module.behavior.kind.length > 0, `${type} must define engine behavior`);
    assert.strictEqual(typeof module.draw, 'function', `${type} owns its procedural drawing`);
    assert.strictEqual(typeof module.getStatLines, 'function', `${type} owns its inspector`);
    if (type !== 'CORE') assert.strictEqual(module.upgrades.length, 4, `${type} owns a four-tier upgrade path`);
  }
});

test('Q/E are the only upgrade branch-selection bindings', () => {
  const wall = createBuildingInstance('WALL', 'player', 0, 0, 'hotkey-wall');
  const options = getBuildingUpgradeOptions(wall);
  assert.strictEqual(getUpgradeOptionForHotkey(wall, 'Q')?.id, options[0].id);
  assert.strictEqual(getUpgradeOptionForHotkey(wall, 'E')?.id, options[1].id);
  assert.ok(options[0].description.includes('maximum HP'), 'Wall HP specialization should describe its health tradeoff');
  assert.ok(options[1].description.includes('100-damage hit'), 'Wall armor specialization should explain per-hit damage');
  assert.ok(options[1].description.includes('82 HP'), 'Wall armor specialization should explain damage reduced per hit');
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 0, 0, 'hotkey-turret');
  assert.strictEqual(getUpgradeOptionForHotkey(turret, 'Q')?.id, getBuildingUpgradeOptions(turret)[0].id);
  assert.strictEqual(getUpgradeOptionForHotkey(turret, 'E')?.id, getBuildingUpgradeOptions(turret)[1].id);
});

test('Drone speed configuration raises cruise speed and keeps direct flight acceleration-limited', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'fast-drone-station');
  const drone = createCombatDrone(station, { x: 300, y: 300 }, 'accelerating-drone');
  const startX = drone.x;
  const startY = drone.y;
  const moved = moveEntityTowardSmoothly(drone, 800, 300, [], [], 0.05, 345, 1120, 94);
  assert.ok(moved);
  const travelled = Math.hypot(drone.x - startX, drone.y - startY);
  assert.ok(travelled <= 345 * 0.05 + 0.01, 'Smooth direct flight must obey its physical speed cap');
  assert.ok(travelled < 345 * 0.05, 'Acceleration limiting must prevent an instant jump to cruise speed');
  assert.ok(BUILDING_MODULES.DRONE_STATION.behavior.kind === 'DRONE_STATION' && BUILDING_MODULES.DRONE_STATION.behavior.baseDroneSpeed >= 240);
});

test('All damage sources clamp health to zero and lethal commander damage enters respawn state', () => {
  const commander = createCommander('enemy', 0, 0, 'lethal-commander');
  commander.hp = 12;
  const result = applyEntityDamage(commander, 250);
  assert.strictEqual(result.damage, 12, 'Actual applied damage must not exceed remaining HP');
  assert.strictEqual(result.becameLethal, true);
  assert.strictEqual(commander.hp, 0, 'HP must be clamped to zero');
  assert.strictEqual(commander.isDead, true, 'Lethal damage must activate commander death state');
  assert.strictEqual(commander.respawnTimer, 3);
  assert.strictEqual(applyEntityDamage(commander, 250).damage, 0, 'Dead commanders cannot take extra lethal damage');
  assert.strictEqual(commander.hp, 0);

  const droneStation = createBuildingInstance('DRONE_STATION', 'player', -10, -10, 'damage-station');
  const drone = createCombatDrone(droneStation, { x: -300, y: -300 }, 'lethal-drone');
  drone.hp = 2;
  applyEntityDamage(drone, 99);
  assert.strictEqual(drone.hp, 0, 'Combat units cannot retain negative HP');

  const turret = createBuildingInstance('AUTO_TURRET', 'enemy', 4, 4, 'lethal-building');
  turret.hp = 3;
  const buildingDamage = applyBuildingDamage(turret, 900);
  assert.strictEqual(buildingDamage.damage, 3);
  assert.strictEqual(buildingDamage.becameLethal, true);
  assert.strictEqual(turret.hp, 0, 'Buildings must be removed from play at exactly zero HP');
});

test('Damage helpers throw on malformed health, armor, or damage instead of converting it to zero', () => {
  const commander = createCommander('enemy', 0, 0, 'strict-damage-commander');
  assert.throws(() => applyEntityDamage(commander, Number.NaN), /finite and non-negative/);
  assert.throws(() => applyEntityDamage(commander, -1), /finite and non-negative/);
  commander.hp = Number.NaN;
  assert.throws(() => applyEntityDamage(commander, 1), /invalid HP/);

  const wall = createBuildingInstance('WALL', 'enemy', 1, 1, 'strict-damage-wall');
  assert.throws(() => applyBuildingDamage(wall, Number.POSITIVE_INFINITY), /finite and non-negative/);
  wall.armor = Number.NaN;
  assert.throws(() => applyBuildingDamage(wall, 1), /invalid armor/);
});
