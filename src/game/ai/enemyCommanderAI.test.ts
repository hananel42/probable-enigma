import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyCommanderAI } from './enemyCommanderAI';
import type { Building, EnemyBase, GameEntity } from '../types';

function entity(id: string, kind: GameEntity['kind'], teamId: string): GameEntity {
  return { id, kind, faction: 'enemy', teamId, allianceId: teamId, x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, radius: 12, speed: 50, damage: 10 } as GameEntity;
}

test('destroying an enemy Core removes its commander and units but preserves salvageable structures', () => {
  const ai = new EnemyCommanderAI();
  const base: EnemyBase = { id: 'base-1', teamId: 'enemy-team-1', x: 0, y: 0, gx: 0, gy: 0, coreId: 'core-1', commanderId: 'commander-1', level: 1, raidTimer: 0, raidInterval: 10, isDestroyed: false, resources: { wood: 10, stone: 10, diamonds: 0 }, buildTimer: 1, repairTimer: 1 };
  const commander = entity('commander-1', 'COMMANDER', 'enemy-team-1');
  const drone = entity('drone-1', 'DRONE', 'enemy-team-1');
  const unrelated = entity('unrelated', 'COMMANDER', 'enemy-team-2');
  const wall = { id: 'wall-1', upgradeIds: [], type: 'WALL', faction: 'enemy', teamId: 'enemy-team-1', allianceId: 'enemy-team-1', gx: 1, gy: 0, x: 44, y: 0, hp: 50, maxHp: 100, widthInCells: 1, heightInCells: 1, level: 1, lastActionTime: 0, range: 0 } satisfies Building;
  const buildings: Building[] = [wall]; // Core has already been removed by the damage/cleanup path.
  const entities: GameEntity[] = [commander, drone, unrelated];

  ai.updateBase(base, buildings, entities, [], 1, 0.016);

  assert.equal(base.isDestroyed, true);
  assert.equal(entities.some(item => item.id === commander.id), false, 'coreless commander must be removed');
  assert.equal(entities.some(item => item.id === drone.id), false, 'dependent units must be removed');
  assert.equal(entities.some(item => item.id === unrelated.id), true, 'other bases must remain untouched');
  assert.equal(buildings.some(item => item.id === wall.id), true, 'surviving structures remain available for salvage');
});
