import type { PeerDataMessage, GameDataTransport } from './transport';

export class FakeTransport implements GameDataTransport {
  readonly sent: Array<{ message: PeerDataMessage; target?: string }> = [];
  readonly closedPeers: Array<{ peerId: string; reason?: string }> = [];
  readonly closeAttempts: Array<{ peerId: string; reason?: string }> = [];
  readonly unavailablePeers = new Set<string>();
  failNextRoomStatusForPeer: string | null = null;
  throwNextRoomStatusForPeer: string | null = null;
  private readonly listeners = new Set<(message: PeerDataMessage) => void>();
  sendData(message: PeerDataMessage, targetPeerId?: string): boolean {
    if (message.type === 'game-room-status' && targetPeerId === this.throwNextRoomStatusForPeer) {
      this.throwNextRoomStatusForPeer = null;
      throw new Error('Simulated transport send exception.');
    }
    if (message.type === 'game-room-status' && targetPeerId === this.failNextRoomStatusForPeer) {
      this.failNextRoomStatusForPeer = null;
      return false;
    }
    if (targetPeerId && this.unavailablePeers.has(targetPeerId)) return false;
    this.sent.push({ message, target: targetPeerId });
    return true;
  }
  subscribeData(listener: (message: PeerDataMessage) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  hasPeerConnection(peerId: string): boolean { return !this.unavailablePeers.has(peerId); }
  closePeer(peerId: string, reason?: string): boolean {
    this.closeAttempts.push({ peerId, reason });
    if (this.unavailablePeers.has(peerId)) return true;
    this.closedPeers.push({ peerId, reason });
    this.unavailablePeers.add(peerId);
    return true;
  }
  emit(message: PeerDataMessage): void { for (const listener of [...this.listeners]) listener(message); }
}
