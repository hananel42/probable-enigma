/** Canonical host-authored chat event delivered to every connected room member. */
export interface RoomChatMessage {
  readonly messageId: string;
  readonly senderPlayerId: string;
  readonly senderName: string;
  readonly text: string;
  readonly sentAtMs: number;
}

export const MAX_CHAT_MESSAGE_LENGTH = 280;

export function normalizeChatText(value: string): string {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text) throw new TypeError('Chat message cannot be empty.');
  if (text.length > MAX_CHAT_MESSAGE_LENGTH) throw new RangeError(`Chat message must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.`);
  return text;
}

export function isRoomChatMessage(value: unknown): value is RoomChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.messageId === 'string' && message.messageId.length > 0 && message.messageId.length <= 200 &&
    typeof message.senderPlayerId === 'string' && message.senderPlayerId.length > 0 && message.senderPlayerId.length <= 128 &&
    typeof message.senderName === 'string' && message.senderName.length > 0 && message.senderName.length <= 24 &&
    typeof message.text === 'string' && message.text.trim().length > 0 && message.text.length <= MAX_CHAT_MESSAGE_LENGTH &&
    typeof message.sentAtMs === 'number' && Number.isFinite(message.sentAtMs) && message.sentAtMs >= 0;
}
