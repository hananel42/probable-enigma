import { updateDroneWeapons } from '../ai/droneAI/DroneAIWeapons';
import type { PrioritizedCombatTarget } from '../combat';
import { BASE_DRONE_TUNING } from '../combatTuning';
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

test('Defense drones keep advancing the shared flight phase while engaging and alerting idle allies', () => {
  const station = createBuildingInstance('DRONE_STATION', 'enemy', -6, -6, 'alert-station', 'enemy-base-alert');
  station.droneMode = 'DEFENSE';
  const sentry = createCombatDrone(station, { x: 170, y: 24 }, 'alert-sentry');
  const reserve = createCombatDrone(station, { x: 760, y: 24 }, 'alert-reserve');
  const commander = createCommander('enemy', 800, 300, 'alert-commander');
  commander.teamId = 'enemy-base-alert';
  commander.aiGoal = 'COLLECT_RESOURCES';
  const hostile = createCommander('player', 255, 24, 'alert-hostile');
  const allEntities = [sentry, reserve, commander, hostile];
  const ai = new DroneAI();

  ai.updateDrone(sentry, createCommander('player'), operationalBuildingSet(station), allEntities, [], 0.05, [], 0.05);
  const combatPhase = sentry.droneFlightPhase;
  ai.updateDrone(sentry, createCommander('player'), operationalBuildingSet(station), allEntities, [], 0.05, [], 0.1);

  assert.notStrictEqual(sentry.droneFlightPhase, combatPhase, 'A defense drone must keep following the same continuously advancing physics phase while it fights');
  assert.strictEqual(sentry.combatAlertEntityId, hostile.id, 'The detecting drone should lock its hostile target');
  assert.strictEqual(reserve.combatAlertEntityId, hostile.id, 'Idle allied drones should receive the alert');
  assert.strictEqual(commander.aiGoal, 'ATTACK_TARGET', 'An idle enemy commander should answer a defense call');
  assert.strictEqual(commander.aiTargetEntityId, hostile.id);
});

test('Defense drones orbit a live combat target instead of holding a stationary firing position', () => {
  const station = createBuildingInstance('DRONE_STATION', 'enemy', -6, -6, 'hold-position-station', 'enemy-hold-base');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 120, y: 24 }, 'hold-position-drone');
  const hostile = createCommander('player', -180, -180, 'hold-position-hostile');
  const entities = [drone, hostile];
  drone.droneFlightGoalX = 900;
  drone.droneFlightGoalY = 480;
  drone.droneCombatCheckTimer = 0;

  new DroneAI().updateDrone(drone, createCommander('player', 0, 0, 'dummy-player'), operationalBuildingSet(station), entities, [], 0.1, [], 1);
  const firstOrbitPhase = drone.droneFlightPhase;
  const firstGoal = { x: drone.droneFlightGoalX!, y: drone.droneFlightGoalY! };
  new DroneAI().updateDrone(drone, createCommander('player', 0, 0, 'dummy-player-2'), operationalBuildingSet(station), entities, [], 0.1, [], 1.1);

  assert.strictEqual(drone.droneFlightCenterId, `combat:${hostile.id}`, 'The hostile becomes the active flight centre');
  assert.ok(firstOrbitPhase !== undefined, 'The unified flight controller must initialize an orbit phase');
  assert.notStrictEqual(drone.droneFlightPhase, firstOrbitPhase, 'Orbit phase must keep advancing while the target survives');
  assert.ok(Math.hypot(firstGoal.x - drone.droneFlightGoalX!, firstGoal.y - drone.droneFlightGoalY!) < 60,
    'The moving orbit target should advance continuously instead of jumping to an unrelated stale goal');
});

