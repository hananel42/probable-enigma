import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGameCommand } from './protocol';

test('runtime command schema accepts valid semantic commands', () => {
  assert.equal(isValidGameCommand({ type: 'SET_INPUT_KEY', code: 'KeyW', pressed: true }), true);
  assert.equal(isValidGameCommand({ type: 'AIM_AT', worldX: 12.5, worldY: -20 }), true);
  assert.equal(isValidGameCommand({ type: 'SELECT_BUILDING', buildingType: 'FIRE_TOWER' }), true);
  assert.equal(isValidGameCommand({ type: 'REPAIR_NEARBY' }), true);
});

test('runtime command schema rejects malformed, non-finite and unknown commands', () => {
  assert.equal(isValidGameCommand({ type: 'SET_INPUT_KEY', code: '', pressed: true }), false);
  assert.equal(isValidGameCommand({ type: 'AIM_AT', worldX: Number.NaN, worldY: 2 }), false);
  assert.equal(isValidGameCommand({ type: 'POINTER_DOWN', button: 7, worldX: 1, worldY: 2 }), false);
  assert.equal(isValidGameCommand({ type: 'SELECT_BUILDING', buildingType: 'NOT_A_BUILDING' }), false);
  assert.equal(isValidGameCommand({ type: 'EXECUTE_ARBITRARY_CODE' }), false);
  assert.equal(isValidGameCommand(null), false);
});
