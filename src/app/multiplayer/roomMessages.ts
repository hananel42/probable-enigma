import { describeRoomActionError, describeRoomRuntimeFailure } from '../../game/multiplayer/connectionErrors';

/** Present action failures as recovery guidance; raw causes remain in the console. */
export function getRoomActionMessage(error: unknown): string {
  return describeRoomActionError(error);
}

export function getRoomRuntimeMessage(context: string): string {
  return describeRoomRuntimeFailure(context);
}

