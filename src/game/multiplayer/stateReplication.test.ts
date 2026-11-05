import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalGameServer } from '../server/LocalGameServer';
import { HostRoomController } from './HostRoomController';
import { RemoteGameClientPort } from './RemoteGameClientPort';
import { generateProceduralEnemyBase } from '../world';
import type { GameDataTransport, PeerDataMessage } from './transport';

class RelayTransport implements GameDataTransport {
  readonly sent: PeerDataMessage[] = [];
  readonly listeners = new Set<(message: PeerDataMessage) => void>();
  peer: RelayTransport | null = null;
  peerId: string;
  dropNextType: string | null = null;

  constructor(peerId: string) { this.peerId = peerId; }

  sendData(message: PeerDataMessage, targetPeerId?: string): boolean {
    this.sent.push(message);
    if (!this.peer || (targetPeerId && targetPeerId !== this.peer.peerId)) return false;
    if (message.type === this.dropNextType) {
      this.dropNextType = null;
      // Simulate a relay-level drop after the sender's own WebSocket accepted the frame.
      return true;
    }
    for (const listener of [...this.peer.listeners]) listener({ ...message, senderPeerId: this.peerId });
    return true;
  }

  subscribeData(listener: (message: PeerDataMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  closePeer(peerId: string): boolean {
    if (!this.peer) return true;
    if (this.peer.peerId !== peerId) return false;
    this.peer = null;
    return true;
  }
}

function createRoom(seed = 0x1234abcd) {
  const server = new LocalGameServer(seed);
  const hostTransport = new RelayTransport('host-peer');
  const guestTransport = new RelayTransport('guest-peer');
  hostTransport.peer = guestTransport;
  guestTransport.peer = hostTransport;
  const host = new HostRoomController(server, hostTransport, 'TEAM');
  host.start();
  const guest = new RemoteGameClientPort(guestTransport);
  // Joining creates room membership only; gameplay begins at the explicit host action.
  host.startMatch();
  return { server, hostTransport, guestTransport, host, guest };
}

test('creating and joining a room does not create or publish a game world until the host starts one', () => {
  const server = new LocalGameServer(123);
  const hostTransport = new RelayTransport('host-room-only');
  const guestTransport = new RelayTransport('guest-room-only');
  hostTransport.peer = guestTransport;
  guestTransport.peer = hostTransport;
  const host = new HostRoomController(server, hostTransport, 'TEAM');
  host.start();
  const guest = new RemoteGameClientPort(guestTransport, 'Waiting Guest');
  try {
    assert.equal(guest.getRoomStatus()?.phase, 'lobby');
    assert.equal(guest.getRoomStatus()?.hasWorld, false);
    assert.equal(guest.getRoomStatus()?.worldId, null);
    assert.equal(guest.hasAuthoritativeState(), false);
    assert.equal(hostTransport.sent.some(message => message.type === 'game-initial-state' || message.type === 'game-state-delta'), false,
      'a room may synchronize membership without publishing any world frame');

    host.startMatch();
    assert.equal(guest.getRoomStatus()?.phase, 'playing');
    assert.equal(guest.getRoomStatus()?.hasWorld, true);
    assert.equal(guest.getRoomStatus()?.worldId, guest.getWorldFrame().worldId);
    assert.equal(guest.hasAuthoritativeState(), true);
  } finally {
    guest.disconnect();
    host.stop();
    server.stop();
  }
});

test('joining sends the seeded full state once, then only compact deltas for changes', () => {
  const room = createRoom();
  try {
    const initial = room.hostTransport.sent.find(message => message.type === 'game-initial-state') as PeerDataMessage & { frame: { worldSeed: number; revision: number } };
    assert.ok(initial, 'guest must receive one authoritative initial state');
    assert.ok(Number.isSafeInteger(initial.frame.worldSeed) && initial.frame.worldSeed >= 0 && initial.frame.worldSeed <= 0xffff_ffff,
      'each explicitly started world has a valid generated seed');
    assert.equal(Object.hasOwn(initial, 'worldSeed'), false, 'world seed belongs to the frame and should not be duplicated in its envelope');
    assert.equal(room.guest.getWorldFrame().worldSeed, initial.frame.worldSeed);
    assert.equal(room.hostTransport.sent.some(message => message.type === 'game-frame'), false, 'the old per-frame snapshot protocol must not be used');

    const countBeforeTick = room.hostTransport.sent.length;
    room.server.step(0.1);
    room.host.flushStateUpdates();
    const outgoing = room.hostTransport.sent.slice(countBeforeTick);
    const delta = outgoing.filter(message => message.type === 'game-state-delta').at(-1) as (PeerDataMessage & { operations: unknown[]; baseRevision: number; revision: number }) | undefined;
    if (!delta) throw new Error('Normal updates must use state deltas.');
    assert.ok(Array.isArray(delta.operations));
    assert.ok(delta.operations.length > 0, 'a state delta must contain actual changes');
    assert.equal(Object.hasOwn(delta, 'worldSeed'), false, 'the immutable world seed is sent only in the initial/full state');
    assert.ok(delta.revision > delta.baseRevision);
    assert.equal(room.guest.getWorldFrame().revision, delta.revision);
    assert.equal(room.guest.getWorldFrame().revision, room.server.captureWorldFrame().revision);
    assert.ok(JSON.stringify(delta).length < JSON.stringify(room.server.captureWorldFrame()).length, 'a normal delta should be smaller than a full state');
    assert.equal(outgoing.some(message => message.type === 'game-initial-state'), false, 'no full state is sent while synchronized');
  } finally {
    room.guest.disconnect();
    room.host.stop();
    room.server.stop();
  }
});

test('host does not transmit empty deltas when only revision metadata advances', () => {
  const room = createRoom();
  try {
    const originalCapture = room.server.captureWorldFrame.bind(room.server);
    Object.defineProperty(room.server, 'captureWorldFrame', {
      configurable: true,
      value: () => {
        const frame = originalCapture();
        return { ...frame, revision: frame.revision + 1, serverTimeMs: frame.serverTimeMs + 100 };
      }
    });
    const before = room.hostTransport.sent.filter(message => message.type === 'game-state-delta').length;
    room.host.flushStateUpdates(Date.now() + 100);
    const after = room.hostTransport.sent.filter(message => message.type === 'game-state-delta').length;
    assert.equal(after, before, 'clock/revision-only updates must not create network messages');
  } finally {
    room.guest.disconnect();
    room.host.stop();
    room.server.stop();
  }
});

test('a missed delta is detected by base revision and repaired with a full authoritative resync', () => {
  const room = createRoom(0xfeedbeef);
  try {
    const before = room.guest.getWorldFrame().revision;
    room.hostTransport.dropNextType = 'game-state-delta';
    room.server.step(0.1);
    room.host.flushStateUpdates();
    assert.equal(room.guest.getWorldFrame().revision, before, 'the deliberately dropped delta must not be applied');

    room.server.step(0.1);
    room.host.flushStateUpdates();
    assert.equal(room.guest.getWorldFrame().revision, room.server.captureWorldFrame().revision, 'base mismatch must trigger a full resync');
    assert.ok(room.guestTransport.sent.some(message => message.type === 'game-resync-request'));
    assert.ok(room.hostTransport.sent.filter(message => message.type === 'game-initial-state').length >= 2);
  } finally {
    room.guest.disconnect();
    room.host.stop();
    room.server.stop();
  }
});

test('a lost initial state is retransmitted until the guest acknowledges it', () => {
  const server = new LocalGameServer(77);
  const hostTransport = new RelayTransport('host-peer');
  const guestTransport = new RelayTransport('guest-peer');
  hostTransport.peer = guestTransport;
  guestTransport.peer = hostTransport;
  hostTransport.dropNextType = 'game-initial-state';
  const host = new HostRoomController(server, hostTransport, 'TEAM');
  host.start();
  const guest = new RemoteGameClientPort(guestTransport);
  let receivedState = false;
  guest.subscribe(() => { receivedState = true; });
  try {
    assert.equal(receivedState, false, 'joining alone must not create or publish a world');
    host.startMatch();
    assert.equal(receivedState, false, 'the deliberately dropped initial state must not produce a guest snapshot');
    host.flushStateUpdates(Date.now() + 1_600);
    assert.equal(receivedState, true);
    const initial = hostTransport.sent.find(message => message.type === 'game-initial-state') as (PeerDataMessage & { frame: { worldSeed: number } }) | undefined;
    assert.ok(initial);
    assert.equal(guest.getWorldFrame().worldSeed, initial!.frame.worldSeed);
    assert.ok(hostTransport.sent.filter(message => message.type === 'game-initial-state').length >= 2);
  } finally {
    guest.disconnect();
    host.stop();
    server.stop();
  }
});


test('world seed deterministically controls procedural resource chunks and outpost placement', () => {
  const first = new LocalGameServer(0x10203040);
  const sameSeed = new LocalGameServer(0x10203040);
  const differentSeed = new LocalGameServer(0x10203041);
  assert.deepEqual(first.getSnapshot().resourceNodes, sameSeed.getSnapshot().resourceNodes);
  assert.notDeepEqual(first.getSnapshot().resourceNodes, differentSeed.getSnapshot().resourceNodes);

  const firstOutpost = generateProceduralEnemyBase(2, 3, 100, -40, 0x10203040).base;
  const sameOutpost = generateProceduralEnemyBase(2, 3, 100, -40, 0x10203040).base;
  const differentOutpost = generateProceduralEnemyBase(2, 3, 100, -40, 0x10203041).base;
  assert.deepEqual({ x: firstOutpost.x, y: firstOutpost.y, raidTimer: firstOutpost.raidTimer }, { x: sameOutpost.x, y: sameOutpost.y, raidTimer: sameOutpost.raidTimer });
  assert.notDeepEqual({ x: firstOutpost.x, y: firstOutpost.y }, { x: differentOutpost.x, y: differentOutpost.y });
  first.stop();
  sameSeed.stop();
  differentSeed.stop();
});
