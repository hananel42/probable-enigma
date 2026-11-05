import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';
import { behavior } from './behavior';
import { BASE_DRONE_TUNING } from '../../combatTuning';
export function getStatLines(building: Building, entities: GameEntity[]): BuildingStatLine[] {
  const drones = entities.filter(entity => entity.kind === 'DRONE' && entity.parentStationId === building.id && entity.hp > 0).length;
  const fireRate = building.droneFireRateMultiplier || 1;
  const speed = behavior.kind === 'DRONE_STATION' ? behavior.baseDroneSpeed : 245;
  return [
    { label: 'ACTIVE DRONES', value: `${drones} / ${building.maxDrones || 2}` },
    { label: 'SENSOR RADIUS', value: `${Math.round(420 + Math.max(0, building.range - 260) * 1.5)}` },
    { label: 'DRONE DAMAGE', value: `${Math.round(BASE_DRONE_TUNING.damage * (building.droneDamageMultiplier || 1))}` },
    { label: 'DRONE HP', value: `${Math.round(70 * (building.droneHealthMultiplier || 1))}` },
    { label: 'DRONE CRUISE SPEED', value: `${Math.round(speed * (building.droneSpeedMultiplier || 1))} px/s`, help: 'Target cruising speed. Acceleration limiting smooths takeoff and braking near a hover point.' },
    { label: 'MAX FLIGHT SPEED', value: `${behavior.kind === 'DRONE_STATION' ? behavior.maximumDroneSpeed : 345} px/s`, help: 'Hard movement cap used by both direct flight and path-following; upgrades cannot make a drone teleport.' },
    { label: 'DRONE FIRE RATE', value: `${(fireRate / BASE_DRONE_TUNING.fireCooldown).toFixed(1)} shots/s`, help: `Station baseline ${BASE_DRONE_TUNING.fireCooldown.toFixed(2)} s between shots before temporary effects.` },
    { label: 'DEPLOY RATE', value: `${(building.droneProductionMultiplier || 1).toFixed(2)}x` }
  ];
}
