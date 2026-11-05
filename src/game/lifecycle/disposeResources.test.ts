import test from 'node:test';
import assert from 'node:assert/strict';
import { disposeResources } from './disposeResources';

test('resource cleanup continues after a disposer fails and reports instead of throwing during teardown', () => {
  const called: string[] = [];
  const reports: Array<{ message: string; details?: unknown }> = [];
  const disposalError = new Error('renderer was already stopped');

  assert.doesNotThrow(() => {
    const failures = disposeResources('test teardown', [
      ['renderer', () => { called.push('renderer'); throw disposalError; }],
      ['transport', () => { called.push('transport'); }],
      ['simulation', () => { called.push('simulation'); }]
    ], (message, details) => reports.push({ message, details }));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].resource, 'renderer');
    assert.equal(failures[0].error, disposalError);
  });

  assert.deepEqual(called, ['renderer', 'transport', 'simulation'], 'one failing disposer must not prevent later resources from being released');
  assert.equal(reports.length, 2, 'the individual error and aggregate diagnostic are both reported');
  assert.ok(reports[1].details instanceof AggregateError);
  assert.match(reports[1].message, /teardown continued/);
});
