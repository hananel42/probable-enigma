import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from './LocalGameServer';


test('FFA worlds place every connected participant far enough apart and preload valid local resources', () => {
  const server = new LocalGameServer(1234);
  server.createWorld('FREE_FOR_ALL', [
    { playerId: 'player-host', displayName: 'Host' },
    { playerId: 'ffa-guest-1', displayName: 'Guest One' },
    { playerId: 'ffa-guest-2', displayName: 'Guest Two' },
    { playerId: 'ffa-guest-3', displayName: 'Guest Three' },
    { playerId: 'ffa-guest-4', displayName: 'Guest Four' },
    { playerId: 'ffa-guest-5', displayName: 'Guest Five' },
    { playerId: 'ffa-guest-6', displayName: 'Guest Six' },
    { playerId: 'ffa-guest-7', displayName: 'Guest Seven' }
  ]);
  const snapshot = server.getSnapshot();
  const spawnRows = snapshot.humanPlayers.map(participant => {
    const commander = snapshot.entities.find(entity => entity.id === participant.commanderId);
    const core = snapshot.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
    assert.ok(commander, `Commander for ${participant.playerId} must exist`);
    assert.ok(core, `Core for ${participant.playerId} must exist`);
    assert.ok(Math.hypot(commander.x - core.x, commander.y - core.y) < 180,
      'Commander must start next to its own Core');
    return { participant, commander, core };
  });

  for (let left = 0; left < spawnRows.length; left++) {
    for (let right = left + 1; right < spawnRows.length; right++) {
      const a = spawnRows[left];
      const b = spawnRows[right];
      assert.ok(Math.hypot(a.core.x - b.core.x, a.core.y - b.core.y) >= 750,
        `${a.participant.playerId} and ${b.participant.playerId} Cores should not spawn close together`);
      assert.ok(Math.hypot(a.commander.x - b.commander.x, a.commander.y - b.commander.y) >= 750,
        `${a.participant.playerId} and ${b.participant.playerId} Commanders should not spawn close together`);
    }
  }

  for (const node of snapshot.resourceNodes) {
    for (const { core } of spawnRows) {
      assert.ok(!(node.gx >= core.gx && node.gx < core.gx + core.widthInCells &&
        node.gy >= core.gy && node.gy < core.gy + core.heightInCells),
      `Resource node '${node.id}' must not overlap Core '${core.id}'`);
    }
  }
  const host = spawnRows[0].commander;
  assert.ok(Math.hypot(snapshot.camera.x - host.x, snapshot.camera.y - host.y) < 1,
    'Initial camera should already be centered on the host FFA spawn');
  server.stop();
});


test('single-participant FFA preserves the central opening and TEAM does not apply the FFA ring', () => {
  const ffaSolo = new LocalGameServer(1234);
  ffaSolo.createWorld('FREE_FOR_ALL', [{ playerId: 'player-host', displayName: 'Host' }]);
  const soloHost = ffaSolo.getSnapshot().entities.find(entity => entity.id === 'player-commander')!;
  assert.equal(soloHost.x, 0);
  assert.equal(soloHost.y, 75);
  ffaSolo.stop();

  const team = new LocalGameServer(1234);
  team.createWorld('TEAM', [
    { playerId: 'player-host', displayName: 'Host' },
    { playerId: 'team-guest', displayName: 'Guest' }
  ]);
  const teamHost = team.getSnapshot().entities.find(entity => entity.id === 'player-commander')!;
  assert.equal(teamHost.x, 0, 'TEAM keeps the established shared start position');
  assert.equal(teamHost.y, 75, 'TEAM keeps the established shared start position');
  team.stop();
});

