import type { PeerDataMessage } from './transport';

/** Protocol envelope metadata is intentionally small and stable across transports. */
export const MAX_PEER_MESSAGE_TYPE_LENGTH = 96;
const utf8Encoder = new TextEncoder();

export interface PeerMessageValidationContext {
  /** Human-readable transport label used in errors; e.g. "PeerJS" or "WebRTC". */
  readonly transportName: string;
  /** Identifier supplied by the connection registry, never by remote payload data. */
  readonly peerId: string;
  /** Application-level UTF-8 JSON-envelope limit, independent of wire serialization. */
  readonly maxBytes: number;
}

function isEnvelopeRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializeForValidation(value: unknown, context: PeerMessageValidationContext): string {
  if (!Number.isSafeInteger(context.maxBytes) || context.maxBytes <= 0) {
    throw new RangeError(`${context.transportName} message-size limit must be a positive safe integer.`);
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (cause) {
    throw new TypeError(`${context.transportName} peer '${context.peerId}' sent a message that cannot be serialized for validation.`, { cause });
  }
  if (typeof serialized !== 'string') {
    throw new TypeError(`${context.transportName} peer '${context.peerId}' sent a message without a JSON representation.`);
  }
  const byteLength = utf8Encoder.encode(serialized).byteLength;
  if (byteLength > context.maxBytes) {
    throw new RangeError(`${context.transportName} message is ${byteLength} bytes; the protocol limit is ${context.maxBytes} bytes.`);
  }
  return serialized;
}

function validateEnvelopeType(value: Record<string, unknown>, context: PeerMessageValidationContext): void {
  if (typeof value.type !== 'string' || value.type.length === 0 || value.type.length > MAX_PEER_MESSAGE_TYPE_LENGTH) {
    throw new TypeError(`${context.transportName} peer '${context.peerId}' sent an invalid game-message type; expected 1–${MAX_PEER_MESSAGE_TYPE_LENGTH} characters.`);
  }
}

function validateOutboundRecord(message: PeerDataMessage, context: PeerMessageValidationContext): Record<string, unknown> {
  if (!isEnvelopeRecord(message)) {
    throw new TypeError(`${context.transportName} outbound game messages must be plain object envelopes.`);
  }
  validateEnvelopeType(message, context);
  return message;
}

/**
 * Validates a local outbound message while preserving the caller's object. PeerJS
 * uses BinaryPack and must send that object, not a JSON string; this shared check
 * applies the same JSON-envelope budget before transport-specific encoding.
 */
export function validateOutboundPeerDataMessage(message: PeerDataMessage, context: PeerMessageValidationContext): void {
  serializeForValidation(validateOutboundRecord(message, context), context);
}

/** Validate and encode a message for adapters whose wire contract is JSON text. */
export function encodePeerDataMessage(message: PeerDataMessage, context: PeerMessageValidationContext): string {
  return serializeForValidation(validateOutboundRecord(message, context), context);
}

/**
 * Validates an inbound envelope and replaces any forged sender ID with the ID
 * derived from the established transport connection. Payload-specific schemas
 * are still checked by the versioned game protocol above this transport layer.
 */
export function validatePeerDataMessage(value: unknown, context: PeerMessageValidationContext): PeerDataMessage {
  if (!isEnvelopeRecord(value)) {
    throw new TypeError(`${context.transportName} peer '${context.peerId}' sent an invalid game-message envelope; expected a plain object.`);
  }
  validateEnvelopeType(value, context);
  serializeForValidation(value, context);
  return { ...value, senderPeerId: context.peerId } as PeerDataMessage;
}
