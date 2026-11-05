import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandomRobotName, normalizeDisplayName, resolveDisplayName } from './displayName';

test('robot names are English, compact, and generated within the public-name limit', () => {
  const values = [0, 0, 0];
  let index = 0;
  assert.equal(createRandomRobotName(() => values[index++]!), 'Wobble Toaster-10');
  const randomName = resolveDisplayName('');
  assert.ok(randomName.length <= 24);
  assert.match(randomName, /^[A-Za-z0-9 _'-]+$/);
});

test('display names are normalized and invalid names are rejected', () => {
  assert.equal(normalizeDisplayName('  Rusty   Bot  '), 'Rusty Bot');
  assert.throws(() => normalizeDisplayName(''), /1–24 characters/);
  assert.throws(() => normalizeDisplayName('X'.repeat(25)), /1–24 characters/);
  assert.throws(() => normalizeDisplayName('bot<script>'), /only letters/);
});
