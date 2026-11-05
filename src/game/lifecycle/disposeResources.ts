/** A named cleanup action owned by a React effect or another runtime lifecycle. */
export type ResourceDisposer = readonly [resource: string, dispose: () => void];

/** Structured error reported when one resource could not be released. */
export interface ResourceDisposalFailure {
  readonly resource: string;
  readonly error: unknown;
}

export type DisposalErrorReporter = (message: string, details?: unknown) => void;

/**
 * Dispose every resource even when an earlier disposer fails.
 *
 * Cleanup usually runs during a React commit/unmount. Throwing an AggregateError
 * from that lifecycle turns a recoverable cleanup problem into an uncaught app
 * error and can leave the room view unmounted. This helper therefore reports the
 * individual failures plus one AggregateError, returns the failures for callers
 * that need metrics, and deliberately does not throw.
 */
export function disposeResources(
  label: string,
  disposers: ReadonlyArray<ResourceDisposer>,
  reportError: DisposalErrorReporter = (message, details) => console.error(message, details)
): readonly ResourceDisposalFailure[] {
  const failures: ResourceDisposalFailure[] = [];
  for (const [resource, dispose] of disposers) {
    try {
      dispose();
    } catch (error) {
      failures.push({ resource, error });
      reportError(`[${label}] Resource cleanup failed for '${resource}'; continuing cleanup.`, { error });
    }
  }

  if (failures.length > 0) {
    const aggregate = new AggregateError(
      failures.map(failure => failure.error),
      `${label} cleanup encountered ${failures.length} error(s).`
    );
    reportError(`[${label}] One or more resource disposers failed; teardown continued.`, aggregate);
  }
  return failures;
}
