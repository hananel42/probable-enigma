import type { PendingRoomRemoval } from './model';
import { HostRoomChatHeartbeat } from './HostRoomChatHeartbeat';

export abstract class HostRoomPeerCleanup extends HostRoomChatHeartbeat {

  /** Complete a pending kick once the guest acknowledges or the deadline expires. */
  protected override finishPendingRoomRemoval(peerId: string, pending: PendingRoomRemoval, reason: string, reportRuntimeError = true): unknown | null {
    if (this.pendingRoomRemovalsByPeer.get(peerId) !== pending) return null;
    this.pendingRoomRemovalsByPeer.delete(peerId);
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;

    try {
      this.removePeer(peerId, reason, true);
      return null;
    } catch (error) {
      console.error('[multiplayer host] The participant was removed, but cleanup reported an issue.', {
        peerId, playerId: pending.playerId, reason, removalId: pending.removalId, error
      });
      if (reportRuntimeError) this.onRuntimeError?.(`peer-cleanup:${reason}`, error);
      return error;
    }
  }

  protected override removePeer(peerId: string, reason: string, closeConnection: boolean, publishRoomStatus = true): void {
    const pendingRemoval = this.pendingRoomRemovalsByPeer.get(peerId);
    if (pendingRemoval) {
      this.pendingRoomRemovalsByPeer.delete(peerId);
      if (pendingRemoval.timer !== null) clearTimeout(pendingRemoval.timer);
      pendingRemoval.timer = null;
    }
    const cleanupErrors: unknown[] = [];
    const mappedPlayerId = this.playerByPeer.get(peerId);
    const replication = this.replicationByPeer.get(peerId);
    const replicationPlayerId = replication?.playerId;
    const knownPlayerIds = new Set([mappedPlayerId, replicationPlayerId].filter((id): id is string => Boolean(id)));
    const hasBookkeeping = mappedPlayerId !== undefined || this.displayNameByPeer.has(peerId) ||
      this.lastSequenceByPeer.has(peerId) || replication !== undefined || this.roomStatusByPeer.has(peerId);

    const reportInvariant = (message: string, stage: string, playerId?: string): void => {
      const error = new Error(message);
      cleanupErrors.push(error);
      console.error('[multiplayer host] Peer lifecycle invariant failed; continuing complete cleanup.', {
        peerId, playerId, reason, stage, mappedPlayerId, replicationPlayerId, error
      });
    };

    if (mappedPlayerId && replicationPlayerId && mappedPlayerId !== replicationPlayerId) {
      reportInvariant('Participant and replication maps disagree about the player assigned to this peer.', 'validate-bookkeeping');
    } else if (mappedPlayerId && !replicationPlayerId) {
      reportInvariant('Participant map contains a peer without replication state.', 'validate-bookkeeping', mappedPlayerId);
    } else if (!mappedPlayerId && replicationPlayerId) {
      reportInvariant('Replication state exists without a participant-to-peer mapping.', 'validate-bookkeeping', replicationPlayerId);
    } else if (!mappedPlayerId && !replicationPlayerId && hasBookkeeping) {
      reportInvariant('Peer bookkeeping exists without any associated participant ID.', 'validate-bookkeeping');
    } else if (!hasBookkeeping) {
      // Duplicate close/heartbeat events are normal. Still run transport close
      // below when requested, since the adapter may retain a stale direct channel.
      console.info('[multiplayer host] Duplicate peer cleanup found no room bookkeeping; confirming transport state.', { peerId, reason });
    }

    // Recover the player ID from either map and remove every unique participant
    // represented by this peer, even if one of the maps was pruned prematurely.
    for (const playerId of knownPlayerIds) {
      try {
        const removed = this.hasWorld ? this.server.removeHumanParticipant(playerId) : true;
        if (!removed) {
          reportInvariant(`Peer '${peerId}' referenced participant '${playerId}', but the authoritative world refused participant removal.`, 'remove-authoritative-participant', playerId);
        } else {
          console.info('[multiplayer host] Removed disconnected participant and active assets.', { peerId, playerId, reason });
        }
      } catch (error) {
        cleanupErrors.push(error);
        console.error('[multiplayer host] Authoritative participant removal threw; transport and bookkeeping cleanup will still run.', {
          peerId, playerId, reason, stage: 'remove-authoritative-participant', error
        });
      }
    }

    // Bookkeeping is always reconciled, even when the maps disagree or the engine
    // refused a removal. No stale map entry may poison later publication ticks.
    this.playerByPeer.delete(peerId);
    this.displayNameByPeer.delete(peerId);
    this.lastSequenceByPeer.delete(peerId);
    this.replicationByPeer.delete(peerId);
    this.roomStatusByPeer.delete(peerId);
    for (const key of this.transportFailureByContext.keys()) {
      if (key.startsWith(`${peerId}:`)) this.transportFailureByContext.delete(key);
    }

    if (closeConnection) {
      if (!this.transport.closePeer) {
        const error = new Error('Transport does not implement closePeer; stale peer connection cannot be explicitly reconciled.');
        cleanupErrors.push(error);
        console.error('[multiplayer host] Room bookkeeping was removed, but transport cleanup is unsupported.', {
          peerId, playerId: mappedPlayerId ?? replicationPlayerId, reason, stage: 'close-transport-peer', error
        });
      } else {
        try {
          // Always call closePeer, even when hasPeerConnection() is false. The
          // adapter may still retain a closed DataConnection or pending attempt.
          const closed = this.transport.closePeer(peerId, reason);
          if (!closed) {
            if (this.transport.hasPeerConnection && !this.transport.hasPeerConnection(peerId)) {
              console.info('[multiplayer host] Peer transport was already absent or closed concurrently; cleanup is complete.', {
                peerId, playerId: mappedPlayerId ?? replicationPlayerId, reason, stage: 'close-transport-peer'
              });
            } else {
              const error = new Error(`Transport refused to close or confirm absence of peer '${peerId}'.`);
              cleanupErrors.push(error);
              console.error('[multiplayer host] Room bookkeeping was removed, but transport refused to reconcile the peer connection.', {
                peerId, playerId: mappedPlayerId ?? replicationPlayerId, reason, stage: 'close-transport-peer', error
              });
            }
          }
        } catch (error) {
          cleanupErrors.push(error);
          console.error('[multiplayer host] Transport threw while reconciling a removed peer.', {
            peerId, playerId: mappedPlayerId ?? replicationPlayerId, reason, stage: 'close-transport-peer', error
          });
        }
      }
    }

    if (publishRoomStatus) this.broadcastRoomStatus(true);
    if (cleanupErrors.length > 0) {
      const error = new AggregateError(cleanupErrors, `Cleanup for peer '${peerId}' completed with errors.`);
      this.onRuntimeError?.(`peer-cleanup:${reason}`, error);
      throw error;
    }
  }

