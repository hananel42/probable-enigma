/**
 * Interprets the browser's connection and ICE states for room lifecycle policy.
 * `disconnected` is recoverable; only `failed`/`closed` is terminal here.
 * Callers should still apply a grace period before acting on disconnection.
 */
export type WebRtcConnectionAssessment = 'connected' | 'recovering' | 'failed' | 'connecting' | 'unknown';

export function assessWebRtcConnection(
  connectionState?: string | null,
  iceConnectionState?: string | null
): WebRtcConnectionAssessment {
  if (connectionState === 'failed' || connectionState === 'closed' ||
      iceConnectionState === 'failed' || iceConnectionState === 'closed') return 'failed';

  // Prefer the more conservative recovery classification if state snapshots
  // disagree briefly during an ICE transition (for example, aggregate
  // connectionState says connected while ICE still reports disconnected).
  if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') return 'recovering';

  if (connectionState === 'connected' || iceConnectionState === 'connected' ||
      iceConnectionState === 'completed') return 'connected';

  if (connectionState === 'new' || connectionState === 'connecting' ||
      iceConnectionState === 'new' || iceConnectionState === 'checking' ||
      iceConnectionState === 'connected' || iceConnectionState === 'completed') return 'connecting';

  return 'unknown';
}
