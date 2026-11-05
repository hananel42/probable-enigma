import type { BuildingUpgradeTier } from '../../upgrades/types';
import { multiply } from '../shared/upgrades';

/**
 * Core progression intentionally front-loads non-aggressive utility.
 * Every Core branch costs one Diamond; later combat branches are only offered at levels 4-5.
 */
export const upgrades: BuildingUpgradeTier[] = [
  {
    targetLevel: 2,
    title: 'Foundational Systems',
    mode: 'CHOICE',
    options: [
      {
        id: 'core_reinforced_matrix', name: 'Reinforced Matrix',
        description: 'Increase Core maximum HP by 25%. The added capacity is not a free repair.',
        effects: [multiply('maxHp', 1.25)], cost: { wood: 80, stone: 95, diamonds: 1 }, aiPriority: 10
      },
      {
        id: 'core_mining_accelerator', name: 'Mining Accelerator',
        description: 'The Commander mines 30% faster, improving early recovery without increasing weapon damage.',
        commanderEffects: [{ kind: 'MULTIPLY', stat: 'miningSpeedMultiplier', value: 1.3 }],
        cost: { wood: 110, stone: 60, diamonds: 1 }, aiPriority: 8
      }
    ]
  },
  {
    targetLevel: 3,
    title: 'Industrial Protocols',
    mode: 'CHOICE',
    options: [
      {
        id: 'core_efficient_extraction', name: 'Efficient Extraction',
        description: 'Increase resources harvested per mining batch by 35%.',
        commanderEffects: [{ kind: 'MULTIPLY', stat: 'miningYieldMultiplier', value: 1.35 }],
        cost: { wood: 90, stone: 120, diamonds: 1 }, aiPriority: 9
      },
      {
        id: 'core_swift_frame', name: 'Swift Frame',
        description: 'Increase Commander movement speed by 12% for quicker repositioning and recovery.',
        commanderEffects: [{ kind: 'MULTIPLY', stat: 'speed', value: 1.12 }],
        cost: { wood: 125, stone: 75, diamonds: 1 }, aiPriority: 7
      }
    ]
  },
  {
    targetLevel: 4,
    title: 'Combat Authorization',
    mode: 'CHOICE',
    options: [
      {
        id: 'core_weapon_calibration', name: 'Weapon Calibration',
        description: 'Increase Commander shot damage by 24%, but reduce mining yield by 8%.',
        commanderEffects: [
          { kind: 'MULTIPLY', stat: 'damage', value: 1.24 },
          { kind: 'MULTIPLY', stat: 'miningYieldMultiplier', value: 0.92 }
        ], cost: { wood: 145, stone: 135, diamonds: 1 }, aiPriority: 10
      },
      {
        id: 'core_rapid_trigger', name: 'Rapid Trigger',
        description: 'Increase firing rate by 22%, at the cost of 10% less damage per shot.',
        commanderEffects: [
          { kind: 'MULTIPLY', stat: 'fireCooldown', value: 0.82 },
          { kind: 'MULTIPLY', stat: 'damage', value: 0.9 }
        ], cost: { wood: 115, stone: 165, diamonds: 1 }, aiPriority: 9
      }
    ]
  },
  {
    targetLevel: 5,
    title: 'Advanced Combat Systems',
    mode: 'CHOICE',
    options: [
      {
        id: 'core_siege_optics', name: 'Siege Optics',
        description: 'Increase Commander weapon range by 25%, trading away 8% shot damage.',
        commanderEffects: [
          { kind: 'MULTIPLY', stat: 'range', value: 1.25 },
          { kind: 'MULTIPLY', stat: 'damage', value: 0.92 }
        ], cost: { wood: 175, stone: 170, diamonds: 1 }, aiPriority: 8
      },
      {
        id: 'core_heavy_pulse', name: 'Heavy Pulse',
        description: 'Increase Commander shot damage by 30%, with a 14% longer firing interval.',
        commanderEffects: [
          { kind: 'MULTIPLY', stat: 'damage', value: 1.3 },
          { kind: 'MULTIPLY', stat: 'fireCooldown', value: 1.14 }
        ], cost: { wood: 145, stone: 205, diamonds: 1 }, aiPriority: 9
      }
    ]
  }
];
