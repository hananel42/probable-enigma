import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContextBuilding } from './buildingSelection';
import { createBuildingInstance, GRID_SIZE } from './rules';

test('cursor-hovered structure wins over a closer structure when it is in range', () => {
  const near = createBuildingInstance('WALL', 'player', 1, 0, 'near');
  const hovered = createBuildingInstance('AUTO_TURRET', 'player', 3, 0, 'hovered');
  const selected = resolveContextBuilding([near, hovered], { x: GRID_SIZE, y: GRID_SIZE / 2 }, { x: 3 * GRID_SIZE + 4, y: 4 });
  assert.equal(selected?.id, 'hovered');
});

test('when cursor is not over an in-range structure, selects nearest in-range structure', () => {
  const near = createBuildingInstance('WALL', 'player', 1, 0, 'near');
  const far = createBuildingInstance('WALL', 'player', 20, 0, 'far');
  const selected = resolveContextBuilding([near, far], { x: 0, y: 0 }, { x: 8000, y: 8000 });
  assert.equal(selected?.id, 'near');
});

test('does not select a structure outside interaction range', () => {
  const far = createBuildingInstance('WALL', 'player', 20, 0, 'far');
  assert.equal(resolveContextBuilding([far], { x: 0, y: 0 }, { x: far.x, y: far.y }), undefined);
});
