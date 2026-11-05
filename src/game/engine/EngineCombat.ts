import type { Building, GameEntity, Projectile } from '../types';
import { distance } from '../rules';
import { sound } from '../audio';
import { applyBuildingDamage, applyEntityDamage, areHostile, getCombatTeamId, isProjectileHostileTo } from '../combat';
import { applyRadialExplosion } from '../explosions';
import { EngineEnemyBases } from './EngineEnemyBases';

export abstract class EngineCombat extends EngineEnemyBases {


  /**
   * Authoritative building damage path. Core reward attribution is performed only
   * on the positive-HP -> zero-HP transition and is idempotent per Core ID.
   */
  public override damageBuilding(
    target: Building,
    rawDamage: number,
    source?: Pick<Building, 'faction' | 'teamId' | 'allianceId' | 'ownerPlayerId'>
      | Pick<Projectile, 'faction' | 'teamId' | 'allianceId' | 'ownerPlayerId'>
  ) {
    const result = applyBuildingDamage(target, rawDamage);
    if (result.becameLethal && target.type === 'CORE' && source && areHostile(source, target)) {
      this.awardDiamondForCore(target, source);
    }
    return result;
  }


  protected override awardDiamondForCore(
    core: Building,
    source: Pick<Building, 'faction' | 'teamId' | 'allianceId' | 'ownerPlayerId'>
      | Pick<Projectile, 'faction' | 'teamId' | 'allianceId' | 'ownerPlayerId'>
  ): void {
    if (this.rewardedCoreIds.has(core.id)) return;
    this.rewardedCoreIds.add(core.id);
    const sourceTeam = source.teamId || source.faction;
    const participant = this.state.humanPlayers.find(player =>
      (source.ownerPlayerId && player.playerId === source.ownerPlayerId) || player.groupId === sourceTeam
    );
    if (participant) {
      participant.resources = { ...participant.resources, diamonds: (participant.resources.diamonds) + 1 };
      if (participant.playerId === this.activePlayerId) this.state.resources = { ...participant.resources };
      this.addFloatingText(core.x, core.y - 28, '+1 DIAMOND', '#a5f3fc');
      this.createSparks(core.x, core.y, '#67e8f9', 18);
      this.triggerStateChange();
      return;
    }

    const enemyBase = this.state.enemyBases.find(base => (base.teamId || base.id) === sourceTeam);
    if (enemyBase) {
      enemyBase.resources = { ...enemyBase.resources, diamonds: (enemyBase.resources.diamonds) + 1 };
      this.addFloatingText(core.x, core.y - 28, '+1 DIAMOND', '#fda4af');
      this.createSparks(core.x, core.y, '#f43f5e', 12);
      this.triggerStateChange();
    }
  }


  protected override steerGuidedProjectile(projectile: Projectile, dt: number): void {
    const turnRate = Math.max(0, Math.min(3.2, projectile.homingStrength ?? 0));
    if (turnRate <= 0) return;
    let target = projectile.targetEntityId
      ? this.state.entities.find(entity => entity.id === projectile.targetEntityId && entity.hp > 0 && !entity.isDead && isProjectileHostileTo(projectile, entity))
      : undefined;
    if (!target) {
      target = this.state.entities.reduce<GameEntity | undefined>((best, candidate) => {
        if (candidate.hp <= 0 || candidate.isDead || !isProjectileHostileTo(projectile, candidate)) return best;
        if (!best || distance(projectile.x, projectile.y, candidate.x, candidate.y) < distance(projectile.x, projectile.y, best.x, best.y)) return candidate;
        return best;
      }, undefined);
    }
    let tx = target?.x;
    let ty = target?.y;
    if (!target) {
      const targetBuilding = projectile.targetBuildingId
        ? this.state.buildings.find(building => building.id === projectile.targetBuildingId && building.hp > 0 && isProjectileHostileTo(projectile, building))
        : undefined;
      tx = targetBuilding?.x;
      ty = targetBuilding?.y;
    }
    if (tx === undefined || ty === undefined) return;

    const speed = Math.hypot(projectile.vx, projectile.vy);
    if (speed < 1e-6) return;
    const current = Math.atan2(projectile.vy, projectile.vx);
    const desired = Math.atan2(ty - projectile.y, tx - projectile.x);
    const delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
    const boundedDelta = Math.max(-turnRate * dt, Math.min(turnRate * dt, delta));
    const next = current + boundedDelta;
    projectile.vx = Math.cos(next) * speed;
    projectile.vy = Math.sin(next) * speed;
  }


