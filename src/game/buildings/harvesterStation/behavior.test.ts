import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../../engine';
import { createBuildingInstance } from '../../rules';
import { update } from './behavior';
import type { BuildingRuntimeContext } from '../types';

test('cooperative harvesters can be collected by any nearby participant without merging wallets', () => {
  const engine = new GameEngine();
  engine.setMultiplayerMode('COOPERATIVE');
  const guest = engine.addHumanParticipant('guest-player', 'COOPERATIVE');
  const host = engine.state.humanPlayers.find(participant => participant.playerId === 'player-host');
  assert.ok(host);
  const hostCommander = engine.state.entities.find(entity => entity.id === host.commanderId);
  const guestCommander = engine.state.entities.find(entity => entity.id === guest.commanderId);
  assert.ok(hostCommander && guestCommander);

  const station = createBuildingInstance('HARVESTER_STATION', 'player', 0, 0, 'co-op-shared-harvester');
  station.ownerPlayerId = host.playerId;
  station.coreId = host.coreId;
  station.storedWood = 23;
  station.storedStone = 11;
  guestCommander.x = station.x;
  guestCommander.y = station.y;
  hostCommander.x = station.x + 1000;
  hostCommander.y = station.y + 1000;
  engine.state.buildings.push(station);
  const hostWalletBefore = { ...host.resources };
  const guestWalletBefore = { ...guest.resources };
  let stateChanges = 0;

  update(station, {
    state: engine.state,
    dt: 0.1,
    spawnEntity: () => { throw new Error('A station with a positive spawn timer must not spawn during this test.'); },
    spawnProjectile: () => { throw new Error('Harvest stations do not spawn projectiles.'); },
    damageEntity: () => { throw new Error('Harvest stations do not damage entities.'); },
    damageBuilding: () => { throw new Error('Harvest stations do not damage buildings.'); },
    createSparks: () => {},
    playSound: () => {},
    distance: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
    resourceNodes: engine.state.resourceNodes,
    findPriorityTarget: () => undefined,
    resolveCachedTarget: () => undefined,
    triggerStateChange: () => { stateChanges++; }
  } satisfies BuildingRuntimeContext);

  assert.deepEqual(guest.resources, { ...guestWalletBefore, wood: guestWalletBefore.wood + 23, stone: guestWalletBefore.stone + 11 });
  assert.deepEqual(host.resources, hostWalletBefore, 'the station owner must not receive another participant’s pickup');
  assert.equal(station.storedWood, 0);
  assert.equal(station.storedStone, 0);
  assert.equal(stateChanges, 1);
});
