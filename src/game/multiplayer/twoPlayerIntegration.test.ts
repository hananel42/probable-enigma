import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { RemoteGameClientPort } from './RemoteGameClientPort';
import { HostRoomController } from './HostRoomController';
import type { GameCommand, GameWorldFrame } from '../server/protocol';
import { BUILDING_BLUEPRINTS, GRID_SIZE, isAreaBuildable } from '../rules';
import { InMemoryRoomRelay } from './twoPlayerIntegrationTestSupport';

test('returning to room stops renderer-style input without disconnecting the guest and permits a later world', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const hostRelay = new InMemoryRoomRelay('host-return-peer');
  const guestRelay = new InMemoryRoomRelay('guest-return-peer');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const unsubscribeFrames = server.subscribeWorldFrames(() => hostProtocol.flushStateUpdates());
  const guest = new RemoteGameClientPort(guestRelay, 'Return Test Guest');
  let aWorldWasReady = false;
  const teardownCommandResults: boolean[] = [];
  const unsubscribeReadiness = guest.subscribeSessionReadiness(ready => {
    if (ready) aWorldWasReady = true;
    else if (aWorldWasReady) {
      // CanvasGameClient teardown used to dispatch these after the host had
      // cleared its replica, causing the transport to isolate this guest.
      teardownCommandResults.push(guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyD', pressed: false }));
      teardownCommandResults.push(guest.dispatch({ type: 'POINTER_UP', button: 0 }));
    }
  });

  try {
    hostProtocol.startMatch();
    assert.equal(guest.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' }), true,
      'guest can dispatch once the first authoritative baseline has arrived');
    hostProtocol.flushStateUpdates();
    assert.equal(guest.isSessionReady(), true, 'guest must receive the first world and live delta');
    const firstWorldId = guest.getWorldFrame().worldId;

    assert.doesNotThrow(() => hostProtocol.returnToLobby(), 'world teardown must not throw through the transport listener');
    assert.equal(guest.getRoomStatus()?.phase, 'lobby');
    assert.equal(guest.getRoomStatus()?.hasWorld, false);
    assert.equal(guest.hasAuthoritativeState(), false);
    assert.deepEqual(teardownCommandResults, [false, false], 'input release attempted after world end is rejected locally');
    assert.ok(hostRelay.peer === guestRelay && guestRelay.peer === hostRelay,
      'return-to-room must preserve both ends of the persistent room connection');

    assert.doesNotThrow(() => guest.sendChat('Still in the room'), 'room chat remains available without an active world');
    hostProtocol.startMatch();
    assert.equal(guest.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' }), true,
      'the guest can issue input in the restarted world without reconnecting');
    hostProtocol.flushStateUpdates();
    assert.equal(guest.isSessionReady(), true, 'the same peer connection can synchronize the next world');
    assert.notEqual(guest.getWorldFrame().worldId, firstWorldId, 'starting again creates a fresh world identity');
    assert.ok(hostRelay.peer === guestRelay && guestRelay.peer === hostRelay,
      'starting a new world must not require a guest reconnect');
  } finally {
    unsubscribeReadiness();
    guest.disconnect();
    unsubscribeFrames();
    hostProtocol.stop();
    server.stop();
  }
});