test('remote participant movement keys persist into authoritative simulation ticks', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const guest = server.addHumanParticipant('guest-player', 'TEAM');
  const beforeX = server.getSnapshot().entities.find(entity => entity.id === guest.commanderId)!.x;

  assert.equal(server.dispatchForPlayer('guest-player', { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: true }), true);
  server.step(0.1);
  const after = server.getSnapshot().entities.find(entity => entity.id === guest.commanderId)!;
  assert.ok(after.x < beforeX, `guest commander should move left (before=${beforeX}, after=${after.x})`);

  server.dispatchForPlayer('guest-player', { type: 'SET_INPUT_KEY', code: 'KeyA', pressed: false });
  const stoppedAt = after.x;
  server.step(0.1);
  const stopped = server.getSnapshot().entities.find(entity => entity.id === guest.commanderId)!;
  assert.ok(Math.abs(stopped.x - stoppedAt) < 1, 'released movement key should not keep driving the commander');
  server.stop();
});


test('authoritative world frames refresh during simulation ticks, not only after input commands', () => {
  const server = new LocalGameServer();
  const revisions: number[] = [];
  const unsubscribe = server.subscribeWorldFrames(frame => revisions.push(frame.revision));
  const initialRevision = server.getWorldFrame().revision;
  server.step(0.1);
  assert.ok(server.getWorldFrame().revision >= initialRevision + 2, `expected multiple live sync frames in 100ms, got revisions ${revisions.join(', ')}`);
  assert.ok(revisions.length >= 3, 'subscribers should receive the initial frame plus live simulation updates');
  unsubscribe();
  server.stop();
});


test('shared-core cooperative defeat permits an explicit host restart in the authoritative server', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('COOPERATIVE');
  const core = server.getSnapshot().buildings.find(building => building.type === 'CORE')!;
  core.hp = 0;
  server.step(0.05);
  assert.equal(server.getSnapshot().isGameOver, true, 'destroying the shared Core should end the run');
  const gameTimeAtDefeat = server.getSnapshot().gameTime;
  assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), true, 'the host may restart after the shared Core is destroyed');
  assert.equal(server.getSnapshot().isGameOver, false, 'restart creates a fresh world instead of preserving the defeated state');
  assert.equal(server.getSnapshot().gameTime, 0, 'the new run resets survival time');
  assert.equal(server.getSnapshot().buildings.find(building => building.id === 'player-core')!.hp > 0, true, 'the shared Core is recreated alive');
  assert.ok(server.getSnapshot().gameTime < gameTimeAtDefeat, 'the new run does not inherit the old survival clock');
  server.stop();
});


test('TEAM room restart is denied while any connected player remains alive and preserves participants after a full defeat', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('TEAM');
  const guest = server.addHumanParticipant('guest-player', 'TEAM');
  const hostCore = server.getSnapshot().buildings.find(building => building.id === 'player-core')!;
  hostCore.hp = 0;
  server.step(0.05);

  assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), false, 'host defeat must not reset a room while the guest can continue');
  assert.equal(server.getSnapshot().humanPlayers.length, 2);
  assert.ok(server.getSnapshot().buildings.some(building => building.id === guest.coreId && building.hp > 0), 'guest Core remains live');

  server.getSnapshot().buildings.find(building => building.id === guest.coreId)!.hp = 0;
  server.step(0.05);
  assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), true);
  assert.equal(server.getSnapshot().multiplayerMode, 'TEAM', 'restart must preserve the room mode');
  assert.equal(server.getSnapshot().humanPlayers.length, 2, 'restart must preserve all participant slots');
  assert.ok(server.getSnapshot().humanPlayers.some(player => player.playerId === guest.playerId), 'guest identity must remain assigned');
  assert.ok(server.getSnapshot().buildings.some(building => building.id === guest.coreId && building.hp > 0), 'guest Core must be recreated under the same ID');
  server.stop();
});

