import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../engine';
import { CanvasGameRenderer } from './CanvasGameRenderer';

function createRecordingCanvas() {
  const translated: Array<[number, number]> = [];
  const arcs: Array<[number, number, number]> = [];
  const textDraws: Array<{ text: string; color: string }> = [];
  const strokeColors: string[] = [];
  let saveDepth = 0;
  let saveCalls = 0;
  let restoreCalls = 0;
  const target: Record<string, unknown> = {
    globalAlpha: 1,
    setTransform: () => undefined,
    clearRect: () => undefined,
    save: () => { saveDepth += 1; saveCalls += 1; },
    restore: () => { saveDepth -= 1; restoreCalls += 1; },
    translate: (x: number, y: number) => { translated.push([x, y]); },
    scale: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => { strokeColors.push(String(target.strokeStyle ?? '')); },
    fill: () => undefined,
    arc: (x: number, y: number, radius: number) => { arcs.push([x, y, radius]); },
    ellipse: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    quadraticCurveTo: () => undefined,
    rotate: () => undefined,
    fillText: (text: string) => { textDraws.push({ text: String(text), color: String(target.fillStyle ?? '') }); },
    setLineDash: () => undefined,
    measureText: () => ({ width: 10 }),
    getTransform: () => ({ a: 1 })
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      // Treat any additional Canvas drawing API as a required no-op for this
      // focused renderer contract test; the implementation remains exercised.
      return () => undefined;
    },
    set(object, property, value) {
      object[property as string] = value;
      return true;
    }
  }) as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }),
    getContext: (kind: string) => kind === '2d' ? context : null
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    translated,
    arcs,
    textDraws,
    strokeColors,
    get saveDepth() { return saveDepth; },
    get saveCalls() { return saveCalls; },
    get restoreCalls() { return restoreCalls; }
  };
}

test('canvas renderer draws the local commander, drones and projectiles', () => {
  const engine = new GameEngine(12345);
  const state = engine.state;
  const drone = { ...state.player, id: 'test-render-drone', kind: 'DRONE' as const, x: 80, y: 75, radius: 8, faction: 'player' as const, hp: 20, maxHp: 20, angle: 0, isDead: false };
  state.entities.push(drone);
  state.projectiles.push({
    id: 'test-render-projectile', x: 40, y: 40, vx: 0, vy: 0, damage: 1, rangeOriginX: 40, rangeOriginY: 40, maxRange: 1000,
    faction: 'enemy', color: '#ffffff', radius: 3, life: 1, maxLife: 1
  });
  const recordingCanvas = createRecordingCanvas();
  const renderer = new CanvasGameRenderer(recordingCanvas.canvas);

  renderer.draw(state);

  assert.ok(recordingCanvas.translated.some(([x, y]) => x === state.player.x && y === state.player.y), 'the player commander must be passed to entity drawing');
  assert.ok(recordingCanvas.translated.some(([x, y]) => x === drone.x && y === drone.y), 'visible autonomous entities must be passed to entity drawing');
  assert.ok(recordingCanvas.arcs.some(([x, y, radius]) => x === 40 && y === 40 && radius === 3), 'visible projectiles must be passed to effect drawing');
});

test('canvas renderer restores every Canvas state scope on each frame', () => {
  const engine = new GameEngine(12345);
  const recordingCanvas = createRecordingCanvas();
  const renderer = new CanvasGameRenderer(recordingCanvas.canvas);

  renderer.draw(engine.state);
  renderer.draw(engine.state);

  assert.equal(recordingCanvas.saveDepth, 0, 'no saved Canvas states may leak across render frames');
  assert.equal(recordingCanvas.saveCalls, recordingCanvas.restoreCalls, 'every ctx.save() must have a matching ctx.restore()');
});


test('canvas renderer displays a local home marker and distinct participant base marker', () => {
  const engine = new GameEngine(12345);
  const guest = engine.addHumanParticipant('guest-team', 'TEAM');
  guest.displayName = 'ALLY PILOT';
  const recordingCanvas = createRecordingCanvas();
  const renderer = new CanvasGameRenderer(recordingCanvas.canvas);

  renderer.draw(engine.state);

  assert.ok(recordingCanvas.textDraws.some(item => item.text.startsWith('YOUR BASE ·')),
    'the local Core must have a persistent screen-space navigation marker');
  assert.ok(recordingCanvas.textDraws.some(item => item.text.startsWith('ALLY PILOT ·') && item.color === '#4ade80'),
    'a distinct allied Core must have a green navigation marker');
});

test('hostile human commanders are rendered with the enemy palette and hostile nameplate color', () => {
  const engine = new GameEngine(12345);
  engine.setMultiplayerMode('FREE_FOR_ALL');
  const rival = engine.addHumanParticipant('guest-ffa', 'FREE_FOR_ALL');
  const rivalGroup = engine.state.groups.find(group => group.id === rival.groupId);
  assert.ok(rivalGroup);
  rivalGroup.name = 'RIVAL OUTPOST';
  rivalGroup.commanderName = 'RIVAL PILOT';

  const recordingCanvas = createRecordingCanvas();
  const renderer = new CanvasGameRenderer(recordingCanvas.canvas);
  renderer.draw(engine.state);

  assert.ok(recordingCanvas.strokeColors.includes('#ef4444'),
    'hostile human Commander chassis must use the enemy red palette');
  assert.ok(recordingCanvas.textDraws.some(item => item.text === 'RIVAL OUTPOST' && item.color === '#f43f5e'),
    'hostile human Commander nameplates must use the enemy color');
  assert.ok(recordingCanvas.textDraws.some(item => item.text.startsWith('GUEST 1 ·') && item.color === '#f43f5e'),
    'hostile human Core navigation must use the enemy color');
});

test('allied human commanders retain friendly colors in TEAM mode', () => {
  const engine = new GameEngine(12345);
  const ally = engine.addHumanParticipant('guest-team', 'TEAM');
  const allyGroup = engine.state.groups.find(group => group.id === ally.groupId);
  assert.ok(allyGroup);
  allyGroup.name = 'ALLY OUTPOST';

  const recordingCanvas = createRecordingCanvas();
  const renderer = new CanvasGameRenderer(recordingCanvas.canvas);
  renderer.draw(engine.state);

  assert.ok(recordingCanvas.strokeColors.includes('#4ade80'),
    'allied human Commander chassis must use the friendly green palette');
  assert.ok(recordingCanvas.textDraws.some(item => item.text === 'ALLY OUTPOST' && item.color === '#bbf7d0'),
    'allied human Commander nameplates must use the friendly color');
});
