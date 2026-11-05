import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { RoomConnectionView } from '../roomView';
import { userFacingError } from './model';
import { PeerJsRoomClientPeerActions } from './PeerJsRoomClientPeerActions';

export abstract class PeerJsRoomClientSignaling extends PeerJsRoomClientPeerActions {

  protected override attachPeerLifecycle(peer: Peer): void {
    peer.on('connection', connection => {
      if (peer !== this.peer || this.intentionalClose) {
        connection.close();
        return;
      }
      if (this.role !== 'host') {
        console.error('[PeerJS] Rejected an unsolicited incoming peer connection on a guest client.', { peerId: connection.peer });
        connection.close();
        return;
      }
      this.acceptGuestConnection(connection);
    });

    peer.on('open', () => {
      if (peer !== this.peer || this.intentionalClose) return;
      this.signalingConnected = true;
      this.signalingReconnectAttempts = 0;
      if (this.signalingReconnectTimer !== null) window.clearTimeout(this.signalingReconnectTimer);
      this.signalingReconnectTimer = null;
      if (this.view.status !== 'error') {
        this.update({
          status: this.role === 'host' ? (this.connections.size > 0 ? 'connected' : 'waiting') : 'connected',
          message: this.role === 'host' ? 'The room is ready for players.' : 'The room service connection was restored.',
          peerConnected: this.role === 'host' ? [...this.connections.values()].some(connection => connection.open) : Boolean(this.hostConnection?.open),
          signalingUnavailable: false, signalingRetryAttempts: 0
        });
      }
    });

    peer.on('error', error => {
      if (peer !== this.peer || this.intentionalClose) return;
      console.error('[PeerJS] Active peer reported an error.', { errorType: error.type, message: error.message, error });
      const dataPlaneAlive = this.role === 'host'
        ? [...this.connections.values()].some(connection => connection.open)
        : Boolean(this.hostConnection?.open);
      const transientSignallingError = ['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(error.type || '');
      const activeRoom = Boolean(this.roomCode && this.role);
      if ((transientSignallingError || activeRoom) && !peer.destroyed && (dataPlaneAlive || this.role === 'host')) {
        // Peer-level failures after room creation belong to the signalling plane.
        // They must never tear down a room or its established WebRTC data channels.
        this.signalingConnected = false;
        this.update({
          status: this.role === 'host' ? (dataPlaneAlive ? 'connected' : 'waiting') : 'connected',
          message: 'The room service connection is recovering. Existing players stay connected; joining may be temporarily unavailable.',
          peerConnected: dataPlaneAlive,
          signalingUnavailable: this.signalingReconnectAttempts >= 5,
          signalingRetryAttempts: this.signalingReconnectAttempts
        });
        this.scheduleSignalingReconnect(peer);
        return;
      }
      this.update({ status: 'error', message: userFacingError(error), peerConnected: this.view.peerConnected });
      // PeerJS can report `peer-unavailable` on the Peer object rather than the
      // DataConnection. Closing the pending channel rejects its open promise now.
      if (this.role === 'guest' && this.view.status === 'error' && this.hostConnection && !this.hostConnection.open) this.hostConnection.close();
    });

    peer.on('disconnected', () => {
      if (peer !== this.peer || this.intentionalClose) return;
      this.signalingConnected = false;
      console.warn('[PeerJS] Signalling connection disconnected; existing WebRTC data channels may continue.', { peerId: peer.id });
      this.update({
        status: this.role === 'host' ? (this.connections.size > 0 ? 'connected' : 'waiting') : 'connected',
        message: 'The room service connection was interrupted. Existing players may remain connected while it recovers.',
        peerConnected: this.role === 'host' ? [...this.connections.values()].some(connection => connection.open) : Boolean(this.hostConnection?.open),
        signalingUnavailable: this.signalingReconnectAttempts >= 5, signalingRetryAttempts: this.signalingReconnectAttempts
      });
      this.scheduleSignalingReconnect(peer);
    });

    peer.on('close', () => {
      if (this.intentionalClose || peer !== this.peer) return;
      const error = new Error('The room connection ended unexpectedly. Check your internet connection and rejoin the room.');
      console.error('[PeerJS] Peer instance closed unexpectedly.', { peerId: peer.id, error });
      try {
        // A Peer-level close suppresses individual DataConnection close callbacks
        // during teardown. Explicitly notify the host controller first, or it would
        // retain ghost participants until the heartbeat lease expires.
        if (this.role === 'host') {
          for (const [remotePeerId, connection] of this.connections) {
            this.dispatchDataMessage({ type: 'game-peer-left', senderPeerId: remotePeerId }, connection, 'host');
          }
        }
      } finally {
        this.destroyPeerAndConnections();
        this.role = undefined;
        this.roomCode = undefined;
        this.hostConnection = null;
        this.update({ status: 'error', message: error.message, roomCode: undefined, role: undefined, peerConnected: false });
      }
    });
  }

  public override retrySignaling(): void {
    const peer = this.peer;
    if (!peer || peer.destroyed || this.intentionalClose || !this.roomCode || !this.role) {
      console.warn('[PeerJS] Manual signalling retry ignored because no active room peer exists.');
      return;
    }
    if (this.signalingReconnectTimer !== null) window.clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
    this.signalingReconnectAttempts = 0;
    if (this.signalingConnected) {
      this.update({ signalingUnavailable: false, signalingRetryAttempts: 0 });
      return;
    }
    this.update({
      status: this.role === 'host' ? ([...this.connections.values()].some(connection => connection.open) ? 'connected' : 'waiting') : 'connected',
      message: 'Retrying the room service connection. Existing players will remain connected.',
      peerConnected: this.role === 'host' ? [...this.connections.values()].some(connection => connection.open) : Boolean(this.hostConnection?.open),
      signalingUnavailable: false, signalingRetryAttempts: 0
    });
    this.scheduleSignalingReconnect(peer);
  }

  protected override scheduleSignalingReconnect(peer: Peer): void {
    if (this.signalingReconnectTimer !== null || this.intentionalClose || peer !== this.peer || peer.destroyed) return;
    const delayMs = Math.min(15_000, 500 * (2 ** Math.min(this.signalingReconnectAttempts, 5)));
    this.signalingReconnectTimer = window.setTimeout(() => {
      this.signalingReconnectTimer = null;
      if (this.intentionalClose || peer !== this.peer || peer.destroyed || this.signalingConnected) return;
      this.signalingReconnectAttempts += 1;
      if (this.signalingReconnectAttempts >= 5) {
        this.update({
          status: this.role === 'host' ? ([...this.connections.values()].some(connection => connection.open) ? 'connected' : 'waiting') : 'connected',
          message: 'The room service is unavailable. Existing players remain connected, but new players cannot join until it recovers.',
          peerConnected: this.role === 'host' ? [...this.connections.values()].some(connection => connection.open) : Boolean(this.hostConnection?.open),
          signalingUnavailable: true, signalingRetryAttempts: this.signalingReconnectAttempts
        });
      }
      // Use a sentinel while PeerJS emits any synchronous 'disconnected' event,
      // avoiding a duplicate retry timer for the same reconnect attempt.
      this.signalingReconnectTimer = -1;
      try {
        if (!peer.disconnected) peer.disconnect();
        peer.reconnect();
        console.info('[PeerJS] Retrying the signalling connection with exponential backoff.', {
          peerId: peer.id, attempt: this.signalingReconnectAttempts, delayMs
        });
      } catch (error) {
        console.error('[PeerJS] Signalling reconnect attempt threw; preserving live data channels.', {
          peerId: peer.id, attempt: this.signalingReconnectAttempts, error
        });
      } finally {
        if (this.signalingReconnectTimer === -1) this.signalingReconnectTimer = null;
      }
      this.scheduleSignalingReconnectAfterAttempt(peer);
    }, delayMs);
  }

  protected override scheduleSignalingReconnectAfterAttempt(peer: Peer): void {
    if (this.signalingReconnectTimer !== null || this.intentionalClose || this.signalingConnected) return;
    this.signalingReconnectTimer = window.setTimeout(() => {
      this.signalingReconnectTimer = null;
      if (peer !== this.peer || peer.destroyed || this.intentionalClose || this.signalingConnected) return;
      // No 'open' event arrived after reconnect(). Reset the signalling socket and
      // retry with backoff. The PeerJS API keeps existing data channels alive.
      if (!peer.disconnected) {
        this.signalingReconnectTimer = -1;
        try {
          peer.disconnect();
        } finally {
          if (this.signalingReconnectTimer === -1) this.signalingReconnectTimer = null;
        }
      }
      this.scheduleSignalingReconnect(peer);
    }, 5_000);
  }

  protected override destroyPeerAndConnections(): void {
    const peer = this.peer;
    this.intentionalClose = true;
    if (this.signalingReconnectTimer !== null) window.clearTimeout(this.signalingReconnectTimer);
    this.signalingReconnectTimer = null;
    this.signalingReconnectAttempts = 0;
    this.signalingConnected = false;
    this.peer = null;
    for (const timer of this.connectionRecoveryTimers.values()) window.clearTimeout(timer);
    this.connectionRecoveryTimers.clear();
    for (const connection of this.allConnections) this.intentionallyClosingConnections.add(connection);
    this.allConnections.clear();
    this.connections.clear();
    this.pendingConnectionPeerIds.clear();
    this.reportedMissingTargetPeerIds.clear();
    this.reportedSendFailures.clear();
    this.hostConnection = null;
    try {
      if (peer && !peer.destroyed) peer.destroy();
    } finally {
      this.intentionalClose = false;
    }
  }

  protected override update(patch: Partial<RoomConnectionView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.viewListeners) listener(this.view);
  }
}
