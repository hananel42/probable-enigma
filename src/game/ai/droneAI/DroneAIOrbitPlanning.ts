import type { Building, DroneStationMode, GameEntity } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import type { PrioritizedCombatTarget } from '../../combat';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import type { DroneFlightCurve } from './model';
import { DroneAIPatrolNavigation } from './DroneAIPatrolNavigation';

/** Builds stable combat/escort curves while retaining each drone's orbit phase and geometry cache. */
export abstract class DroneAIOrbitPlanning extends DroneAIPatrolNavigation {
  protected createDroneOrbitCurve(
    drone: GameEntity,
    combatTarget: PrioritizedCombatTarget | undefined,
    droneMode: DroneStationMode,
    escortTarget: GameEntity | undefined,
    escortTetherRadius: number,
    siblingCount: number,
    myIndex: number,
    maxSpeed: number,
    buildings: Building[],
    dt: number
  ): DroneFlightCurve | null {
    const droneMovement = droneStationBehavior;
    if (drone.droneAIState === 'ATTACK' && combatTarget) {
      const targetX = combatTarget.kind === 'ENTITY' ? combatTarget.entity.x : combatTarget.building.x;
      const targetY = combatTarget.kind === 'ENTITY' ? combatTarget.entity.y : combatTarget.building.y;
      const targetId = combatTarget.kind === 'ENTITY' ? combatTarget.entity.id : combatTarget.building.id;
      const targetChanged = drone.droneCombatOrbitTargetId !== targetId;
      if (targetChanged || drone.droneCombatOrbitAngle === undefined) {
        drone.droneCombatOrbitTargetId = targetId;
        drone.droneCombatOrbitAngle = Math.atan2(drone.y - targetY, drone.x - targetX);
        drone.droneOrbitApproachActive = false;
        drone.droneOrbitApproachTargetId = null;
        drone.droneOrbitApproachStallTimer = 0;
        this.clearDroneSafeHoverRecovery(drone);
        this.clearDroneNavigation(drone);
      }
      const cachedCenterMoved = drone.droneCombatOrbitCenterX === undefined || drone.droneCombatOrbitCenterY === undefined ||
        distance(drone.droneCombatOrbitCenterX, drone.droneCombatOrbitCenterY, targetX, targetY) > GRID_SIZE * 1.8;
      const orbitNeedsRefresh = targetChanged || drone.droneCombatOrbitRadiusX === undefined ||
        drone.droneCombatOrbitRadiusY === undefined || drone.droneOrbitBuildingCount !== buildings.length ||
        cachedCenterMoved;

      if (orbitNeedsRefresh) {
        const targetHalfWidth = combatTarget.kind === 'BUILDING'
          ? ((combatTarget.building.widthInCells || 1) * GRID_SIZE) * 0.5 : 0;
        const targetHalfHeight = combatTarget.kind === 'BUILDING'
          ? ((combatTarget.building.heightInCells || 1) * GRID_SIZE) * 0.5 : 0;
        const baseRadiusX = Math.max(droneMovement.combatOrbitRadiusX, targetHalfWidth + 44);
        const baseRadiusY = Math.max(droneMovement.combatOrbitRadiusY, targetHalfHeight + 40);
        const commanderDistance = droneMode === 'ESCORT' && escortTarget && escortTarget !== drone
          ? distance(escortTarget.x, escortTarget.y, targetX, targetY) : 0;
        const availableEscortRadius = droneMode === 'ESCORT'
          ? Math.max(22, escortTetherRadius - commanderDistance - 18)
          : Number.POSITIVE_INFINITY;
        const targetOrbit = this.getClearCombatOrbit(
          targetX, targetY, baseRadiusX, baseRadiusY, buildings, availableEscortRadius
        );

        let orbitCenterX = targetX;
        let orbitCenterY = targetY;
        let orbit = targetOrbit;
        let usesMidpoint = false;

        if (!orbit && droneMode === 'ESCORT' && escortTarget && escortTarget !== drone) {
          // If the target's orbit cannot fit inside the commander leash, orbit a
          // bounded midpoint instead of dragging the drone outside its formation.
          usesMidpoint = true;
          orbitCenterX = (targetX + escortTarget.x) * 0.5;
          orbitCenterY = (targetY + escortTarget.y) * 0.5;
          orbit = this.getClearCombatOrbit(orbitCenterX, orbitCenterY, 48, 38, buildings, 84) || { radiusX: 42, radiusY: 34 };
        }
        if (!orbit) {
          // Dense compounds can surround moving targets. Prefer a conservative
          // obstacle-aware fallback instead of allowing route logic to go idle.
          orbit = this.getClearCombatOrbit(targetX, targetY, baseRadiusX, baseRadiusY, buildings) || { radiusX: 660, radiusY: 620 };
        }

        drone.droneCombatOrbitRadiusX = orbit.radiusX;
        drone.droneCombatOrbitRadiusY = orbit.radiusY;
        drone.droneOrbitBuildingCount = buildings.length;
        drone.droneCombatOrbitCenterX = targetX;
        drone.droneCombatOrbitCenterY = targetY;
        drone.droneCombatOrbitUsesMidpoint = usesMidpoint;
        if (targetChanged || drone.droneCombatOrbitAngle === undefined) {
          drone.droneCombatOrbitAngle = Math.atan2(drone.y - orbitCenterY, drone.x - orbitCenterX);
        }
      }

      const usesMidpoint = Boolean(drone.droneCombatOrbitUsesMidpoint && escortTarget && escortTarget !== drone);
      const orbitCenterX = usesMidpoint ? (targetX + escortTarget!.x) * 0.5 : targetX;
      const orbitCenterY = usesMidpoint ? (targetY + escortTarget!.y) * 0.5 : targetY;
      const orbitCenterVx = usesMidpoint
        ? ((combatTarget.kind === 'ENTITY' ? combatTarget.entity.vx || 0 : 0) + (escortTarget!.vx || 0)) * 0.5
        : combatTarget.kind === 'ENTITY' ? (combatTarget.entity.vx || 0) : 0;
      const orbitCenterVy = usesMidpoint
        ? ((combatTarget.kind === 'ENTITY' ? combatTarget.entity.vy || 0 : 0) + (escortTarget!.vy || 0)) * 0.5
        : combatTarget.kind === 'ENTITY' ? (combatTarget.entity.vy || 0) : 0;
      const radiusX = drone.droneCombatOrbitRadiusX || droneMovement.combatOrbitRadiusX;
      const radiusY = drone.droneCombatOrbitRadiusY || droneMovement.combatOrbitRadiusY;
      const linearOrbitSpeed = Math.min(maxSpeed || droneMovement.baseDroneSpeed, droneMovement.combatOrbitSpeed);
      const orbitKey = `combat:${targetId}`;
      if (drone.droneOrbitApproachActive && drone.droneOrbitApproachMode === 'COMBAT' &&
          drone.droneOrbitApproachTargetId === orbitKey && drone.droneOrbitApproachPhase !== undefined) {
        drone.droneCombatOrbitAngle = drone.droneOrbitApproachPhase;
      } else {
        drone.droneCombatOrbitAngle = this.advanceEllipsePhase(
          drone.droneCombatOrbitAngle || 0, radiusX, radiusY, linearOrbitSpeed, dt
        ) % (Math.PI * 2);
      }
      return {
        centerX: orbitCenterX,
        centerY: orbitCenterY,
        radiusX,
        radiusY,
        phase: drone.droneCombatOrbitAngle,
        angularSpeed: linearOrbitSpeed / Math.max(1, Math.hypot(radiusX * Math.sin(drone.droneCombatOrbitAngle), radiusY * Math.cos(drone.droneCombatOrbitAngle))),
        centerVx: orbitCenterVx,
        centerVy: orbitCenterVy
      };
    }

    if (droneMode !== 'ESCORT' || !escortTarget || escortTarget.isDead || escortTarget.hp <= 0) return null;

    drone.droneCombatOrbitTargetId = null;
    const slotOffset = (myIndex / Math.max(1, siblingCount)) * Math.PI * 2;
    const baseRadiusX = 82 + (myIndex % 3) * 8;
    const baseRadiusY = 58 + (myIndex % 2) * 7;
    const linearOrbitSpeed = Math.min(maxSpeed, droneMovement.escortOrbitSpeed);
    const escortOrbitKey = `escort:${escortTarget.id}`;
    const continuingApproach = drone.droneOrbitApproachActive && drone.droneOrbitApproachMode === 'ESCORT' &&
      drone.droneOrbitApproachTargetId === escortOrbitKey && drone.droneOrbitApproachPhase !== undefined;
    const phase = continuingApproach
      ? drone.droneOrbitApproachPhase!
      : this.advanceEllipsePhase(drone.patrolAngle ?? slotOffset, baseRadiusX, baseRadiusY, linearOrbitSpeed, dt);
    drone.patrolAngle = phase % (Math.PI * 2);
    const cachedCenterMoved = drone.droneCombatOrbitCenterX === undefined || drone.droneCombatOrbitCenterY === undefined ||
      distance(drone.droneCombatOrbitCenterX, drone.droneCombatOrbitCenterY, escortTarget.x, escortTarget.y) > GRID_SIZE * 1.2;
    const orbitNeedsRefresh = drone.droneEscortOrbitRadiusX === undefined || drone.droneEscortOrbitRadiusY === undefined ||
      drone.droneOrbitBuildingCount !== buildings.length || cachedCenterMoved || (drone.droneEscortOrbitCheckTimer || 0) <= 0;
    drone.droneEscortOrbitCheckTimer = Math.max(0, (drone.droneEscortOrbitCheckTimer || 0) - dt);
    if (orbitNeedsRefresh) {
      const safeOrbit = this.getClearCombatOrbit(
        escortTarget.x, escortTarget.y, baseRadiusX, baseRadiusY, buildings, escortTetherRadius - 24
      );
      drone.droneEscortOrbitRadiusX = safeOrbit?.radiusX ?? baseRadiusX;
      drone.droneEscortOrbitRadiusY = safeOrbit?.radiusY ?? baseRadiusY;
      drone.droneCombatOrbitCenterX = escortTarget.x;
      drone.droneCombatOrbitCenterY = escortTarget.y;
      drone.droneOrbitBuildingCount = buildings.length;
      drone.droneEscortOrbitCheckTimer = 0.55;
    }
    const radiusX = drone.droneEscortOrbitRadiusX || baseRadiusX;
    const radiusY = drone.droneEscortOrbitRadiusY || baseRadiusY;
    return {
      centerX: escortTarget.x,
      centerY: escortTarget.y,
      radiusX,
      radiusY,
      phase: drone.patrolAngle,
      angularSpeed: linearOrbitSpeed / Math.max(1, Math.hypot(radiusX * Math.sin(phase), radiusY * Math.cos(phase))),
      centerVx: escortTarget.vx || 0,
      centerVy: escortTarget.vy || 0
    };
  }
}
