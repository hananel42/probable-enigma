# Interactive guidance framework

## Purpose

The first-visit briefing is the first consumer of a reusable guidance system. The same system can support future tutorials, contextual feature tours, help walkthroughs, and release-specific onboarding without implementing a new overlay or progress store for each feature.

## Architecture

- `src/guidance/types.ts` defines data-only guide and step contracts.
- `src/guidance/guides.ts` contains application guide definitions. Text, target anchors, and order live in data rather than in screen event handlers.
- `src/guidance/progressStore.ts` validates definitions and stores progress under `guide ID + version`. A changed guide can be replayed by incrementing its version without clearing unrelated preferences.
- `src/guidance/GuidanceProvider.tsx` owns the active guide, current step, navigation, automatic first-run startup, and progress lifecycle.
- `src/guidance/GuidanceOverlay.tsx` is the single shared accessible coach-mark UI. It locates targets, follows target movement/resizing, manages keyboard navigation, and renders the same controls for all guides.
- `data-guide-target="stable-key"` marks an element that can be highlighted. Use stable semantic keys; do not bind guides to styling classes or deeply nested DOM selectors.

## Add a guide

1. Add a `GuidanceDefinition` to `APP_GUIDES` (or provide a separate definitions list to `GuidanceProvider`). Give it a unique `id`, a human-maintained `version`, and non-empty step IDs/titles/body text.
2. Add `data-guide-target` anchors to the relevant interactive elements. One anchor may be reused by multiple guide definitions.
3. Use `autoStart: true` only for a guide intended to open on a new version's first visit. Dismissed and completed versions do not automatically restart; a user can open them again through `useGuidance().startGuide(id)`.
4. Keep tour content in English and make each step useful when read on its own. If the underlying screen may not be visible, omit a target for an informational step or let the overlay explain that its target is currently unavailable.
5. Add pure-model tests for persistence/version behavior and a UI integration test when a browser test harness is available.

## Persistence and failure behavior

Progress is local to the current browser profile. It records `in-progress`, `completed`, or `dismissed` plus the last step. Interrupted tours resume from their last step. Storage is optional: if browser storage is restricted, the framework reports the problem and keeps progress in page memory so guidance cannot prevent the game from loading. Invalid stored records are reported and discarded; they are never used as a step index.

## Keyboard and accessibility

- `ArrowRight`: next step.
- `ArrowLeft`: previous step.
- `Escape`: close/skip the current guide.
- Every step uses a dialog with a title, description, visible progress, and labelled controls.
- Steps should not require color perception alone to convey instructions. The target is highlighted, but the text also describes its role.