test('two-player room protocol assigns a guest, routes movement/build commands, and projects the guest view', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const hostRelay = new InMemoryRoomRelay('host-peer');
  const guestRelay = new InMemoryRoomRelay('guest-peer');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'TEAM');
  hostProtocol.start();
  const unsubscribeFrames = server.subscribeWorldFrames(() => hostProtocol.flushStateUpdates());

  const guest = new RemoteGameClientPort(guestRelay);
  try {
    assert.equal(guest.getRoomStatus()?.phase, 'lobby', 'a room connection begins without an active game world');
    assert.equal(guest.getRoomStatus()?.hasWorld, false);
    assert.equal(guest.hasAuthoritativeState(), false);
    hostProtocol.startMatch();
    assert.equal(guest.getSnapshot().player.id, 'commander-guest-player-1', 'guest should render its own commander after the host starts the world');
    assert.equal(guest.getWorldFrame().snapshot.humanPlayers.length, 2, 'guest should receive the shared authoritative world');

    const hostStart = server.getSnapshot().entities.find(entity => entity.id === 'player-commander')!;
    const guestStart = server.getSnapshot().entities.find(entity => entity.id === 'commander-guest-player-1')!;
    const hostStartX = hostStart.x;
    const guestStartX = guestStart.x;

    assert.equal(guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyA', pressed: true }), true);
    server.step(0.1);
    assert.ok(guest.getSnapshot().player.x < guestStartX, 'guest movement command must move the guest commander');
    assert.equal(hostStart.x, hostStartX, 'guest input must not move the host commander');

    guest.dispatch({ type: 'SET_INPUT_KEY', code: 'KeyA', pressed: false });
    server.step(0.1);
    const guestAfterReleaseX = server.getSnapshot().entities.find(entity => entity.id === 'commander-guest-player-1')!.x;
    server.step(0.1);
    const guestAfterIdleX = server.getSnapshot().entities.find(entity => entity.id === 'commander-guest-player-1')!.x;
    assert.ok(Math.abs(guestAfterIdleX - guestAfterReleaseX) < 1, 'released guest movement key must stop driving the commander');

    const guestCommander = server.getSnapshot().entities.find(entity => entity.id === 'commander-guest-player-1')!;
    const guestAlliance = server.getSnapshot().humanPlayers.find(player => player.playerId === 'guest-player-1')!.allianceId;
    guest.dispatch({ type: 'AIM_AT', worldX: guestCommander.x + 900, worldY: guestCommander.y + 500 });
    guest.dispatch({ type: 'POINTER_DOWN', button: 0, worldX: guestCommander.x + 900, worldY: guestCommander.y + 500 });
    server.step(0.25);
    assert.ok(server.getSnapshot().projectiles.some(projectile => projectile.allianceId === guestAlliance), 'guest pointer hold must create projectiles in the authoritative simulation');
    guest.dispatch({ type: 'POINTER_UP', button: 0 });
    server.step(0.1);

    const wall = BUILDING_BLUEPRINTS.WALL;
    let gx = -1;
    let gy = -1;
    for (let y = 50; y < 180 && gx < 0; y++) {
      for (let x = 50; x < 180; x++) {
        const occupiedByUnit = server.getSnapshot().entities.some(entity => {
          const ex = Math.floor(entity.x / GRID_SIZE);
          const ey = Math.floor(entity.y / GRID_SIZE);
          return entity.hp > 0 && ex >= x && ex < x + wall.widthInCells && ey >= y && ey < y + wall.heightInCells;
        });
        if (!occupiedByUnit && isAreaBuildable(x, y, wall.widthInCells, wall.heightInCells, server.getSnapshot().buildings, server.getSnapshot().resourceNodes)) {
          gx = x; gy = y; break;
        }
      }
    }
    assert.ok(gx >= 0, 'integration test world should contain a legal building location');
    const guestBefore = { ...server.getSnapshot().humanPlayers.find(player => player.playerId === 'guest-player-1')!.resources };
    const hostBefore = { ...server.getSnapshot().humanPlayers.find(player => player.playerId === 'player-host')!.resources };
    const buildingsBefore = server.getSnapshot().buildings.length;
    guest.dispatch({ type: 'SELECT_BUILDING', buildingType: 'WALL' });
    guest.dispatch({ type: 'AIM_AT', worldX: gx * GRID_SIZE + 1, worldY: gy * GRID_SIZE + 1 });
    guest.dispatch({ type: 'PLACE_SELECTED_BUILDING' });
    const snapshot = server.getSnapshot();
    assert.equal(snapshot.buildings.length, buildingsBefore + 1, 'guest build command should create exactly one structure');
    assert.equal(snapshot.humanPlayers.find(player => player.playerId === 'guest-player-1')!.resources.wood, guestBefore.wood - wall.cost.wood);
    assert.equal(snapshot.humanPlayers.find(player => player.playerId === 'guest-player-1')!.resources.stone, guestBefore.stone - wall.cost.stone);
    assert.deepEqual(server.getSnapshot().humanPlayers.find(player => player.playerId === 'player-host')!.resources, hostBefore, 'guest construction must not charge the host wallet');

    const guestFrame = guest.getWorldFrame() as GameWorldFrame;
    assert.equal(guestFrame.snapshot.player.id, 'commander-guest-player-1');
    assert.equal(guestFrame.snapshot.resources.wood, guestBefore.wood - wall.cost.wood);

    // The host's structure is visible to the guest, but not manageable in TEAM mode.
    const hostOwnedWall = { ...server.getSnapshot().buildings.find(building => building.type === 'WALL')! };
    hostOwnedWall.ownerPlayerId = 'player-host';
    hostOwnedWall.x = guestCommander.x + 35;
    hostOwnedWall.y = guestCommander.y;
    hostOwnedWall.hp = Math.max(1, hostOwnedWall.hp - 20);
    server.getSnapshot().buildings.push(hostOwnedWall);
    const levelBeforeUnauthorizedUpgrade = hostOwnedWall.level;
    const hpBeforeUnauthorizedRepair = hostOwnedWall.hp;
    guest.dispatch({ type: 'AIM_AT', worldX: hostOwnedWall.x, worldY: hostOwnedWall.y });
    guest.dispatch({ type: 'UPGRADE_NEARBY', key: 'E' });
    guest.dispatch({ type: 'REPAIR_NEARBY', buildingId: hostOwnedWall.id });
    guest.dispatch({ type: 'DISMANTLE_NEARBY', buildingId: hostOwnedWall.id });
    assert.equal(server.getSnapshot().buildings.some(building => building.id === hostOwnedWall.id), true, 'guest must not dismantle a host-owned structure');
    assert.equal(hostOwnedWall.level, levelBeforeUnauthorizedUpgrade, 'guest must not upgrade a host-owned structure');
    assert.equal(hostOwnedWall.hp, hpBeforeUnauthorizedRepair, 'guest must not repair a host-owned structure');

  } finally {
    guest.disconnect();
    unsubscribeFrames();
    hostProtocol.stop();
    server.stop();
  }
});


