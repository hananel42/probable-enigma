import type { Building } from '../types';
import { canAfford, deductCost, distance, getBuildingUpgradeCost, getBuildingSalvageRefund, getRepairCost, isCommanderOperational, repairBuilding, upgradeBuildingStats } from '../rules';
import { sound } from '../audio';
import { applyCommanderUpgradeEffects, getBuildingUpgradeOptions, getUpgradeOptionForHotkey } from '../upgrades/upgradeSystem';
import { isOrphanedStructure } from '../coreStatus';
import { resolveContextBuilding } from '../buildingSelection';
import { EnginePlacement } from './EnginePlacement';

export abstract class EngineEconomyActions extends EnginePlacement {


  public override attemptRepairNearby(buildingId?: string) {
    if (!isCommanderOperational(this.state.player)) return;
    const candidates = this.state.buildings
      .filter(b => this.canUsePlayerStructure(b) && b.hp < b.maxHp && b.hp > 0)
      .map(b => ({ b, dist: distance(b.x, b.y, this.state.player.x, this.state.player.y) }))
      .filter(item => item.dist < 160)
      .sort((a, b) => a.dist - b.dist);
    const contextTarget = !buildingId
      ? resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld)
      : undefined;
    const nearbyDamaged = buildingId
      ? candidates.find(item => item.b.id === buildingId)
      : contextTarget ? candidates.find(item => item.b.id === contextTarget.id) : undefined;
    if (!nearbyDamaged) return;

    const building = nearbyDamaged.b;
    const cost = getRepairCost(building);
    if (!canAfford(this.state.resources, cost)) {
      sound.playHit();
      return;
    }

    const res = repairBuilding(building, this.state.resources);
    const idx = this.state.buildings.findIndex(b => b.id === building.id);
    if (idx !== -1) {
      // Preserve the shared Building object identity used by DroneAI's station index.
      Object.assign(building, res.building);
      this.state.buildings[idx] = building;
      this.setActivePlayerResources(res.wallet);
      sound.playRepair();
      this.createSparks(res.building.x, res.building.y, '#4ade80', 10);
      this.triggerStateChange();
    }
  }


  protected override getNearbyUpgradeTarget() {
    const context = resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld);
    if (!context || !this.canUsePlayerStructure(context) || getBuildingUpgradeOptions(context).length === 0) return undefined;
    return context;
  }


  public override attemptUpgradeHotkeyNearby(key: 'Q' | 'E') {
    if (!isCommanderOperational(this.state.player)) return;
    const building = this.getNearbyUpgradeTarget();
    if (!building) return;
    const option = getUpgradeOptionForHotkey(building, key);
    if (option) this.attemptUpgradeNearby(building.id, option.id);
  }


  public override attemptUpgradeNearby(buildingId?: string, upgradeId?: string) {
    if (!isCommanderOperational(this.state.player)) return;
    const candidates = this.state.buildings
      .filter(b => this.canUsePlayerStructure(b) && b.hp > 0 && getBuildingUpgradeOptions(b).length > 0)
      .map(b => ({ b, dist: distance(b.x, b.y, this.state.player.x, this.state.player.y) }))
      .filter(item => item.dist <= 155)
      .sort((a, b) => a.dist - b.dist);
    const contextualTarget = !buildingId
      ? resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld)
      : undefined;
    const nearby = buildingId
      ? candidates.find(item => item.b.id === buildingId)
      : contextualTarget ? candidates.find(item => item.b.id === contextualTarget.id) : undefined;
    if (!nearby) return;

    const building = nearby.b;
    const options = getBuildingUpgradeOptions(building);
    if (options.length === 0) return;
    // A human must explicitly choose a branch. Linear tiers have only one option
    // and remain accessible through the E hotkey without extra clicks.
    if (options.length > 1 && !upgradeId) return;
    if (upgradeId && !options.some(option => option.id === upgradeId)) return;

    const selectedOption = options.find(option => option.id === upgradeId) || (options.length === 1 ? options[0] : undefined);
    if (!selectedOption) return;
    const cost = getBuildingUpgradeCost(building, selectedOption.id);
    if (!canAfford(this.state.resources, cost)) {
      sound.playHit();
      return;
    }

    const commanders = building.type === 'CORE'
      ? this.state.entities.filter(entity => entity.kind === 'COMMANDER' && entity.faction === 'player' &&
          (this.state.multiplayerMode === 'COOPERATIVE' ? true : (entity.teamId || entity.faction) === (building.teamId || building.faction)))
      : [];
    if (building.type === 'CORE' && commanders.length === 0) return;
    const upgraded = upgradeBuildingStats(building, selectedOption.id);
    if (upgraded.level !== building.level + 1) return;
    const idx = this.state.buildings.findIndex(b => b.id === building.id);
    if (idx !== -1) {
      this.setActivePlayerResources(deductCost(this.state.resources, cost));
      for (const commander of commanders) applyCommanderUpgradeEffects(commander, selectedOption);
      // Keep the existing object reference stable for cached drone/building indexes.
      Object.assign(building, upgraded);
      this.state.buildings[idx] = building;
      sound.playBuild();
      this.createSparks(upgraded.x, upgraded.y, '#38bdf8', 15);
      this.triggerStateChange();
    }
  }


  /** Refund half of the invested value, scaled by remaining HP. The Core is immutable. */
  public override attemptDismantleNearby(buildingId?: string) {
    if (!isCommanderOperational(this.state.player)) return;
    const candidates = this.state.buildings
      .filter(building => building.type !== 'CORE' && building.hp > 0 &&
        (this.canUsePlayerStructure(building) || isOrphanedStructure(building, this.state.buildings)))
      .map(building => ({ building, dist: distance(building.x, building.y, this.state.player.x, this.state.player.y) }))
      .filter(item => item.dist <= 155)
      .sort((a, b) => a.dist - b.dist);
    const contextTarget = !buildingId
      ? resolveContextBuilding(this.state.buildings, this.state.player, this.state.mouseWorld)
      : undefined;
    const target = buildingId
      ? candidates.find(item => item.building.id === buildingId)?.building
      : contextTarget ? candidates.find(item => item.building.id === contextTarget.id)?.building : undefined;
    if (!target) return;

    const refund = getBuildingSalvageRefund(target);
    this.setActivePlayerResources({
      wood: this.state.resources.wood + refund.wood,
      stone: this.state.resources.stone + refund.stone,
      diamonds: this.state.resources.diamonds
    });
    this.state.buildings = this.state.buildings.filter(building => building.id !== target.id);
    if (this.state.selectedStationId === target.id) this.state.selectedStationId = null;

    // Dependent units will be cleaned up on their next AI update; removing the
    // structure here ensures they cannot keep depositing into a deleted station.
    sound.playBuild();
    this.createSparks(target.x, target.y, '#fbbf24', 10);
    this.triggerStateChange();
  }
}
