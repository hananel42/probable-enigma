import type { DroneAIState } from '../types';

/**
 * Resolve the only high-level drone AI state from the combat target selected this tick.
 * Patrol doctrine (DEFENSE or ESCORT) decides the route when no target is active; it is
 * deliberately not represented as another combat state.
 */
export function resolveDroneAIState(activeCombatTargetId: string | null | undefined): DroneAIState {
  return activeCombatTargetId ? 'ATTACK' : 'PATROL';
}
