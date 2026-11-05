import type { PeerDataMessage } from '../transport';
import { isRoomChatMessage } from '../chat';
import { isRoomManagementStatus } from '../roomManagement';
import type { RoomRemovalNotice } from './model';
import { COMMAND_PROTOCOL_VERSION, STATE_SYNC_PROTOCOL_VERSION, notifyListeners } from './model';
import { RemoteGameClientPortProjection } from './RemoteGameClientPortProjection';

export abstract class RemoteGameClientPortMessageDispatch extends RemoteGameClientPortProjection {

  protected override onMessage(message: PeerDataMessage): void {
    if (message.type !== 'game-player-assigned' && typeof message.roomSessionId === 'string' &&
        this.announcedRoomSessionId !== null && message.roomSessionId !== this.announcedRoomSessionId) {
      // This is a delayed packet from a replaced host controller on a still-open
      // channel. It is intentionally isolated at room-session scope, not by world ID.
      const staleRoomSignature = `${message.roomSessionId}->${this.announcedRoomSessionId}`;
      if (staleRoomSignature !== this.lastDiscardedRoomSessionSignature) {
        console.debug('[multiplayer guest] Discarded packets from a retired room-controller session.', {
          type: message.type, receivedRoomSessionId: message.roomSessionId,
          activeRoomSessionId: this.announcedRoomSessionId
        });
        this.lastDiscardedRoomSessionSignature = staleRoomSignature;
      }
      return;
    }
    if (message.type === 'game-player-assigned') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || message.stateSyncProtocolVersion !== STATE_SYNC_PROTOCOL_VERSION ||
          typeof message.playerId !== 'string' || !message.playerId.trim() ||
          (message.worldId !== undefined && message.worldId !== null && (typeof message.worldId !== 'string' || !message.worldId.trim())) ||
          (message.roomSessionId !== undefined && (typeof message.roomSessionId !== 'string' || !message.roomSessionId.trim()))) {
        this.fail('Host sent a malformed multiplayer participant assignment.', message);
      }
      const incomingRoomSessionId = typeof message.roomSessionId === 'string' ? message.roomSessionId : null;
      if (incomingRoomSessionId && this.announcedRoomSessionId && incomingRoomSessionId !== this.announcedRoomSessionId) {
        // A new room-controller lifecycle is the only valid reason to reset room-level
        // sequence cursors while reusing an underlying WebRTC data connection.
        this.resetForRoomSessionChange(incomingRoomSessionId);
      } else if (incomingRoomSessionId) {
        this.announcedRoomSessionId = incomingRoomSessionId;
      }
      const assignedWorldId = typeof message.worldId === 'string' ? message.worldId : null;
      const previousWorldId = this.announcedWorldId ?? this.authoritativeFrame?.worldId ?? null;
      const worldChanged = assignedWorldId !== null && previousWorldId !== null && assignedWorldId !== previousWorldId;
      if (worldChanged && assignedWorldId !== null && this.retiredWorldIds.has(assignedWorldId)) {
        console.debug('[multiplayer guest] Ignored a stale participant assignment for a retired host world.', {
          receivedWorldId: assignedWorldId, activeWorldId: previousWorldId, playerId: message.playerId
        });
        return;
      }
      if (this.playerAssigned && this.playerId !== message.playerId && !worldChanged) {
        this.fail(`Host attempted to reassign this connection from '${this.playerId}' to '${message.playerId}'.`, message);
      }

      if (worldChanged) {
        this.beginAuthorityWorldChange(assignedWorldId, this.playerId, message.playerId);
      }
      if (assignedWorldId !== null) {
        this.announcedWorldId = assignedWorldId;
        this.awaitingAuthorityAnnouncement = false;
      } else if (this.announcedWorldId !== null || this.authoritativeFrame !== null ||
          this.pendingInitialStateForUnannouncedWorld !== null || this.awaitingAuthorityAnnouncement) {
        // A null world assignment is an explicit return to the persistent room,
        // not a malformed attempt to keep simulating the previous world.
        this.endActiveWorld('host-assigned-no-world');
      }
      this.playerId = message.playerId;
      this.playerAssigned = true;
      if (this.helloRetry) clearInterval(this.helloRetry);
      this.helloRetry = null;

