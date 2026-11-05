import type { BuildingUpgradeTier } from '../../upgrades/types';
import { add, addTowerEffect, multiply, set } from '../shared/upgrades';

/**
 * Effect Tower upgrades are composable modes, not hard-coded tower variants.
 * The ordered upgrade history records the path while towerEffectIds stores the active effect set.
 */
export const upgrades: BuildingUpgradeTier[] = [
  {
    targetLevel: 2, title: 'Wave Chemistry', mode: 'CHOICE',
    options: [
      {
        id: 'cryo-surge', name: 'Cryogenic Surge',
        description: 'Adds a slowing wave (42% movement reduction for 2.8 s), but pulse damage is 12% lower. The wave core turns cyan.',
        effects: [addTowerEffect('slowing'), multiply('damage', 0.88), set('effectDuration', 2.8)],
        cost: { wood: 55, stone: 105, diamonds: 0 }, aiPriority: 9
      },
      {
        id: 'flashover-coils', name: 'Flashover Coils',
        description: 'Increase burning damage by 40% and burn duration by 20%, but reduce wave radius by 8%.',
        effects: [multiply('burnDamagePerSecond', 1.4), multiply('effectDuration', 1.2), multiply('fireRadius', 0.92)],
        cost: { wood: 100, stone: 65, diamonds: 0 }, aiPriority: 10
      }
    ]
  },
  {
    targetLevel: 3, title: 'Control Spectrum', mode: 'CHOICE',
    options: [
      {
        id: 'signal-suppression', name: 'Signal Suppression',
        description: 'Adds a 38% enemy firing-rate reduction for the effect duration. Suppression waves deal 10% less direct damage.',
        effects: [addTowerEffect('signal-suppression'), multiply('damage', 0.9), set('effectDuration', 2.6)],
        cost: { wood: 70, stone: 120, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'weakened-shots', name: 'Weakening Wave',
        description: 'Adds a 35% reduction to enemy projectile power for the effect duration. Radius is reduced by 6%.',
        effects: [addTowerEffect('weakened-shots'), multiply('fireRadius', 0.94), set('effectDuration', 2.8)],
        cost: { wood: 115, stone: 75, diamonds: 0 }, aiPriority: 8
      }
    ]
  },
  {
    targetLevel: 4, title: 'Disruption Package', mode: 'CHOICE',
    options: [
      {
        id: 'radio-jammer', name: 'Radio Jammer',
        description: 'Adds radio disruption: drones suffer 24 HP/s and 50% slower firing; Commanders take only 0.25 HP/s. The tower emits a violet interference ring.',
        effects: [addTowerEffect('radio-jamming'), multiply('fireCooldown', 1.12), set('effectDuration', 2.2)],
        cost: { wood: 85, stone: 145, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'corrosive-wave', name: 'Corrosive Wave',
        description: 'Adds corrosion: 4 HP/s and 35% lower effective armor for a short duration. Direct pulse damage is 8% lower.',
        effects: [addTowerEffect('corrosion'), multiply('damage', 0.92), set('effectDuration', 3.2)],
        cost: { wood: 130, stone: 90, diamonds: 0 }, aiPriority: 9
      }
    ]
  },
  {
    targetLevel: 5, title: 'Master Spectrum', mode: 'CHOICE',
    options: [
      {
        id: 'wide-spectrum', name: 'Wide-Spectrum Wave',
        description: 'Adds slowing, suppression, and weakened shots to the current effect mix, but reduces radius and direct damage by 15%. Effect durations become 2.5 s.',
        effects: [addTowerEffect('slowing'), addTowerEffect('signal-suppression'), addTowerEffect('weakened-shots'), multiply('fireRadius', 0.85), multiply('damage', 0.85), set('effectDuration', 2.5)],
        cost: { wood: 155, stone: 150, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'rapid-wave', name: 'Rapid Wave Driver',
        description: 'Launch waves 28% more often and 20% faster, but reduce the radius by 10%. All installed effect modes remain active.',
        effects: [multiply('fireCooldown', 0.72), multiply('pulseDuration', 0.8), multiply('fireRadius', 0.9)],
        cost: { wood: 135, stone: 175, diamonds: 0 }, aiPriority: 8
      }
    ]
  }
];
