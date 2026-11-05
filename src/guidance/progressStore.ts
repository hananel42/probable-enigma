import type { GuidanceDefinition, GuidanceProgress, GuidanceProgressStatus } from './types';

export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_PREFIX = 'craftbound:guidance:v1';
const VALID_STATUSES = new Set<GuidanceProgressStatus>(['in-progress', 'completed', 'dismissed']);

/** Versioned storage keys let changed guides be shown again without clearing other user preferences. */
export function getGuidanceProgressKey(guide: Pick<GuidanceDefinition, 'id' | 'version'>): string {
  if (!guide.id.trim() || !guide.version.trim()) throw new TypeError('Guidance IDs and versions must be non-empty.');
  return `${STORAGE_PREFIX}:${encodeURIComponent(guide.id)}:${encodeURIComponent(guide.version)}`;
}

/** Validate definitions once at the application boundary rather than failing midway through a tour. */
export function validateGuidanceDefinitions(guides: readonly GuidanceDefinition[]): void {
  const guideIds = new Set<string>();
  for (const guide of guides) {
    if (!guide.id.trim() || !guide.version.trim() || !guide.title.trim()) {
      throw new TypeError('Every guidance definition requires a non-empty ID, version, and title.');
    }
    if (guideIds.has(guide.id)) throw new TypeError(`Duplicate guidance definition ID '${guide.id}'.`);
    guideIds.add(guide.id);
    if (guide.steps.length === 0) throw new TypeError(`Guidance '${guide.id}' must contain at least one step.`);
    const stepIds = new Set<string>();
    for (const step of guide.steps) {
      if (!step.id.trim() || !step.title.trim() || !step.body.trim()) {
        throw new TypeError(`Every step in guidance '${guide.id}' requires a non-empty ID, title, and body.`);
      }
      if (stepIds.has(step.id)) throw new TypeError(`Guidance '${guide.id}' contains duplicate step ID '${step.id}'.`);
      stepIds.add(step.id);
      if (step.target !== undefined && !step.target.trim()) {
        throw new TypeError(`Guidance step '${guide.id}/${step.id}' has an empty target.`);
      }
    }
  }
}

function isProgress(value: unknown, guide: GuidanceDefinition): value is GuidanceProgress {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.version === guide.version &&
    typeof record.status === 'string' && VALID_STATUSES.has(record.status as GuidanceProgressStatus) &&
    typeof record.stepIndex === 'number' && Number.isSafeInteger(record.stepIndex) &&
    record.stepIndex >= 0 && record.stepIndex < guide.steps.length &&
    typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) && record.updatedAt >= 0;
}

/**
 * Reusable versioned progress repository. Storage failures are reported once and
 * degrade to page-memory progress so restricted browser storage cannot crash the game.
 */
export class GuidanceProgressStore {
  private readonly memory = new Map<string, string>();
  private storageWarningShown = false;

  constructor(private readonly storage?: StringStorage) {}

  load(guide: GuidanceDefinition): GuidanceProgress | null {
    const key = getGuidanceProgressKey(guide);
    let serialized: string | null = this.memory.get(key) ?? null;
    if (this.storage) {
      try {
        serialized = this.storage.getItem(key) ?? serialized;
      } catch (error) {
        this.warnStorageFailure('read', error);
      }
    }
    if (serialized === null) return null;

    try {
      const parsed: unknown = JSON.parse(serialized);
      if (isProgress(parsed, guide)) return parsed;
      console.warn(`[guidance] Ignoring invalid saved progress for '${guide.id}' version '${guide.version}'.`);
      this.remove(guide);
      return null;
    } catch (error) {
      console.warn(`[guidance] Could not parse saved progress for '${guide.id}'.`, error);
      this.remove(guide);
      return null;
    }
  }

  save(guide: GuidanceDefinition, progress: GuidanceProgress): void {
    if (!isProgress(progress, guide)) throw new TypeError(`Invalid progress for guidance '${guide.id}'.`);
    const key = getGuidanceProgressKey(guide);
    const serialized = JSON.stringify(progress);
    this.memory.set(key, serialized);
    try {
      this.storage?.setItem(key, serialized);
    } catch (error) {
      this.warnStorageFailure('write', error);
    }
  }

  remove(guide: GuidanceDefinition): void {
    const key = getGuidanceProgressKey(guide);
    this.memory.delete(key);
    try {
      this.storage?.removeItem(key);
    } catch (error) {
      this.warnStorageFailure('remove', error);
    }
  }

  private warnStorageFailure(operation: string, error: unknown): void {
    if (this.storageWarningShown) return;
    this.storageWarningShown = true;
    console.warn(`[guidance] Browser storage could not ${operation} progress; progress will remain in memory for this page.`, error);
  }
}

/** Browser storage is optional: restricted/private contexts still get an in-memory guide. */
export function createBrowserGuidanceProgressStore(): GuidanceProgressStore {
  try {
    if (typeof window === 'undefined') return new GuidanceProgressStore();
    return new GuidanceProgressStore(window.localStorage);
  } catch (error) {
    console.warn('[guidance] Persistent browser storage is unavailable; progress will remain in memory for this page.', error);
    return new GuidanceProgressStore();
  }
}
