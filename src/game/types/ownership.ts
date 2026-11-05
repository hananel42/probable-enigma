/** Stable identifiers and shared ownership/economy contracts. */
export type Faction = 'player' | 'enemy';

/** Named multiplayer-ready ownership group. Several groups may share an alliance. */
export interface GameGroup {
  id: string;
  name: string;
  commanderName: string;
  faction: Faction;
  allianceId: string;
  color: string;
}

export type ResourceType = 'wood' | 'stone';

/** Currency ledger. Diamonds are combat rewards, never mineable nodes or salvage. */
export interface Resources {
  wood: number;
  stone: number;
  diamonds: number;
}

/** Data-driven debuffs available to the Effect Tower. IDs are current-schema identifiers and may change during development. */
export type TowerEffectId = 'burning' | 'slowing' | 'signal-suppression' | 'weakened-shots' | 'radio-jamming' | 'corrosion';

export type BuildingType =
  | 'CORE'
  | 'WALL'
  | 'AUTO_TURRET'
  | 'HARVESTER_STATION'
  | 'DRONE_STATION'
  | 'FIRE_TOWER';

export interface BuildingBlueprint {
  type: BuildingType;
  name: string;
  cost: Resources;
  hp: number;
  range: number;
  widthInCells: number; // 1 or 2
  heightInCells: number; // 1 or 2
  description: string;
  hotkey: string;
}

export type DroneStationMode = 'DEFENSE' | 'ESCORT';

/** The only two runtime states for a drone: engage a valid target, or follow its doctrine route. */
export type DroneAIState = 'ATTACK' | 'PATROL';