test('remote client fire command damages a hostile commander in the authoritative simulation', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('FREE_FOR_ALL');
  const hostRelay = new InMemoryRoomRelay('host-peer-fire');
  const guestRelay = new InMemoryRoomRelay('guest-peer-fire');
  hostRelay.peer = guestRelay;
  guestRelay.peer = hostRelay;
  const hostProtocol = new HostRoomController(server, hostRelay, 'FREE_FOR_ALL');
  hostProtocol.start();
  const unsubscribeFrames = server.subscribeWorldFrames(() => hostProtocol.flushStateUpdates());
  const guest = new RemoteGameClientPort(guestRelay);
  try {
    hostProtocol.startMatch();
    const snapshot = server.getSnapshot();
    const host = snapshot.entities.find(entity => entity.id === 'player-commander')!;
    const remote = snapshot.entities.find(entity => entity.id === 'commander-guest-player-1')!;
    // Put the two commanders at a deterministic, weapon-range distance for a true hit test.
    host.x = remote.x + 210;
    host.y = remote.y;
    const initialHp = host.hp;
    guest.dispatch({ type: 'AIM_AT', worldX: host.x, worldY: host.y });
    guest.dispatch({ type: 'POINTER_DOWN', button: 0, worldX: host.x, worldY: host.y });
    for (let tick = 0; tick < 50 && host.hp === initialHp; tick++) server.step(0.02);
    guest.dispatch({ type: 'POINTER_UP', button: 0 });
    assert.ok(host.hp < initialHp, `remote firing should damage hostile commander (before=${initialHp}, after=${host.hp})`);
    assert.ok(server.getSnapshot().projectiles.some(projectile => projectile.allianceId === 'alliance-guest-player-1') || host.hp < initialHp,
      'the authoritative world must reflect the guest attack');
  } finally {
    guest.disconnect();
    unsubscribeFrames();
    hostProtocol.stop();
    server.stop();
  }
});
