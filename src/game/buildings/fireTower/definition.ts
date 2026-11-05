import type { BuildingDefinition } from '../types';

export const definition: BuildingDefinition = {
  type: 'FIRE_TOWER', name: 'Effect Tower', cost: { wood: 70, stone: 90, diamonds: 0 },
  hp: 260, range: 170, widthInCells: 1, heightInCells: 1,
  description: 'Emits periodic expanding waves that apply configurable damage, control, and disruption effects.', hotkey: '5',
  category: 'DEFENSE', combatRole: 'WEAPON', accentColor: '#fb923c', glyph: '♨'
};
