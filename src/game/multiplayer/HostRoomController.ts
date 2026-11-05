import { HostRoomTransport } from './hostRoomController/HostRoomTransport';



/**
 * Host-side multiplayer lifecycle and replication authority.
 * Every guest has an independent delta baseline, a liveness lease, and an
 * acknowledged defeat-notification channel. Disconnect cleanup is idempotent.
 */
export class HostRoomController extends HostRoomTransport  {}
