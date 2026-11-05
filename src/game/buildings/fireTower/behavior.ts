import type { BuildingBehavior, BuildingRuntimeContext } from '../types';
import { areHostile, applyEntityDamage } from '../../combat';
import { applyTowerEffects } from '../../statusEffects/towerEffects';
import { assertFireTowerBuilding } from './state';

/** Generic expanding effect wave. Effect identity and balance live in the shared effect registry. */
export const behavior: BuildingBehavior = {
  kind: 'EFFECT_WAVE', scanInterval: 0.14, pulseDuration: 0.6, defaultInterval: 4, defaultRadius: 175
};

export function update(building: import('../../types').Building, context: BuildingRuntimeContext): void {
  if (behavior.kind !== 'EFFECT_WAVE') throw new Error('Effect Tower behavior descriptor changed unexpectedly.');
  assertFireTowerBuilding(building);
  const waveDuration = Math.max(0.15, building.pulseDuration);
  const radiusLimit = Math.max(40, building.fireRadius);
  building.targetScanTimer = Math.max(0, (building.targetScanTimer || 0) - context.dt);
  if (building.targetScanTimer <= 0) {
    const target = context.findPriorityTarget(building, radiusLimit);
    building.targetEntityId = target?.kind === 'ENTITY' ? target.entity.id : null;
    building.targetBuildingId = target?.kind === 'BUILDING' ? target.building.id : null;
    building.targetScanTimer = behavior.scanInterval;
  }

  if (!building.isPulsing) {
    building.fireTimer = Math.max(0, building.fireTimer - context.dt);
    if (building.fireTimer <= 0) {
      building.isPulsing = true;
      building.pulseProgress = 0;
      building.pulseAffectedIds = [];
      context.playSound('pulse');
    }
  }
  if (!building.isPulsing) return;

  building.pulseProgress = Math.min(1, building.pulseProgress + context.dt / waveDuration);
  const radius = radiusLimit * building.pulseProgress;
  const primary = context.resolveCachedTarget(building, radiusLimit);
  const pulseDamage = Math.max(0, building.damage ?? 24);
  const hitIds = new Set(building.pulseAffectedIds);
  const waveThickness = 27;

  for (const entity of context.state.entities) {
    if (!areHostile(building, entity) || entity.hp <= 0 || entity.isDead) continue;
    const hitId = `entity:${entity.id}`;
    if (hitIds.has(hitId)) continue;
    const distance = context.distance(building.x, building.y, entity.x, entity.y);
    if (distance > radius + waveThickness || (building.pulseProgress < 1 && distance < radius - waveThickness)) continue;

    const isPrimary = primary?.kind === 'ENTITY' && primary.entity.id === entity.id;
    const damageResult = applyEntityDamage(entity, pulseDamage * (isPrimary ? 1 : 0.65));
    applyTowerEffects(building, entity);
    hitIds.add(hitId);
    context.createSparks(entity.x, entity.y, isPrimary ? '#f8fafc' : '#c084fc', isPrimary ? 6 : 3);
    if (damageResult.becameLethal && entity.kind === 'COMMANDER') {
      context.createSparks(entity.x, entity.y, '#f43f5e', 14);
      context.playSound('explosion');
    }
  }

  for (const targetBuilding of context.state.buildings) {
    if (targetBuilding.id === building.id || targetBuilding.hp <= 0 || !areHostile(building, targetBuilding)) continue;
    const hitId = `building:${targetBuilding.id}`;
    if (hitIds.has(hitId)) continue;
    const distance = context.distance(building.x, building.y, targetBuilding.x, targetBuilding.y);
    if (distance > radius + waveThickness || (building.pulseProgress < 1 && distance < radius - waveThickness)) continue;
    const isPrimary = primary?.kind === 'BUILDING' && primary.building.id === targetBuilding.id;
    context.damageBuilding(targetBuilding, pulseDamage * (isPrimary ? 1 : 0.65), building);
    hitIds.add(hitId);
    context.createSparks(targetBuilding.x, targetBuilding.y, '#c084fc', 4);
  }

  building.pulseAffectedIds = [...hitIds];
  if (building.pulseProgress >= 1) {
    building.isPulsing = false;
    building.pulseProgress = 0;
    building.pulseAffectedIds = [];
    building.fireTimer = Math.max(0.1, building.fireCooldown);
  }
}
