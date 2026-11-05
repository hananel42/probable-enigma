import type { Building, GameEntity } from '../../types';

export interface DroneEntityIndex {
  entities: GameEntity[];
  length: number;
  first?: GameEntity;
  middle?: GameEntity;
  last?: GameEntity;
  byId: Map<string, GameEntity>;
  dronesByTeam: Map<string, GameEntity[]>;
  dronesByStation: Map<string, GameEntity[]>;
  commandersByTeam: Map<string, GameEntity>;
  escortFormationById: Map<string, { index: number; count: number }>;
  stationFormationById: Map<string, { index: number; count: number }>;
}

export interface DroneFlightCurve {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  phase: number;
  angularSpeed: number;
  centerVx: number;
  centerVy: number;
  leash?: { x: number; y: number; radius: number };
}

export interface DefenseOrbitRoute {
  signature: string;
  compoundSignature: string;
  knownBuildingGeometry: Map<string, string>;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  angularSpeed: number;
}

export interface DroneBuildingIndex {
  buildings: Building[];
  length: number;
  first?: Building;
  middle?: Building;
  last?: Building;
  byId: Map<string, Building>;
}
