/**
 * PeerJS policy shared by the transport adapter and regression tests.
 * BinaryPack is required because PeerJS's JSON serializer does not use the
 * large-message chunking path. Full authoritative frames must remain supported.
 */
export const PEERJS_GAME_DATA_SERIALIZATION = 'binary' as const;
export const MAX_PEERJS_GAME_MESSAGE_BYTES = 16 * 1024 * 1024;

/** Use PeerJS's verbose internal tracing only in Vite development builds. */
export function getPeerJsDebugLevel(isDevelopment: boolean): 0 | 1 {
  return isDevelopment ? 1 : 0;
}
