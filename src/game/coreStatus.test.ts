import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingInstance } from './rules';
import { isBuildingOperational, isOrphanedStructure } from './coreStatus';

test('team-owned structures track live Core HP through the cached operational index', () => {
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'status-core', 'status-team');
  core.coreId = core.id;
  const structures = Array.from({ length: 600 }, (_, index) =>
    createBuildingInstance('WALL', 'enemy', index + 10, 0, `status-wall-${index}`, 'status-team')
  );
  const buildings = [core, ...structures];

  assert.ok(structures.every(structure => isBuildingOperational(structure, buildings)));
  core.hp = 0;
  assert.ok(structures.every(structure => !isBuildingOperational(structure, buildings)));
  assert.ok(structures.every(structure => isOrphanedStructure(structure, buildings)));

  // The index stores live objects, not cached boolean answers: repairs take effect immediately.
  core.hp = core.maxHp;
  assert.ok(structures.every(structure => isBuildingOperational(structure, buildings)));
});

test('operational index refreshes when a matching Core is added to the same array', () => {
  const wall = createBuildingInstance('WALL', 'enemy', 4, 4, 'late-core-wall', 'late-core-team');
  const buildings = [wall];
  assert.equal(isBuildingOperational(wall, buildings), false);

  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'late-core', 'late-core-team');
  buildings.push(core);
  assert.equal(isBuildingOperational(wall, buildings), true);
});
