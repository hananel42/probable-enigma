import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';

export function getStatLines(building: Building, entities: GameEntity[]): BuildingStatLine[] {
  const commander = entities.find(entity =>
    entity.kind === 'COMMANDER' &&
    (entity.teamId || entity.faction) === (building.teamId || building.faction)
  );
  const lines: BuildingStatLine[] = [
    { label: 'ROLE', value: 'COMMAND / RESPAWN' },
    { label: 'UPGRADE TARGET', value: 'COMMANDER SYSTEMS' }
  ];
  if (!commander) return lines;
  lines.push(
    { label: 'COMMANDER HP', value: `${Math.ceil(commander.hp)} / ${Math.ceil(commander.maxHp)}` },
    { label: 'MOVE SPEED', value: `${Math.round(commander.speed)} px/s` },
    { label: 'WEAPON DAMAGE', value: `${Math.round(commander.damage || 0)}` },
    { label: 'FIRE RATE', value: `${(1 / Math.max(0.001, commander.fireCooldown || 0.18)).toFixed(1)} shots/s` },
    { label: 'WEAPON RANGE', value: `${Math.round(commander.range || 320)}` },
    { label: 'COMMANDER DAMAGE REDUCTION', value: `${Math.round((commander.armor || 0) * 100)}%` },
    { label: 'MINING SPEED', value: `x${(commander.miningSpeedMultiplier || 1).toFixed(2)}` },
    { label: 'MINING YIELD', value: `x${(commander.miningYieldMultiplier || 1).toFixed(2)}` }
  );
  return lines;
}
