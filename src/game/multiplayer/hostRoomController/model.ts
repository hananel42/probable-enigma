import type { GameWorldFrame } from '../../server/protocol';

export const COMMAND_PROTOCOL_VERSION = 2;

export const STATE_SYNC_PROTOCOL_VERSION = 3;

export const COMMAND_RATE_WINDOW_MS = 1_000;

export const MAX_COMMANDS_PER_PEER_PER_WINDOW = 120;

export const FULL_STATE_RETRY_MS = 1_500;

export const MAX_FULL_STATE_ATTEMPTS = 20;

export const RESYNC_REQUEST_MIN_INTERVAL_MS = 1_000;

export const ACK_STALE_RESYNC_MS = 12_000;

export const DEFEAT_NOTICE_RETRY_MS = 750;

export const PEER_LIVENESS_TIMEOUT_MS = 60_000;

export const HEARTBEAT_REPLY_MIN_INTERVAL_MS = 500;

export const CHAT_RATE_WINDOW_MS = 5_000;

export const MAX_CHAT_MESSAGES_PER_WINDOW = 6;

export const ROOM_STATUS_MIN_INTERVAL_MS = 1_000;

export const ROOM_STATUS_FAILURE_LOG_INTERVAL_MS = 2_000;

/** Keep the peer open briefly so the removal notice can be acknowledged before forced cleanup. */
export const ROOM_REMOVAL_ACK_TIMEOUT_MS = 1_500;

export type DefeatReason = 'core-destroyed';

export interface DefeatNotification {
  readonly eventId: string;
  readonly playerId: string;
  readonly coreId: string;
  readonly worldId: string;
  readonly revision: number;
  readonly reason: DefeatReason;
}

export interface PeerReplicationState {
  readonly playerId: string;
  /** Client-port lifecycle token; a changed token requires fresh assignment/state sync. */
  clientSessionId: string;
  assignmentQueued: boolean;
  baseline: GameWorldFrame | null;
  /** Exact full frame being retried until its revision is acknowledged. */
  pendingFullStateFrame: GameWorldFrame | null;
  lastAcknowledgedRevision: number;
  lastAcknowledgedAtMs: number;
  waitingFullStateAckRevision: number | null;
  lastFullStateSentAtMs: number;
  fullStateAttempts: number;
  lastResyncRequestAtMs: number;
  needsFullState: boolean;
  lastHeardAtMs: number;
  lastRoundTripAtMs: number;
  lastHeartbeatSequence: number;
  lastHeartbeatReplySequence: number;
  lastAcknowledgedHostSequence: number;
  lastHeartbeatReplyAtMs: number;
  commandRateWindowStartedAtMs: number;
  commandsInRateWindow: number;
  chatWindowStartedAtMs: number;
  chatMessagesInWindow: number;
  defeatNotification: DefeatNotification | null;
  defeatAcknowledged: boolean;
  lastDefeatNoticeSentAtMs: number;
}

export interface PeerRoomStatusDelivery {
  content: string;
  urgentContent: string;
  lastSentAtMs: number;
  lastFailureLoggedAtMs: number;
}

export interface PendingRoomRemoval {
  readonly removalId: string;
  readonly playerId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface PeerTransportFailureState {
  retryCount: number;
  lastLoggedAtMs: number;
  lastContext: string;
  lastMessageType: string;
  lastError: string | null;
}
