import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GuidanceOverlay } from './GuidanceOverlay';
import { APP_GUIDES } from './guides';
import { createBrowserGuidanceProgressStore, validateGuidanceDefinitions, type GuidanceProgressStore } from './progressStore';
import { advanceGuidance, rewindGuidance } from './navigation';
import type { GuidanceDefinition, GuidanceProgress, GuidanceProgressStatus } from './types';

interface ActiveGuidance {
  guideId: string;
  stepIndex: number;
}

export interface GuidanceContextValue {
  readonly activeGuide: GuidanceDefinition | null;
  readonly activeStepIndex: number;
  readonly startGuide: (id: string) => void;
  readonly restartGuide: (id: string) => void;
  readonly nextStep: () => void;
  readonly previousStep: () => void;
  readonly dismissGuide: () => void;
  readonly resetGuideProgress: (id: string) => void;
  readonly getGuideProgress: (id: string) => GuidanceProgress | null;
}

const GuidanceContext = createContext<GuidanceContextValue | null>(null);

function progressRecord(guide: GuidanceDefinition, stepIndex: number, status: GuidanceProgressStatus): GuidanceProgress {
  return { version: guide.version, status, stepIndex, updatedAt: Date.now() };
}

interface GuidanceProviderProps {
  children: React.ReactNode;
  guides?: readonly GuidanceDefinition[];
  /** Optional injection point for deterministic tests and applications with their own persistence adapter. */
  progressStore?: GuidanceProgressStore;
}

export const GuidanceProvider: React.FC<GuidanceProviderProps> = ({
  children,
  guides = APP_GUIDES,
  progressStore: suppliedStore
}) => {
  const guidesById = useMemo(() => {
    validateGuidanceDefinitions(guides);
    return new Map(guides.map(guide => [guide.id, guide]));
  }, [guides]);
  const [store] = useState(() => suppliedStore ?? createBrowserGuidanceProgressStore());
  const [progressById, setProgressById] = useState<Record<string, GuidanceProgress | null>>({});
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [active, setActive] = useState<ActiveGuidance | null>(null);
  const activeRef = useRef<ActiveGuidance | null>(null);
  activeRef.current = active;

  useEffect(() => {
    const loaded: Record<string, GuidanceProgress | null> = {};
    for (const guide of guides) loaded[guide.id] = store.load(guide);
    setProgressById(loaded);
    setProgressLoaded(true);
  }, [guides, store]);

  const persist = useCallback((guide: GuidanceDefinition, stepIndex: number, status: GuidanceProgressStatus) => {
    const value = progressRecord(guide, stepIndex, status);
    store.save(guide, value);
    setProgressById(current => ({ ...current, [guide.id]: value }));
  }, [store]);

  const startGuide = useCallback((id: string) => {
    const guide = guidesById.get(id);
    if (!guide) throw new Error(`Unknown guidance definition '${id}'.`);
    const saved = store.load(guide);
    const startIndex = saved?.status === 'in-progress' ? Math.min(saved.stepIndex, guide.steps.length - 1) : 0;
    persist(guide, startIndex, 'in-progress');
    setActive({ guideId: id, stepIndex: startIndex });
  }, [guidesById, persist, store]);

  const restartGuide = useCallback((id: string) => {
    const guide = guidesById.get(id);
    if (!guide) throw new Error(`Unknown guidance definition '${id}'.`);
    persist(guide, 0, 'in-progress');
    setActive({ guideId: id, stepIndex: 0 });
  }, [guidesById, persist]);

  const dismissGuide = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const guide = guidesById.get(current.guideId);
    if (!guide) throw new Error(`Active guidance '${current.guideId}' is no longer registered.`);
    persist(guide, current.stepIndex, 'dismissed');
    setActive(null);
  }, [guidesById, persist]);

  const nextStep = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const guide = guidesById.get(current.guideId);
    if (!guide) throw new Error(`Active guidance '${current.guideId}' is no longer registered.`);
    const next = advanceGuidance(guide, current.stepIndex);
    if (next.completed) {
      persist(guide, next.stepIndex, 'completed');
      setActive(null);
      return;
    }
    persist(guide, next.stepIndex, 'in-progress');
    setActive({ guideId: current.guideId, stepIndex: next.stepIndex });
  }, [guidesById, persist]);

  const previousStep = useCallback(() => {
    const current = activeRef.current;
    if (!current || current.stepIndex <= 0) return;
    const guide = guidesById.get(current.guideId);
    if (!guide) throw new Error(`Active guidance '${current.guideId}' is no longer registered.`);
    const previous = rewindGuidance(guide, current.stepIndex);
    persist(guide, previous.stepIndex, 'in-progress');
    setActive({ guideId: current.guideId, stepIndex: previous.stepIndex });
  }, [guidesById, persist]);

  const resetGuideProgress = useCallback((id: string) => {
    const guide = guidesById.get(id);
    if (!guide) throw new Error(`Unknown guidance definition '${id}'.`);
    store.remove(guide);
    setProgressById(current => ({ ...current, [id]: null }));
    if (activeRef.current?.guideId === id) setActive(null);
  }, [guidesById, store]);

  // Resume interrupted first-run guidance, or auto-start it once for a new version.
  useEffect(() => {
    if (!progressLoaded || active) return;
    const candidate = guides.find(guide => {
      if (!guide.autoStart) return false;
      const saved = progressById[guide.id];
      return saved === null || saved === undefined || saved.status === 'in-progress';
    });
    if (!candidate) return;
    const saved = progressById[candidate.id];
    const stepIndex = saved?.status === 'in-progress' ? Math.min(saved.stepIndex, candidate.steps.length - 1) : 0;
    if (!saved) persist(candidate, stepIndex, 'in-progress');
    setActive({ guideId: candidate.id, stepIndex });
  }, [active, guides, persist, progressById, progressLoaded]);

  const activeGuide = active ? guidesById.get(active.guideId) ?? null : null;
  const value = useMemo<GuidanceContextValue>(() => ({
    activeGuide,
    activeStepIndex: active?.stepIndex ?? 0,
    startGuide,
    restartGuide,
    nextStep,
    previousStep,
    dismissGuide,
    resetGuideProgress,
    getGuideProgress: (id: string) => progressById[id] ?? null
  }), [active, activeGuide, dismissGuide, nextStep, previousStep, progressById, resetGuideProgress, restartGuide, startGuide]);

  return (
    <GuidanceContext.Provider value={value}>
      {children}
      {activeGuide && (
        <GuidanceOverlay
          guide={activeGuide}
          stepIndex={Math.min(value.activeStepIndex, activeGuide.steps.length - 1)}
          onPrevious={previousStep}
          onNext={nextStep}
          onDismiss={dismissGuide}
        />
      )}
    </GuidanceContext.Provider>
  );
};

export function useGuidance(): GuidanceContextValue {
  const context = useContext(GuidanceContext);
  if (!context) throw new Error('useGuidance must be used inside GuidanceProvider.');
  return context;
}
