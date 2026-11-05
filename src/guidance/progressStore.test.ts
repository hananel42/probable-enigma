import test from 'node:test';
import assert from 'node:assert/strict';
import { getGuidanceProgressKey, GuidanceProgressStore, validateGuidanceDefinitions, type StringStorage } from './progressStore';
import type { GuidanceDefinition } from './types';
import { advanceGuidance, rewindGuidance } from './navigation';

class TestStorage implements StringStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const guide: GuidanceDefinition = {
  id: 'test-tour', version: '1', title: 'Test tour', autoStart: true,
  steps: [
    { id: 'intro', title: 'Introduction', body: 'A test step.' },
    { id: 'finish', title: 'Finish', body: 'The final step.' }
  ]
};

test('guidance progress is persisted per guide ID and version and can be resumed', () => {
  const storage = new TestStorage();
  const firstStore = new GuidanceProgressStore(storage);
  firstStore.save(guide, { version: '1', status: 'in-progress', stepIndex: 1, updatedAt: 42 });
  const secondStore = new GuidanceProgressStore(storage);
  assert.deepEqual(secondStore.load(guide), { version: '1', status: 'in-progress', stepIndex: 1, updatedAt: 42 });
  assert.notEqual(getGuidanceProgressKey(guide), getGuidanceProgressKey({ ...guide, version: '2' }));
  assert.equal(secondStore.load({ ...guide, version: '2' }), null, 'a new guide version should have fresh progress');
});

test('guidance repository rejects malformed or out-of-range progress instead of resuming an invalid step', () => {
  const storage = new TestStorage();
  const store = new GuidanceProgressStore(storage);
  storage.setItem(getGuidanceProgressKey(guide), JSON.stringify({ version: '1', status: 'in-progress', stepIndex: 99, updatedAt: 42 }));
  assert.equal(store.load(guide), null);
  assert.equal(storage.getItem(getGuidanceProgressKey(guide)), null, 'invalid persisted data is removed after being reported');
});

test('guidance definitions reject duplicate IDs and empty instructions at startup', () => {
  assert.throws(() => validateGuidanceDefinitions([guide, guide]), /Duplicate guidance definition ID/);
  assert.throws(() => validateGuidanceDefinitions([{ ...guide, steps: [] }]), /at least one step/);
  assert.throws(() => validateGuidanceDefinitions([{ ...guide, steps: [guide.steps[0], guide.steps[0]] }]), /duplicate step ID/);
  assert.doesNotThrow(() => validateGuidanceDefinitions([guide]));
});


test('guidance step navigation clamps the previous edge and completes only after the final step', () => {
  assert.deepEqual(rewindGuidance(guide, 0), { stepIndex: 0, completed: false });
  assert.deepEqual(advanceGuidance(guide, 0), { stepIndex: 1, completed: false });
  assert.deepEqual(advanceGuidance(guide, 1), { stepIndex: 1, completed: true });
  assert.throws(() => advanceGuidance(guide, -1), /outside guidance/);
  assert.throws(() => rewindGuidance(guide, 2), /outside guidance/);
});
