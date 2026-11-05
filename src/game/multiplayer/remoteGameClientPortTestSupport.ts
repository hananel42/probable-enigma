import type { PeerDataMessage, GameDataTransport } from './transport';
import type { GameSnapshot, GameWorldFrame } from '../server/protocol';
import type { GameEntity } from '../types';

export class TestTransport implements GameDataTransport {
  readonly sent: PeerDataMessage[] = [];
  private listeners = new Set<(message: PeerDataMessage) => void>();
  sendData(message: PeerDataMessage): boolean { this.sent.push(message); return true; }
  subscribeData(listener: (message: PeerDataMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  inject(message: PeerDataMessage): void { for (const listener of this.listeners) listener(message); }
}

export function makeFrame(
  worldId = 'world-test',
  playerId = 'guest-player-1',
  revision = 1
): GameWorldFrame {
  const commanderId = playerId === 'guest-player-1' ? 'guest-commander' : `commander-${playerId}`;
  const coreId = playerId === 'guest-player-1' ? 'guest-core' : `core-${playerId}`;
  const commander: GameEntity = {
    id: commanderId, ownerPlayerId: playerId, kind: 'COMMANDER', faction: 'player',
    x: 1000, y: 1000, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, speed: 100, radius: 10,
    isFlying: false, isDead: false
  };
  const snapshot = {
    player: commander,
    humanPlayers: [{ playerId, commanderId: commander.id, coreId, resources: { wood: 0, stone: 0, diamonds: 0 }, connected: true, aim: { x: 1100, y: 1000, gx: 0, gy: 0 }, isAiming: false, selectedBuildingType: null, selectedStationId: null }],
    multiplayerMode: 'TEAM', groups: [], entities: [commander],
    buildings: [{ id: coreId, type: 'CORE', hp: 100, x: 1000, y: 1000 }], resources: { wood: 0, stone: 0, diamonds: 0 },
    resourceNodes: [], enemyBases: [], projectiles: [], particles: [], floatingTexts: [], selectedBuildingType: null,
    selectedStationId: null, camera: { x: commander.x, y: commander.y, zoom: 1 },
    mouseWorld: { x: commander.x, y: commander.y, gx: 0, gy: 0 }, isMouseAiming: false, isGameOver: false,
    gameTime: 0, difficultyLevel: 1
  } as unknown as GameSnapshot;
  return { protocolVersion: 3, worldId, worldSeed: worldId === 'world-test' ? 123 : 456, revision, serverTimeMs: Date.now(), snapshot };
}
