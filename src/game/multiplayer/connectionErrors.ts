/** Translate transport failures into concise, actionable language for players. */
export function describePeerConnectionError(errorType: string | undefined, rawMessage: string): string {
  const normalizedMessage = rawMessage.toLowerCase();

  if (errorType === 'peer-unavailable') {
    return 'Room not found or the host is offline. Check the five-letter room code and try again.';
  }
  if (errorType === 'browser-incompatible') {
    return 'This browser does not support online multiplayer. Use a recent version of Chrome, Edge, Firefox, or Safari.';
  }
  if (errorType === 'unavailable-id') {
    return 'That room code is already in use. Create the room again to generate a new code.';
  }
  if (errorType === 'network' || errorType === 'server-error' || errorType === 'socket-error' || errorType === 'socket-closed' || errorType === 'disconnected') {
    return 'Could not reach the room service. Check your internet connection and try again.';
  }
  if (errorType === 'webrtc' || errorType === 'negotiation-failed') {
    return 'Could not connect to the other players. Check your connection, try another network, or rejoin the room.';
  }
  if (normalizedMessage.includes('did not open within') || normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out')) {
    return 'The connection took too long to become ready. Check that the host is still in the room, then try again.';
  }
  if (normalizedMessage.includes('closed before opening')) {
    return 'The connection ended before you could join. The host may have left or the room may be full. Check the code and try again.';
  }
  return 'Could not connect to the room. Check your room code and internet connection, then try again.';
}

/** Map host-side action exceptions to user guidance; detailed causes stay in diagnostics. */
export function describeRoomActionError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.toLowerCase();
  if (message.includes('only the room host') || message.includes('only the room owner')) {
    return 'Only the room host can perform this action.';
  }
  if (message.includes('already being removed')) return 'That player is already being removed from the room.';
  if (message.includes('no longer in the room')) return 'That player is no longer in the room. The participant list has been refreshed.';
  if (message.includes('no active world') || message.includes('world while room phase')) {
    return 'The world has already changed. The room status has been refreshed; try again if needed.';
  }
  if (message.includes('already unavailable') || message.includes('notice may not have arrived')) {
    return 'The player was removed, but their connection was already unavailable so the notice may not have arrived.';
  }
  if (/(peerjs|webrtc|rtcdatachannel|iceconnection|signalling|signaling|transport|aggregateerror|protocol|data channel)/i.test(raw)) {
    return 'That room action could not be completed. Check the room status and try again.';
  }
  return raw || 'That room action could not be completed. Please try again.';
}

/** Keep low-level runtime contexts in the console, not in player-facing alerts. */
export function describeRoomRuntimeFailure(context: string): string {
  if (context.includes('room-removal-notice-unavailable')) {
    return 'The participant connection had already ended, so they may not have seen the removal notice. The room list has been updated.';
  }
  if (context.includes('room-removal-ack-timeout')) {
    return 'The player was removed, but we could not confirm that they saw the notice. The room list has been updated.';
  }
  if (context.startsWith('peer-cleanup') || context.includes('stale-peer-cleanup')) {
    return 'A player connection ended unexpectedly. The room is updating its participant list; other players can continue.';
  }
  if (context.includes('publication')) {
    return 'Room updates were briefly interrupted. The host will retry automatically.';
  }
  if (context.includes('room-status')) {
    return 'The room status could not be refreshed. Reopen room management in a moment.';
  }
  return 'A room operation failed. Try again; if the problem continues, leave and rejoin the room.';
}
