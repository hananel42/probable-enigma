import test from 'node:test';
import assert from 'node:assert/strict';
import type { Projectile, Resources } from './types';
import { GameEngine } from './engine';
import { createBuildingInstance, createCommander, createCombatDrone, getBuildingUpgradeCost, upgradeBuildingStats } from './rules';
import { getBuildingUpgradeOptions } from './upgrades/upgradeSystem';
import { BASE_WEAPON_TUNING } from './combatTuning';
import { BUILDING_MODULES } from './buildings/registry';
import { BUILDING_UPGRADE_TREES } from './upgrades/upgradeCatalog';
import { applyTowerEffects } from './statusEffects/towerEffects';
import { getBuffMultiplier, tickBuffs } from './statusEffects/buffSystem';

const hostProjectileIdentity: Pick<Projectile, 'faction' | 'teamId' | 'allianceId' | 'ownerPlayerId'> = {
  faction: 'player',
  teamId: 'group-host',
  allianceId: 'alliance-humans',
  ownerPlayerId: 'player-host'
};

function makeProjectile(overrides: Partial<Projectile> = {}): Projectile {
  return {
    id: 'test-projectile',
    x: 0,
    y: 0,
    rangeOriginX: 0,
    rangeOriginY: 0,
    maxRange: 450,
    vx: 450,
    vy: 0,
    damage: 30,
    faction: 'player',
    teamId: 'group-host',
    allianceId: 'alliance-humans',
    ownerPlayerId: 'player-host',
    color: '#38bdf8',
    radius: 4,
    life: 1,
    maxLife: 1,
    ...overrides
  };
}

test('unupgraded Commander and Auto-Turret share the same baseline weapon, while the turret has more HP', () => {
  const commander = createCommander('player', 0, 0, 'baseline-commander');
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 4, 4, 'baseline-turret');
  const behavior = BUILDING_MODULES.AUTO_TURRET.behavior;
  assert.strictEqual(behavior.kind, 'PROJECTILE_WEAPON');
  if (behavior.kind !== 'PROJECTILE_WEAPON') throw new Error('Auto-Turret must remain a projectile weapon.');

  assert.strictEqual(commander.damage, BASE_WEAPON_TUNING.damage);
  assert.strictEqual(turret.damage, commander.damage, 'Base direct-hit damage must match');
  assert.strictEqual(commander.fireCooldown, BASE_WEAPON_TUNING.fireCooldown);
  assert.strictEqual(turret.fireCooldown, commander.fireCooldown, 'Base cooldown must match');
  assert.strictEqual(commander.range, BASE_WEAPON_TUNING.range);
  assert.strictEqual(turret.range, commander.range, 'Base range must match');
  assert.strictEqual(behavior.projectileSpeed, BASE_WEAPON_TUNING.projectileSpeed);
  assert.ok(turret.maxHp > commander.maxHp, 'A turret should survive longer than a Commander');
});

test('projectiles cannot exploit hitbox or muzzle offsets to damage targets beyond their listed range', () => {
  const engine = new GameEngine(120);
  const canReach = (engine as unknown as { projectileCanReachTarget: (p: Projectile, x: number, y: number) => boolean }).projectileCanReachTarget;
  const projectile = makeProjectile({ rangeOriginX: 10, rangeOriginY: 20, maxRange: 360 });
  assert.strictEqual(canReach.call(engine, projectile, 370, 20), true, 'Exactly maxRange from the firing origin remains reachable');
  assert.strictEqual(canReach.call(engine, projectile, 370.1, 20), false, 'A large collision radius must not extend center-to-center range');
  assert.strictEqual(canReach.call(engine, projectile, 10, 380), true);
  assert.strictEqual(canReach.call(engine, makeProjectile(), 10_000, 10_000), false,
    'Every current projectile is bounded by its explicit range metadata');
});

test('destroying a hostile Core awards exactly one Diamond per Core and never rewards friendly structures', () => {
  const engine = new GameEngine(121);
  const host = engine.state.humanPlayers.find(player => player.playerId === 'player-host');
  assert.ok(host);
  assert.strictEqual(host.resources.diamonds ?? 0, 0);

  const hostileCore = createBuildingInstance('CORE', 'enemy', 80, 80, 'diamond-reward-core', 'enemy-outpost-1');
  hostileCore.hp = 1;
  engine.state.buildings.push(hostileCore);
  const result = engine.damageBuilding(hostileCore, 999, hostProjectileIdentity);
  assert.strictEqual(result.becameLethal, true);
  assert.strictEqual(host.resources.diamonds, 1, 'A lethal hostile-Core hit rewards one Diamond');
  assert.strictEqual(engine.state.resources.diamonds, 1, 'The active HUD wallet stays in sync');

  engine.damageBuilding(hostileCore, 999, hostProjectileIdentity);
  assert.strictEqual(host.resources.diamonds, 1, 'Additional damage to the same destroyed Core cannot reward a second Diamond');

  const alliedCore = createBuildingInstance('CORE', 'player', 100, 100, 'diamond-friendly-core', 'group-host');
  alliedCore.hp = 1;
  alliedCore.allianceId = 'alliance-humans';
  engine.state.buildings.push(alliedCore);
  engine.damageBuilding(alliedCore, 999, hostProjectileIdentity);
  assert.strictEqual(host.resources.diamonds, 1, 'A friendly Core never pays a Diamond bounty');

  const hostileWall = createBuildingInstance('WALL', 'enemy', 110, 110, 'diamond-not-for-wall', 'enemy-outpost-1');
  hostileWall.hp = 1;
  engine.state.buildings.push(hostileWall);
  engine.damageBuilding(hostileWall, 999, hostProjectileIdentity);
  assert.strictEqual(host.resources.diamonds, 1, 'Destroying non-Core structures never pays Diamonds');

  const secondHostileCore = createBuildingInstance('CORE', 'enemy', 130, 130, 'diamond-reward-core-2', 'enemy-outpost-2');
  secondHostileCore.hp = 1;
  engine.state.buildings.push(secondHostileCore);
  engine.damageBuilding(secondHostileCore, 999, hostProjectileIdentity);
  assert.strictEqual(host.resources.diamonds, 2, 'A different hostile Core may pay its own single Diamond');
});

