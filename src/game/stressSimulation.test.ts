import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './engine';
import { createBuildingInstance } from './rules';
import type { Projectile } from './types';

test('simulation stress: hundreds of structures/projectiles and 240 ticks remain finite and make progress', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  engine.addHumanParticipant('stress-guest', 'TEAM');

  // Synthetic entities are deliberately placed far from the initial base so the test
  // exercises broad-phase queries and projectile cleanup without making survival depend
  // on a particular random world seed.
  for (let i = 0; i < 72; i++) {
    const gx = 120 + (i % 12) * 3;
    const gy = 120 + Math.floor(i / 12) * 3;
    const wall = createBuildingInstance('WALL', 'enemy', gx, gy, `stress-wall-${i}`, 'stress-enemy');
    wall.ownerPlayerId = 'stress-enemy';
    wall.allianceId = 'stress-enemy-alliance';
    engine.state.buildings.push(wall);
  }

  for (let i = 0; i < 160; i++) {
    const projectile: Projectile = {
      id: `stress-projectile-${i}`,
      x: 120 * 48 + (i % 16) * 20,
      y: 120 * 48 + Math.floor(i / 16) * 20,
      vx: i % 2 === 0 ? 90 : -70,
      vy: i % 3 === 0 ? 45 : -30,
      damage: 1, rangeOriginX: 120 * 48 + (i % 16) * 20, rangeOriginY: 120 * 48 + Math.floor(i / 16) * 20, maxRange: 1000,
    faction: 'enemy',
      teamId: 'stress-enemy',
      allianceId: 'stress-enemy-alliance',
      color: '#ffffff',
      radius: 3,
      life: 0.75 + (i % 4) * 0.1,
      maxLife: 1.05
    };
    engine.state.projectiles.push(projectile);
  }

  const initialTime = engine.state.gameTime;
  const startedAt = performance.now();
  for (let tick = 0; tick < 240; tick++) engine.step(1 / 60);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(engine.state.gameTime >= initialTime + 3.99, `simulation should advance ~4 seconds (actual=${engine.state.gameTime - initialTime})`);
  assert.ok(Number.isFinite(elapsedMs) && elapsedMs >= 0);
  assert.equal(engine.state.buildings.filter(building => building.id.startsWith('stress-wall-')).length, 72);
  assert.ok(engine.state.projectiles.length < 160, 'expired projectiles must be removed instead of accumulating forever');
  assert.ok(engine.state.entities.every(entity => Number.isFinite(entity.x) && Number.isFinite(entity.y) && Number.isFinite(entity.hp) && entity.hp >= 0));
  assert.ok(engine.state.buildings.every(building => Number.isFinite(building.hp) && building.hp >= 0));
  assert.ok(engine.state.humanPlayers.every(player => Number.isFinite(player.resources.wood) && Number.isFinite(player.resources.stone) && player.resources.wood >= 0 && player.resources.stone >= 0));
  assert.ok(elapsedMs < 15_000, `bounded stress workload should finish under 15 seconds (actual=${elapsedMs.toFixed(1)}ms)`);
  console.log(`Simulation stress workload: 240 ticks, 72 extra structures, 160 projectiles; ${elapsedMs.toFixed(1)} ms wall time.`);
});
