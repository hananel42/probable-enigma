import type { GameDataTransport, PeerDataMessage } from './transport';

export class InMemoryRoomRelay implements GameDataTransport {
  private readonly listeners = new Set<(message: PeerDataMessage) => void>();
  peer: InMemoryRoomRelay | null = null;
  constructor(readonly peerId: string) {}

  subscribeData(listener: (message: PeerDataMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendData(message: PeerDataMessage, targetPeerId?: string): boolean {
    if (!this.peer || (targetPeerId && targetPeerId !== this.peer.peerId)) return false;
    for (const listener of [...this.peer.listeners]) listener({ ...message, senderPeerId: this.peerId });
    return true;
  }

  closePeer(peerId: string): boolean {
    // Closing an already-disconnected test peer is idempotent, matching PeerJS.
    if (!this.peer) return true;
    if (this.peer.peerId !== peerId) return false;
    this.peer = null;
    return true;
  }
}

/** Exercises the same room-data protocol as App.tsx, without a browser or WebSocket dependency. */
