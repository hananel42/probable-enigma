import type { Building, GameEntity } from '../../types';
import type { BuildingStatLine } from '../types';
export function getStatLines(_building: Building, _entities: GameEntity[]): BuildingStatLine[] {
  return [{ label: 'BLOCKS MOVEMENT', value: 'YES' }, { label: 'DAMAGE MODEL', value: 'HP + ARMOR' }];
}