      // Assignment is the explicit authority boundary. Accept a buffered frame
      // only when its world matches the identity the host just announced.
      if (assignedWorldId !== null && this.pendingInitialStateForUnannouncedWorld) {
        const pendingWorldId = this.pendingInitialStateForUnannouncedWorld.frame.worldId;
        if (pendingWorldId === assignedWorldId) {
          const pending = this.pendingInitialStateForUnannouncedWorld;
          this.pendingInitialStateForUnannouncedWorld = null;
          this.acceptFullState(pending);
        } else {
          console.debug('[multiplayer guest] Discarded a full-state candidate whose world was not confirmed by the latest assignment.', {
            pendingWorldId, assignedWorldId
          });
          this.pendingInitialStateForUnannouncedWorld = null;
          this.awaitingAuthorityAnnouncement = false;
          if (!worldChanged && this.authoritativeFrame?.worldId === assignedWorldId) {
            this.awaitingAuthorityBaseline = false;
          }
        }
      }
      if (this.pendingInitialStateBeforeAssignment) {
        const pending = this.pendingInitialStateBeforeAssignment;
        this.pendingInitialStateBeforeAssignment = null;
        if (assignedWorldId === null || pending.frame.worldId === assignedWorldId) {
          this.acceptFullState(pending);
        } else {
          console.debug('[multiplayer guest] Discarded a pre-assignment full state from a world the host did not announce.', {
            pendingWorldId: pending.frame.worldId, assignedWorldId
          });
        }
      }
      this.flushPendingDefeatNotice();
      return;
    }

    if (message.type === 'game-room-removed') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION ||
          typeof message.roomSessionId !== 'string' || !message.roomSessionId.trim() ||
          typeof message.removalId !== 'string' || message.removalId.length < 1 || message.removalId.length > 256 ||
          message.code !== 'HOST_REMOVED') {
        this.fail('The room host sent an invalid participant-removal notice.', message);
      }
      if (this.announcedRoomSessionId !== message.roomSessionId) {
        // A delayed notice for a previous room authority must not dismiss a player
        // from the room they have since joined.
        console.debug('[multiplayer guest] Ignored a removal notice for a previous room session.', {
          receivedRoomSessionId: message.roomSessionId,
          activeRoomSessionId: this.announcedRoomSessionId
        });
        return;
      }

      const removalId = message.removalId;
      const alreadyNotified = this.receivedRoomRemovalIds.has(removalId);
      if (!alreadyNotified) {
        this.receivedRoomRemovalIds.add(removalId);
        // Never display free-form host text from the wire. The code maps to a
        // fixed sentence so users see an explanation, not protocol internals.
        const notice: RoomRemovalNotice = {
          removalId,
          message: 'The host removed you from this room.'
        };
        for (const listener of [...this.roomRemovalListeners]) {
          try {
            listener(notice);
          } catch (error) {
            console.error('[multiplayer guest] The removal notice could not be displayed by one UI listener.', { error });
          }
        }
      }

      // ACK duplicate deliveries as well; a prior ACK may have been interrupted
      // even though the UI already showed the notice.
      const acknowledged = this.transport.sendData({
        type: 'game-room-removal-ack',
        protocolVersion: COMMAND_PROTOCOL_VERSION,
        roomSessionId: message.roomSessionId,
        removalId
      });
      if (!acknowledged) {
        console.warn('[multiplayer guest] Could not confirm the room-removal notice; the host will finish removal after its deadline.', {
          removalId
        });
      }
      return;
    }

    if (message.type === 'game-connection-error') {
      if (typeof message.code !== 'string' || typeof message.message !== 'string') {
        this.fail('Host sent a malformed connection-error message.', message);
      }
      this.updateConnectionHealth('degraded', `${message.code}: ${message.message}`);
      console.error('[multiplayer guest] Host rejected the connection handshake.', { code: message.code, message: message.message });
      return;
    }
    if (message.type === 'game-world-ended') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || typeof message.worldId !== 'string' || !message.worldId ||
          message.reason !== 'host-returned-to-room') {
        this.fail('Host sent a malformed world-ended event.', message);
      }
      if (this.announcedWorldId !== null && message.worldId !== this.announcedWorldId) {
        console.debug('[multiplayer guest] Ignored a world-ended event for a world that is no longer active.', {
          receivedWorldId: message.worldId, announcedWorldId: this.announcedWorldId
        });
        return;
      }
      this.endActiveWorld('host-ended-world');
      return;
    }

    if (message.type === 'game-room-status') {
      const statusRevision = message.statusRevision;
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || !isRoomManagementStatus(message.status) ||
          typeof statusRevision !== 'number' || !Number.isSafeInteger(statusRevision) || statusRevision < 0 ||
          typeof message.roomSessionId !== 'string' || !message.roomSessionId.trim()) {
        this.fail('Host sent a malformed room-management status.', message);
      }

      // The assignment, not a room-status packet, establishes which controller
      // owns this connection. This also prevents a late status from an old
      // React/controller lifecycle from becoming the guest's first room session.
      if (this.announcedRoomSessionId === null || message.roomSessionId !== this.announcedRoomSessionId) {
        const unassignedRoomSignature = `unassigned:${message.roomSessionId}`;
        if (unassignedRoomSignature !== this.lastDiscardedRoomSessionSignature) {
          console.debug('[multiplayer guest] Discarded room status until participant assignment establishes the room session.', {
            receivedRoomSessionId: message.roomSessionId,
            activeRoomSessionId: this.announcedRoomSessionId,
            phase: message.status.phase
          });
          this.lastDiscardedRoomSessionSignature = unassignedRoomSignature;
        }
        return;
      }

      const staleBySequence = statusRevision <= this.currentRoomStatusRevision;
      if (staleBySequence) {
        const outOfOrderSignature = `out-of-order:${message.roomSessionId}`;
        if (outOfOrderSignature !== this.lastDiscardedOutOfOrderStatusSignature) {
          console.debug('[multiplayer guest] Discarded out-of-order room status traffic.', {
            receivedStatusRevision: statusRevision, currentStatusRevision: this.currentRoomStatusRevision,
            receivedPhase: message.status.phase, receivedWorldId: message.status.worldId
          });
          this.lastDiscardedOutOfOrderStatusSignature = outOfOrderSignature;
        }
        return;
      }

      if (message.status.hasWorld && message.status.worldId !== this.announcedWorldId) {
        // A world-bearing status is both room control and a claim about the
        // currently announced world. Do not apply a mismatch or advance the
        // cursor: a valid status for the assigned world can still follow it.
        const signature = `${message.status.worldId}:${this.announcedWorldId}`;
        if (signature !== this.lastDiscardedStaleWorldStatusSignature) {
          console.debug('[multiplayer guest] Discarded room status for a previous or unannounced world.', {
            statusRevision, receivedWorldId: message.status.worldId,
            announcedWorldId: this.announcedWorldId, phase: message.status.phase
          });
          this.lastDiscardedStaleWorldStatusSignature = signature;
        }
        return;
      }

      if (!message.status.hasWorld && (this.announcedWorldId !== null || this.authoritativeFrame !== null ||
          this.pendingInitialStateForUnannouncedWorld !== null || this.awaitingAuthorityAnnouncement)) {
        this.endActiveWorld('room-status-no-world');
      }
      this.currentRoomStatusRevision = statusRevision;
      this.currentRoomStatus = message.status;
      notifyListeners('room-status', this.roomStatusListeners, message.status);
      return;
    }

    if (message.type === 'game-chat-broadcast') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || !isRoomChatMessage(message.message)) {
        this.fail('Host sent a malformed room-chat event.', message);
      }
      const chatMessage = message.message;
      if (this.receivedChatMessageIds.has(chatMessage.messageId)) return;
      this.receivedChatMessageIds.add(chatMessage.messageId);
      if (this.receivedChatMessageIds.size > 512) {
        const oldestId = this.receivedChatMessageIds.values().next().value as string | undefined;
        if (!oldestId) throw new Error('Chat-message deduplication set is non-empty but has no first key.');
        this.receivedChatMessageIds.delete(oldestId);
      }
      notifyListeners('room-chat', this.chatListeners, chatMessage);
      return;
    }
    if (message.type === 'game-chat-rejected') {
      if (typeof message.reason !== 'string' || !message.reason.trim()) this.fail('Host sent a malformed chat rejection.', message);
      console.warn('[multiplayer guest] Host rejected a chat message.', { reason: message.reason });
      return;
    }

    if (message.type === 'game-host-heartbeat') {
      this.acceptHostHeartbeat(message);
      return;
    }

    if (message.type === 'game-player-defeated') {
      this.acceptDefeatNoticeEnvelope(message);
      return;
    }

    if (message.type === 'game-initial-state') {
      this.acceptInitialStateEnvelope(message);
      return;
    }

    if (message.type === 'game-state-delta') {
      this.acceptDeltaEnvelope(message);
      return;
    }

    if (message.type === 'game-state-ack') {
      this.fail('A guest received a host-directed state acknowledgement; this message direction is invalid.', message);
    }

    if (message.type === 'game-player-defeated-ack' || message.type === 'game-client-heartbeat') {
      this.fail(`A guest received a guest-to-host control message '${message.type}'; this message direction is invalid.`, message);
    }

    if (message.type !== 'game-peer-left') {
      this.fail(`Unexpected multiplayer message from host: '${message.type}'.`, message);
    }
  }
}
