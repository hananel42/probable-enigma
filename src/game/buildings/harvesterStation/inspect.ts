import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';
export function getStatLines(building: Building, entities: GameEntity[]): BuildingStatLine[] {
  const bots = entities.filter(entity => entity.kind === 'HARVESTER_BOT' && entity.parentStationId === building.id && entity.hp > 0).length;
  return [
    { label: 'ACTIVE ROVERS', value: `${bots} / ${building.maxBots || 1}` },
    { label: 'SILO CAPACITY / TYPE', value: `${building.maxCapacity || 75}` },
    { label: 'EXTRACTION RATE', value: `${(building.miningSpeedMultiplier || 1).toFixed(2)}x` },
    { label: 'CARGO / TRIP', value: `${Math.round(20 * (building.botCargoCapacityMultiplier || 1))}` },
    { label: 'ROVER PRODUCTION', value: `${(building.botProductionMultiplier || 1).toFixed(2)}x` }
  ];
}