test('Defense drones resume their patrol smoothly after the engaged target is destroyed', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -4, -4, 'resume-patrol-station');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 180, y: 24 }, 'resume-patrol-drone');
  const hostile = createCommander('enemy', 235, 24, 'resume-patrol-target');
  const entities = [drone, hostile];
  const ai = new DroneAI();
  drone.droneCombatCheckTimer = 0;

  ai.updateDrone(drone, createCommander('player', 0, 0, 'resume-patrol-player'), operationalBuildingSet(station), entities, [], 0.05, [], 1);
  assert.strictEqual(drone.droneCombatOrbitTargetId, hostile.id);
  const goalBeforeDeath = { x: drone.droneFlightGoalX!, y: drone.droneFlightGoalY! };
  const patrolBeforeDeath = drone.droneFlightPhase;
  const positionBeforeReturn = { x: drone.x, y: drone.y };

  hostile.hp = 0;
  hostile.isDead = true;
  drone.droneCombatCheckTimer = 0;
  ai.updateDrone(drone, createCommander('player', 0, 0, 'resume-patrol-player-2'), operationalBuildingSet(station), entities, [], 0.05, [], 1.05);

  assert.strictEqual(drone.droneCombatOrbitTargetId, null, 'Destroyed targets should release the combat orbit lock');
  assert.strictEqual(drone.droneFlightCenterId, `station:${station.id}`, 'The drone immediately returns to its previous home centre');
  assert.notStrictEqual(drone.droneFlightPhase, patrolBeforeDeath, 'The shared orbit phase continues advancing after target loss');
  const returnStep = Math.hypot(drone.x - positionBeforeReturn.x, drone.y - positionBeforeReturn.y);
  assert.ok(returnStep <= 390 * 0.05 + 0.5, `Returning to home must preserve the physical speed cap, moved ${returnStep.toFixed(2)} px`);
  assert.ok(Number.isFinite(drone.droneFlightGoalX) && Number.isFinite(drone.droneFlightGoalY));
});
test('Escort drones abandon targets that leave the ten-tile commander tether', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'escort-tether-station');
  station.droneMode = 'ESCORT';
  const commander = createCommander('player', 0, 0, 'escort-tether-commander');
  station.escortCommanderId = commander.id;
  const drone = createCombatDrone(station, { x: 180, y: 0 }, 'escort-tether-drone');
  const hostile = createCommander('enemy', 220, 0, 'escort-tether-hostile');
  drone.droneCombatCheckTimer = 0;
  const entities = [drone, commander, hostile];
  const ai = new DroneAI();

  ai.updateDrone(drone, commander, operationalBuildingSet(station), entities, [], 0.05, [], 1);
  assert.strictEqual(drone.droneTargetEntityId, hostile.id, "A hostile within the commander tether should be engaged");
  assert.strictEqual(drone.droneAIState, 'ATTACK', 'Acquiring a live target must enter the explicit ATTACK state');
  assert.strictEqual(drone.droneFlightCenterId, `combat:${hostile.id}`, 'The hostile becomes the escort flight centre while it fits the commander leash');

  hostile.x = 620;
  hostile.y = 0;
  drone.droneCombatCheckTimer = 0;
  ai.updateDrone(drone, commander, operationalBuildingSet(station), entities, [], 0.05, [], 1.1);
  assert.notStrictEqual(drone.droneTargetEntityId, hostile.id, 'An escort drone must break off once its target exits the ten-tile commander radius');
  assert.strictEqual(drone.droneAIState, 'PATROL', 'Leaving pursuit range must return the drone to its non-attacking state');
  assert.strictEqual(drone.droneFlightCenterId, `escort:${commander.id}`, 'Leaving the tether immediately restores the live commander centre');
  assert.strictEqual(drone.droneCombatOrbitTargetId, null, 'Leaving the tether clears the combat orbit lock');
});

