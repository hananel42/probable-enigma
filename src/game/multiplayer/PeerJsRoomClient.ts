import { PeerJsRoomClientRecovery } from './peerJsRoomClient/PeerJsRoomClientRecovery';
import type { GameDataTransport } from './transport';



/**
 * PeerJS Cloud room client and direct WebRTC game-data transport.
 * The host owns one simulation and accepts up to seven guest data connections.
 * The WebSocket relay is deliberately not used as an implicit fallback.
 */
export class PeerJsRoomClient extends PeerJsRoomClientRecovery implements GameDataTransport {}
