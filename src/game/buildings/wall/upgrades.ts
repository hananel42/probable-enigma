import type { BuildingUpgradeTier } from '../../upgrades/types';
import { add, multiply, set, universalSystems } from '../shared/upgrades';

/** Modular defenses: health, mitigation, reflection, and recovery remain independent stats. */
export const upgrades: BuildingUpgradeTier[] = [
  {
    targetLevel: 2, title: 'Defensive Specialization', mode: 'CHOICE',
    options: [
      {
        id: 'reinforced-plating', name: 'Reinforced Plating',
        description: 'Increase maximum HP by 45%. A thicker segmented armor frame gives the wall more time to absorb repeated hits.',
        effects: [multiply('maxHp', 1.45)], cost: { wood: 70, stone: 45, diamonds: 0 }, aiPriority: 9
      },
      {
        id: 'reactive-armor', name: 'Reactive Armor',
        description: 'Reduce every incoming hit by 18% (a 100-damage hit removes 82 HP) and reflect 12% of hostile projectiles back under this wall team.',
        effects: [add('armor', 0.18), add('projectileReflectChance', 0.12)], cost: { wood: 45, stone: 85, diamonds: 0 }, aiPriority: 10
      }
    ]
  },
  { targetLevel: 3, title: 'Structural Systems', mode: 'LINEAR', options: [universalSystems(1.12)] },
  {
    targetLevel: 4, title: 'Fortification Package', mode: 'CHOICE',
    options: [
      {
        id: 'bastion-frame', name: 'Bastion Frame',
        description: 'Increase maximum HP by 40% and add 5 percentage points of damage reduction.',
        effects: [multiply('maxHp', 1.4), add('armor', 0.05)], cost: { wood: 100, stone: 115, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'self-repairing-alloy', name: 'Self-Repairing Alloy',
        description: 'Regenerate 8 HP per second while alive. Repairing alloy is visible as green seams.',
        effects: [add('passiveRepairPerSecond', 8)], cost: { wood: 140, stone: 70, diamonds: 0 }, aiPriority: 7
      }
    ]
  },
  {
    targetLevel: 5, title: 'Reactive Defense Network', mode: 'CHOICE',
    options: [
      {
        id: 'mirror-weave', name: 'Mirror Weave',
        description: 'Add a further 30% projectile reflection chance, capped at 70% total, but reduce maximum HP by 12%. Reflected shots inherit this wall team and may hit their original attackers.',
        effects: [add('projectileReflectChance', 0.3), multiply('maxHp', 0.88)], cost: { wood: 125, stone: 165, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'fortress-keystone', name: 'Fortress Keystone',
        description: 'Increase maximum HP by 30%, gain 10% damage reduction, and repair 3 HP/s more slowly than the self-repairing alloy.',
        effects: [multiply('maxHp', 1.3), add('armor', 0.1), add('passiveRepairPerSecond', 3)], cost: { wood: 165, stone: 145, diamonds: 0 }, aiPriority: 8
      }
    ]
  }
];
