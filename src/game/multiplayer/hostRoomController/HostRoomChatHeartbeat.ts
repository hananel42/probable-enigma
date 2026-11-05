import type { GameWorldFrame } from '../../server/protocol';
import type { PeerDataMessage } from '../transport';
import { normalizeChatText } from '../chat';
import type { RoomChatMessage } from '../chat';
import { normalizeDisplayName } from '../displayName';
import type { PeerReplicationState } from './model';
import { CHAT_RATE_WINDOW_MS, COMMAND_PROTOCOL_VERSION, DEFEAT_NOTICE_RETRY_MS, HEARTBEAT_REPLY_MIN_INTERVAL_MS, MAX_CHAT_MESSAGES_PER_WINDOW, STATE_SYNC_PROTOCOL_VERSION } from './model';
import { HostRoomMessageDispatch } from './HostRoomMessageDispatch';

export abstract class HostRoomChatHeartbeat extends HostRoomMessageDispatch {

  /** Host chat uses the same canonical broadcast path as guest messages. */
  public override sendHostChat(rawText: string): RoomChatMessage {
    const text = normalizeChatText(rawText);
    const host = this.server.getSnapshot().humanPlayers.find(participant => participant.playerId === 'player-host');
    if (!host) throw new Error('Cannot send room chat because the host participant is missing.');
    return this.publishChatMessage(host.playerId, normalizeDisplayName(this.hostDisplayName || host.displayName), text);
  }

