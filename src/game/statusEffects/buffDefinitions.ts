import type { BuffDefinition } from '../types';

/** Data-only buff registry. New effects should be added here, not to GameEngine. */
export const BUFF_DEFINITIONS = {
  burning: {
    id: 'burning',
    name: 'Burning',
    durationSeconds: 3,
    healthPerSecond: -14,
    effect: {
      particleColor: '#ef4444',
      particleRate: 7,
      particleSize: 2.5,
      markerColor: '#f97316',
      markerShape: 'flame'
    },
    reapply: 'STRONGEST'
  }
} satisfies Record<string, BuffDefinition>;
