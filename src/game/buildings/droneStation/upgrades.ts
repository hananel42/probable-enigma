import type { BuildingUpgradeTier } from '../../upgrades/types';
import { add, multiply, set, universalSystems } from '../shared/upgrades';

/** Upgrade branch content belongs to this building and is registered automatically. */
export const upgrades: BuildingUpgradeTier[] = [
    {
      targetLevel: 2, title: 'Drone Doctrine', mode: 'CHOICE',
      options: [
        { id: 'expanded-drone-wing', name: 'Expanded Drone Wing', description: 'Supports one additional active combat drone.', effects: [add('maxDrones', 1)], aiPriority: 10 },
        { id: 'hardened-drone-frames', name: 'Hardened Drone Frames', description: 'Deployed drones gain 25% health.', effects: [multiply('droneHealthMultiplier', 1.25)], aiPriority: 8 }
      ]
    },
    { targetLevel: 3, title: 'Command Systems', mode: 'LINEAR', options: [universalSystems(1.12)] },
    {
      targetLevel: 4, title: 'Force Projection Package', mode: 'CHOICE',
      options: [
        { id: 'wide-area-control', name: 'Wide-Area Sensor Array', description: '+35% drone detection and defensive response radius.', effects: [multiply('range', 1.35)], aiPriority: 7 },
        { id: 'rapid-deployment', name: 'Rapid Deployment', description: 'Deploys replacement drones 35% faster.', effects: [multiply('droneProductionMultiplier', 1.35)], aiPriority: 9 }
      ]
    },
    { targetLevel: 5, title: 'Masterwork Command', mode: 'LINEAR', options: [universalSystems(1.18)] }
  ];
