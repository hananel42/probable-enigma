/** Placement of the reusable guidance card relative to its target element. */
export type GuidancePlacement = 'top' | 'right' | 'bottom' | 'left' | 'center';

/** One independently addressable step in an onboarding tour, feature guide, or contextual walkthrough. */
export interface GuidanceStep {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Value of the target element's data-guide-target attribute. Omit for a centered informational step. */
  readonly target?: string;
  readonly placement?: GuidancePlacement;
}

/**
 * Data-only definition shared by first-run onboarding and future contextual guides.
 * Increment `version` when an existing guide changes enough that users should see it again.
 */
export interface GuidanceDefinition {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly steps: readonly GuidanceStep[];
  /** Start automatically on a fresh visit. A dismissed/completed version will not auto-start again. */
  readonly autoStart?: boolean;
}

export type GuidanceProgressStatus = 'in-progress' | 'completed' | 'dismissed';

/** Persisted progress belongs to a particular guide version, not to the whole application. */
export interface GuidanceProgress {
  readonly version: string;
  readonly status: GuidanceProgressStatus;
  readonly stepIndex: number;
  readonly updatedAt: number;
}
