import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../engine';
import { createBuildingInstance } from '../rules';
import type { Projectile } from '../types';

function projectileFor(engine: GameEngine, allianceId: string): Projectile {
  const guest = engine.state.entities.find(entity => entity.id === 'commander-guest-player')!;
  return {
    id: `test-shot-${allianceId}`,
    x: guest.x - 80,
    y: guest.y,
    vx: 800,
    vy: 0,
    damage: 12,
    faction: 'player',
    teamId: 'group-host',
    allianceId,
    color: '#ffffff',
    radius: 4,
    life: 1,
    maxLife: 1,
    rangeOriginX: guest.x - 80,
    rangeOriginY: guest.y,
    maxRange: 450
  };
}

test('TEAM mode lets player projectiles pass through allied structures and commanders without damage', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  engine.addHumanParticipant('guest-player', 'TEAM');
  const guest = engine.state.entities.find(entity => entity.id === 'commander-guest-player')!;
  const hpBefore = guest.hp;
  const alliedWall = createBuildingInstance('WALL', 'player', 3, 1, 'host-allied-wall', 'group-host');
  alliedWall.ownerPlayerId = 'player-host';
  alliedWall.allianceId = 'alliance-humans';
  const wallHpBefore = alliedWall.hp;
  engine.state.buildings.push(alliedWall);
  const projectile = projectileFor(engine, 'alliance-humans');
  projectile.x = guest.x - 220;
  projectile.vx = 500;
  projectile.life = 1;
  engine.state.projectiles.push(projectile);
  for (let tick = 0; tick < 22; tick++) engine.step(0.02);
  assert.equal(guest.hp, hpBefore, 'friendly shot must not damage allied commander');
  assert.equal(alliedWall.hp, wallHpBefore, 'friendly shot must pass through an allied structure without damaging it');
  assert.ok(engine.state.projectiles.some(item => item.id === projectile.id), 'friendly shot should continue past both allied structure and commander');
});

test('FREE_FOR_ALL mode lets a player projectile damage an opposing commander', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('FREE_FOR_ALL');
  engine.addHumanParticipant('guest-player', 'FREE_FOR_ALL');
  const guest = engine.state.entities.find(entity => entity.id === 'commander-guest-player')!;
  const hpBefore = guest.hp;
  const projectile = projectileFor(engine, 'alliance-player-host');
  engine.state.projectiles.push(projectile);
  engine.step(0.1);
  assert.ok(guest.hp < hpBefore, `hostile projectile should damage opposing commander (before=${hpBefore}, after=${guest.hp})`);
});