  /** Enforce the same center-to-center weapon range for players and turrets. Collision radii must not grant free extra range. */
  protected override projectileCanReachTarget(projectile: Projectile, targetX: number, targetY: number): boolean {
    const dx = targetX - projectile.rangeOriginX;
    const dy = targetY - projectile.rangeOriginY;
    return dx * dx + dy * dy <= projectile.maxRange * projectile.maxRange + 1e-6;
  }


  protected override tryReflectProjectile(projectile: Projectile, wall: Building): boolean {
    const chance = Math.max(0, Math.min(0.7, wall.projectileReflectChance ?? 0));
    if (chance <= 0 || Math.random() >= chance) return false;
    projectile.faction = wall.faction;
    projectile.teamId = getCombatTeamId(wall);
    projectile.allianceId = wall.allianceId || getCombatTeamId(wall);
    projectile.ownerPlayerId = wall.ownerPlayerId;
    // A reflected projectile gets a fresh, short return leg from the point of reflection.
    projectile.rangeOriginX = wall.x;
    projectile.rangeOriginY = wall.y;
    projectile.maxRange = Math.hypot(projectile.vx, projectile.vy) * Math.max(projectile.life, 0.35);
    projectile.color = wall.faction === 'player' ? '#67e8f9' : '#fda4af';
    projectile.vx *= -1;
    projectile.vy *= -1;
    const speed = Math.hypot(projectile.vx, projectile.vy) || 1;
    projectile.x += (projectile.vx / speed) * (projectile.radius + 3);
    projectile.y += (projectile.vy / speed) * (projectile.radius + 3);
    projectile.life = Math.max(projectile.life, 0.35);
    projectile.maxLife = Math.max(projectile.maxLife, projectile.life);
    this.createSparks(wall.x, wall.y, '#67e8f9', 7);
    return true;
  }


  protected override applyProjectileExplosion(projectile: Projectile, x: number, y: number, directTargetId: string): void {
    const radius = Math.max(0, Math.min(120, projectile.explosionRadius ?? 0));
    if (radius <= 0) return;
    const multiplier = Math.max(0, Math.min(1.5, projectile.explosionDamageMultiplier ?? 0.45));
    const damage = projectile.damage * multiplier;
    const excluded = new Set([directTargetId]);

    applyRadialExplosion({
      origin: { x, y }, radius, baseDamage: damage, falloff: 'flat',
      targets: this.state.entities,
      getCollisionRadius: entity => entity.radius,
      excludeIds: excluded,
      canDamage: entity => entity.hp > 0 && !entity.isDead && isProjectileHostileTo(projectile, entity),
      applyDamage: (entity, rawDamage) => {
        const result = applyEntityDamage(entity, rawDamage);
        if (result.damage > 0) this.addFloatingText(entity.x, entity.y - 10, `-${Math.round(result.damage)}`, '#fb923c');
        this.createSparks(entity.x, entity.y, '#fb923c', 3);
        if (result.becameLethal && entity.kind === 'COMMANDER') sound.playExplosion(false);
      }
    });
    applyRadialExplosion({
      origin: { x, y }, radius, baseDamage: damage, falloff: 'flat',
      targets: this.state.buildings,
      getCollisionRadius: building => (building.widthInCells || 1) * 18,
      excludeIds: excluded,
      canDamage: building => building.hp > 0 && isProjectileHostileTo(projectile, building),
      applyDamage: (building, rawDamage) => {
        const result = this.damageBuilding(building, rawDamage, projectile);
        if (result.damage > 0) this.addFloatingText(building.x, building.y - 12, `-${Math.round(result.damage)}`, '#fb923c');
        this.createSparks(building.x, building.y, '#fb923c', 3);
      }
    });
    this.createSparks(x, y, '#fb923c', 10);
    sound.playExplosion(false);
  }
}
