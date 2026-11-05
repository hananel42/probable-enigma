import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../engine';
import { BUILDING_BLUEPRINTS, GRID_SIZE, createBuildingInstance, createCombatDrone, createHarvesterBot, isAreaBuildable } from '../rules';

test('authoritative engine creates a separate commander, core and ledger per participant in team mode', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const guest = engine.addHumanParticipant('guest-player', 'TEAM');
  assert.equal(engine.state.humanPlayers.length, 2);
  assert.notEqual(engine.state.humanPlayers[0].commanderId, guest.commanderId);
  assert.notEqual(engine.state.humanPlayers[0].coreId, guest.coreId);
  assert.notStrictEqual(engine.state.humanPlayers[0].resources, guest.resources, 'Each participant must own a separate resource ledger object');
  assert.equal(engine.state.entities.some(entity => entity.id === guest.commanderId), true);
  assert.equal(engine.state.buildings.some(building => building.id === guest.coreId), true);
  assert.equal(engine.state.entities.find(entity => entity.id === guest.commanderId)?.allianceId, engine.state.humanPlayers[0].allianceId);
});

test('cooperative mode uses one core but keeps command and resource contexts separate', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('COOPERATIVE');
  const guest = engine.addHumanParticipant('guest-player', 'COOPERATIVE');
  assert.equal(engine.state.buildings.filter(building => building.type === 'CORE' && building.hp > 0).length, 1);
  assert.equal(guest.coreId, engine.state.humanPlayers[0].coreId);
  const hostBefore = { ...engine.state.humanPlayers[0].resources };
  const accepted = engine.dispatchForPlayer('guest-player', { type: 'test' }, () => {
    engine.state.resources = { wood: 7, stone: 3 , diamonds: 0 };
  });
  assert.equal(accepted, true);
  assert.deepEqual(guest.resources, { wood: 7, stone: 3 , diamonds: 0 });
  assert.deepEqual(engine.state.humanPlayers[0].resources, hostBefore);
  assert.equal(engine.state.player.id, engine.state.humanPlayers[0].commanderId);
});

test('free-for-all assigns distinct alliances so commanders are hostile', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('FREE_FOR_ALL');
  const guest = engine.addHumanParticipant('guest-player', 'FREE_FOR_ALL');
  const hostCommander = engine.state.entities.find(entity => entity.id === engine.state.humanPlayers[0].commanderId)!;
  const guestCommander = engine.state.entities.find(entity => entity.id === guest.commanderId)!;
  assert.notEqual(hostCommander.allianceId, guestCommander.allianceId);
  assert.notEqual(hostCommander.teamId, guestCommander.teamId);
});

test('each connected commander advances from its own input context', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const guest = engine.addHumanParticipant('guest-player', 'TEAM');
  const hostCommander = engine.state.entities.find(entity => entity.id === engine.state.humanPlayers[0].commanderId)!;
  const guestCommander = engine.state.entities.find(entity => entity.id === guest.commanderId)!;
  const hostStartX = hostCommander.x;
  const guestStartX = guestCommander.x;
  engine.setPlayerInputKey('player-host', 'KeyD', true);
  engine.setPlayerInputKey('guest-player', 'KeyA', true);
  engine.step(0.1);
  assert.ok(hostCommander.x > hostStartX, 'host should move right from its own input');
  assert.ok(guestCommander.x < guestStartX, 'guest should move left from its own input');
});

test('pointer hold is retained by the active participant so firing works across simulation ticks', () => {
  const engine = new GameEngine();
  const player = engine.state.player;
  engine.setAimPoint(player.x + 1000, player.y + 1000);
  engine.handleWorldPointerDown(0, player.x + 1000, player.y + 1000);
  engine.step(0.25);
  assert.ok(engine.state.projectiles.length > 0, 'holding the primary pointer should fire after the weapon cooldown');
  engine.handleWorldPointerUp(0);
  const countAfterRelease = engine.state.projectiles.length;
  engine.step(0.5);
  assert.ok(engine.state.projectiles.length <= countAfterRelease + 1, 'releasing the pointer should stop sustained fire');
});


test('repeated participant registration is idempotent and does not create duplicate resource ledgers', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const first = engine.addHumanParticipant('guest-player', 'TEAM');
  const repeated = engine.addHumanParticipant('guest-player', 'TEAM');
  assert.equal(repeated, first);
  assert.equal(engine.state.humanPlayers.filter(player => player.playerId === 'guest-player').length, 1);
});

