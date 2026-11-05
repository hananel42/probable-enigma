import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, X } from 'lucide-react';
import type { GuidanceDefinition, GuidanceStep } from './types';

interface RectSnapshot {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface GuidanceOverlayProps {
  guide: GuidanceDefinition;
  stepIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onDismiss: () => void;
}

function readTargetRect(target: string | undefined): RectSnapshot | null {
  if (!target) return null;
  const element = [...document.querySelectorAll<HTMLElement>('[data-guide-target]')]
    .find(candidate => candidate.dataset.guideTarget === target);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function getCardPosition(rect: RectSnapshot | null, step: GuidanceStep): React.CSSProperties {
  if (!rect || typeof window === 'undefined') {
    return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }
  const margin = 12;
  // Keep the card inside very narrow mobile viewports instead of enforcing a wider minimum.
  const cardWidth = Math.max(1, Math.min(360, window.innerWidth - margin * 2));
  const estimatedCardHeight = Math.min(270, Math.max(205, window.innerHeight * 0.36));
  const placement = step.placement ?? 'bottom';
  let top: number;
  if (placement === 'top' || (placement === 'bottom' && rect.bottom + estimatedCardHeight + 20 > window.innerHeight)) {
    top = rect.top - estimatedCardHeight - 14;
  } else if (placement === 'center') {
    top = (window.innerHeight - estimatedCardHeight) / 2;
  } else {
    top = rect.bottom + 14;
  }
  const left = placement === 'left'
    ? rect.left - cardWidth - 14
    : placement === 'right'
      ? rect.right + 14
      : rect.left + rect.width / 2 - cardWidth / 2;
  return {
    left: Math.max(margin, Math.min(window.innerWidth - cardWidth - margin, left)),
    top: Math.max(margin, Math.min(window.innerHeight - estimatedCardHeight - margin, top)),
    width: cardWidth,
    maxHeight: window.innerHeight - margin * 2,
    overflowY: 'auto'
  };
}

function useTargetRect(target: string | undefined): RectSnapshot | null {
  const [rect, setRect] = useState<RectSnapshot | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        setRect(readTargetRect(target));
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const targetElement = target
      ? [...document.querySelectorAll<HTMLElement>('[data-guide-target]')].find(element => element.dataset.guideTarget === target)
      : null;
    if (targetElement && observer) observer.observe(targetElement);
    if (observer) observer.observe(document.documentElement);
    const mutationObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update);
    mutationObserver?.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);
  return rect;
}

/** Shared accessible coach-mark overlay used by all registered guides. */
export const GuidanceOverlay: React.FC<GuidanceOverlayProps> = ({ guide, stepIndex, onPrevious, onNext, onDismiss }) => {
  const step = guide.steps[stepIndex];
  const rect = useTargetRect(step.target);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const position = getCardPosition(rect, step);
  const hasTarget = Boolean(rect);
  const spotlightPadding = 6;

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onNext();
    } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, [onDismiss, onNext, onPrevious, stepIndex]);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    nextButtonRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown, stepIndex]);

  const blockerStyle = (left: number, top: number, width: number, height: number): React.CSSProperties => ({
    position: 'fixed', left, top, width: Math.max(0, width), height: Math.max(0, height),
    background: 'rgba(2, 6, 23, 0.78)', pointerEvents: 'auto'
  });

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="guidance-overlay">
      {hasTarget && rect ? (
        <>
          <div aria-hidden="true" style={blockerStyle(0, 0, window.innerWidth, Math.max(0, rect.top - spotlightPadding))} />
          <div aria-hidden="true" style={blockerStyle(0, rect.top - spotlightPadding, Math.max(0, rect.left - spotlightPadding), rect.height + spotlightPadding * 2)} />
          <div aria-hidden="true" style={blockerStyle(rect.right + spotlightPadding, rect.top - spotlightPadding, Math.max(0, window.innerWidth - rect.right - spotlightPadding), rect.height + spotlightPadding * 2)} />
          <div aria-hidden="true" style={blockerStyle(0, rect.bottom + spotlightPadding, window.innerWidth, Math.max(0, window.innerHeight - rect.bottom - spotlightPadding))} />
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-sm border-2 border-cyan-200 shadow-[0_0_0_2px_rgba(8,145,178,0.35),0_0_24px_rgba(34,211,238,0.36)]"
            style={{ top: rect.top - spotlightPadding, left: rect.left - spotlightPadding, width: rect.width + spotlightPadding * 2, height: rect.height + spotlightPadding * 2 }}
          />
        </>
      ) : <div aria-hidden="true" className="fixed inset-0 bg-slate-950/80" />}

      <section
        role="dialog"
        aria-modal="true"
        ref={dialogRef}
        aria-labelledby="guidance-step-title"
        aria-describedby="guidance-step-body"
        className="fixed z-[10002] border border-cyan-300/35 bg-slate-950/95 p-5 text-slate-100 shadow-2xl shadow-black/70 backdrop-blur-md"
        style={position}
        data-testid="guidance-card"
      >
        <header className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <BookOpen size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300">{guide.title} · Step {stepIndex + 1} of {guide.steps.length}</div>
            <h2 id="guidance-step-title" className="mt-1 text-base font-bold tracking-[0.06em]">{step.title}</h2>
          </div>
          <button type="button" onClick={onDismiss} aria-label="Close guide" title="Close guide" className="flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white">
            <X size={16} />
          </button>
        </header>
        <p id="guidance-step-body" className="text-sm leading-relaxed text-slate-300">{step.body}</p>
        {!hasTarget && step.target && <p className="mt-3 text-xs text-amber-200">This part of the interface is not visible right now. You can continue and return to the guide later.</p>}
        <div className="mt-5 h-1 overflow-hidden bg-slate-800" aria-label="Guide progress">
          <div className="h-full bg-cyan-300 transition-[width]" style={{ width: `${((stepIndex + 1) / guide.steps.length) * 100}%` }} />
        </div>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onDismiss} className="min-h-9 px-2 text-[10px] font-bold tracking-[0.12em] text-slate-400 hover:text-slate-100">SKIP GUIDE</button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onPrevious} disabled={stepIndex === 0} className="inline-flex min-h-9 items-center gap-1 border border-slate-700 px-3 text-[10px] font-bold tracking-[0.1em] text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-35">
              <ArrowLeft size={13} /> BACK
            </button>
            <button ref={nextButtonRef} type="button" onClick={onNext} className="inline-flex min-h-9 items-center gap-1 border border-cyan-200/60 bg-cyan-200/10 px-3 text-[10px] font-bold tracking-[0.1em] text-cyan-100 hover:bg-cyan-200/20">
              {stepIndex === guide.steps.length - 1 ? 'FINISH' : 'NEXT'} <ArrowRight size={13} />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
};
