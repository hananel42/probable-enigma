import { droneAI } from '../ai/droneAI';
import { EngineEconomyActions } from './EngineEconomyActions';

export abstract class EngineGroups extends EngineEconomyActions {


  /**
   * Assign a group to an alliance. Groups keep distinct ownership/economy IDs,
   * while combat and defensive support follow the shared alliance ID.
   * This is the authority-side primitive future multiplayer lobby commands use.
   */
  public override setGroupAlliance(groupId: string, allianceId: string): boolean {
    const normalizedAllianceId = allianceId.trim();
    if (!normalizedAllianceId) return false;
    const group = this.state.groups.find(candidate => candidate.id === groupId);
    if (!group || group.allianceId === normalizedAllianceId) return Boolean(group);
    group.allianceId = normalizedAllianceId;
    for (const actor of this.state.entities) {
      if ((actor.teamId || actor.faction) === groupId) actor.allianceId = normalizedAllianceId;
    }
    for (const building of this.state.buildings) {
      if ((building.teamId || building.faction) === groupId) building.allianceId = normalizedAllianceId;
    }
    for (const projectile of this.state.projectiles) {
      if ((projectile.teamId || projectile.faction) === groupId) projectile.allianceId = normalizedAllianceId;
    }
    for (const base of this.state.enemyBases) {
      if ((base.teamId || base.id) === groupId) base.allianceId = normalizedAllianceId;
    }
    // Diplomatic mutations do not replace arrays; invalidate derived defence clusters.
    droneAI.invalidateGroupRelations();
    this.triggerStateChange();
    return true;
  }


  /**
   * Update a group's public identity through an authoritative command.
   * Group ids and alliance ownership remain stable while display names/colors
   * may change, which makes this safe to expose to a future multiplayer lobby.
   */
  public override setGroupIdentity(groupId: string, name: string, commanderName: string, color?: string): boolean {
    const group = this.state.groups.find(candidate => candidate.id === groupId);
    if (!group) return false;
    const clean = (value: string, maxLength: number) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
    const normalizedName = clean(name, 36);
    const normalizedCommanderName = clean(commanderName, 24);
    if (!normalizedName || !normalizedCommanderName) return false;
    const normalizedColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : group.color;
    group.name = normalizedName;
    group.commanderName = normalizedCommanderName;
    group.color = normalizedColor;
    for (const base of this.state.enemyBases) {
      if ((base.teamId || base.id) !== groupId) continue;
      base.groupName = normalizedName;
      base.commanderName = normalizedCommanderName;
      base.groupColor = normalizedColor;
    }
    this.triggerStateChange();
    return true;
  }
}
