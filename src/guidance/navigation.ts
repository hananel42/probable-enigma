import type { GuidanceDefinition } from './types';

export interface GuidanceNavigationResult {
  readonly stepIndex: number;
  readonly completed: boolean;
}

/** Shared step-boundary policy keeps keyboard, button, and future event-driven navigation consistent. */
export function advanceGuidance(guide: GuidanceDefinition, currentIndex: number): GuidanceNavigationResult {
  assertStepIndex(guide, currentIndex);
  if (currentIndex === guide.steps.length - 1) return { stepIndex: currentIndex, completed: true };
  return { stepIndex: currentIndex + 1, completed: false };
}

export function rewindGuidance(guide: GuidanceDefinition, currentIndex: number): GuidanceNavigationResult {
  assertStepIndex(guide, currentIndex);
  return { stepIndex: Math.max(0, currentIndex - 1), completed: false };
}

function assertStepIndex(guide: GuidanceDefinition, stepIndex: number): void {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= guide.steps.length) {
    throw new RangeError(`Step index ${stepIndex} is outside guidance '${guide.id}'.`);
  }
}
