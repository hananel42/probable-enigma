import { isValidGameCommand } from '../../server/protocol';
import type { PeerDataMessage } from '../transport';
import { createRandomRobotName, normalizeDisplayName } from '../displayName';
import { COMMAND_PROTOCOL_VERSION, COMMAND_RATE_WINDOW_MS, MAX_COMMANDS_PER_PEER_PER_WINDOW, RESYNC_REQUEST_MIN_INTERVAL_MS, STATE_SYNC_PROTOCOL_VERSION } from './model';
import { HostRoomReplication } from './HostRoomReplication';

export abstract class HostRoomMessageDispatch extends HostRoomReplication {

  protected override handleMessage(message: PeerDataMessage): void {
    const peerId = typeof message.senderPeerId === 'string' ? message.senderPeerId : '';
    if (!peerId) {
      console.error('[multiplayer host] Rejected peer message without a transport-assigned peer ID.', message);
      return;
    }

    if (message.type === 'game-peer-left') {
      try {
        this.removePeer(peerId, 'peer-closed', false);
      } catch (error) {
        // This is a transport callback boundary. Cleanup has already reconciled
        // the maps; diagnostics stay visible without escaping into the emitter.
        console.error('[multiplayer host] Peer-close cleanup completed with diagnostics; the room callback remains live.', {
          peerId, playerId: this.playerByPeer.get(peerId) ?? this.replicationByPeer.get(peerId)?.playerId,
          reason: 'peer-closed', stage: 'transport-close-event', error
        });
        this.onRuntimeError?.('peer-cleanup:peer-closed', error);
      }
      return;
    }

    // While a kick is awaiting acknowledgement, the peer may only acknowledge
    // that notice. Do not accept new gameplay/chat traffic during removal.
    if (this.pendingRoomRemovalsByPeer.has(peerId) && message.type !== 'game-room-removal-ack') {
      console.debug('[multiplayer host] Ignored room traffic from a participant whose removal is already in progress.', {
        peerId, type: message.type
      });
      return;
    }

    if (message.type === 'game-hello') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || message.stateSyncProtocolVersion !== STATE_SYNC_PROTOCOL_VERSION) {
        console.error('[multiplayer host] Rejected hello with an unsupported command or state-sync protocol version.', {
          peerId, protocolVersion: message.protocolVersion, stateSyncProtocolVersion: message.stateSyncProtocolVersion
        });
        return;
      }
      let incomingName: string;
      try {
        incomingName = typeof message.displayName === 'string'
          ? normalizeDisplayName(message.displayName)
          : createRandomRobotName();
      } catch (error) {
        console.error('[multiplayer host] Rejected hello with an invalid player display name.', { peerId, displayName: message.displayName, error });
        this.tryQueueTransportMessage({ type: 'game-connection-error', protocolVersion: COMMAND_PROTOCOL_VERSION, roomSessionId: this.roomSessionId,
          code: 'INVALID_DISPLAY_NAME', message: 'Choose a name between 1 and 24 characters using letters, numbers, spaces, underscores, apostrophes, or hyphens.' }, peerId, 'invalid-display-name-rejection');
        // The handshake has not registered this peer in playerByPeer yet, so
        // removePeer would be a no-op and leak the transport connection.
        if (!this.transport.closePeer) {
          throw new Error(`Cannot reject peer '${peerId}' with an invalid display name: the transport does not implement closePeer.`);
        }
        if (!this.transport.closePeer(peerId, 'invalid-display-name')) {
          throw new Error(`Transport refused to close peer '${peerId}' after invalid display-name validation.`);
        }
        return;
      }
      const clientSessionId = message.clientSessionId;
      if (typeof clientSessionId !== 'string' || clientSessionId.length < 1 || clientSessionId.length > 128) {
        console.error('[multiplayer host] Rejected hello without a valid client-session token.', {
          peerId, clientSessionId
        });
        return;
      }
      let peer = this.replicationByPeer.get(peerId);
      if (!peer && this.roomPhase === 'results') {
        const error = new Error('The match has ended. The host must create a new lobby before new players can join.');
        this.tryQueueTransportMessage({ type: 'game-connection-error', protocolVersion: COMMAND_PROTOCOL_VERSION, roomSessionId: this.roomSessionId, code: 'MATCH_FINISHED', message: error.message }, peerId, 'match-finished-rejection');
        if (!this.transport.closePeer) throw new Error(`Cannot reject late joiner '${peerId}': transport has no closePeer implementation.`);
        if (!this.transport.closePeer(peerId, 'match-finished')) throw new Error(`Transport refused to close late joiner '${peerId}' after match completion.`);
        console.warn('[multiplayer host] Rejected a room join after results had been finalized.', { peerId });
        return;
      }
      if (!peer) {
        const playerId = `guest-player-${this.nextGuestSerial++}`;
        if (this.hasWorld) {
          this.server.addHumanParticipant(playerId, this.mode);
          this.server.setHumanParticipantDisplayName(playerId, incomingName);
        }
        this.playerByPeer.set(peerId, playerId);
        this.displayNameByPeer.set(peerId, incomingName);
        this.lastSequenceByPeer.set(peerId, 0);
        peer = {
          playerId,
          clientSessionId,
          assignmentQueued: false,
          baseline: null,
          pendingFullStateFrame: null,
          lastAcknowledgedRevision: -1,
          lastAcknowledgedAtMs: Date.now(),
          waitingFullStateAckRevision: null,
          lastFullStateSentAtMs: 0,
          fullStateAttempts: 0,
          lastResyncRequestAtMs: 0,
          needsFullState: true,
          lastHeardAtMs: Date.now(),
          lastRoundTripAtMs: Date.now(),
          lastHeartbeatSequence: 0,
          lastHeartbeatReplySequence: 0,
          lastAcknowledgedHostSequence: 0,
          lastHeartbeatReplyAtMs: 0,
          commandRateWindowStartedAtMs: Date.now(),
          commandsInRateWindow: 0,
          chatWindowStartedAtMs: Date.now(),
          chatMessagesInWindow: 0,
          defeatNotification: null,
          defeatAcknowledged: false,
          lastDefeatNoticeSentAtMs: 0
        };
        this.replicationByPeer.set(peerId, peer);
        this.onGuestJoined?.(playerId);
      } else {
        this.displayNameByPeer.set(peerId, incomingName);
        if (this.hasWorld) this.server.setHumanParticipantDisplayName(peer.playerId, incomingName);
        const nowMs = Date.now();
        peer.lastHeardAtMs = nowMs;
        if (clientSessionId !== peer.clientSessionId) {
          const previousSessionId = peer.clientSessionId;
          peer.clientSessionId = clientSessionId;
          // A new RemoteGameClientPort can replace the old listener while its
          // PeerJS DataConnection remains open. Reset per-client sequence and
          // replication cursors so the new instance receives a fresh baseline
          // and its commands/heartbeats are not rejected as stale.
          this.lastSequenceByPeer.set(peerId, 0);
          peer.baseline = null;
          peer.pendingFullStateFrame = null;
          peer.lastAcknowledgedRevision = -1;
          peer.lastAcknowledgedAtMs = nowMs;
          peer.waitingFullStateAckRevision = null;
          peer.lastFullStateSentAtMs = 0;
          peer.fullStateAttempts = 0;
          peer.lastResyncRequestAtMs = 0;
          peer.needsFullState = true;
          peer.lastHeartbeatSequence = 0;
          peer.lastHeartbeatReplySequence = 0;
          peer.lastAcknowledgedHostSequence = 0;
          peer.lastHeartbeatReplyAtMs = 0;
          peer.lastRoundTripAtMs = nowMs;
          if (peer.defeatNotification) {
            peer.defeatAcknowledged = false;
            peer.lastDefeatNoticeSentAtMs = 0;
          }
          console.info('[multiplayer host] Detected a new guest client lifecycle on an existing peer connection; refreshing its handshake and state baseline.', {
            peerId, playerId: peer.playerId, previousSessionId, clientSessionId
          });
        }
      }
      this.sendParticipantAssignment(peerId, peer);
      if (this.hasWorld && peer.assignmentQueued && (peer.needsFullState || peer.baseline === null)) {
        this.sendFullState(peerId, peer, this.server.captureWorldFrame(), Date.now());
      }
      this.sendRoomStatusToPeer(peerId, Date.now());
      return;
    }

    if (typeof message.roomSessionId === 'string' && message.roomSessionId !== this.roomSessionId) {
      console.debug('[multiplayer host] Discarded a delayed control packet from a retired room-controller session.', {
        peerId, type: message.type, receivedRoomSessionId: message.roomSessionId,
        activeRoomSessionId: this.roomSessionId
      });
      return;
    }

    if (message.type === 'game-room-removal-ack') {
      if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION ||
          typeof message.roomSessionId !== 'string' || message.roomSessionId !== this.roomSessionId ||
          typeof message.removalId !== 'string' || message.removalId.length < 1 || message.removalId.length > 256) {
        console.warn('[multiplayer host] Ignored an invalid room-removal acknowledgement.', { peerId });
        return;
      }
      const pending = this.pendingRoomRemovalsByPeer.get(peerId);
      if (!pending || pending.removalId !== message.removalId) {
        console.debug('[multiplayer host] Ignored a stale room-removal acknowledgement.', {
          peerId, receivedRemovalId: message.removalId, expectedRemovalId: pending?.removalId ?? null
        });
        return;
      }
      this.finishPendingRoomRemoval(peerId, pending, 'host-kicked');
      return;
    }

    if (message.type === 'game-chat-send') {
      this.acceptGuestChat(peerId, message);
      return;
    }

    if (message.type === 'game-client-heartbeat') {
      this.acceptClientHeartbeat(peerId, message);
      return;
    }

    if (message.type === 'game-player-defeated-ack') {
      this.acceptDefeatAcknowledgement(peerId, message);
      return;
    }

    if (message.type === 'game-state-ack') {
      this.acceptStateAcknowledgement(peerId, message);
      return;
    }

    if (message.type === 'game-resync-request') {
      if (!this.hasWorld) return;
      const peer = this.replicationByPeer.get(peerId);
      if (!peer) {
        console.error('[multiplayer host] Rejected a resync request from an unregistered peer.', { peerId, message });
        return;
      }
      if (message.protocolVersion !== STATE_SYNC_PROTOCOL_VERSION ||
          (message.worldId !== undefined && message.worldId !== this.server.worldId) ||
          (message.reason !== undefined && typeof message.reason !== 'string')) {
        console.error('[multiplayer host] Rejected malformed or cross-world state-resync request.', { peerId, message });
        return;
      }
      const resyncRequestedAtMs = Date.now();
      if (resyncRequestedAtMs - peer.lastResyncRequestAtMs < RESYNC_REQUEST_MIN_INTERVAL_MS) {
        console.warn('[multiplayer host] Rate-limited repeated full-state resync requests from the same guest.', { peerId, playerId: peer.playerId });
        return;
      }
      peer.lastResyncRequestAtMs = resyncRequestedAtMs;
      peer.lastHeardAtMs = resyncRequestedAtMs;
      const alreadySynchronizing = peer.needsFullState || peer.waitingFullStateAckRevision !== null;
      console.warn('[multiplayer host] Guest requested an authoritative full-state resync.', {
        peerId, playerId: peer.playerId, reason: message.reason,
        expectedRevision: message.expectedRevision, receivedBaseRevision: message.receivedBaseRevision
      });
      peer.needsFullState = true;
      peer.pendingFullStateFrame = null;
      peer.waitingFullStateAckRevision = null;
      peer.lastFullStateSentAtMs = 0;
      if (!alreadySynchronizing) peer.fullStateAttempts = 0;
      this.sendFullState(peerId, peer, this.server.captureWorldFrame(), resyncRequestedAtMs);
      return;
    }

    if (message.type !== 'game-command') {
      console.error('[multiplayer host] Rejected unsupported peer message type.', { peerId, type: message.type, message });
      return;
    }
    if (!this.hasWorld || this.roomPhase !== 'playing') {
      console.warn('[multiplayer host] Ignored a gameplay command while no world is actively running.', {
        peerId, phase: this.roomPhase, hasWorld: this.hasWorld, commandType: message.command && typeof message.command === 'object' ? (message.command as { type?: unknown }).type : undefined
      });
      return;
    }
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION) {
      console.error('[multiplayer host] Rejected command with an unsupported protocol version.', { peerId, protocolVersion: message.protocolVersion });
      return;
    }
    const playerId = this.playerByPeer.get(peerId);
    if (!playerId) {
      console.error('[multiplayer host] Rejected a command from a peer before participant assignment.', { peerId, message });
      return;
    }
    const rawSequence = message.sequence;
    if (typeof rawSequence !== 'number' || !Number.isSafeInteger(rawSequence)) {
      console.error('[multiplayer host] Rejected command with an invalid sequence number.', { peerId, sequence: rawSequence });
      return;
    }
    const sequence = rawSequence;
    const lastSequence = this.lastSequenceByPeer.get(peerId);
    if (lastSequence === undefined) throw new Error(`Multiplayer sequence state is missing for registered peer '${peerId}'.`);
    if (sequence <= lastSequence) {
      console.error('[multiplayer host] Rejected duplicate or out-of-order command.', { peerId, sequence, lastSequence });
      return;
    }
    const currentRevision = this.server.getWorldFrame().revision;
    const observedRevision = message.observedRevision;
    if (typeof observedRevision !== 'number' || !Number.isSafeInteger(observedRevision) ||
        observedRevision < 0 || observedRevision > currentRevision) {
      console.error('[multiplayer host] Rejected command with an invalid observed world revision.', { peerId, observedRevision, currentRevision });
      return;
    }
    const command = message.command;
    if (!isValidGameCommand(command)) {
      console.error('[multiplayer host] Rejected malformed game command.', { peerId, sequence, command });
      return;
    }
    const peer = this.replicationByPeer.get(peerId);
    if (!peer) throw new Error(`Replication state is missing for registered peer '${peerId}'.`);
    const nowMs = Date.now();
    if (nowMs - peer.commandRateWindowStartedAtMs >= COMMAND_RATE_WINDOW_MS) {
      peer.commandRateWindowStartedAtMs = nowMs;
      peer.commandsInRateWindow = 0;
    }
    peer.commandsInRateWindow += 1;
    if (peer.commandsInRateWindow > MAX_COMMANDS_PER_PEER_PER_WINDOW) {
      const error = new Error(`Guest exceeded the command budget of ${MAX_COMMANDS_PER_PEER_PER_WINDOW} commands per ${COMMAND_RATE_WINDOW_MS} ms.`);
      console.error('[multiplayer host] Disconnecting a guest that exceeded the command-rate budget.', {
        peerId, playerId, sequence, commandsInWindow: peer.commandsInRateWindow, error
      });
      this.removePeer(peerId, 'command-rate-limit', true);
      return;
    }
    this.lastSequenceByPeer.set(peerId, sequence);
    peer.lastHeardAtMs = nowMs;
    this.server.dispatchForPlayer(playerId, command);
  }
}