test('Diamonds are reserved for Core upgrades and are a hard purchase requirement', () => {
  const core = createBuildingInstance('CORE', 'player', -1, -1, 'diamond-cost-core');
  for (const tier of BUILDING_UPGRADE_TREES.CORE) {
    core.level = tier.targetLevel - 1;
    for (const option of tier.options) {
      assert.ok((getBuildingUpgradeCost(core, option.id).diamonds ?? 0) >= 1, `${option.name} costs at least one Diamond`);
    }
  }
  const turret = createBuildingInstance('AUTO_TURRET', 'player', 2, 2, 'diamond-free-turret');
  for (const tier of BUILDING_UPGRADE_TREES.AUTO_TURRET) {
    turret.level = tier.targetLevel - 1;
    for (const option of tier.options) {
      assert.strictEqual(getBuildingUpgradeCost(turret, option.id).diamonds ?? 0, 0,
        `${option.name} cannot consume Diamonds`);
    }
  }

  const engine = new GameEngine(122);
  const liveCore = engine.state.buildings.find(building => building.id === 'player-core');
  assert.ok(liveCore);
  engine.state.resources = { wood: 1000, stone: 1000, diamonds: 0 };
  const host = engine.state.humanPlayers.find(player => player.playerId === 'player-host');
  assert.ok(host);
  host.resources = { ...engine.state.resources };
  engine.attemptUpgradeNearby(liveCore.id, 'core_reinforced_matrix');
  assert.strictEqual(liveCore.level, 1, 'Enough wood and stone are not sufficient without a Diamond');
  assert.strictEqual(engine.state.resources.wood, 1000, 'Failed purchases do not consume ordinary materials');

  engine.state.resources = { wood: 1000, stone: 1000, diamonds: 1 };
  host.resources = { ...engine.state.resources };
  engine.attemptUpgradeNearby(liveCore.id, 'core_reinforced_matrix');
  assert.strictEqual(liveCore.level, 2);
  assert.strictEqual(engine.state.resources.diamonds, 0, 'Successful Core upgrades consume the Diamond');
});

test('Core progression keeps opening choices non-aggressive and opens weapon modules at levels 4 and 5', () => {
  const core = createBuildingInstance('CORE', 'player', 0, 0, 'staged-core-upgrades');
  const levelTwo = getBuildingUpgradeOptions(core);
  assert.deepStrictEqual(levelTwo.map(option => option.id), ['core_reinforced_matrix', 'core_mining_accelerator']);
  assert.ok(levelTwo.every(option => (option.commanderEffects ?? []).every(effect =>
    effect.stat !== 'damage' && effect.stat !== 'fireCooldown' && effect.stat !== 'range')),
  'Opening Core upgrades must not increase combat stats');

  core.level = 3;
  const levelFour = getBuildingUpgradeOptions(core);
  assert.ok(levelFour.some(option => option.id === 'core_weapon_calibration'));
  assert.ok(levelFour.some(option => option.id === 'core_rapid_trigger'));
  core.level = 4;
  const levelFive = getBuildingUpgradeOptions(core);
  assert.ok(levelFive.some(option => option.id === 'core_siege_optics'));
  assert.ok(levelFive.some(option => option.id === 'core_heavy_pulse'));
});

