import type { GameDataTransport, PeerDataMessage, TransportDiagnostics } from './transport';
import { encodePeerDataMessage, validatePeerDataMessage } from './peerMessageEnvelope';

const MAX_RELIABLE_BUFFERED_BYTES = 1024 * 1024;
const MAX_DATA_CHANNEL_MESSAGE_BYTES = 1_500_000;
const SEND_FAILURE_LOG_INTERVAL_MS = 2_000;

interface SendFailureState {
  attempts: number;
  lastLoggedAtMs: number;
  lastError: string;
}

type ChannelBinding = {
  channel: RTCDataChannel;
  onMessage: (event: MessageEvent<string>) => void;
  onClose: () => void;
  onError: (event: Event) => void;
};

/**
 * Pluggable data-plane adapter for already-negotiated WebRTC RTCDataChannels.
 * Peer negotiation and room signaling stay in the signaling/control plane; this
 * class owns only validated game-message delivery, backpressure and peer routing.
 */
export class WebRtcDataChannelTransport implements GameDataTransport {
  private readonly channels = new Map<string, ChannelBinding>();
  private readonly listeners = new Set<(message: PeerDataMessage) => void>();
  private readonly reportedUnavailablePeers = new Set<string>();
  private readonly sendFailures = new Map<string, SendFailureState>();

  get diagnostics(): TransportDiagnostics {
    const channels = [...this.channels.values()].map(binding => binding.channel);
    return {
      kind: 'webrtc-data-channel',
      reliable: channels.length > 0 && channels.every(channel =>
        channel.ordered && channel.maxRetransmits === null && channel.maxPacketLifeTime === null
      )
    };
  }

  /** Attach a peer's negotiated reliable, ordered data channel. Duplicate live peer IDs are rejected. */
  attachPeer(peerId: string, channel: RTCDataChannel): void {
    if (!peerId.trim()) throw new Error('WebRTC transport peer ID must not be empty.');
    if (this.channels.has(peerId)) throw new Error(`WebRTC data channel already attached for peer '${peerId}'.`);
    if (channel.label !== 'craftbound-game') {
      throw new Error(`Unexpected WebRTC data channel label '${channel.label}'; expected 'craftbound-game'.`);
    }

    const onMessage = (event: MessageEvent) => {
      let message: PeerDataMessage;
      try {
        if (typeof event.data !== 'string') {
          throw new TypeError(`WebRTC peer '${peerId}' sent a non-text game message; this transport requires JSON text frames.`);
        }
        const decoded: unknown = JSON.parse(event.data);
        message = validatePeerDataMessage(decoded, {
          transportName: 'WebRTC',
          peerId,
          maxBytes: MAX_DATA_CHANNEL_MESSAGE_BYTES
        });
      } catch (error) {
        // Exceptions thrown out of a DOM event listener are not reliably delivered
        // to the room authority. Report the cause and close only this bad peer.
        console.error('[webrtc transport] Rejected malformed or oversized peer data; isolating the affected peer.', { peerId, error });
        this.closePeer(peerId, 'invalid-inbound-game-message');
        return;
      }

      for (const listener of [...this.listeners]) {
        try {
          listener(message);
        } catch (error) {
          console.error('[webrtc transport] Protocol listener failed; isolating the affected peer.', {
            peerId, messageType: message.type, error
          });
          this.closePeer(peerId, 'protocol-listener-failed');
          return;
        }
      }
    };
    const onClose = () => this.detachPeer(peerId, channel);
    const onError = (event: Event) => console.error('[webrtc transport] RTCDataChannel error.', { peerId, event, channelState: channel.readyState });
    channel.addEventListener('message', onMessage as EventListener);
    channel.addEventListener('close', onClose);
    channel.addEventListener('error', onError);
    this.channels.set(peerId, { channel, onMessage, onClose, onError });
    this.reportedUnavailablePeers.delete(peerId);
  }

  hasPeerConnection(peerId: string): boolean {
    return this.channels.get(peerId)?.channel.readyState === 'open';
  }

