import type { DataConnection } from 'peerjs';
import type { PeerDataMessage } from '../transport';
import { assessWebRtcConnection } from '../webRtcConnectionHealth';
import type { RoomRole } from './model';
import { describeError } from './model';
import { PeerJsRoomClientConnections } from './PeerJsRoomClientConnections';

export abstract class PeerJsRoomClientDataChannel extends PeerJsRoomClientConnections {

  protected override handleWebRtcConnectionState(connection: DataConnection, connectionRole: RoomRole): void {
    if (this.intentionalClose || this.intentionallyClosingConnections.has(connection)) return;
    if (!this.allConnections.has(connection) && !this.pendingConnectionPeerIds.has(connection.peer)) return;

    const peerConnection = connection.peerConnection;
    const connectionState = peerConnection?.connectionState;
    const iceState = peerConnection?.iceConnectionState;
    const assessment = assessWebRtcConnection(connectionState, iceState);
    if (assessment === 'connected') {
      this.clearConnectionRecoveryTimer(connection);
      return;
    }
    if (assessment === 'failed') {
      this.clearConnectionRecoveryTimer(connection);
      const error = new Error(`WebRTC path to '${connection.peer}' entered a terminal failed state (connection=${connectionState}, ICE=${iceState}).`);
      console.error('[PeerJS] WebRTC connection failed; closing only the affected room peer.', {
        peerId: connection.peer, connectionRole, connectionState, iceState, error
      });
      connection.close();
      return;
    }
    if (assessment === 'recovering') {
      this.scheduleConnectionRecoveryClose(connection, connectionRole);
      return;
    }
    // 'new'/'connecting' are expected during negotiation and ICE restarts; an unknown state is not a reason to kick.
  }

  /**
   * Transport callbacks are an isolation boundary. A protocol listener failure
   * must be visible and must close only the affected peer; it must never escape
   * PeerJS's event emitter and trigger the application's global fail-stop hook.
   */
  protected override dispatchDataMessage(message: PeerDataMessage, connection: DataConnection, connectionRole: RoomRole): void {
    for (const listener of [...this.dataListeners]) {
      try {
        listener(message);
      } catch (error) {
        const errorMessage = describeError(error);
        console.error(`[PeerJS transport] Protocol listener failed for '${message.type}' from peer '${connection.peer}': ${errorMessage}. Isolating the affected peer.`, {
          peerId: connection.peer,
          messageType: message.type,
          connectionRole,
          error
        });
        if (connection.open) connection.close();
        if (connectionRole === 'guest') {
          this.update({
            status: 'error',
            message: 'A room message could not be processed. Please rejoin the room.',
            peerConnected: false
          });
        }
        return;
      }
    }
  }

  /** A registered PeerJS object is live only while its direct WebRTC path is usable. */
  protected override isDirectConnectionLive(connection: DataConnection): boolean {
    if (!connection.open) return false;
    const peerConnectionState = connection.peerConnection?.connectionState;
    if (peerConnectionState === 'closed' || peerConnectionState === 'failed') return false;
    const dataChannel = (connection as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
    if (dataChannel && (dataChannel.readyState === 'closed' || dataChannel.readyState === 'closing')) return false;
    return true;
  }
}
