import type { PeerDataMessage } from '../transport';
import type { PeerTransportFailureState } from './model';
import { ROOM_STATUS_FAILURE_LOG_INTERVAL_MS } from './model';
import { HostRoomPeerCleanup } from './HostRoomPeerCleanup';

export abstract class HostRoomTransport extends HostRoomPeerCleanup {

  /**
   * Isolate transport exceptions per message/peer. A WebRTC race or adapter bug
   * must be visible in the console and UI, but must not abort the host's entire
   * publication tick or prevent messages for the remaining room members.
   */
  protected override tryQueueTransportMessage(message: PeerDataMessage, peerId: string | undefined, context: string): boolean {
    try {
      const queued = this.transport.sendData(message, peerId);
      if (peerId) {
        if (queued) {
          this.transportFailureByContext.delete(`${peerId}:${context}`);
        } else {
          this.reportTransportQueueFailure(peerId, context, message.type, undefined);
        }
      }
      return queued;
    } catch (error) {
      if (peerId) {
        const shouldNotifyRuntime = this.reportTransportQueueFailure(peerId, context, message.type, error);
        if (shouldNotifyRuntime) this.onRuntimeError?.(`transport-send:${context}`, error);
      } else {
        console.error('[multiplayer host] Broadcast transport send threw; delivery will be retried for active peers.', {
          context, type: message.type, error
        });
      }
      return false;
    }
  }

  /** Retry a failed peer send while rate-limiting repeated diagnostics for that message path. */
  protected override reportTransportQueueFailure(
    peerId: string,
    context: string,
    messageType: string,
    error: unknown,
    extraDetails: Record<string, unknown> = {}
  ): boolean {
    const nowMs = Date.now();
    const key = `${peerId}:${context}`;
    const previous = this.transportFailureByContext.get(key);
    const failure: PeerTransportFailureState = {
      retryCount: (previous?.retryCount ?? 0) + 1,
      lastLoggedAtMs: previous?.lastLoggedAtMs ?? 0,
      lastContext: context,
      lastMessageType: messageType,
      lastError: error instanceof Error
        ? `${error.name}: ${error.message}`
        : error === undefined
          ? previous?.lastError ?? null
          : String(error)
    };
    let logged = false;
    if (nowMs - failure.lastLoggedAtMs >= ROOM_STATUS_FAILURE_LOG_INTERVAL_MS) {
      const details = {
        peerId,
        playerId: this.playerByPeer.get(peerId) ?? this.replicationByPeer.get(peerId)?.playerId,
        context: failure.lastContext,
        messageType: failure.lastMessageType,
        retryCount: failure.retryCount,
        lastError: failure.lastError,
        hasRegisteredTransport: this.transport.hasPeerConnection?.(peerId) ?? 'unknown',
        ...extraDetails
      };
      if (error !== undefined) {
        console.error('[multiplayer host] Direct-peer send failed; retry is retained and diagnostics are rate-limited.', { ...details, error });
      } else {
        console.warn('[multiplayer host] Direct-peer send was not queued; retry is retained and diagnostics are rate-limited.', details);
      }
      failure.lastLoggedAtMs = nowMs;
      logged = true;
    }
    this.transportFailureByContext.set(key, failure);
    return logged;
  }
}