  sendData(message: PeerDataMessage, targetPeerId?: string): boolean {
    const targets = targetPeerId
      ? [[targetPeerId, this.channels.get(targetPeerId)] as const]
      : [...this.channels.entries()];
    if (targets.length === 0) {
      console.error('[webrtc transport] Cannot send game data because no peer data channels are attached.', { type: message.type });
      return false;
    }

    const encoded = encodePeerDataMessage(message, {
      transportName: 'WebRTC outbound',
      peerId: targetPeerId ?? 'broadcast',
      maxBytes: MAX_DATA_CHANNEL_MESSAGE_BYTES
    });

    let sentCount = 0;
    for (const [peerId, binding] of targets) {
      if (!binding) {
        if (!this.reportedUnavailablePeers.has(peerId)) {
          this.reportedUnavailablePeers.add(peerId);
          console.warn('[webrtc transport] Requested peer has no attached data channel; room membership should be reconciled.', { peerId, type: message.type });
        }
        continue;
      }
      const { channel } = binding;
      if (channel.readyState !== 'open') {
        if (!this.reportedUnavailablePeers.has(peerId)) {
          this.reportedUnavailablePeers.add(peerId);
          console.warn('[webrtc transport] Skipping a send because the peer data channel is not open.', { peerId, type: message.type, readyState: channel.readyState });
        }
        if (channel.readyState === 'closed' || channel.readyState === 'closing') this.detachPeer(peerId, channel);
        continue;
      }
      this.reportedUnavailablePeers.delete(peerId);
      const backlogLimit = MAX_RELIABLE_BUFFERED_BYTES;
      if (channel.bufferedAmount > backlogLimit) {
        this.reportSendFailure(peerId, 'backpressure', message.type,
          `bufferedAmount=${channel.bufferedAmount} exceeds limit=${backlogLimit}`);
        continue;
      }
      try {
        channel.send(encoded);
        this.sendFailures.delete(`${peerId}:send`);
        this.sendFailures.delete(`${peerId}:backpressure`);
        sentCount++;
      } catch (error) {
        const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        this.reportSendFailure(peerId, 'send', message.type, errorText);
        // `readyState` may change between the open check and send(). If it has,
        // detach immediately so the room controller sees the authoritative loss
        // on its next reconciliation tick. Keep healthy-looking channels attached
        // after other errors so explicit retries can recover them.
        if (channel.readyState !== 'open') this.detachPeer(peerId, channel);
      }
    }
    return sentCount > 0;
  }

  subscribeData(listener: (message: PeerDataMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Close a specific peer channel after its application-level liveness lease expires. */
  closePeer(peerId: string, reason = 'host-requested-close'): boolean {
    const binding = this.channels.get(peerId);
    if (!binding) {
      // Close events can race liveness expiry. Absence is already the desired state.
      this.reportedUnavailablePeers.delete(peerId);
      console.info('[webrtc transport] Peer channel was already absent; cleanup is complete.', { peerId, reason });
      return true;
    }
    this.detachPeer(peerId, binding.channel);
    if (binding.channel.readyState !== 'closed') binding.channel.close();
    return true;
  }

  detachPeer(peerId: string, expectedChannel?: RTCDataChannel): void {
    const binding = this.channels.get(peerId);
    if (!binding) return;
    if (expectedChannel && binding.channel !== expectedChannel) return;
    binding.channel.removeEventListener('message', binding.onMessage as EventListener);
    binding.channel.removeEventListener('close', binding.onClose);
    binding.channel.removeEventListener('error', binding.onError);
    this.channels.delete(peerId);
    this.reportedUnavailablePeers.delete(peerId);
    for (const key of this.sendFailures.keys()) if (key.startsWith(`${peerId}:`)) this.sendFailures.delete(key);
  }

  close(): void {
    for (const [peerId, binding] of this.channels) {
      this.detachPeer(peerId, binding.channel);
      if (binding.channel.readyState !== 'closed') binding.channel.close();
    }
    this.listeners.clear();
    this.reportedUnavailablePeers.clear();
    this.sendFailures.clear();
  }

  private reportSendFailure(peerId: string, context: 'send' | 'backpressure', messageType: string, lastError: string): void {
    const nowMs = Date.now();
    const key = `${peerId}:${context}`;
    const previous = this.sendFailures.get(key);
    const failure: SendFailureState = {
      attempts: (previous?.attempts ?? 0) + 1,
      lastLoggedAtMs: previous?.lastLoggedAtMs ?? 0,
      lastError
    };
    if (nowMs - failure.lastLoggedAtMs >= SEND_FAILURE_LOG_INTERVAL_MS) {
      console.error('[webrtc transport] Reliable message could not be queued; per-peer delivery will retry and diagnostics are rate-limited.', {
        peerId, context, messageType, attempts: failure.attempts, lastError, transportState: this.channels.get(peerId)?.channel.readyState
      });
      failure.lastLoggedAtMs = nowMs;
    }
    this.sendFailures.set(key, failure);
  }
}
