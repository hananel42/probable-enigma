import type { Building, GameEntity, TowerEffectId } from '../types';
import { applyBuff, BUFF_DEFINITIONS } from './buffSystem';
import type { BuffApplicationOverrides } from './buffSystem';
import type { BuffDefinition } from '../types';
import { assertFireTowerBuilding } from '../buildings/fireTower/state';

/** Stable data registry for Effect Tower modes. Keep gameplay balance here rather than in engine branches. */
export interface TowerEffectDefinition {
  readonly id: TowerEffectId;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly canAffect: (entity: GameEntity) => boolean;
  readonly makeBuff: (source: Building, target: GameEntity) => { definition: BuffDefinition; overrides: BuffApplicationOverrides };
}

const effect = (
  id: TowerEffectId,
  name: string,
  description: string,
  color: string,
  canAffect: TowerEffectDefinition['canAffect'],
  makeBuff: TowerEffectDefinition['makeBuff']
): TowerEffectDefinition => ({ id, name, description, color, canAffect, makeBuff });

const anyEntity = (entity: GameEntity) => entity.hp > 0 && !entity.isDead;
const duration = (source: Building) => {
  assertFireTowerBuilding(source);
  return Math.max(0.25, Math.min(8, source.effectDuration));
};

const burningDamagePerSecond = (source: Building) => {
  assertFireTowerBuilding(source);
  return source.burnDamagePerSecond;
};

/** Effects may stack as distinct IDs; re-applying an existing effect refreshes its strongest instance. */
export const TOWER_EFFECTS: Readonly<Record<TowerEffectId, TowerEffectDefinition>> = {
  burning: effect('burning', 'Burning', 'Deals damage over time.', '#fb923c', anyEntity, source => ({
    definition: BUFF_DEFINITIONS.burning,
    overrides: {
      durationSeconds: duration(source),
      healthPerSecond: -burningDamagePerSecond(source),
      effect: { particleColor: '#fb923c', markerColor: '#f97316', markerShape: 'flame' }
    }
  })),
  slowing: effect('slowing', 'Cryogenic Slow', 'Reduces movement speed by 42%.', '#67e8f9', anyEntity, source => ({
    definition: {
      id: 'tower-slowing', name: 'Cryogenic Slow', durationSeconds: duration(source),
      modifiers: { speedMultiplier: 0.58 }, reapply: 'STRONGEST',
      effect: { particleColor: '#67e8f9', particleRate: 3, particleSize: 2, markerColor: '#22d3ee', markerShape: 'ring' }
    }, overrides: { durationSeconds: duration(source) }
  })),
  'signal-suppression': effect('signal-suppression', 'Signal Suppression', 'Reduces the target firing rate by 38%.', '#c084fc', anyEntity, source => ({
    definition: {
      id: 'tower-signal-suppression', name: 'Signal Suppression', durationSeconds: duration(source),
      modifiers: { fireRateMultiplier: 0.62 }, reapply: 'STRONGEST',
      effect: { particleColor: '#c084fc', particleRate: 2.5, particleSize: 2, markerColor: '#a855f7', markerShape: 'ring' }
    }, overrides: { durationSeconds: duration(source) }
  })),
  'weakened-shots': effect('weakened-shots', 'Weakened Shots', 'Reduces outgoing weapon damage by 35%.', '#fbbf24', anyEntity, source => ({
    definition: {
      id: 'tower-weakened-shots', name: 'Weakened Shots', durationSeconds: duration(source),
      modifiers: { powerMultiplier: 0.65 }, reapply: 'STRONGEST',
      effect: { particleColor: '#fbbf24', particleRate: 2, particleSize: 2, markerColor: '#f59e0b', markerShape: 'dot' }
    }, overrides: { durationSeconds: duration(source) }
  })),
  'radio-jamming': effect('radio-jamming', 'Radio Jamming', 'Severely disrupts drones, but has little effect on Commanders.', '#d8b4fe', anyEntity, (source, target) => {
    const dps = target.kind === 'DRONE' ? -24 : target.kind === 'COMMANDER' ? -0.25 : -6;
    const fireRate = target.kind === 'DRONE' ? 0.5 : target.kind === 'COMMANDER' ? 0.9 : 0.75;
    return {
      definition: {
        id: 'tower-radio-jamming', name: 'Radio Jamming', durationSeconds: duration(source),
        healthPerSecond: dps, modifiers: { fireRateMultiplier: fireRate }, reapply: 'STRONGEST',
        effect: { particleColor: '#d8b4fe', particleRate: 4, particleSize: 2.5, markerColor: '#a855f7', markerShape: 'ring' }
      }, overrides: { durationSeconds: duration(source) }
    };
  }),
  corrosion: effect('corrosion', 'Corrosion', 'Deals light damage over time and weakens effective armor.', '#bef264', anyEntity, source => ({
    definition: {
      id: 'tower-corrosion', name: 'Corrosion', durationSeconds: duration(source),
      healthPerSecond: -4, modifiers: { armorMultiplier: 0.65 }, reapply: 'STRONGEST',
      effect: { particleColor: '#bef264', particleRate: 3, particleSize: 2, markerColor: '#84cc16', markerShape: 'dot' }
    }, overrides: { durationSeconds: duration(source) }
  }))
};

/** Apply every currently installed mode. The registry decides its target filtering and effect values. */
export function applyTowerEffects(source: Building, target: GameEntity): void {
  assertFireTowerBuilding(source);
  for (const id of source.towerEffectIds) {
    const definition = TOWER_EFFECTS[id];
    if (!definition) throw new Error(`Effect Tower '${source.id}' references unknown effect '${String(id)}'.`);
    if (!definition.canAffect(target)) continue;
    const generated = definition.makeBuff(source, target);
    applyBuff(target, generated.definition, generated.overrides);
  }
}