  /**
   * Cleanup from a periodic callback must not leak a rejection into window-level
   * handlers. Errors are logged and surfaced to the room UI, while other peers
   * continue processing on the next publication tick.
   */
  protected override removePeerDuringPublication(peerId: string, reason: string, closeConnection: boolean): void {
    try {
      this.removePeer(peerId, reason, closeConnection, false);
    } catch (error) {
      console.error('[multiplayer host] Peer cleanup failed during the publication tick; remaining peers will still be processed.', {
        peerId, reason, error
      });
      this.onRuntimeError?.(`peer-cleanup:${reason}`, error);
    }
    this.broadcastRoomStatus(true);
  }

  /** Reconcile room membership with the transport's authoritative live-connection registry. */
  protected override pruneMissingTransportPeers(nowMs: number): void {
    if (!this.transport.hasPeerConnection) return;
    const registeredPeerIds = new Set([
      ...this.playerByPeer.keys(),
      ...this.displayNameByPeer.keys(),
      ...this.lastSequenceByPeer.keys(),
      ...this.replicationByPeer.keys(),
      ...this.roomStatusByPeer.keys()
    ]);
    const missingPeerIds = [...registeredPeerIds].filter(peerId => !this.transport.hasPeerConnection!(peerId));
    if (missingPeerIds.length === 0) return;

    for (const peerId of missingPeerIds) {
      console.warn('[multiplayer host] Removing a stale participant whose direct transport connection is no longer registered.', {
        peerId, playerId: this.playerByPeer.get(peerId), detectedAtMs: nowMs
      });
      try {
        this.removePeerDuringPublication(peerId, 'transport-connection-missing', true);
      } catch (error) {
        console.error('[multiplayer host] Stale participant cleanup failed; other peers will be preserved.', { peerId, error });
        this.onRuntimeError?.('stale-peer-cleanup', error);
      }
    }
    this.broadcastRoomStatus(true, nowMs);
  }
}
