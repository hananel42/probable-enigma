import type { GameWorldFrame } from '../../server/protocol';
import type { PeerDataMessage } from '../transport';
import type { StatePatchOperation } from '../stateDelta';

export const STATE_SYNC_PROTOCOL_VERSION = 3;

export const COMMAND_PROTOCOL_VERSION = 2;

export const HEARTBEAT_INTERVAL_MS = 2_000;

export const HOST_LIVENESS_TIMEOUT_MS = 60_000;

/**
 * UI subscribers execute synchronously while a transport message is being
 * handled. A faulty subscriber must be diagnosed, but must never be reclassified
 * as malformed peer traffic and cause the persistent room connection to close.
 */
export function notifyListeners<Args extends unknown[]>(
  eventName: string,
  listeners: Iterable<(...args: Args) => void>,
  ...args: Args
): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch (error) {
      console.error(`[multiplayer guest] Local ${eventName} subscriber failed; keeping the room connection active.`, { error });
    }
  }
}

export let nextClientSessionSerial = 1;

export function createClientSessionId(): string {
  return `${Date.now().toString(36)}-${nextClientSessionSerial++}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PlayerDefeatNotice {
  readonly eventId: string;
  readonly playerId: string;
  readonly coreId: string;
  readonly worldId: string;
  readonly revision: number;
  readonly reason: 'core-destroyed';
}

/** A stable, user-facing explanation when the room owner removes this guest. */
export interface RoomRemovalNotice {
  readonly removalId: string;
  readonly message: string;
}

export type RemoteConnectionHealth = 'connected' | 'degraded';

export interface InitialStateEnvelope extends PeerDataMessage {
  type: 'game-initial-state';
  protocolVersion: number;
  frame: GameWorldFrame;
}

export interface StateDeltaEnvelope extends PeerDataMessage {
  type: 'game-state-delta';
  protocolVersion: number;
  worldId: string;
  baseRevision: number;
  revision: number;
  serverTimeMs: number;
  operations: StatePatchOperation[];
}

export function poseMap<T extends { readonly id: string }>(poses: readonly T[]): Map<string, T> {
  return new Map(poses.map(pose => [pose.id, pose]));
}

export function applyRenderPoses<T extends { id: string }, P extends { id: string }>(
  current: readonly T[],
  poses: ReadonlyMap<string, P>,
  fields: readonly string[]
): T[] {
  return current.map(item => {
    const pose = poses.get(item.id);
    if (!pose) return item;
    const updated = { ...item } as T;
    const writable = updated as Record<string, unknown>;
    const poseFields = pose as P & Record<string, unknown>;
    for (const field of fields) {
      const value = poseFields[field];
      if (typeof value === 'number') writable[field] = value;
    }
    return updated;
  });
}
