import type { BuildingDefinition } from '../types';

export const definition: BuildingDefinition = {
  type: 'CORE', name: 'Outpost Command Core', cost: { wood: 120, stone: 150, diamonds: 0 },
  hp: 1200, range: 160, widthInCells: 2, heightInCells: 2,
  description: 'Central command, respawn, and outpost-spawn objective.', hotkey: '0',
  category: 'COMMAND', combatRole: 'SPAWN', accentColor: '#facc15', glyph: '◆'
};