test('a successful building placement permanently deducts its cost from the active participant ledger', () => {
  const engine = new GameEngine();
  const before = { ...engine.state.humanPlayers[0].resources };
  const buildingCount = engine.state.buildings.length;
  let targetGx = -1;
  let targetGy = -1;
  const wall = BUILDING_BLUEPRINTS.WALL;
  for (let gy = 50; gy < 200 && targetGx < 0; gy++) {
    for (let gx = 50; gx < 200; gx++) {
      const occupiedByUnit = engine.state.entities.some(entity => {
        const ex = Math.floor(entity.x / GRID_SIZE);
        const ey = Math.floor(entity.y / GRID_SIZE);
        return entity.hp > 0 && ex >= gx && ex < gx + wall.widthInCells && ey >= gy && ey < gy + wall.heightInCells;
      });
      if (!occupiedByUnit && isAreaBuildable(gx, gy, wall.widthInCells, wall.heightInCells, engine.state.buildings, engine.state.resourceNodes)) {
        targetGx = gx; targetGy = gy; break;
      }
    }
  }
  assert.ok(targetGx >= 0, 'test world should contain an empty buildable cell');

  const accepted = engine.dispatchForPlayer('player-host', { type: 'test-place-building' }, () => {
    engine.selectBuilding('WALL');
    engine.setAimPoint(targetGx * GRID_SIZE + 1, targetGy * GRID_SIZE + 1);
    engine.attemptPlaceSelectedBuilding();
  });

  assert.equal(accepted, true);
  assert.equal(engine.state.buildings.length, buildingCount + 1, 'the wall should be placed in a free distant cell');
  assert.equal(engine.state.humanPlayers[0].resources.wood, before.wood - BUILDING_BLUEPRINTS.WALL.cost.wood);
  assert.equal(engine.state.humanPlayers[0].resources.stone, before.stone - BUILDING_BLUEPRINTS.WALL.cost.stone);
});


test('disconnect removes a remote commander, ledger, group, units and active structures while preserving gray salvage', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const guest = engine.addHumanParticipant('guest-player', 'TEAM');
  const guestCommander = engine.state.entities.find(entity => entity.id === guest.commanderId)!;
  engine.state.entities.push({ ...guestCommander, id: 'guest-owned-drone', kind: guestCommander.kind });
  const guestUnit = engine.state.entities.find(entity => entity.id === 'guest-owned-drone')!;
  guestUnit.ownerPlayerId = guest.playerId;

  const liveWall = createBuildingInstance('WALL', 'player', 18, 18, 'guest-live-wall', guest.groupId);
  liveWall.ownerPlayerId = guest.playerId;
  liveWall.coreId = guest.coreId;
  const grayWall = createBuildingInstance('WALL', 'player', 20, 18, 'guest-gray-wall', guest.groupId);
  grayWall.ownerPlayerId = guest.playerId;
  grayWall.coreId = 'already-destroyed-core';
  engine.state.buildings.push(liveWall, grayWall);

  assert.equal(engine.removeHumanParticipant(guest.playerId), true);
  assert.equal(engine.state.humanPlayers.some(player => player.playerId === guest.playerId), false);
  assert.equal(engine.state.entities.some(entity => entity.id === guest.commanderId || entity.id === 'guest-owned-drone'), false);
  assert.equal(engine.state.groups.some(group => group.id === guest.groupId), false);
  assert.equal(engine.state.buildings.some(building => building.id === guest.coreId || building.id === liveWall.id), false,
    'disconnect removes the Core and the participant’s still-operational structures');
  assert.equal(engine.state.buildings.some(building => building.id === grayWall.id), true,
    'an already-gray structure must remain as abandoned salvage');
  assert.equal(grayWall.ownerPlayerId, undefined, 'gray salvage no longer retains live player ownership');
  assert.equal(engine.removeHumanParticipant(guest.playerId), false, 'removal is idempotent');
});


test('Core destruction permanently removes the defeated Commander and detaches their gray structures', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const guest = engine.addHumanParticipant('guest-core-loss', 'TEAM');
  const core = engine.state.buildings.find(building => building.id === guest.coreId)!;
  const grayWall = createBuildingInstance('WALL', 'player', 18, 18, 'guest-core-loss-wall', guest.groupId);
  grayWall.ownerPlayerId = guest.playerId;
  grayWall.coreId = guest.coreId;
  engine.state.buildings.push(grayWall);

  core.hp = 0;
  engine.step(0.05);
  assert.equal(engine.state.entities.some(entity => entity.id === guest.commanderId), false,
    'the defeated Commander must be removed from the actual renderable entity set');
  assert.equal(engine.state.buildings.some(building => building.id === grayWall.id), true,
    'structures whose Core was destroyed remain in the world');
  assert.equal(grayWall.ownerPlayerId, undefined, 'a gray structure is now abandoned salvage');
  assert.equal(engine.setPlayerInputKey(guest.playerId, 'KeyD', true), false,
    'a defeated participant can no longer send persistent movement input');
  engine.step(0.05);
  assert.equal(engine.state.entities.some(entity => entity.id === guest.commanderId), false,
    'subsequent simulation ticks must not respawn the defeated Commander');
});