test('Drone combat policy has exactly two high-level states', () => {
  assert.strictEqual(resolveDroneAIState(null), 'PATROL');
  assert.strictEqual(resolveDroneAIState(undefined), 'PATROL');
  assert.strictEqual(resolveDroneAIState('live-hostile'), 'ATTACK');
  assert.strictEqual(resolveDroneAIState(''), 'PATROL');

  const station = createBuildingInstance('DRONE_STATION', 'player', -3, -3, 'fsm-state-station');
  const drone = createCombatDrone(station, { x: 180, y: 24 }, 'fsm-state-drone');
  assert.strictEqual(drone.droneAIState, 'PATROL', 'A new drone starts on its doctrine route, not in combat');
});

test('Defense drones release combat navigation and resume patrol when a hostile exits their sensor range', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -6, -6, 'defense-range-station');
  station.droneMode = 'DEFENSE';
  const drone = createCombatDrone(station, { x: 180, y: 24 }, 'defense-range-drone');
  const hostile = createCommander('enemy', -180, -180, 'defense-range-hostile');
  const entities = [drone, hostile];
  const ai = new DroneAI();
  drone.droneCombatCheckTimer = 0;

  ai.updateDrone(drone, createCommander('player', -500, -500, 'defense-range-viewer'), operationalBuildingSet(station), entities, [], 0.05, [], 1);
  assert.equal(drone.droneCombatOrbitTargetId, hostile.id, 'The drone should engage a hostile that enters its defense range');
  assert.strictEqual(drone.droneAIState, 'ATTACK');

  hostile.x = 1400;
  hostile.y = 24;
  drone.droneCombatCheckTimer = 0;
  const patrolPhaseBeforeBreakoff = drone.droneFlightPhase;
  ai.updateDrone(drone, createCommander('player', -500, -500, 'defense-range-viewer-2'), operationalBuildingSet(station), entities, [], 0.05, [], 1.05);

  assert.equal(drone.droneTargetEntityId, null, 'Out-of-range enemies must not remain cached combat targets');
  assert.strictEqual(drone.droneAIState, 'PATROL', 'Defensive drones return to patrol as soon as no valid target remains');
  assert.equal(drone.droneCombatOrbitTargetId, null, 'Leaving sensor range must clear the combat orbit lock');
  assert.strictEqual(drone.droneFlightCenterId, `station:${station.id}`, 'Breakoff returns to the base centre immediately');
  assert.notEqual(drone.droneFlightPhase, patrolPhaseBeforeBreakoff, 'The same flight phase keeps advancing after breakoff');

  let travelledDistance = 0;
  let largestStep = 0;
  for (let step = 0; step < 36; step++) {
    const oldX = drone.x;
    const oldY = drone.y;
    ai.updateDrone(
      drone,
      createCommander('player', -500, -500, 'defense-range-viewer-recovery'),
      operationalBuildingSet(station),
      entities,
      [],
      0.05,
      [],
      1.1 + step * 0.05
    );
    const movementStep = Math.hypot(drone.x - oldX, drone.y - oldY);
    travelledDistance += movementStep;
    largestStep = Math.max(largestStep, movementStep);
  }
  assert.ok(travelledDistance > 35, 'A drone that breaks off pursuit must physically travel back toward its defense orbit instead of retaining a stale waypoint');
  assert.ok(largestStep <= Math.min(drone.speed, 345) * 0.05 + 1,
    `Returning to defense patrol must use normal flight speed, not teleport ${largestStep.toFixed(2)} px in one 50ms step`);
});

