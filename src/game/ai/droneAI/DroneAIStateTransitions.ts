import type { DroneAIState, DroneStationMode, GameEntity } from '../../types';
import { DroneAIOrbitPlanning } from './DroneAIOrbitPlanning';

/** Centralizes transition cleanup so old navigation cannot leak across AI states. */
export abstract class DroneAIStateTransitions extends DroneAIOrbitPlanning {
  protected applyDroneAIStateTransitions(
    drone: GameEntity,
    previousState: DroneAIState,
    nextState: DroneAIState,
    releasedCombatNavigation: boolean,
    droneMode: DroneStationMode
  ): void {
    const stateChanged = previousState !== nextState;
    drone.droneAIState = nextState;

    if (stateChanged) {
      // A state transition invalidates path work and recovery state from the old
      // state. Stale A* results must not hold the drone or restore old waypoints.
      this.clearDroneNavigation(drone);
      drone.droneOrbitApproachActive = false;
      drone.droneOrbitApproachTargetId = null;
      drone.droneOrbitApproachMode = undefined;
      drone.droneOrbitApproachPhase = undefined;
      drone.dronePatrolEntryStallTimer = 0;
      drone.droneOrbitApproachStallTimer = 0;
      this.clearDroneSafeHoverRecovery(drone);
      drone.stuckTimer = 0;
      if (nextState === 'PATROL') {
        drone.droneTargetEntityId = null;
        drone.droneTargetBuildingId = null;
        drone.combatAlertEntityId = null;
        drone.combatAlertBuildingId = null;
        drone.combatAlertTimer = 0;
      } else {
        // After leaving patrol, do not reuse a waypoint from the previous orbit.
        drone.dronePatrolOrbitInitialized = false;
      }
    }

    if (!releasedCombatNavigation) return;
    drone.droneCombatOrbitTargetId = null;
    drone.droneCombatOrbitUsesMidpoint = false;
    drone.droneOrbitApproachActive = false;
    drone.droneOrbitApproachTargetId = null;
    drone.droneOrbitApproachMode = undefined;
    drone.droneOrbitApproachStallTimer = 0;
    this.clearDroneSafeHoverRecovery(drone);
    this.clearDroneNavigation(drone);
    if (droneMode === 'DEFENSE') {
      // Re-anchor defense patrol on return from combat instead of reusing the
      // old combat orbit's approach point.
      drone.dronePatrolOrbitInitialized = false;
      drone.dronePatrolEntryStallTimer = 0;
    }
  }
}