test('Effect Tower combines data-driven waves and applies distinct debuffs to Commanders and Drones', () => {
  const tower = createBuildingInstance('FIRE_TOWER', 'player', 0, 0, 'combined-effect-tower');
  tower.effectDuration = 3;
  tower.towerEffectIds = ['burning', 'slowing', 'signal-suppression', 'weakened-shots', 'radio-jamming', 'corrosion'];
  const commander = createCommander('enemy', 100, 100, 'effect-target-commander');
  commander.armor = 0.4;
  const initialHp = commander.hp;
  applyTowerEffects(tower, commander);

  assert.ok(getBuffMultiplier(commander, 'speedMultiplier') < 1, 'Cryogenic waves slow the target');
  assert.ok(getBuffMultiplier(commander, 'fireRateMultiplier') < 1, 'Signal and radio effects reduce firing rate');
  assert.ok(getBuffMultiplier(commander, 'powerMultiplier') < 1, 'Weakening waves reduce outgoing shot power');
  assert.strictEqual(getBuffMultiplier(commander, 'armorMultiplier'), 0.65, 'Corrosion weakens effective armor');
  const commanderJamming = commander.buffs?.find(buff => buff.id === 'tower-radio-jamming');
  assert.strictEqual(commanderJamming?.healthPerSecond, -0.25, 'Radio jamming barely harms a Commander');
  assert.ok(commander.buffs?.some(buff => buff.id === 'burning'));
  const commanderTick = tickBuffs(commander, 1);
  assert.ok(commanderTick.healthDelta < 0 && commander.hp === initialHp,
    'Status ticking reports damage for the authoritative engine to apply through its damage path');

  const droneStation = createBuildingInstance('DRONE_STATION', 'enemy', 6, 6, 'jammed-drone-station', 'enemy-team');
  const drone = createCombatDrone(droneStation, { x: 300, y: 300 }, 'effect-target-drone');
  tower.towerEffectIds = ['radio-jamming'];
  applyTowerEffects(tower, drone);
  const droneJamming = drone.buffs?.find(buff => buff.id === 'tower-radio-jamming');
  assert.strictEqual(droneJamming?.healthPerSecond, -24, 'Radio jamming heavily damages Drones');
  assert.strictEqual(getBuffMultiplier(drone, 'fireRateMultiplier'), 0.5, 'Radio jamming halves Drone firing rate');
  assert.ok(tickBuffs(drone, 1).healthDelta <= -24, 'Drone radio-jamming damage is materially higher than Commander damage');
});

test('Explosive turret payloads damage hostile splash targets and can earn a Core bounty without friendly fire', () => {
  const engine = new GameEngine(123);
  const alliedCommander = engine.state.player;
  alliedCommander.x = 95;
  alliedCommander.y = 100;

  const directTarget = createCommander('enemy', 145, 100, 'splash-direct-target');
  directTarget.teamId = 'enemy-team';
  const splashTarget = createCommander('enemy', 150, 115, 'splash-secondary-target');
  splashTarget.teamId = 'enemy-team';
  engine.state.entities.push(directTarget, splashTarget);

  const hostileCore = createBuildingInstance('CORE', 'enemy', 3, 2, 'splash-hostile-core', 'enemy-team');
  hostileCore.hp = 10;
  engine.state.buildings.push(hostileCore);
  const projectile = makeProjectile({ damage: 50, explosionRadius: 70, explosionDamageMultiplier: 0.5 });
  const alliedHpBefore = alliedCommander.hp;
  const directHpBefore = directTarget.hp;
  const splashHpBefore = splashTarget.hp;

  const explode = (engine as unknown as { applyProjectileExplosion: (p: Projectile, x: number, y: number, directTargetId: string) => void }).applyProjectileExplosion;
  explode.call(engine, projectile, hostileCore.x, hostileCore.y, directTarget.id);

  assert.strictEqual(directTarget.hp, directHpBefore, 'The direct-hit target does not receive duplicate splash damage');
  assert.ok(splashTarget.hp < splashHpBefore, 'Nearby hostile units receive splash damage');
  assert.strictEqual(alliedCommander.hp, alliedHpBefore, 'Allied units never take splash damage');
  assert.strictEqual(engine.state.humanPlayers[0].resources.diamonds, 1, 'A hostile Core destroyed by splash still pays its one Diamond reward');
});

test('Wall reflection changes projectile ownership to the wall team and bounds the reflected return leg', () => {
  const engine = new GameEngine(124);
  const wall = createBuildingInstance('WALL', 'player', 2, 2, 'reflecting-wall', 'group-host');
  wall.ownerPlayerId = 'player-host';
  wall.projectileReflectChance = 0.7;
  const projectile = makeProjectile({
    faction: 'enemy', teamId: 'enemy-team', allianceId: 'enemy-alliance', ownerPlayerId: 'enemy-player',
    vx: -450, rangeOriginX: -200, rangeOriginY: wall.y, maxRange: 360
  });
  const originalRandom = Math.random;
  Math.random = () => 0;
  let didReflect = false;
  try {
    const reflect = (engine as unknown as { tryReflectProjectile: (p: Projectile, b: typeof wall) => boolean }).tryReflectProjectile;
    didReflect = reflect.call(engine, projectile, wall);
  } finally {
    Math.random = originalRandom;
  }

  assert.strictEqual(didReflect, true);
  assert.strictEqual(projectile.faction, wall.faction);
  assert.strictEqual(projectile.teamId, wall.teamId);
  assert.strictEqual(projectile.allianceId, wall.allianceId);
  assert.strictEqual(projectile.ownerPlayerId, 'player-host');
  assert.ok(projectile.vx > 0, 'The shot reverses direction');
  assert.strictEqual(projectile.rangeOriginX, wall.x, 'Range tracking restarts at the reflecting wall');
  assert.ok(projectile.maxRange <= 450 * projectile.life, 'The reflected shot receives a bounded return leg');
});
