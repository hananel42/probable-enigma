import test from 'node:test';
import assert from 'node:assert/strict';
import { describePeerConnectionError, describeRoomActionError, describeRoomRuntimeFailure } from './connectionErrors';

test('common PeerJS connection errors explain a concrete recovery step', () => {
  assert.match(describePeerConnectionError('peer-unavailable', 'unavailable'), /Room not found or the host is offline/i);
  assert.match(describePeerConnectionError('network', 'offline'), /internet connection/i);
  assert.match(describePeerConnectionError('webrtc', 'failed'), /try another network/i);
  assert.match(describePeerConnectionError('browser-incompatible', 'unsupported'), /recent version/i);
  assert.match(describePeerConnectionError(undefined, 'data channel closed before opening'), /host may have left/i);
});


test('player-facing connection messages avoid implementation details', () => {
  for (const message of [
    describePeerConnectionError('webrtc', 'ICE negotiation failed'),
    describePeerConnectionError('network', 'socket closed'),
    describePeerConnectionError(undefined, 'RTCDataChannel transport closed unexpectedly')
  ]) {
    assert.doesNotMatch(message, /\b(?:WebRTC|PeerJS|RTCDataChannel|ICE|signalling|signaling|transport)\b/i);
    assert.match(message, /connection|room|players/i);
  }
});

test('room action and runtime failures are translated into player-oriented guidance', () => {
  assert.match(describeRoomActionError(new Error('Only the room host can pause.')), /Only the room host/i);
  assert.match(describeRoomActionError(new Error('PeerJS AggregateError in cleanup')), /could not be completed/i);
  assert.match(describeRoomRuntimeFailure('peer-cleanup:host-kicked'), /participant list/i);
  assert.doesNotMatch(describeRoomRuntimeFailure('peer-cleanup:host-kicked'), /PeerJS|WebRTC|AggregateError/i);
  const missedKickNotice = describeRoomRuntimeFailure('room-removal-notice-unavailable');
  assert.match(missedKickNotice, /connection had already ended/i);
  assert.match(missedKickNotice, /room list has been updated/i);
  assert.doesNotMatch(missedKickNotice, /PeerJS|WebRTC|AggregateError/i);
  const unconfirmedKickNotice = describeRoomRuntimeFailure('room-removal-ack-timeout');
  assert.match(unconfirmedKickNotice, /could not confirm that they saw the notice/i);
  assert.doesNotMatch(unconfirmedKickNotice, /PeerJS|WebRTC|AggregateError/i);
});
