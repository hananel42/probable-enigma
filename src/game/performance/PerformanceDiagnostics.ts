/** Low-overhead aggregated timing diagnostics for finding simulation stalls. */
export type PerformanceDetails = Record<string, string | number | boolean | null | undefined>;

interface TimingBucket {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

const REPORT_INTERVAL_MS = 5_000;
const DEFAULT_SLOW_SAMPLE_THRESHOLD_MS = 4;
const SLOW_LOG_COOLDOWN_MS = 1_500;
const buckets = new Map<string, TimingBucket>();
const lastSlowLogByStage = new Map<string, number>();
let enabled = true;
let lastReportAtMs = now();
let windowStartedAtMs = lastReportAtMs;
let slowSampleCount = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function cleanDetails(details: PerformanceDetails | undefined): PerformanceDetails | undefined {
  if (!details) return undefined;
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

export function isPerformanceDiagnosticsEnabled(): boolean {
  return enabled;
}

export function setPerformanceDiagnosticsEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled;
  lastReportAtMs = now();
  windowStartedAtMs = lastReportAtMs;
  buckets.clear();
  lastSlowLogByStage.clear();
  slowSampleCount = 0;
  console.info(`[perf] Runtime performance diagnostics ${enabled ? 'enabled' : 'disabled'}.`);
}

/** Record one elapsed-time sample. Stages are aggregated to keep normal logging quiet. */
export function recordPerformanceSample(
  stage: string,
  durationMs: number,
  details?: PerformanceDetails
): void {
  if (!enabled || !Number.isFinite(durationMs) || durationMs < 0) return;
  const bucket = buckets.get(stage) ?? { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  bucket.count += 1;
  bucket.totalMs += durationMs;
  bucket.maxMs = Math.max(bucket.maxMs, durationMs);
  bucket.lastMs = durationMs;
  buckets.set(stage, bucket);

  // Frame intervals are not synchronous work durations: ~16.7 ms is normal at
  // 60 Hz, so only flag intervals that indicate an actual missed-frame stall.
  const thresholdMs = stage === 'client.renderFrameInterval' ? 34 : DEFAULT_SLOW_SAMPLE_THRESHOLD_MS;
  if (durationMs < thresholdMs) return;
  slowSampleCount += 1;
  const timestamp = now();
  const last = lastSlowLogByStage.get(stage) ?? Number.NEGATIVE_INFINITY;
  if (timestamp - last < SLOW_LOG_COOLDOWN_MS) return;
  lastSlowLogByStage.set(stage, timestamp);
  console.warn('[perf:slow] Expensive operation detected.', {
    stage,
    durationMs: Number(durationMs.toFixed(3)),
    thresholdMs,
    ...cleanDetails(details)
  });
}

/** Measure a synchronous phase without changing its return value or exception behavior. */
export function measurePerformance<T>(
  stage: string,
  action: () => T,
  details?: PerformanceDetails
): T {
  if (!enabled) return action();
  const startedAt = now();
  try {
    return action();
  } finally {
    recordPerformanceSample(stage, now() - startedAt, details);
  }
}

function buildReport(context?: PerformanceDetails) {
  const measuredWindowMs = Math.max(0, now() - windowStartedAtMs);
  const stages = [...buckets.entries()]
    .map(([stage, sample]) => ({
      stage,
      calls: sample.count,
      totalMs: Number(sample.totalMs.toFixed(3)),
      averageMs: Number((sample.totalMs / sample.count).toFixed(3)),
      maxMs: Number(sample.maxMs.toFixed(3)),
      lastMs: Number(sample.lastMs.toFixed(3))
    }))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 18);
  return {
    windowMs: Math.round(measuredWindowMs),
    slowSamplesAtOrAboveThreshold: slowSampleCount,
    defaultSlowThresholdMs: DEFAULT_SLOW_SAMPLE_THRESHOLD_MS,
    stages,
    ...cleanDetails(context)
  };
}

function clearWindow(): void {
  buckets.clear();
  slowSampleCount = 0;
  windowStartedAtMs = now();
  lastReportAtMs = windowStartedAtMs;
}

/** Print one aggregate report at most every five seconds. Call once per server tick. */
export function flushPerformanceDiagnostics(context?: PerformanceDetails): void {
  if (!enabled) return;
  const timestamp = now();
  if (timestamp - lastReportAtMs < REPORT_INTERVAL_MS) return;
  console.info('[perf] Simulation performance window.', buildReport(context));
  clearWindow();
}

/** Immediately report and reset the current window; useful from DevTools. */
export function reportPerformanceDiagnosticsNow(context?: PerformanceDetails): void {
  console.info('[perf] Manual performance report.', buildReport(context));
  clearWindow();
}

/** Install an opt-in console control surface without requiring devtools imports. */
if (typeof window !== 'undefined') {
  (window as Window & { craftboundPerformance?: {
    setEnabled: typeof setPerformanceDiagnosticsEnabled;
    reportNow: typeof reportPerformanceDiagnosticsNow;
    isEnabled: typeof isPerformanceDiagnosticsEnabled;
  } }).craftboundPerformance = {
    setEnabled: setPerformanceDiagnosticsEnabled,
    reportNow: reportPerformanceDiagnosticsNow,
    isEnabled: isPerformanceDiagnosticsEnabled
  };
}
