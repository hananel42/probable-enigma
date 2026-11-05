import type { DataConnection } from 'peerjs';
import { assessWebRtcConnection } from '../webRtcConnectionHealth';
import type { PeerSendFailureState, RoomRole } from './model';
import { DATA_PATH_RECOVERY_GRACE_MS, SEND_FAILURE_LOG_INTERVAL_MS } from './model';
import { PeerJsRoomClientDataChannel } from './PeerJsRoomClientDataChannel';

export abstract class PeerJsRoomClientRecovery extends PeerJsRoomClientDataChannel {

  /** Keep each peer's send attempts observable without flooding logs at 30 Hz. */
  protected override reportSendFailure(peerId: string, messageType: string, lastError: string): void {
    const nowMs = Date.now();
    const failureKey = `${peerId}:${messageType}`;
    const previous = this.reportedSendFailures.get(failureKey);
    const state: PeerSendFailureState = {
      attempts: (previous?.attempts ?? 0) + 1,
      lastLoggedAtMs: previous?.lastLoggedAtMs ?? 0,
      lastError
    };
    if (nowMs - state.lastLoggedAtMs >= SEND_FAILURE_LOG_INTERVAL_MS) {
      console.error('[PeerJS transport] Direct-peer send failed; the affected peer will be retried and diagnostics are rate-limited.', {
        peerId, messageType, attempts: state.attempts, lastError,
        registered: this.connections.has(peerId), connectionOpen: this.connections.get(peerId)?.open ?? false,
        connectionState: this.connections.get(peerId)?.peerConnection?.connectionState
      });
      state.lastLoggedAtMs = nowMs;
    }
    this.reportedSendFailures.set(failureKey, state);
  }

  protected override clearPeerSendFailures(peerId: string): void {
    for (const key of this.reportedSendFailures.keys()) {
      if (key.startsWith(`${peerId}:`)) this.reportedSendFailures.delete(key);
    }
  }

  protected override scheduleConnectionRecoveryClose(connection: DataConnection, connectionRole: RoomRole): void {
    if (this.connectionRecoveryTimers.has(connection) || this.intentionalClose || this.intentionallyClosingConnections.has(connection)) return;
    const connectionState = connection.peerConnection?.connectionState;
    const iceState = connection.peerConnection?.iceConnectionState;
    console.warn('[PeerJS] WebRTC path is temporarily disconnected; waiting for ICE recovery before ending the room connection.', {
      peerId: connection.peer, connectionRole, connectionState, iceState, graceMs: DATA_PATH_RECOVERY_GRACE_MS
    });
    const timer = window.setTimeout(() => {
      this.connectionRecoveryTimers.delete(connection);
      if (this.intentionalClose || this.intentionallyClosingConnections.has(connection)) return;
      const currentConnectionState = connection.peerConnection?.connectionState;
      const currentIceState = connection.peerConnection?.iceConnectionState;
      const assessment = assessWebRtcConnection(currentConnectionState, currentIceState);
      if (assessment === 'connected' || assessment === 'connecting' || assessment === 'unknown') return;
      if (assessment === 'failed' || assessment === 'recovering') {
        const error = new Error(`WebRTC path to '${connection.peer}' did not recover within ${DATA_PATH_RECOVERY_GRACE_MS} ms (connection=${currentConnectionState}, ICE=${currentIceState}).`);
        console.error('[PeerJS] Closing a WebRTC peer after the recovery grace period expired.', {
          peerId: connection.peer, connectionRole, connectionState: currentConnectionState, iceState: currentIceState, error
        });
        connection.close();
      }
    }, DATA_PATH_RECOVERY_GRACE_MS);
    this.connectionRecoveryTimers.set(connection, timer);
  }

  protected override clearConnectionRecoveryTimer(connection: DataConnection): void {
    const timer = this.connectionRecoveryTimers.get(connection);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.connectionRecoveryTimers.delete(connection);
  }
}
