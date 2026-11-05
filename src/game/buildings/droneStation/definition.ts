import type { BuildingDefinition } from '../types';

export const definition: BuildingDefinition = {
  type: 'DRONE_STATION', name: 'Drone Station', cost: { wood: 80, stone: 70, diamonds: 0 },
  hp: 380, range: 260, widthInCells: 2, heightInCells: 2,
  description: 'Deploys combat drones in Defense or Escort doctrine.', hotkey: '4',
  category: 'SUPPORT', combatRole: 'SUPPORT', accentColor: '#38bdf8', glyph: '✦'
};
