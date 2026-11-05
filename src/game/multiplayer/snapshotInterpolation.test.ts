import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameEntity } from '../types';
import type { GameSnapshot } from '../server/protocol';
import { captureRenderState, interpolateRenderStates, SnapshotInterpolationBuffer } from './snapshotInterpolation';

function makeSnapshot(x: number, gameTime = x): GameSnapshot {
  const player: GameEntity = {
    id: 'commander-guest', kind: 'COMMANDER', faction: 'player', x, y: x * 2,
    vx: 10, vy: 20, angle: 0, hp: 100, maxHp: 100, speed: 100, radius: 10, isFlying: false
  };
  return {
    player,
    humanPlayers: [],
    multiplayerMode: 'TEAM',
    groups: [],
    entities: [player],
    buildings: [],
    resources: { wood: 0, stone: 0 , diamonds: 0 },
    resourceNodes: [],
    enemyBases: [],
    projectiles: [],
    particles: [],
    floatingTexts: [],
    selectedBuildingType: null,
    selectedStationId: null,
    camera: { x, y: x * 2, zoom: 1 },
    mouseWorld: { x, y: x * 2, gx: 0, gy: 0 },
    isMouseAiming: false,
    isGameOver: false,
    gameTime,
    difficultyLevel: 1
  } as unknown as GameSnapshot;
}

test('render interpolation creates a midpoint without mutating authoritative snapshots', () => {
  const a = makeSnapshot(10, 1);
  const b = makeSnapshot(30, 3);
  const middle = interpolateRenderStates(captureRenderState(a), captureRenderState(b), 0.5);
  assert.equal(middle.entities[0].x, 20);
  assert.equal(middle.entities[0].y, 40);
  assert.equal(middle.camera.x, 20);
  assert.equal(middle.gameTime, 2);
  assert.equal(a.player.x, 10);
  assert.equal(b.player.x, 30);
});

test('snapshot buffer interpolates compact delayed states and returns latest pose after the buffer catches up', () => {
  const buffer = new SnapshotInterpolationBuffer(4);
  const a = makeSnapshot(0);
  const b = makeSnapshot(100);
  buffer.push({ receivedAtMs: 0, snapshot: a });
  buffer.push({ receivedAtMs: 100, snapshot: b });
  assert.equal(buffer.sampleAt(50)?.entities[0].x, 50);
  assert.equal(buffer.sampleAt(120)?.entities[0].x, 100);
});

test('snapshot buffer rejects time going backwards', () => {
  const buffer = new SnapshotInterpolationBuffer();
  buffer.push({ receivedAtMs: 100, snapshot: makeSnapshot(1) });
  assert.throws(() => buffer.push({ receivedAtMs: 99, snapshot: makeSnapshot(2) }), /time-ordered/);
});

test('render history excludes full-world arrays such as structures and resource nodes', () => {
  const renderState = captureRenderState(makeSnapshot(10));
  assert.deepEqual(Object.keys(renderState).sort(), [
    'camera', 'enemyBases', 'entities', 'floatingTexts', 'gameTime', 'particles', 'projectiles'
  ]);
  assert.equal('buildings' in renderState, false);
  assert.equal('resourceNodes' in renderState, false);
});
