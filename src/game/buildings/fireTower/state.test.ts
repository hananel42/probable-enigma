import assert from 'node:assert/strict';
import test from 'node:test';
import type { Building } from '../../types';
import { assertFireTowerBuilding } from './state';

function makeFireTower(): Building {
  return {
    id: 'fire-tower-test',
    type: 'FIRE_TOWER',
    faction: 'player',
    teamId: 'player',
    allianceId: 'player',
    gx: 0,
    gy: 0,
    widthInCells: 1,
    heightInCells: 1,
    x: 25,
    y: 25,
    hp: 260,
    maxHp: 260,
    level: 1,
    lastActionTime: 0,
    range: 170,
    upgradeIds: [],
    fireTimer: 4,
    fireRadius: 175,
    damage: 24,
    fireCooldown: 4,
    burnDamagePerSecond: 14,
    effectDuration: 3,
    towerEffectIds: ['burning'],
    pulseDuration: 0.6,
    isPulsing: false,
    pulseProgress: 0,
    pulseAffectedIds: []
  };
}

test('Effect Tower accepts the complete current runtime contract without a legacy burnDuration field', () => {
  const tower = makeFireTower();
  assert.doesNotThrow(() => assertFireTowerBuilding(tower));
  assert.deepEqual(tower.towerEffectIds, ['burning']);
  assert.equal(tower.effectDuration, 3);
  assert.equal('burnDuration' in tower, false);
});

test('Effect Tower state rejects missing current fields instead of fabricating defaults', () => {
  const tower = makeFireTower();
  delete (tower as unknown as Record<string, unknown>).towerEffectIds;
  assert.throws(() => assertFireTowerBuilding(tower), /requires at least one valid tower effect ID/);
});
