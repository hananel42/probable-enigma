import type { DataConnection } from 'peerjs';
import type { PeerDataMessage } from '../transport';
import { MAX_PEERJS_GAME_MESSAGE_BYTES } from '../peerJsTransportPolicy';
import { validateOutboundPeerDataMessage } from '../peerMessageEnvelope';
import { MAX_BUFFERED_BYTES } from './model';
import { PeerJsRoomClientRoomEntry } from './PeerJsRoomClientRoomEntry';

export abstract class PeerJsRoomClientPeerActions extends PeerJsRoomClientRoomEntry {

  /** Close a single stale guest peer without generating a duplicate local disconnect event. */
  public override closePeer(peerId: string, reason = 'host-requested-close'): boolean {
    if (this.role !== 'host') {
      console.error('[PeerJS transport] Only the host may close an individual guest connection.', { peerId, role: this.role, reason });
      return false;
    }
    const connection = this.connections.get(peerId);
    if (!connection) {
      // HostRoomController may learn about a close after PeerJS has already
      // removed the DataConnection from its registry. Closing is intentionally
      // idempotent: an already-absent peer is already closed, not a cleanup fault.
      const pending = [...this.allConnections].find(candidate => candidate.peer === peerId);
      if (pending) {
        this.clearConnectionRecoveryTimer(pending);
        this.intentionallyClosingConnections.add(pending);
        this.allConnections.delete(pending);
        this.pendingConnectionPeerIds.delete(peerId);
        this.clearPeerSendFailures(peerId);
        pending.close();
      } else {
        this.pendingConnectionPeerIds.delete(peerId);
        this.clearPeerSendFailures(peerId);
        console.info('[PeerJS transport] Guest connection was already absent; treating close as complete.', { peerId, reason });
      }
      return true;
    }
    this.clearConnectionRecoveryTimer(connection);
    this.intentionallyClosingConnections.add(connection);
    this.connections.delete(peerId);
    this.pendingConnectionPeerIds.delete(peerId);
    this.reportedMissingTargetPeerIds.delete(peerId);
    this.clearPeerSendFailures(peerId);
    this.allConnections.delete(connection);
    connection.close();
    const activeGuestCount = [...this.connections.values()].filter(candidate => candidate.open).length;
    this.update({
      status: activeGuestCount > 0 ? 'connected' : 'waiting',
      peerConnected: activeGuestCount > 0,
      message: reason.startsWith('host-kicked') ? 'The player was removed from the room.' : 'A player left the room.'
    });
    return true;
  }

  /** A host may use this to reconcile room membership with the live transport registry. */
  public override hasPeerConnection(peerId: string): boolean {
    if (this.role !== 'host') return Boolean(this.hostConnection?.peer === peerId && this.isDirectConnectionLive(this.hostConnection));
    const connection = this.connections.get(peerId);
    return Boolean(connection && this.isDirectConnectionLive(connection));
  }

