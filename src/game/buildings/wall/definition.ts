import type { BuildingDefinition } from '../types';

export const definition: BuildingDefinition = {
  type: 'WALL', name: 'Reinforced Wall', cost: { wood: 15, stone: 20, diamonds: 0 },
  hp: 400, range: 0, widthInCells: 1, heightInCells: 1,
  description: 'Fortified barrier that blocks units and protects the compound.', hotkey: '1',
  category: 'FORTIFICATION', combatRole: 'FORTIFICATION', accentColor: '#94a3b8', glyph: '▰'
};
