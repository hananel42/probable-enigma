/** Application-level destination for Escape; rendering and simulation lifecycles stay separate. */
export type EscapeSurface = 'single-player' | 'multiplayer';

export type EscapeAction =
  | 'ignore'
  | 'let-guide-handle'
  | 'toggle-single-player-pause'
  | 'close-chat'
  | 'open-room'
  | 'close-room'
  | 'keep-room-open';

export interface EscapeRoutingContext {
  readonly surface: EscapeSurface;
  readonly guideOpen: boolean;
  readonly textEntryFocused: boolean;
  readonly chatOpen: boolean;
  readonly roomOpen: boolean;
  readonly hasWorld: boolean;
}

/**
 * Resolve Escape consistently before a component touches the simulation or room.
 * Single-player owns a local pause menu; multiplayer only navigates the room panel
 * and must never pause the shared authority from a participant's local UI.
 */
export function resolveEscapeAction(context: EscapeRoutingContext): EscapeAction {
  if (context.guideOpen) return 'let-guide-handle';
  if (context.textEntryFocused) return 'ignore';
  if (context.chatOpen) return 'close-chat';

  if (context.surface === 'single-player') return 'toggle-single-player-pause';

  // In a lobby or after a world ends, the room panel is the primary screen. Escape
  // should recover it if hidden, not expose an empty canvas behind it.
  if (!context.hasWorld) return context.roomOpen ? 'keep-room-open' : 'open-room';
  return context.roomOpen ? 'close-room' : 'open-room';
}

/** Return true for controls where Escape belongs to the editor/browser control. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable;
}
