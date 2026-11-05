import type { RoomManagementStatus, RoomPhase } from './roomManagement';

export type RoomPanelRole = 'host' | 'guest';

interface RoomLifecycleView {
  readonly phase: RoomPhase;
  readonly hasWorld: boolean;
  readonly worldId: string | null;
}

/**
 * Decide whether a room-status transition should automatically change the panel.
 * `null` means preserve the user's current choice. In particular, periodic room
 * status updates for the same active world must never close a panel the player
 * deliberately opened while playing.
 */
export function roomPanelVisibilityForStatus(
  previous: RoomLifecycleView | null,
  next: RoomManagementStatus,
  role: RoomPanelRole,
  sessionReady: boolean
): boolean | null {
  if (!next.hasWorld || next.phase !== 'playing') return true;

  const enteredPlayingWorld = !previous || !previous.hasWorld || previous.phase !== 'playing' || previous.worldId !== next.worldId;
  if (!enteredPlayingWorld) return null;

  // The host is ready as soon as its authoritative world starts. A guest keeps
  // the room visible until its baseline and first live delta prove synchronization.
  return role === 'guest' && !sessionReady;
}

/** Only readiness transitions affect visibility; repeated `ready=true` is inert. */
export function roomPanelVisibilityForReadiness(
  previousReady: boolean,
  ready: boolean,
  status: RoomManagementStatus | null
): boolean | null {
  if (!status || !status.hasWorld) return null;
  if (status.phase !== 'playing') return true;
  if (!ready) return true;
  if (!previousReady && ready) return false;
  return null;
}
