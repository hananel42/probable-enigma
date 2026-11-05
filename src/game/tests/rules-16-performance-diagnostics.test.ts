import * as support from '../rulesTestSupport';
import {
  measurePerformance,
  recordPerformanceSample,
  reportPerformanceDiagnosticsNow,
  setPerformanceDiagnosticsEnabled
} from '../performance/PerformanceDiagnostics';

const { test } = support;
const assert: typeof support.assert = support.assert;

test('Performance diagnostics preserve return values and report stage timing without masking failures', () => {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const capturedInfo: unknown[][] = [];
  const capturedWarn: unknown[][] = [];
  console.info = ((...args: unknown[]) => { capturedInfo.push(args); }) as typeof console.info;
  console.warn = ((...args: unknown[]) => { capturedWarn.push(args); }) as typeof console.warn;
  try {
    setPerformanceDiagnosticsEnabled(true);
    const result = measurePerformance('test.performance.return', () => 42, { fixture: 'unit-test' });
    assert.equal(result, 42);

    const expected = new Error('diagnostic must not swallow the action error');
    assert.throws(() => measurePerformance('test.performance.throw', () => { throw expected; }), expected);
    recordPerformanceSample('test.performance.slow', 5.5, { fixture: 'slow-sample' });
    reportPerformanceDiagnosticsNow({ scenario: 'unit-test' });

    assert.ok(capturedWarn.some(args => args[0] === '[perf:slow] Expensive operation detected.'));
    const report = capturedInfo.find(args => args[0] === '[perf] Manual performance report.')?.[1] as
      { stages?: Array<{ stage: string }>; scenario?: string } | undefined;
    assert.equal(report?.scenario, 'unit-test');
    assert.ok(report?.stages?.some(stage => stage.stage === 'test.performance.return'));
    assert.ok(report?.stages?.some(stage => stage.stage === 'test.performance.throw'));
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
    setPerformanceDiagnosticsEnabled(true);
  }
});
