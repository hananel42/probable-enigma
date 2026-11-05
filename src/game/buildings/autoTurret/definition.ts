import type { BuildingDefinition } from '../types';
import { BASE_WEAPON_TUNING } from '../../combatTuning';

export const definition: BuildingDefinition = {
  type: 'AUTO_TURRET', name: 'Auto-Turret', cost: { wood: 35, stone: 45, diamonds: 0 },
  hp: 280, range: BASE_WEAPON_TUNING.range, widthInCells: 1, heightInCells: 1,
  description: 'Tracks and fires at hostile combatants and structures.', hotkey: '2',
  category: 'DEFENSE', combatRole: 'WEAPON', accentColor: '#a78bfa', glyph: '✣'
};
