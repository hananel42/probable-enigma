import type { Building, BuildingType, EnemyBase, FloatingText, GameEntity, GameGroup, Particle, Projectile, ResourceNode, Resources } from '../types';

export interface EngineHumanPlayer {
  playerId: string;
  commanderId: string;
  coreId: string;
  groupId: string;
  allianceId: string;
  displayName: string;
  /** Authoritative simulation time when this participant's Core was first destroyed in the current run. */
  defeatedAtGameTime?: number | null;
  color: string;
  resources: Resources;
  connected: boolean;
  selectedBuildingType: BuildingType | null;
  selectedStationId: string | null;
  aim: { x: number; y: number; gx: number; gy: number };
  isAiming: boolean;
}

export interface GameEngineState {
  player: GameEntity;
  /** Human participants represented in this authoritative world. */
  humanPlayers: EngineHumanPlayer[];
  multiplayerMode: 'FREE_FOR_ALL' | 'TEAM' | 'COOPERATIVE';
  groups: GameGroup[];
  entities: GameEntity[];
  buildings: Building[];
  resources: Resources;
  resourceNodes: ResourceNode[];
  enemyBases: EnemyBase[];
  projectiles: Projectile[];
  particles: Particle[];
  floatingTexts: FloatingText[];
  selectedBuildingType: BuildingType | null;
  selectedStationId: string | null;
  camera: { x: number; y: number; zoom: number };
  mouseWorld: { x: number; y: number; gx: number; gy: number };
  isMouseAiming: boolean;
  isGameOver: boolean;
  gameTime: number;
  difficultyLevel: number;
}
