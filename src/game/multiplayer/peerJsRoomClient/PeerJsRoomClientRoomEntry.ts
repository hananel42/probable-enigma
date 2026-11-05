import { Peer } from 'peerjs';
import { createPeerJsRoomCode, getPeerJsHostId, PEERJS_APP_ID_PREFIX } from '../peerJsRoomIdentity';
import { PEERJS_GAME_DATA_SERIALIZATION } from '../peerJsTransportPolicy';
import type { PeerErrorLike } from './model';
import { APPLICATION_ID, APPLICATION_PROTOCOL_VERSION, PEERJS_CLOUD_OPTIONS, PEER_OPEN_TIMEOUT_MS, peerErrorType, userFacingError } from './model';
import { PeerJsRoomClientView } from './PeerJsRoomClientView';

export abstract class PeerJsRoomClientRoomEntry extends PeerJsRoomClientView {

  /** Creates a PeerJS host ID from the fixed application prefix plus a random five-letter suffix. */
  public override async createRoom(): Promise<void> {
    this.assertNoActivePeer('create a room');
    this.intentionalClose = false;
    this.update({ status: 'connecting', message: 'Preparing a new room…', roomCode: undefined, role: undefined, peerConnected: false });

    const maxIdAttempts = 8;
    for (let attempt = 1; attempt <= maxIdAttempts; attempt++) {
      const roomCode = createPeerJsRoomCode();
      const hostId = getPeerJsHostId(roomCode);
      let candidate: Peer | null = null;
      try {
        candidate = new Peer(hostId, PEERJS_CLOUD_OPTIONS);
        this.peer = candidate;
        await this.waitForPeerOpen(candidate, hostId);
        this.role = 'host';
        this.roomCode = roomCode;
        this.attachPeerLifecycle(candidate);
        this.update({
          status: 'waiting',
          role: 'host',
          roomCode,
          peerConnected: false,
          message: 'Room is ready. Share the five-letter code so others can join.'
        });
        console.info('[PeerJS] Created direct WebRTC room.', { roomCode, hostId, attempt });
        return;
      } catch (error) {
        if (this.peer === candidate) this.peer = null;
        if (candidate && !candidate.destroyed) candidate.destroy();
        if (peerErrorType(error) === 'unavailable-id') {
          console.warn('[PeerJS] Generated room ID is already in use; generating a new five-letter code.', { roomCode, attempt });
          continue;
        }
        const message = `Could not create the room. ${userFacingError(error)}`;
        console.error('[PeerJS] Room creation failed.', { roomCode, hostId, error });
        this.update({ status: 'error', message, roomCode: undefined, role: undefined, peerConnected: false });
        throw error;
      }
    }

    const error = new Error('Could not create a room right now. Please try again in a moment.');
    console.error('[PeerJS] Room-ID reservation retry limit reached.', { attempts: maxIdAttempts, prefix: PEERJS_APP_ID_PREFIX, error });
    this.update({ status: 'error', message: error.message, roomCode: undefined, role: undefined, peerConnected: false });
    throw error;
  }

  /** Connects a fresh guest peer directly to the host's derived long ID. */
  public override async joinRoom(roomCodeInput: string): Promise<void> {
    this.assertNoActivePeer('join a room');
    const roomCode = roomCodeInput.trim().toUpperCase();
    const hostId = getPeerJsHostId(roomCode);
    this.intentionalClose = false;
    this.update({ status: 'connecting', message: 'Joining the room…', roomCode: undefined, role: undefined, peerConnected: false });

    let peer: Peer | null = null;
    try {
      peer = new Peer(PEERJS_CLOUD_OPTIONS);
      this.peer = peer;
      const guestId = await this.waitForPeerOpen(peer);
      this.role = 'guest';
      this.attachPeerLifecycle(peer);
      this.update({ status: 'signaling', message: 'Room found. Connecting to the other players…', peerConnected: false });

      const connection = peer.connect(hostId, {
        label: 'craftbound-game',
        reliable: true,
        // BinaryPack's large-payload path chunks and reassembles full world frames.
        serialization: PEERJS_GAME_DATA_SERIALIZATION,
        metadata: {
          application: APPLICATION_ID,
          applicationProtocolVersion: APPLICATION_PROTOCOL_VERSION,
          roomCode,
          role: 'guest'
        }
      });
      this.hostConnection = connection;
      await this.bindConnection(connection, 'guest');
      if (!this.connections.has(hostId)) throw new Error('PeerJS data connection opened without being registered in the transport.');
      this.roomCode = roomCode;
      this.update({ status: 'connected', message: 'Connected to the room. Waiting for the host to start or resume the world.', roomCode, role: 'guest', peerConnected: true });
      console.info('[PeerJS] Joined direct WebRTC room.', { roomCode, hostId, guestId });
    } catch (error) {
      const message = `Could not join room ${roomCode}. ${userFacingError(error)}`;
      console.error('[PeerJS] Room join failed.', { roomCode, hostId, error });
      this.destroyPeerAndConnections();
      this.role = undefined;
      this.roomCode = undefined;
      this.hostConnection = null;
      this.update({ status: 'error', message, roomCode: undefined, role: undefined, peerConnected: false });
      throw error;
    }
  }

  protected override assertNoActivePeer(action: string): void {
    if (this.peer || this.roomCode || this.role) throw new Error(`Cannot ${action} while a PeerJS room is active. Leave the current room first.`);
  }

  protected override waitForPeerOpen(peer: Peer, expectedId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`PeerJS did not open its signalling connection within ${PEER_OPEN_TIMEOUT_MS} ms.`));
      }, PEER_OPEN_TIMEOUT_MS);
      peer.on('open', id => {
        this.signalingConnected = true;
        if (settled) return;
        if (expectedId && id !== expectedId) {
          settled = true;
          window.clearTimeout(timeoutId);
          reject(new Error(`PeerJS registered unexpected ID '${id}'; expected '${expectedId}'.`));
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(id);
      });
      peer.on('error', error => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error as PeerErrorLike);
      });
    });
  }
}