test('CO-OP rejects restart before Core defeat, then permits restart without remembering death', () => {
  const server = new LocalGameServer();
  server.setMultiplayerMode('COOPERATIVE');
  server.addHumanParticipant('guest-player', 'COOPERATIVE');
  assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), false);
  assert.equal(server.getSnapshot().isGameOver, false, 'a live shared Core keeps the room running');
  const core = server.getSnapshot().buildings.find(building => building.type === 'CORE')!;
  core.hp = 0;
  server.step(0.05);
  const defeatedTime = server.getSnapshot().gameTime;
  assert.equal(server.dispatchForPlayer('player-host', { type: 'RESTART' }), true);
  assert.equal(server.getSnapshot().isGameOver, false);
  assert.equal(server.getSnapshot().gameTime, 0);
  assert.ok(server.getSnapshot().gameTime < defeatedTime);
  assert.equal(server.getSnapshot().humanPlayers.length, 2);
  assert.equal(server.getSnapshot().humanPlayers.every(player => player.defeatedAtGameTime === null), true);
  server.stop();
});


test('authoritative simulation advances independently of requestAnimationFrame/render timing', async () => {
  const server = new LocalGameServer();
  const initialGameTime = server.getSnapshot().gameTime;
  server.start();
  await new Promise(resolve => setTimeout(resolve, 120));
  server.stop();
  assert.ok(server.getSnapshot().gameTime > initialGameTime,
    'the authoritative clock must advance from its own fixed-rate scheduler, without relying on canvas rendering');
  assert.ok(server.getSnapshot().gameTime >= 0.05,
    `expected several fixed simulation ticks in 120ms, got ${server.getSnapshot().gameTime}`);
});


test('simulation overload diagnostics are rate-limited but preserve cumulative dropped-tick metrics', async () => {
  const server = new LocalGameServer(123);
  const engine = (server as unknown as { engine: { step: (dt: number) => void } }).engine;
  const originalStep = engine.step.bind(engine);
  const originalWarn = console.warn;
  const overloadWarnings: Array<{ message: unknown; details: unknown }> = [];
  engine.step = (dt: number) => {
    const until = performance.now() + 35;
    while (performance.now() < until) { /* Deliberately simulate a busy main-thread tick. */ }
    originalStep(dt);
  };
  console.warn = (message?: unknown, details?: unknown) => {
    if (typeof message === 'string' && message.includes('[simulation clock] Main thread could not keep up')) {
      overloadWarnings.push({ message, details });
    } else {
      originalWarn(message, details);
    }
  };

  try {
    server.start();
    await new Promise(resolve => setTimeout(resolve, 480));
  } finally {
    server.stop();
    engine.step = originalStep;
    console.warn = originalWarn;
  }

  assert.ok(overloadWarnings.length >= 1, 'the initial overload remains visible');
  assert.ok(overloadWarnings.length <= 1, `warnings should not flood the console inside one diagnostic window (count=${overloadWarnings.length})`);
  const details = overloadWarnings[0]?.details as {
    droppedTicksSinceLastDiagnostic?: number;
    totalDroppedWallClockTicks?: number;
    maxEngineStepMs?: number;
    averageEngineStepMs?: number;
    activeEntityCount?: number;
    droneCount?: number;
    buildingCount?: number;
  } | undefined;
  assert.ok((details?.droppedTicksSinceLastDiagnostic ?? 0) > 0, 'the warning reports dropped ticks in the current window');
  assert.ok((details?.totalDroppedWallClockTicks ?? 0) >= (details?.droppedTicksSinceLastDiagnostic ?? 0), 'the cumulative dropped-tick count remains monotonic');
  assert.ok((details?.maxEngineStepMs ?? 0) >= 30, 'the warning identifies slow engine steps rather than only reporting scheduler lateness');
  assert.ok((details?.averageEngineStepMs ?? -1) >= 0, 'the warning reports an average simulation-step duration');
  assert.ok(typeof details?.activeEntityCount === 'number' && typeof details?.droneCount === 'number' && typeof details?.buildingCount === 'number',
    'the warning reports world size so simulation cost can be compared with active units and structures');
});
