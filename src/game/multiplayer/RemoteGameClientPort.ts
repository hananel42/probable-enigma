import { RemoteGameClientPortSessionLifecycle } from './remoteGameClientPort/RemoteGameClientPortSessionLifecycle';
export type { PlayerDefeatNotice, RoomRemovalNotice, RemoteConnectionHealth } from './remoteGameClientPort/model';
import type { GameClientPort } from '../server/protocol';



/** Guest-side read-only replica. Only the room creator mutates the authoritative simulation. */
export class RemoteGameClientPort extends RemoteGameClientPortSessionLifecycle implements GameClientPort {}
