import type { DataConnection } from 'peerjs';
import type { PeerDataMessage } from '../transport';
import { assessWebRtcConnection } from '../webRtcConnectionHealth';
import { PEERJS_GAME_DATA_SERIALIZATION } from '../peerJsTransportPolicy';
import type { RoomRole } from './model';
import { APPLICATION_ID, APPLICATION_PROTOCOL_VERSION, CONNECTION_OPEN_TIMEOUT_MS, MAX_ROOM_GUESTS, userFacingError, validatePeerData } from './model';
import { PeerJsRoomClientSignaling } from './PeerJsRoomClientSignaling';

export abstract class PeerJsRoomClientConnections extends PeerJsRoomClientSignaling {

  protected override acceptGuestConnection(connection: DataConnection): void {
    // The guest selects this wire format when creating the DataConnection. PeerJS
    // carries the choice in its connection handshake, so the receiver can verify
    // it before attempting to parse any game traffic.
    if (connection.serialization !== PEERJS_GAME_DATA_SERIALIZATION) {
      const error = new Error(`Expected PeerJS serialization '${PEERJS_GAME_DATA_SERIALIZATION}', received '${connection.serialization}'.`);
      console.error('[PeerJS] Rejected an incoming room connection with an incompatible data serializer.', {
        peerId: connection.peer, serialization: connection.serialization, expected: PEERJS_GAME_DATA_SERIALIZATION, error
      });
      connection.close();
      return;
    }
    const metadata = connection.metadata as Record<string, unknown> | undefined;
    if (!metadata || metadata.application !== APPLICATION_ID ||
        metadata.applicationProtocolVersion !== APPLICATION_PROTOCOL_VERSION || metadata.role !== 'guest' ||
        metadata.roomCode !== this.roomCode || connection.label !== 'craftbound-game' || !connection.reliable) {
      const error = new Error(`Rejected incompatible PeerJS connection from '${connection.peer}'.`);
      console.error('[PeerJS] Incoming peer metadata did not match this application, protocol, or room.', { peerId: connection.peer, metadata, roomCode: this.roomCode, error });
      connection.close();
      return;
    }
    if (this.connections.has(connection.peer) || this.pendingConnectionPeerIds.has(connection.peer)) {
      const error = new Error(`Duplicate PeerJS connection from peer '${connection.peer}'.`);
      console.error('[PeerJS] Rejected duplicate peer connection.', { peerId: connection.peer, error });
      connection.close();
      return;
    }
    if (this.connections.size + this.pendingConnectionPeerIds.size >= MAX_ROOM_GUESTS) {
      const error = new Error(`Room already has the maximum of ${MAX_ROOM_GUESTS} guest connections.`);
      console.error('[PeerJS] Rejected guest because the room is full.', { peerId: connection.peer, capacity: MAX_ROOM_GUESTS, error });
      connection.close();
      return;
    }

    this.pendingConnectionPeerIds.add(connection.peer);
    void this.bindConnection(connection, 'host').catch(error => {
      console.error('[PeerJS] Failed to open an incoming guest data connection; closing the pending channel.', { peerId: connection.peer, error });
      this.pendingConnectionPeerIds.delete(connection.peer);
      // A channel that failed before opening still owns a PeerJS negotiation
      // and must be closed. Testing only `connection.open` here leaked attempts
      // that never reached the open state.
      this.intentionallyClosingConnections.add(connection);
      this.allConnections.delete(connection);
      connection.close();
    });
  }