  /** Host broadcasts when no target is supplied; guest data always goes to the host. */
  public override sendData(message: PeerDataMessage, targetPeerId?: string): boolean {
    if (!this.peer || this.peer.destroyed) {
      console.error('[PeerJS transport] Cannot send game data without an active PeerJS instance.', { type: message.type, role: this.role });
      return false;
    }
    const encoded = JSON.stringify(message);
    if (typeof encoded !== 'string') throw new TypeError(`PeerJS game message '${message.type}' is not JSON-serializable.`);
    const byteLength = new TextEncoder().encode(encoded).byteLength;
    if (byteLength > MAX_PEERJS_GAME_MESSAGE_BYTES) {
      const error = new RangeError(`PeerJS game message '${message.type}' is ${byteLength} bytes; the limit is ${MAX_PEERJS_GAME_MESSAGE_BYTES} bytes.`);
      console.error('[PeerJS transport] Refusing an oversized outbound game message.', { type: message.type, byteLength, error });
      throw error;
    }

    let targets: Array<[string, DataConnection]>;
    if (this.role === 'host') {
      if (targetPeerId) {
        const connection = this.connections.get(targetPeerId);
        if (!connection) {
          if (!this.reportedMissingTargetPeerIds.has(targetPeerId)) {
            this.reportedMissingTargetPeerIds.add(targetPeerId);
            console.warn('[PeerJS transport] Target peer has no registered direct connection; the host room controller must reconcile this peer.', {
              targetPeerId, type: message.type
            });
          }
          return false;
        }
        targets = [[targetPeerId, connection]];
      } else {
        targets = [...this.connections.entries()];
      }
    } else if (this.role === 'guest') {
      const connection = this.hostConnection;
      if (!connection) {
        console.error('[PeerJS transport] Guest has no host data connection.', { type: message.type, targetPeerId });
        return false;
      }
      if (targetPeerId && targetPeerId !== connection.peer) {
        console.error('[PeerJS transport] Guest attempted to target a peer other than the room host.', { targetPeerId, hostPeerId: connection.peer, type: message.type });
        return false;
      }
      targets = [[connection.peer, connection]];
    } else {
      console.error('[PeerJS transport] Cannot send data before the room role has been assigned.', { type: message.type });
      return false;
    }

    if (targets.length === 0) {
      console.error('[PeerJS transport] No direct data connections are available for this send.', { type: message.type, targetPeerId });
      return false;
    }

    // Validate before fan-out so a malformed or oversized local message fails once,
    // before it can partially reach some peers and diverge the authoritative room.
    validateOutboundPeerDataMessage(message, {
      transportName: 'PeerJS outbound',
      peerId: targetPeerId ?? 'broadcast',
      maxBytes: MAX_PEERJS_GAME_MESSAGE_BYTES
    });

    let sentCount = 0;
    for (const [peerId, connection] of targets) {
      if (!connection.open) {
        if (!this.reportedMissingTargetPeerIds.has(peerId)) {
          this.reportedMissingTargetPeerIds.add(peerId);
          console.warn('[PeerJS transport] Data connection is no longer open; skipping this send until room membership is reconciled.', {
            peerId, type: message.type, open: connection.open
          });
        }
        continue;
      }
      const dataChannel = (connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
      if (dataChannel && dataChannel.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.reportSendFailure(peerId, message.type, `bufferedAmount=${dataChannel.bufferedAmount} exceeds limit=${MAX_BUFFERED_BYTES}`);
        continue;
      }
      try {
        // PeerJS DataConnection.send() is synchronous and returns void. Delivery
        // and later WebRTC failures are surfaced through data/error/close events
        // and the room protocol's ACK + heartbeat channels, not a Promise result.
        connection.send(message);
        this.reportedMissingTargetPeerIds.delete(peerId);
        this.reportedSendFailures.delete(`${peerId}:${message.type}`);
        sentCount++;
      } catch (error) {
        // Keep fan-out isolated: a synchronous failure for one guest must not
        // prevent the host from attempting delivery to every other guest.
        this.reportSendFailure(peerId, message.type, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
        if (!this.isDirectConnectionLive(connection)) connection.close();
      }
    }
    return sentCount > 0;
  }

  public override leaveRoom(): void {
    if (!this.peer && !this.roomCode && !this.role) {
      this.update({ status: 'idle', message: 'Not connected', roomCode: undefined, role: undefined, peerConnected: false });
      return;
    }
    console.info('[PeerJS] Leaving direct WebRTC room.', { roomCode: this.roomCode, role: this.role });
    this.destroyPeerAndConnections();
    this.role = undefined;
    this.roomCode = undefined;
    this.hostConnection = null;
    this.pendingConnectionPeerIds.clear();
    this.update({ status: 'idle', message: 'Left room', roomCode: undefined, role: undefined, peerConnected: false });
  }

  public override disconnect(update = true): void {
    this.destroyPeerAndConnections();
    this.role = undefined;
    this.roomCode = undefined;
    this.hostConnection = null;
    this.pendingConnectionPeerIds.clear();
    this.dataListeners.clear();
    if (update) this.update({ status: 'idle', message: 'Not connected', roomCode: undefined, role: undefined, peerConnected: false });
  }
}
