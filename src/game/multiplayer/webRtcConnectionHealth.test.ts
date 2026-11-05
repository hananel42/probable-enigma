import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWebRtcConnection } from './webRtcConnectionHealth';

test('WebRTC connection health treats connected/completed states as healthy', () => {
  assert.equal(assessWebRtcConnection('connected', 'connected'), 'connected');
  assert.equal(assessWebRtcConnection('connecting', 'completed'), 'connected');
  assert.equal(assessWebRtcConnection(undefined, 'connected'), 'connected');
});

test('WebRTC connection health classifies disconnected as recoverable rather than terminal', () => {
  assert.equal(assessWebRtcConnection('disconnected', 'disconnected'), 'recovering');
  assert.equal(assessWebRtcConnection('connected', 'disconnected'), 'recovering');
  assert.equal(assessWebRtcConnection(undefined, 'disconnected'), 'recovering');
});

test('WebRTC connection health treats failed/closed states as terminal', () => {
  assert.equal(assessWebRtcConnection('failed', 'checking'), 'failed');
  assert.equal(assessWebRtcConnection('closed', undefined), 'failed');
  assert.equal(assessWebRtcConnection('connected', 'failed'), 'failed');
});

test('WebRTC connection health preserves negotiation states as non-terminal', () => {
  assert.equal(assessWebRtcConnection('new', 'new'), 'connecting');
  assert.equal(assessWebRtcConnection('connecting', 'checking'), 'connecting');
  assert.equal(assessWebRtcConnection(undefined, undefined), 'unknown');
});
