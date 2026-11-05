import test from 'node:test';
import assert from 'node:assert/strict';
import { roomPanelVisibilityForReadiness, roomPanelVisibilityForStatus } from './roomPanelTransitions';
import type { RoomManagementStatus } from './roomManagement';

function roomStatus(phase: RoomManagementStatus['phase'], worldId: string | null): RoomManagementStatus {
  return {
    phase,
    hasWorld: worldId !== null,
    worldId,
    mode: 'TEAM',
    gameTimeSeconds: phase === 'playing' ? 10 : 0,
    players: [],
    updatedAtMs: 1000
  };
}

test("same-world room status updates preserve the user's open-room choice during play", () => {
  const playing = roomStatus('playing', 'world-1');
  assert.equal(roomPanelVisibilityForStatus(playing, { ...playing, updatedAtMs: 2000 }, 'host', true), null);
  assert.equal(roomPanelVisibilityForStatus(playing, { ...playing, updatedAtMs: 3000 }, 'guest', true), null);
});

test('room panel is shown in a lobby or paused world and hidden only when a ready player enters play', () => {
  assert.equal(roomPanelVisibilityForStatus(null, roomStatus('lobby', null), 'host', true), true);
  assert.equal(roomPanelVisibilityForStatus(roomStatus('playing', 'world-1'), roomStatus('paused', 'world-1'), 'host', true), true);
  assert.equal(roomPanelVisibilityForStatus(roomStatus('lobby', null), roomStatus('playing', 'world-1'), 'host', true), false);
  assert.equal(roomPanelVisibilityForStatus(roomStatus('lobby', null), roomStatus('playing', 'world-1'), 'guest', false), true);
  assert.equal(roomPanelVisibilityForStatus(roomStatus('paused', 'world-1'), roomStatus('playing', 'world-1'), 'guest', true), false);
});

test('guest readiness opens during resync and closes only on a fresh ready transition in play', () => {
  const playing = roomStatus('playing', 'world-1');
  assert.equal(roomPanelVisibilityForReadiness(false, false, playing), true);
  assert.equal(roomPanelVisibilityForReadiness(false, true, playing), false);
  assert.equal(roomPanelVisibilityForReadiness(true, true, playing), null);
  assert.equal(roomPanelVisibilityForReadiness(false, true, roomStatus('paused', 'world-1')), true);
  assert.equal(roomPanelVisibilityForReadiness(false, true, roomStatus('lobby', null)), null);
});