  protected override bindConnection(connection: DataConnection, connectionRole: RoomRole): Promise<void> {
    this.allConnections.add(connection);
    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = new Error(`PeerJS data connection to '${connection.peer}' did not open within ${CONNECTION_OPEN_TIMEOUT_MS} ms.`);
        reject(error);
      }, CONNECTION_OPEN_TIMEOUT_MS);

      const openConnection = () => {
        if (opened || this.intentionalClose) return;
        opened = true;
        settled = true;
        window.clearTimeout(timeoutId);
        this.pendingConnectionPeerIds.delete(connection.peer);
        if (this.connections.has(connection.peer)) {
          const error = new Error(`PeerJS connection map already contains '${connection.peer}' when its channel opened.`);
          console.error('[PeerJS] Connection bookkeeping invariant failed.', { peerId: connection.peer, error });
          reject(error);
          return;
        }
        this.connections.set(connection.peer, connection);
        this.reportedMissingTargetPeerIds.delete(connection.peer);
        this.clearPeerSendFailures(connection.peer);
        if (connectionRole === 'guest') {
          this.hostConnection = connection;
        }
        if (connectionRole === 'host') {
          const openGuestCount = [...this.connections.values()].filter(candidate => candidate.open).length;
          this.update({ status: 'connected', peerConnected: openGuestCount > 0, message: `${openGuestCount} player${openGuestCount === 1 ? '' : 's'} connected.` });
        }
        resolve();
      };

      connection.on('open', openConnection);
      connection.on('data', data => {
        if (this.intentionalClose) return;
        let message: PeerDataMessage;
        try {
          message = validatePeerData(data, connection.peer);
        } catch (error) {
          console.error('[PeerJS transport] Invalid inbound data; closing only the offending peer instead of leaking an exception into the application event loop.', {
            peerId: connection.peer, connectionRole, error
          });
          connection.close();
          if (connectionRole === 'guest') {
            this.update({ status: 'error', message: 'The room received an invalid message and closed this connection. Please rejoin the room.', peerConnected: false });
          }
          return;
        }
        if (message.type === 'game-peer-left') {
          const error = new Error('Remote peers may not send the transport-only game-peer-left message.');
          console.error('[PeerJS] Rejected remote attempt to emit a local transport lifecycle event.', { peerId: connection.peer, error });
          connection.close();
          return;
        }
        this.dispatchDataMessage(message, connection, connectionRole);
      });
      connection.on('close', () => {
        this.clearConnectionRecoveryTimer(connection);
        this.allConnections.delete(connection);
        this.pendingConnectionPeerIds.delete(connection.peer);
        this.reportedMissingTargetPeerIds.delete(connection.peer);
        this.clearPeerSendFailures(connection.peer);
        if (!opened) {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeoutId);
            reject(new Error(`PeerJS data connection to '${connection.peer}' closed before opening.`));
          }
          return;
        }
        if (this.connections.get(connection.peer) === connection) this.connections.delete(connection.peer);
        if (this.intentionalClose || this.intentionallyClosingConnections.has(connection)) return;
        if (connectionRole === 'host') {
          this.dispatchDataMessage({ type: 'game-peer-left', senderPeerId: connection.peer }, connection, connectionRole);
          const openGuestCount = [...this.connections.values()].filter(candidate => candidate.open).length;
          this.update({
            status: openGuestCount > 0 ? 'connected' : 'waiting',
            peerConnected: openGuestCount > 0,
            message: openGuestCount > 0 ? 'A player disconnected. Other direct peers remain connected.' : 'The guest disconnected. The hosted simulation remains available.'
          });
        } else if (this.hostConnection === connection) {
          const error = new Error('The room connection ended. The host may have left or the connection was interrupted. You can join again with the room code.');
          console.error('[PeerJS] Host data connection closed unexpectedly.', { hostPeerId: connection.peer, error });
          this.hostConnection = null;
          this.role = undefined;
          this.roomCode = undefined;
          this.destroyPeerAndConnections();
          this.update({ status: 'error', message: error.message, roomCode: undefined, role: undefined, peerConnected: false });
        }
      });
      connection.on('error', error => {
        const peerConnection = connection.peerConnection;
        const connectionState = peerConnection?.connectionState;
        const iceState = peerConnection?.iceConnectionState;
        console.error('[PeerJS] Data connection reported an error.', {
          peerId: connection.peer, connectionRole, connectionState, iceState, error
        });
        if (!opened && !settled) {
          settled = true;
          window.clearTimeout(timeoutId);
          reject(error);
          return;
        }

        // A DataConnection error is diagnostic, not by itself proof the path has
        // failed. Keep an open data channel while its WebRTC state can still
        // recover; the state-change monitor and room heartbeat decide whether
        // this is a real disconnect.
        const assessment = assessWebRtcConnection(connectionState, iceState);
        if (assessment === 'failed') {
          console.error('[PeerJS] Closing a data channel whose underlying WebRTC path is terminal.', {
            peerId: connection.peer, connectionRole, connectionState, iceState, error
          });
          connection.close();
          return;
        }
        if (assessment === 'recovering') {
          this.scheduleConnectionRecoveryClose(connection, connectionRole);
          return;
        }
        if (connection.open) {
          console.warn('[PeerJS] Preserving the still-open data channel after a non-terminal error.', {
            peerId: connection.peer, connectionRole, connectionState, iceState, error
          });
          this.update({
            status: this.role === 'host' ? (this.connections.size > 0 ? 'connected' : 'waiting') : 'connected',
            message: `The room connection is recovering. Your room is still open while we check the connection. ${userFacingError(error)}`,
            peerConnected: this.role === 'host'
              ? [...this.connections.values()].some(candidate => candidate.open)
              : Boolean(this.hostConnection?.open)
          });
          return;
        }

        // A non-open channel which has not reached an explicit recoverable state
        // cannot carry game data, so close it and let the lifecycle callback
        // perform the single canonical cleanup path.
        connection.close();
      });

      const peerConnection = connection.peerConnection;
      const monitorWebRtcState = () => this.handleWebRtcConnectionState(connection, connectionRole);
      peerConnection?.addEventListener('connectionstatechange', monitorWebRtcState);
      peerConnection?.addEventListener('iceconnectionstatechange', monitorWebRtcState);
      if (connection.open) queueMicrotask(openConnection);
      queueMicrotask(monitorWebRtcState);
    });
  }
}
