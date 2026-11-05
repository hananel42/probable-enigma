import test from 'node:test';
import assert from 'node:assert/strict';
import { isTextEntryTarget, resolveEscapeAction, type EscapeRoutingContext } from './escapeRouting';

const context = (overrides: Partial<EscapeRoutingContext> = {}): EscapeRoutingContext => ({
  surface: 'single-player',
  guideOpen: false,
  textEntryFocused: false,
  chatOpen: false,
  roomOpen: false,
  hasWorld: true,
  ...overrides
});

test('Escape toggles the single-player pause menu without depending on canvas focus', () => {
  assert.equal(resolveEscapeAction(context()), 'toggle-single-player-pause');
  assert.equal(resolveEscapeAction(context({ roomOpen: true })), 'toggle-single-player-pause');
});

test('multiplayer Escape opens room management without changing the shared simulation phase', () => {
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', hasWorld: true, roomOpen: false })), 'open-room');
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', hasWorld: true, roomOpen: true })), 'close-room');
});

test('Escape always reveals the room screen when no multiplayer world exists', () => {
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', hasWorld: false, roomOpen: false })), 'open-room');
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', hasWorld: false, roomOpen: true })), 'keep-room-open');
});

test('Escape leaves text entry and active first-visit guidance to their own handlers', () => {
  assert.equal(resolveEscapeAction(context({ textEntryFocused: true })), 'ignore');
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', textEntryFocused: true })), 'ignore');
  assert.equal(resolveEscapeAction(context({ guideOpen: true })), 'let-guide-handle');
});

test('Escape closes room chat before navigating the multiplayer screen', () => {
  assert.equal(resolveEscapeAction(context({ surface: 'multiplayer', chatOpen: true, roomOpen: false })), 'close-chat');
});

test('text-entry target detection is safe when no DOM exists and ignores non-elements', () => {
  assert.equal(isTextEntryTarget(null), false);
});
