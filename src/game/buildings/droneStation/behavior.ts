import type { BuildingBehavior, BuildingRuntimeContext } from '../types';
import { createCombatDrone, findFreeAdjacentSpawnPosition } from '../../rules';
/** Drone movement and combat tuning is shared with the entity AI. */
export const behavior = {
  kind: 'DRONE_STATION', baseProductionInterval: 9, defaultCapacity: 2,
  baseDroneSpeed: 300, maximumDroneSpeed: 390, acceleration: 1950,
  arrivalSlowdownDistance: 72, formationSpeed: 278,
  combatOrbitSpeed: 255, combatOrbitRadiusX: 132, combatOrbitRadiusY: 112,
  escortOrbitSpeed: 238, escortTetherBlocks: 10,
  defenseOrbitPaddingX: 178, defenseOrbitPaddingY: 158
} as const satisfies BuildingBehavior & { baseDroneSpeed: number; maximumDroneSpeed: number; acceleration: number; arrivalSlowdownDistance: number; formationSpeed: number; combatOrbitSpeed: number; combatOrbitRadiusX: number; combatOrbitRadiusY: number; escortOrbitSpeed: number; escortTetherBlocks: number; defenseOrbitPaddingX: number; defenseOrbitPaddingY: number };
export function update(building: import('../../types').Building, context: BuildingRuntimeContext): void {
  if (behavior.kind !== 'DRONE_STATION') return;
  building.spawnTimer = (building.spawnTimer ?? behavior.baseProductionInterval) - context.dt;
  if (building.spawnTimer > 0) return;
  building.spawnTimer = behavior.baseProductionInterval / Math.max(0.25, building.droneProductionMultiplier || 1);
  const drones = context.state.entities.reduce((n, e) => n + (e.kind === 'DRONE' && e.parentStationId === building.id && e.hp > 0 ? 1 : 0), 0);
  if (drones >= (building.maxDrones || 2)) return;
  const spawn = findFreeAdjacentSpawnPosition(building, true, context.state.buildings, context.resourceNodes);
  context.spawnEntity(createCombatDrone(building, spawn));
  if (building.faction === 'player') context.playSound('build');
}