test('Kamikaze speed is 120% of the drone current speed, including station upgrades, independent of target speed', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'kamikaze-speed-station');
  station.droneSpeedMultiplier = 2.5;
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'kamikaze-speed-drone');
  drone.hp = 10;
  const target = createCommander('enemy', 1000, 0, 'kamikaze-speed-target');
  target.speed = 5000; // Target speed must not influence the kamikaze drone.
  const buildings = operationalBuildingSet(station);
  const startX = drone.x;
  const startY = drone.y;

  new DroneAI().updateDrone(
    drone, createCommander('player', -500, -500, 'kamikaze-speed-viewer'),
    buildings, [drone, target], [], 0.5, [], 1
  );

  const travelledSpeed = Math.hypot(drone.x - startX, drone.y - startY) / 0.5;
  const expectedSpeed = drone.speed * BASE_DRONE_TUNING.kamikazeSpeedMultiplier;
  assert.ok(Math.abs(travelledSpeed - expectedSpeed) < 0.01,
    `Expected 120% of the upgraded drone speed (${expectedSpeed}px/s), got ${travelledSpeed}px/s`);
  assert.ok(travelledSpeed > drone.speed, "Kamikaze flight must be 20% faster than this drone's normal speed");
});

test('Kamikaze drones wait safely without a hostile target and acquire one when it appears', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'kamikaze-no-target-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'kamikaze-no-target-drone');
  drone.hp = 1;
  drone.vx = 0;
  drone.vy = 0;
  const ai = new DroneAI();
  const viewer = createCommander('player', -500, -500, 'kamikaze-no-target-viewer');
  const buildings = operationalBuildingSet(station);
  const start = { x: drone.x, y: drone.y };

  ai.updateDrone(drone, viewer, buildings, [drone], [], 0.1, [], 1);
  assert.strictEqual(drone.droneKamikazeActive, true, 'Low-health drones must commit to kamikaze mode even if no target is available yet');
  assert.strictEqual(drone.droneKamikazeTargetId, null);
  assert.strictEqual(drone.droneKamikazeTargetBuildingId, null);
  assert.strictEqual(drone.hp, 1, 'A drone must not detonate without a valid hostile target');
  assert.ok(Math.hypot(drone.x - start.x, drone.y - start.y) < 0.01, 'No-target waiting must not drift');

  const hostile = createCommander('enemy', 500, 0, 'kamikaze-no-target-later-hostile');
  ai.updateDrone(drone, viewer, buildings, [drone, hostile], [], 0.1, [], 1.1);
  assert.strictEqual(drone.droneKamikazeTargetId, hostile.id, 'The drone should acquire a valid hostile once one becomes available');
  assert.ok(drone.x > start.x, 'The drone should begin moving toward the newly available target');
  assert.strictEqual(drone.hp, 1, 'Target acquisition must not prematurely detonate the drone');
});

test('Kamikaze drones discard a dead cached target and retarget a live hostile', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'kamikaze-retarget-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'kamikaze-retarget-drone');
  drone.hp = 1;
  const deadTarget = createCommander('enemy', 30, 0, 'kamikaze-retarget-dead-target');
  deadTarget.hp = 0;
  deadTarget.isDead = true;
  const liveTarget = createCommander('enemy', 600, 0, 'kamikaze-retarget-live-target');
  drone.droneKamikazeTargetId = deadTarget.id;

  new DroneAI().updateDrone(
    drone,
    createCommander('player', -500, -500, 'kamikaze-retarget-viewer'),
    operationalBuildingSet(station),
    [drone, deadTarget, liveTarget],
    [],
    0.1,
    [],
    1
  );

  assert.strictEqual(drone.droneKamikazeTargetId, liveTarget.id, 'A dead cached target must be discarded before movement');
  assert.ok(drone.x > 0, 'The drone should move toward the valid replacement target');
  assert.strictEqual(drone.hp, 1, 'Retargeting must not itself trigger detonation');
});

test('Drone baseline fire rate increases while its close-range weapon envelope stays unchanged', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'drone-weapon-tuning-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'drone-weapon-tuning-drone');
  const target = createCommander('enemy', 500, 0, 'drone-weapon-tuning-target');
  const buildings = operationalBuildingSet(station);

  new DroneAI().updateDrone(
    drone, createCommander('player', -500, -500, 'drone-weapon-tuning-viewer'),
    buildings, [drone, target], [], 0.01, [], 1
  );

  assert.equal(drone.fireCooldown, BASE_DRONE_TUNING.fireCooldown);
  assert.equal(drone.range, GRID_SIZE * BASE_DRONE_TUNING.weaponRangeInGridCells,
    'Weapon range remains at the established 2.8 grid cells');
  assert.equal(createCombatDrone(station).range, GRID_SIZE * BASE_DRONE_TUNING.weaponRangeInGridCells,
    'New drones must start with the same range used by the runtime AI');
});

