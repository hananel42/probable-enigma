import type { BuildingUpgradeTier } from '../../upgrades/types';
import { add, multiply, set, universalSystems } from '../shared/upgrades';

/** Upgrade branch content belongs to this building and is registered automatically. */
export const upgrades: BuildingUpgradeTier[] = [
    {
      targetLevel: 2, title: 'Industrial Specialization', mode: 'CHOICE',
      options: [
        { id: 'expanded-workforce', name: 'Expanded Workforce', description: 'Supports one additional active mining rover.', effects: [add('maxBots', 1)], aiPriority: 10 },
        { id: 'deep-silo', name: 'Deep Silo', description: '+70% station storage capacity.', effects: [multiply('maxCapacity', 1.7)], aiPriority: 7 }
      ]
    },
    { targetLevel: 3, title: 'Industrial Systems', mode: 'LINEAR', options: [universalSystems(1.12)] },
    {
      targetLevel: 4, title: 'Logistics Package', mode: 'CHOICE',
      options: [
        { id: 'rapid-extraction', name: 'Rapid Extraction Tools', description: 'Rovers mine 35% faster.', effects: [multiply('miningSpeedMultiplier', 1.35)], aiPriority: 9 },
        { id: 'heavy-cargo-rigs', name: 'Heavy Cargo Rigs', description: 'Rovers carry 50% more per trip.', effects: [multiply('botCargoCapacityMultiplier', 1.5)], aiPriority: 8 }
      ]
    },
    { targetLevel: 5, title: 'Masterwork Logistics', mode: 'LINEAR', options: [universalSystems(1.18)] }
  ];
