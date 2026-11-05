import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingInstance, upgradeBuildingStats } from '../rules';
import { BASE_WEAPON_TUNING } from '../combatTuning';
import { getRecommendedBuildingUpgradeId } from '../upgrades/upgradeSystem';
import { BUILDING_MODULES } from './registry';
import { getCoreVisualProfile } from './core/draw';
import { getTurretVisualProfile } from './autoTurret/draw';
import { getEffectTowerVisualProfile } from './fireTower/draw';

const CORE_UPGRADE_IDS = [
  'core_reinforced_matrix',
  'core_mining_accelerator',
  'core_efficient_extraction',
  'core_swift_frame',
  'core_weapon_calibration',
  'core_rapid_trigger',
  'core_siege_optics',
  'core_heavy_pulse'
] as const;

const TURRET_UPGRADE_IDS = [
  'long-barrel',
  'overcharged-rounds',
  'twin-barrel',
  'guided-rounds',
  'high-velocity-rounds',
  'explosive-ordnance',
  'rapid-cycle',
  'reinforced-bearing'
] as const;

test('every published upgrade has a unique stable ID, a useful name/description and valid costs', () => {
  for (const [buildingType, module] of Object.entries(BUILDING_MODULES)) {
    const ids = new Set<string>();
    for (const tier of module.upgrades) {
      assert.ok(tier.targetLevel >= 2 && tier.targetLevel <= 5, `${buildingType}: target level must be reachable`);
      assert.ok(tier.options.length > 0, `${buildingType}: every tier needs at least one option`);
      for (const option of tier.options) {
        assert.ok(option.id.trim().length > 0, `${buildingType}: upgrade ID must not be blank`);
        assert.ok(!ids.has(option.id), `${buildingType}: duplicate upgrade ID '${option.id}'`);
        ids.add(option.id);
        assert.ok(option.name.trim().length > 0, `${option.id}: name must not be blank`);
        assert.ok(option.description.trim().length > 20, `${option.id}: description must explain its effect`);
        for (const [resource, amount] of Object.entries(option.cost ?? {})) {
          assert.ok(Number.isFinite(amount) && amount >= 0, `${option.id}: invalid ${resource} cost`);
        }
      }
    }
  }
});

test('every Core specialization has a distinct installed-module visual cue', () => {
  for (const id of CORE_UPGRADE_IDS) {
    const core = createBuildingInstance('CORE', 'player', 0, 0, `visual-${id}`);
    core.upgradeIds = [id];
    const profile = getCoreVisualProfile(core);
    const activeCues = Object.entries(profile).filter(([, active]) => active).map(([key]) => key);
    assert.strictEqual(activeCues.length, 1, `${id} should activate exactly one Core visual cue`);
    assert.ok(activeCues[0], `${id} must not be visually invisible`);
  }
});

test('Auto-Turret visual IDs match every published upgrade including High-Velocity Rounds', () => {
  for (const id of TURRET_UPGRADE_IDS) {
    const turret = createBuildingInstance('AUTO_TURRET', 'player', 1, 1, `visual-${id}`);
    turret.upgradeIds = [id];
    if (id === 'twin-barrel') turret.shotsPerAttack = 2;
    const profile = getTurretVisualProfile(turret);
    const visualKey = ({
      'long-barrel': 'longBarrel',
      'overcharged-rounds': 'overcharged',
      'twin-barrel': 'twin',
      'guided-rounds': 'guided',
      'high-velocity-rounds': 'highVelocity',
      'explosive-ordnance': 'explosive',
      'rapid-cycle': 'rapidCycle',
      'reinforced-bearing': 'reinforced'
    } as const)[id];
    assert.strictEqual(profile[visualKey], true, `${id} must activate the ${visualKey} drawing cue`);
  }
});


test('autonomous turrets prioritize range upgrades to counter long-range kiting', () => {
  const turret = createBuildingInstance('AUTO_TURRET', 'enemy', 0, 0, 'ai-range-priority');
  assert.strictEqual(turret.range, BASE_WEAPON_TUNING.range, 'An unupgraded turret shares the Commander range baseline');
  assert.strictEqual(getRecommendedBuildingUpgradeId(turret), 'long-barrel', 'AI should prefer extended range over extra raw damage');
  const upgraded = upgradeBuildingStats(turret, 'long-barrel');
  assert.strictEqual(upgraded.range, BASE_WEAPON_TUNING.range * 1.35);
  assert.ok((upgraded.damage ?? 0) < BASE_WEAPON_TUNING.damage, 'Range comes with an explicit damage tradeoff');
});


test('Effect Tower stat-only upgrades and combined modes have explicit visual cues', () => {
  const tower = createBuildingInstance('FIRE_TOWER', 'player', 0, 0, 'effect-visual-profile');
  tower.upgradeIds = ['flashover-coils'];
  assert.strictEqual(getEffectTowerVisualProfile(tower).flashoverCoils, true, 'Flashover must render its copper coils');

  tower.upgradeIds = ['rapid-wave'];
  assert.strictEqual(getEffectTowerVisualProfile(tower).rapidWave, true, 'Rapid Wave must visibly accelerate the tower pulse');

  tower.upgradeIds = ['wide-spectrum'];
  assert.strictEqual(getEffectTowerVisualProfile(tower).wideSpectrum, true, 'Wide Spectrum must render outer spectral rings');

  tower.upgradeIds = ['cryo-surge'];
  tower.towerEffectIds = ['burning', 'slowing'];
  assert.deepStrictEqual(getEffectTowerVisualProfile(tower).activeEffects, ['burning', 'slowing'], 'Installed effect modes provide their own color-coded arcs');
});