test('core destruction defeats only the affected participant in team mode and blocks their commands', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('TEAM');
  const guest = engine.addHumanParticipant('guest-player', 'TEAM');
  const guestCore = engine.state.buildings.find(building => building.id === guest.coreId)!;
  guestCore.hp = 0;
  engine.step(0.05);

  assert.equal(engine.state.isGameOver, false, 'a guest Core loss must not end the host view');
  assert.equal(engine.dispatchForPlayer('guest-player', { type: 'test-after-defeat' }, () => assert.fail('defeated guest command must not execute')), false,
    'a defeated guest cannot issue authoritative commands');
  assert.equal(engine.dispatchForPlayer('player-host', { type: 'test-host-alive' }, () => {}), true,
    'the surviving host must continue playing');

  const hostCore = engine.state.buildings.find(building => building.id === 'player-core')!;
  hostCore.hp = 0;
  engine.step(0.05);
  assert.equal(engine.state.isGameOver, true, 'the host loses when the host Core is destroyed');
  assert.equal(engine.state.entities.some(entity => entity.id === 'player-commander'), false,
    'the host Commander must also be removed when the host Core is destroyed');
  assert.equal(engine.dispatchForPlayer('player-host', { type: 'test-host-after-defeat' }, () => assert.fail('defeated host command must not execute')), false);
  let restartWasAllowed = false;
  assert.equal(engine.dispatchForPlayer('player-host', { type: 'RESTART' }, () => { restartWasAllowed = true; }), true, 'the room may restart after every connected TEAM participant has lost their Core');
  assert.equal(restartWasAllowed, true);
});

test('cooperative players share the same Core defeat condition', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('COOPERATIVE');
  const guest = engine.addHumanParticipant('guest-player', 'COOPERATIVE');
  engine.state.buildings.find(building => building.id === guest.coreId)!.hp = 0;
  engine.step(0.05);
  assert.equal(engine.state.isGameOver, true, 'the shared Core loss ends the host view');
  assert.equal(engine.dispatchForPlayer('guest-player', { type: 'test-coop-after-defeat' }, () => assert.fail('defeated co-op command must not execute')), false,
    'the shared Core loss also blocks the guest');
  assert.equal(engine.canRestartGame(), true, 'destroying the shared Core unlocks host-controlled redeployment');
  let restarted = false;
  assert.equal(engine.dispatchForPlayer('player-host', { type: 'RESTART' }, () => { restarted = engine.restartGame(); }), true);
  assert.equal(restarted, true, 'the room may be restarted without kicking eliminated players');
  assert.equal(engine.state.isGameOver, false, 'redeployment starts a fresh run instead of preserving the dead state');
  assert.equal(engine.state.humanPlayers.length, 2, 'all connected participants remain in the room across restart');
  assert.equal(engine.state.humanPlayers.every(player => player.defeatedAtGameTime === null), true, 'the fresh run must not remember previous deaths');
});


test('cooperative disconnect removes only the commander and keeps all shared structures and autonomous units', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('COOPERATIVE');
  const guest = engine.addHumanParticipant('guest-player', 'COOPERATIVE');
  assert.equal(guest.groupId, engine.state.humanPlayers[0].groupId, 'CO-OP participants belong to one shared group');

  const station = createBuildingInstance('DRONE_STATION', 'player', 30, 30, 'co-op-guest-drone-station', guest.groupId);
  station.ownerPlayerId = guest.playerId;
  station.coreId = guest.coreId;
  station.allianceId = guest.allianceId;
  station.droneMode = 'ESCORT';
  station.escortCommanderId = guest.commanderId;
  const minerStation = createBuildingInstance('HARVESTER_STATION', 'player', 34, 30, 'co-op-guest-miner-station', guest.groupId);
  minerStation.ownerPlayerId = guest.playerId;
  minerStation.coreId = guest.coreId;
  minerStation.allianceId = guest.allianceId;
  const drone = createCombatDrone(station, undefined, 'co-op-guest-drone');
  const miner = createHarvesterBot(minerStation, undefined, 'co-op-guest-miner');
  engine.state.buildings.push(station, minerStation);
  engine.state.entities.push(drone, miner);
  const sharedCore = engine.state.buildings.find(building => building.id === 'player-core');
  assert.ok(sharedCore);

  assert.equal(engine.removeHumanParticipant(guest.playerId), true);
  assert.equal(engine.state.humanPlayers.some(participant => participant.playerId === guest.playerId), false);
  assert.equal(engine.state.entities.some(entity => entity.id === guest.commanderId), false);
  assert.equal(engine.state.entities.some(entity => entity.id === drone.id), true, 'shared drones survive their builder disconnecting');
  assert.equal(engine.state.entities.some(entity => entity.id === miner.id), true, 'shared automated miners survive their builder disconnecting');
  assert.equal(engine.state.buildings.some(building => building.id === station.id), true);
  assert.equal(engine.state.buildings.some(building => building.id === minerStation.id), true);
  assert.equal(engine.state.buildings.some(building => building.id === sharedCore.id), true);
  assert.equal(engine.state.groups.filter(group => group.id === 'group-host').length, 1, 'the shared group is not removed with one participant');
});
