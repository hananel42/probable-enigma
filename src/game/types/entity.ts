import type { BuildingType, DroneAIState, Faction, ResourceType } from './ownership';
import type { ActiveBuff } from './statusEffects';

/** Simulation entities, navigation state, and AI-owned decision memory. */
export type EntityKind = 'COMMANDER' | 'HARVESTER_BOT' | 'DRONE';

export type HarvesterState =
  | 'IDLE'
  | 'NAVIGATING_TO_RESOURCE'
  | 'MINING'
  | 'RETURNING';

export interface PathWaypoint {
  gx: number;
  gy: number;
  x: number;
  y: number;
}

export type CommanderAIGoal =
  | 'IDLE'
  | 'COLLECT_RESOURCES'
  | 'MINE_RESOURCE'
  | 'BUILD_STRUCTURE'
  | 'UPGRADE_STRUCTURE'
  | 'REPAIR_STRUCTURE'
  | 'GUARD_CORE'
  | 'DISMANTLE_STRUCTURE'
  | 'ATTACK_TARGET';

export interface GameEntity {
  id: string;
  /** Set for human-controlled commanders; AI and worker units may omit it. */
  ownerPlayerId?: string;
  kind: EntityKind;
  faction: Faction;
  /** Ownership group identity, separate from alliance membership. */
  teamId?: string;
  /** Units sharing an alliance never damage each other and can share defensive coverage. */
  allianceId?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Visual drone facing angle, interpolated separately from immediate aim. */
  visualAngle?: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  isFlying: boolean; // Drones fly over resources; ground units are blocked by resources and buildings
  // Smart Navigation / Pathfinding
  path?: PathWaypoint[];
  pathIndex?: number;
  pathRecalcTimer?: number;
  pathTargetX?: number;
  pathTargetY?: number;
  /** Backoff after failed A* attempts, avoiding repeated expensive searches. */
  pathFailureCount?: number;
  pathRetryDelay?: number;
  stuckTimer?: number;
  /** Harvester navigation watchdog: catches routes that repeatedly make no progress. */
  navigationNoProgressTimer?: number;
  navigationRetryCount?: number;
  navigationGoalProgressTimer?: number;
  navigationLastGoalDistance?: number;
  lastProgressX?: number;
  lastProgressY?: number;
  harvesterFailedResourceId?: string | null;
  /** Recently unreachable deposits, temporarily excluded to avoid repeat A* searches. */
  harvesterFailedResourceIds?: string[];
  harvesterFailureCooldown?: number;
  flightPathActive?: boolean;
  /** Cached drone route visibility result; updated only when the grid goal changes or cache expires. */
  flightRouteCheckTimer?: number;
  flightRouteCheckedTargetGx?: number;
  flightRouteCheckedTargetGy?: number;
  flightRouteBlocked?: boolean;
  /** One-way low-health kamikaze commitment and its locked target. */
  droneKamikazeActive?: boolean;
  droneKamikazeTargetId?: string | null;
  droneKamikazeTargetBuildingId?: string | null;
  /** Explicit high-level drone AI state; patrol doctrine is represented separately. */
  droneAIState?: DroneAIState;
  /** Unified second-order flight controller state. The center is resolved live each simulation tick. */
  droneFlightCenterId?: string;
  droneFlightPhase?: number;
  droneFlightOrbitDirection?: -1 | 1;
  droneFlightGoalX?: number;
  droneFlightGoalY?: number;
  droneFlightPlannedX?: number;
  droneFlightPlannedY?: number;
  droneFlightPathRefreshTimer?: number;
  droneFlightPathNeedsAStar?: boolean;
  /** True while following a physically connected escape route out of the air-clearance ring. */
  droneFlightEscapingClearance?: boolean;
  /** Time spent failing to reduce distance to the current A* waypoint. */
  droneFlightPathNoProgressSeconds?: number;
  /** Monotonic timestamp used to rate-limit stalled-route diagnostics. */
  droneFlightStallWarningAtMs?: number;
  droneCombatCheckTimer?: number;
  droneTargetEntityId?: string | null;
  droneTargetBuildingId?: string | null;
  droneAlertBroadcastCooldown?: number;
  droneSafeTargetX?: number;
  droneSafeTargetY?: number;
  /** Rate-limits recovery searches when a dense base temporarily has no safe hover tile nearby. */
  droneSafeTargetRetryTimer?: number;
  droneSafeTargetRetryCount?: number;
  /** Cached geometry and phase for active combat-orbit planning. */
  droneCombatOrbitAngle?: number;
  droneCombatOrbitTargetId?: string | null;
  droneCombatOrbitRadiusX?: number;
  droneCombatOrbitRadiusY?: number;
  droneOrbitBuildingCount?: number;
  droneCombatOrbitCenterX?: number;
  droneCombatOrbitCenterY?: number;
  droneCombatOrbitUsesMidpoint?: boolean;
  /** Target and phase captured while entering a combat or escort orbit. */
  droneOrbitApproachActive?: boolean;
  droneOrbitApproachTargetId?: string | null;
  droneOrbitApproachMode?: 'COMBAT' | 'ESCORT';
  droneOrbitApproachPhase?: number;
  droneEscortOrbitRadiusX?: number;
  droneEscortOrbitRadiusY?: number;
  droneEscortOrbitCheckTimer?: number;
  /** Whether the drone has captured its current defense-patrol ellipse. */
  dronePatrolOrbitInitialized?: boolean;
  /** Time spent stalled while entering a defense patrol route. */
  dronePatrolEntryStallTimer?: number;
  /** Time spent stalled while entering a combat or escort orbit. */
  droneOrbitApproachStallTimer?: number;
  /** Move out of an air-clearance trap using physical collision, not the blocked air grid. */
  evasionTimer?: number;
  /** Staggers low-frequency projectile-threat scans across autonomous commanders. */
  aiDodgeCheckTimer?: number;
  evasionDirectionX?: number;
  evasionDirectionY?: number;
  // Sub-properties
  parentStationId?: string;
  // Harvester bot
  harvesterState?: HarvesterState;
  targetResourceId?: string | null;
  /** Alternate reachable approach point for returning to a station; never a teleport destination. */
  harvesterReturnX?: number;
  harvesterReturnY?: number;
  /** Rotates between perimeter candidates when a station entrance route fails. */
  harvesterStationApproachIndex?: number;
  miningTimer?: number;
  harvesterSearchTimer?: number;
  cargoType?: ResourceType | null;
  cargoAmount?: number;
  cargoCapacity?: number;
  // Combat unit / drone / commander
  fireCooldown?: number;
  lastFireTime?: number;
  damage?: number;
  range?: number;
  /** Commander-only core upgrade effects; defaults are neutral multipliers. */
  armor?: number;
  miningSpeedMultiplier?: number;
  miningYieldMultiplier?: number;
  patrolAngle?: number;
  // Modular status effects.
  buffs?: ActiveBuff[];
  appliedBuffHealthMultiplier?: number;
  // Commander properties (both Player and Enemy Commander share these identically!)
  isDead?: boolean;
  respawnTimer?: number;
  miningTargetId?: string | null;
  miningProgress?: number;
  isActivelyMining?: boolean;
  // Commander AI controller state (for Enemy Commander)
  aiGoal?: CommanderAIGoal;
  aiTargetResourceId?: string | null;
  aiTargetBuildingId?: string | null;
  aiTargetEntityId?: string | null;
  aiBuildType?: BuildingType | null;
  aiDecisionTimer?: number;
  aiMovementNoProgressTimer?: number;
  aiLastMoveX?: number;
  aiLastMoveY?: number;
  aiFailedTargetId?: string | null;
  aiFailedTargetCooldown?: number;
  /** Short-lived reinforcement request sent by a defending drone. */
  combatAlertEntityId?: string | null;
  combatAlertBuildingId?: string | null;
  combatAlertTimer?: number;
  dashCooldown?: number;
  dashTimer?: number;
}