test('Drone weapon loop fires using the faster 0.28-second baseline interval', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'drone-fire-interval-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'drone-fire-interval-drone');
  const enemy = createCommander('enemy', 50, 0, 'drone-fire-interval-target');
  const target: PrioritizedCombatTarget = { kind: 'ENTITY', entity: enemy, distance: 50 };
  const projectiles: Projectile[] = [];

  updateDroneWeapons(drone, target, drone.range || 0, 'player-team', projectiles, 0.27);
  assert.equal(projectiles.length, 0, 'The baseline cooldown has not yet elapsed at 0.27 seconds');
  updateDroneWeapons(drone, target, drone.range || 0, 'player-team', projectiles, 0.02);
  assert.equal(projectiles.length, 1, 'A shot must be ready by 0.29 seconds, sooner than the previous 0.38-second baseline');
});

test('Drone weapons reject missing damage instead of silently substituting baseline damage', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'invalid-drone-damage-station');
  const drone = createCombatDrone(station, { x: 0, y: 0 }, 'invalid-drone-damage-drone');
  drone.damage = undefined;
  const enemy = createCommander('enemy', 50, 0, 'invalid-drone-damage-target');
  const target: PrioritizedCombatTarget = { kind: 'ENTITY', entity: enemy, distance: 50 };
  const projectiles: Projectile[] = [];

  assert.throws(
    () => updateDroneWeapons(drone, target, drone.range ?? 0, 'player-team', projectiles, BASE_DRONE_TUNING.fireCooldown),
    /invalid weapon damage/,
    'Broken drone damage state must be visible instead of silently replacing it with baseline damage.'
  );
  assert.strictEqual(projectiles.length, 0, 'Invalid damage must never create a projectile.');
});

test('Low-health drones kamikaze into the nearest hostile with sharply distance-falling splash damage', () => {
  const station = createBuildingInstance('DRONE_STATION', 'player', -20, -20, 'kamikaze-station');
  const drone = createCombatDrone(station, { x: -20, y: 0 }, 'kamikaze-drone');
  drone.hp = 10;
  const target = createCommander('enemy', 0, 0, 'kamikaze-target');
  const nearbyTurret = createBuildingInstance('AUTO_TURRET', 'enemy', 1, 0, 'kamikaze-nearby-turret');
  const edgeTurret = createBuildingInstance('AUTO_TURRET', 'enemy', 3, 0, 'kamikaze-edge-turret');
  const buildings = [...operationalBuildingSet(station), nearbyTurret, edgeTurret];
  const entities = [drone, target];
  const targetHpBefore = target.hp;
  const nearbyHpBefore = nearbyTurret.hp;
  const edgeHpBefore = edgeTurret.hp;

  new DroneAI().updateDrone(drone, createCommander('player', -500, -500, 'kamikaze-viewer'), buildings, entities, [], 0.05, [], 1);

  assert.ok(target.hp < targetHpBefore, 'The drone should explode on contact with its nearest hostile');
  assert.ok(nearbyTurret.hp < nearbyHpBefore, 'The explosion should damage nearby hostile structures');
  assert.ok(nearbyHpBefore - nearbyTurret.hp > 0, 'Nearby structures must receive positive splash damage');
  assert.strictEqual(edgeTurret.hp, edgeHpBefore, 'Damage must fall to zero at the three-block blast edge');
  assert.strictEqual(drone.hp, 0, 'A kamikaze drone is consumed by its explosion');
});
