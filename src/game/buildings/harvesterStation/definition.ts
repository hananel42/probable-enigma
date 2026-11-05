import type { BuildingDefinition } from '../types';

export const definition: BuildingDefinition = {
  type: 'HARVESTER_STATION', name: 'Harvester Station', cost: { wood: 65, stone: 65, diamonds: 0 },
  hp: 360, range: 350, widthInCells: 2, heightInCells: 2,
  description: 'Dispatches autonomous mining rovers and stores their cargo.', hotkey: '3',
  category: 'ECONOMY', combatRole: 'SUPPORT', accentColor: '#34d399', glyph: '⇄'
};