  protected override acceptGuestChat(peerId: string, message: PeerDataMessage): void {
    const peer = this.replicationByPeer.get(peerId);
    if (!peer || this.playerByPeer.get(peerId) !== peer.playerId) {
      console.error('[multiplayer host] Rejected room chat from an unregistered peer.', { peerId, message });
      return;
    }
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || typeof message.text !== 'string') {
      console.error('[multiplayer host] Rejected malformed room-chat message.', { peerId, message });
      return;
    }
    let text: string;
    try {
      text = normalizeChatText(message.text);
    } catch (error) {
      console.error('[multiplayer host] Rejected empty, invalid, or oversized chat text.', { peerId, playerId: peer.playerId, error });
      return;
    }
    const nowMs = Date.now();
    if (nowMs - peer.chatWindowStartedAtMs >= CHAT_RATE_WINDOW_MS) {
      peer.chatWindowStartedAtMs = nowMs;
      peer.chatMessagesInWindow = 0;
    }
    peer.chatMessagesInWindow += 1;
    if (peer.chatMessagesInWindow > MAX_CHAT_MESSAGES_PER_WINDOW) {
      console.warn('[multiplayer host] Rate-limited a guest sending excessive chat messages.', { peerId, playerId: peer.playerId, windowMessages: peer.chatMessagesInWindow });
      this.tryQueueTransportMessage({ type: 'game-chat-rejected', protocolVersion: COMMAND_PROTOCOL_VERSION, roomSessionId: this.roomSessionId, reason: 'You are sending messages too quickly.' }, peerId, 'chat-rate-limit-rejection');
      return;
    }
    const senderName = this.displayNameByPeer.get(peerId);
    if (!senderName) throw new Error(`Chat sender '${peer.playerId}' is registered but missing from the room roster.`);
    this.publishChatMessage(peer.playerId, normalizeDisplayName(senderName), text);
  }

  protected override publishChatMessage(senderPlayerId: string, senderName: string, text: string): RoomChatMessage {
    const message: RoomChatMessage = {
      messageId: `${this.roomSessionId}:chat:${this.nextChatMessageSerial++}`,
      senderPlayerId,
      senderName,
      text,
      sentAtMs: Date.now()
    };
    // Local HUD is updated directly; network broadcast sends only the canonical,
    // host-validated identity and text to guests.
    this.onChatMessage?.(message);
    if (this.replicationByPeer.size > 0) {
      const sent = this.tryQueueTransportMessage({
        type: 'game-chat-broadcast', protocolVersion: COMMAND_PROTOCOL_VERSION,
        roomSessionId: this.roomSessionId, message
      }, undefined, 'room-chat-broadcast');
      if (!sent) console.error('[multiplayer host] Room chat broadcast could not be queued for every connected guest.', { messageId: message.messageId });
    }
    return message;
  }

  protected override acceptClientHeartbeat(peerId: string, message: PeerDataMessage): void {
    const peer = this.replicationByPeer.get(peerId);
    if (!peer) {
      console.error('[multiplayer host] Rejected a heartbeat from an unregistered peer.', { peerId, message });
      return;
    }
    if (typeof message.roomSessionId === 'string' && message.roomSessionId !== this.roomSessionId) {
      console.debug('[multiplayer host] Ignored heartbeat from a retired room-controller session.', {
        peerId, receivedRoomSessionId: message.roomSessionId, activeRoomSessionId: this.roomSessionId
      });
      return;
    }
    const sequence = message.sequence;
    const acknowledgedHostSequence = message.lastHostSequence;
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION ||
        typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1 ||
        typeof acknowledgedHostSequence !== 'number' || !Number.isSafeInteger(acknowledgedHostSequence) || acknowledgedHostSequence < 0 ||
        typeof message.clientSessionId !== 'string' || message.clientSessionId.length < 1 || message.clientSessionId.length > 128) {
      console.error('[multiplayer host] Rejected malformed client heartbeat.', { peerId, message });
      return;
    }
    if (message.clientSessionId !== peer.clientSessionId) {
      console.warn('[multiplayer host] Ignored a heartbeat from a stale guest client lifecycle.', {
        peerId, playerId: peer.playerId,
        receivedSessionId: message.clientSessionId,
        currentSessionId: peer.clientSessionId,
        sequence: message.sequence
      });
      return;
    }
    if (sequence <= peer.lastHeartbeatSequence) {
      console.warn('[multiplayer host] Ignored a duplicate or stale client heartbeat.', { peerId, sequence, lastHeartbeatSequence: peer.lastHeartbeatSequence });
      return;
    }
    if (acknowledgedHostSequence > peer.lastHeartbeatReplySequence) {
      console.error('[multiplayer host] Rejected heartbeat acknowledgement for a host response that was never queued.', {
        peerId, acknowledgedHostSequence, lastHeartbeatReplySequence: peer.lastHeartbeatReplySequence
      });
      return;
    }
    const nowMs = Date.now();
    peer.lastHeartbeatSequence = sequence;
    peer.lastHeardAtMs = nowMs;
    // Renew the liveness lease only when the guest acknowledges a newer host
    // heartbeat, not by echoing the same old value forever.
    if (acknowledgedHostSequence > peer.lastAcknowledgedHostSequence) {
      peer.lastAcknowledgedHostSequence = acknowledgedHostSequence;
      peer.lastRoundTripAtMs = nowMs;
    }
    if (nowMs - peer.lastHeartbeatReplyAtMs < HEARTBEAT_REPLY_MIN_INTERVAL_MS) return;
    peer.lastHeartbeatReplyAtMs = nowMs;
    const sent = this.tryQueueTransportMessage({
      type: 'game-host-heartbeat', protocolVersion: COMMAND_PROTOCOL_VERSION,
      roomSessionId: this.roomSessionId, clientSessionId: peer.clientSessionId,
      sequence, serverTimeMs: nowMs
    }, peerId, 'host-heartbeat');
    if (sent) peer.lastHeartbeatReplySequence = sequence;
    else console.error('[multiplayer host] Could not queue host heartbeat response.', { peerId, sequence });
  }

  protected override acceptDefeatAcknowledgement(peerId: string, message: PeerDataMessage): void {
    if (!this.hasWorld) return;
    const peer = this.replicationByPeer.get(peerId);
    if (!peer) {
      console.error('[multiplayer host] Rejected defeat acknowledgement from an unregistered peer.', { peerId, message });
      return;
    }
    const notice = peer.defeatNotification;
    if (message.protocolVersion !== COMMAND_PROTOCOL_VERSION || message.stateSyncProtocolVersion !== STATE_SYNC_PROTOCOL_VERSION ||
        typeof message.eventId !== 'string' || !notice || message.eventId !== notice.eventId ||
        message.playerId !== peer.playerId || message.coreId !== notice.coreId || message.worldId !== notice.worldId) {
      console.error('[multiplayer host] Rejected malformed, stale, or mismatched defeat acknowledgement.', {
        peerId, playerId: peer.playerId, expectedEventId: notice?.eventId, message
      });
      return;
    }
    peer.defeatAcknowledged = true;
    peer.lastHeardAtMs = Date.now();
  }

  protected override updateDefeatNotification(peerId: string, peer: PeerReplicationState, frame: GameWorldFrame, coreId: string, nowMs: number): void {
    const coreIsOperational = frame.snapshot.buildings.some(building => building.type === 'CORE' && building.id === coreId && building.hp > 0);
    if (coreIsOperational) {
      // A room restart revives the same participant/core IDs. Clear the previous
      // lifecycle event so a later defeat in the same room has a new event ID.
      if (peer.defeatNotification !== null) {
        peer.defeatNotification = null;
        peer.defeatAcknowledged = false;
        peer.lastDefeatNoticeSentAtMs = 0;
      }
      return;
    }

    if (peer.defeatNotification === null) {
      peer.defeatNotification = {
        eventId: `${frame.worldId}:${peer.playerId}:${coreId}:defeat-${this.nextDefeatEventSerial++}`,
        playerId: peer.playerId,
        coreId,
        worldId: frame.worldId,
        revision: frame.revision,
        reason: 'core-destroyed'
      };
      peer.defeatAcknowledged = false;
      peer.lastDefeatNoticeSentAtMs = 0;
    }
    if (peer.defeatAcknowledged || nowMs - peer.lastDefeatNoticeSentAtMs < DEFEAT_NOTICE_RETRY_MS) return;

    // Retransmit until the guest acknowledges receipt. PeerJS channels are reliable,
    // but this app-level ACK covers page lifecycle, handler failure, and future adapters.
    peer.lastDefeatNoticeSentAtMs = nowMs;
    const notice = peer.defeatNotification;
    if (!notice) throw new Error(`Defeat notification was not created for peer '${peerId}'.`);
    const sent = this.tryQueueTransportMessage({
      type: 'game-player-defeated',
      roomSessionId: this.roomSessionId,
      protocolVersion: COMMAND_PROTOCOL_VERSION,
      stateSyncProtocolVersion: STATE_SYNC_PROTOCOL_VERSION,
      ...notice
    }, peerId, 'player-defeated-notice');
    if (!sent) console.error('[multiplayer host] Could not queue the player-defeated notification; it will be retried.', { peerId, notice });
  }
}
