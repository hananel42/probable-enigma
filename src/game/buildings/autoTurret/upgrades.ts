import type { BuildingUpgradeTier } from '../../upgrades/types';
import { add, multiply, set } from '../shared/upgrades';

/**
 * Four independent branch choices let players combine modules in any order across tiers.
 * Stats are applied cumulatively; each module includes an intentional tradeoff.
 */
export const upgrades: BuildingUpgradeTier[] = [
  {
    targetLevel: 2, title: 'Ballistics Package', mode: 'CHOICE',
    options: [
      {
        id: 'long-barrel', name: 'Long-Barrel Optics',
        description: 'Increase range by 35%, but reduce damage per shot by 8%. A longer barrel and rear sight are rendered.',
        effects: [multiply('range', 1.35), multiply('damage', 0.92)],
        cost: { wood: 75, stone: 70, diamonds: 0 }, aiPriority: 11
      },
      {
        id: 'overcharged-rounds', name: 'Overcharged Rounds',
        description: 'Increase damage by 30%, but reduce projectile speed by 10%. The muzzle glows amber.',
        effects: [multiply('damage', 1.3), multiply('projectileSpeed', 0.9)],
        cost: { wood: 45, stone: 95, diamonds: 0 }, aiPriority: 8
      }
    ]
  },
  {
    targetLevel: 3, title: 'Projectile Guidance', mode: 'CHOICE',
    options: [
      {
        id: 'twin-barrel', name: 'Twin-Barrel Assembly',
        description: 'Fire two spread shots per volley, each at 68% damage. The firing interval is 12% longer.',
        effects: [set('shotsPerAttack', 2), multiply('damage', 0.68), multiply('fireCooldown', 1.12)],
        cost: { wood: 95, stone: 85, diamonds: 0 }, aiPriority: 8
      },
      {
        id: 'guided-rounds', name: 'Guided Rounds',
        description: 'Rounds gently steer toward the chosen target at a limited turn rate, but deal 10% less damage and travel 8% slower. Agile targets can still dodge.',
        effects: [set('projectileHomingStrength', 1.55), multiply('damage', 0.9), multiply('projectileSpeed', 0.92)],
        cost: { wood: 55, stone: 125, diamonds: 0 }, aiPriority: 9
      }
    ]
  },
  {
    targetLevel: 4, title: 'Payload Engineering', mode: 'CHOICE',
    options: [
      {
        id: 'high-velocity-rounds', name: 'High-Velocity Rounds',
        description: 'Increase projectile speed by 38%, but reduce damage by 5%. Fast rounds are harder to evade at range.',
        effects: [multiply('projectileSpeed', 1.38), multiply('damage', 0.95)],
        cost: { wood: 105, stone: 105, diamonds: 0 }, aiPriority: 7
      },
      {
        id: 'explosive-ordnance', name: 'Explosive Ordnance',
        description: 'Direct hits splash nearby hostiles within 58 units for 48% damage. Direct damage is reduced by 18%. Splash respects alliances.',
        effects: [set('explosionRadius', 58), set('explosionDamageMultiplier', 0.48), multiply('damage', 0.82)],
        cost: { wood: 130, stone: 90, diamonds: 0 }, aiPriority: 10
      }
    ]
  },
  {
    targetLevel: 5, title: 'Final Assembly', mode: 'CHOICE',
    options: [
      {
        id: 'rapid-cycle', name: 'Rapid-Cycle Actuator',
        description: 'Fire 28% faster, but each projectile deals 12% less damage. Actuator fins rotate while tracking.',
        effects: [multiply('fireCooldown', 0.72), multiply('damage', 0.88)],
        cost: { wood: 145, stone: 130, diamonds: 0 }, aiPriority: 10
      },
      {
        id: 'reinforced-bearing', name: 'Reinforced Bearing',
        description: 'Increase turret maximum HP by 25% and add 8% damage reduction, at the cost of a 10% longer firing interval.',
        effects: [multiply('maxHp', 1.25), add('armor', 0.08), multiply('fireCooldown', 1.1)],
        cost: { wood: 115, stone: 165, diamonds: 0 }, aiPriority: 8
      }
    ]
  }
];
