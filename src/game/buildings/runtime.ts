import { sound } from '../audio';
import { applyEntityDamage, findPriorityHostileTarget } from '../combat';
import { distance } from '../rules';
import { isBuildingOperational } from '../coreStatus';
import { BUILDING_MODULES } from './registry';
import type { Building, GameEntity } from '../types';
import type { GameEngineState } from '../engine';

export interface BuildingRuntimeHost {
  state: GameEngineState;
  createSparks(x: number, y: number, color: string, count?: number, particleSize?: number): void;
  triggerStateChange(): void;
  resolveCachedBuildingTarget(building: Building, entities: GameEntity[], buildings: Building[], range: number): ReturnType<typeof findPriorityHostileTarget>;
  damageBuilding(target: Building, amount: number, source?: Building): void;
}

/** Generic lifecycle only: ownership-specific mechanics live in the registered building module. */
export function updateBuildingsRuntime(host: BuildingRuntimeHost, dt: number): void {
  const buildings = host.state.buildings;
  for (let i = buildings.length - 1; i >= 0; i--) {
    const building = buildings[i];
    if (building.hp <= 0) {
      sound.playExplosion(building.type === 'CORE');
      host.createSparks(building.x, building.y, '#f59e0b', 24);
      buildings.splice(i, 1);
      continue;
    }
    if (!isBuildingOperational(building, buildings)) {
      building.targetEntityId = null;
      building.targetBuildingId = null;
      building.isPulsing = false;
      building.pulseProgress = 0;
      continue;
    }
    const module = BUILDING_MODULES[building.type];
    if ((building.passiveRepairPerSecond || 0) > 0 && building.hp < building.maxHp) {
      building.hp = Math.min(building.maxHp, building.hp + (building.passiveRepairPerSecond || 0) * dt);
    }
    if (!module.update) continue;
    module.update(building, {
      state: host.state,
      dt,
      spawnEntity: entity => host.state.entities.push(entity),
      spawnProjectile: projectile => host.state.projectiles.push(projectile),
      damageEntity: (entity, amount) => { applyEntityDamage(entity, amount); },
      damageBuilding: (target, amount, source) => { host.damageBuilding(target, amount, source); },
      createSparks: (x, y, color, count) => host.createSparks(x, y, color, count),
      playSound: kind => {
        if (kind === 'shoot') sound.playShoot();
        else if (kind === 'build') sound.playBuild();
        else if (kind === 'pulse') sound.playFirePulse();
        else if (kind === 'explosion') sound.playExplosion(false);
        else sound.playMine();
      },
      distance,
      resourceNodes: host.state.resourceNodes,
      findPriorityTarget: (source, range) => findPriorityHostileTarget(source, host.state.entities, host.state.buildings, range),
      resolveCachedTarget: (source, range) => host.resolveCachedBuildingTarget(source, host.state.entities, host.state.buildings, range),
      triggerStateChange: () => host.triggerStateChange()
    });
  }
}
