import type { GameGroup } from './types';

/** True when two different ownership groups share one diplomatic alliance. */
export function areGroupsAllied(
  a?: Pick<GameGroup, 'id' | 'allianceId'>,
  b?: Pick<GameGroup, 'id' | 'allianceId'>
): boolean {
  return Boolean(a && b && a.id !== b.id && a.allianceId && a.allianceId === b.allianceId);
}

/** An allied group is displayed in the shared green alliance color. */
export function isAllianceGroup(group: GameGroup | undefined, groups: readonly GameGroup[]): boolean {
  return Boolean(group && groups.some(other => areGroupsAllied(group, other)));
}

export function getGroupDisplayColor(
  group: GameGroup | undefined,
  groups: readonly GameGroup[],
  fallback = '#f43f5e'
): string {
  if (!group) return fallback;
  return isAllianceGroup(group, groups) ? '#4ade80' : group.color;
}
