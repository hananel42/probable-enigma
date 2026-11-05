import type { Building, GameEntity, Projectile, ResourceNode } from '../../types';
import { getBuffMultiplier } from '../../statusEffects/buffSystem';
import { BASE_WEAPON_TUNING } from '../../combatTuning';
import { distance } from '../../rules';
import { moveEntityAlongPath } from '../../movement';
import { belongsToTeam, findPriorityHostileTarget, getCombatTeamId } from '../../combat';
import { sound } from '../../audio';
import { isBuildingOperational } from '../../coreStatus';
import type { CommanderActionFeedback } from './model';
import { CommanderAIState } from './CommanderAIState';

export abstract class CommanderAICombatLayer extends CommanderAIState {

  protected override executeAttackGoal(
    commander: GameEntity,
    allEntities: GameEntity[],
    buildings: Building[],
    resources: ResourceNode[],
    projectiles: Projectile[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    commander.isActivelyMining = false;
    commander.miningProgress = 0;

    // Re-evaluate the active target every combat tick, not only when the strategic
    // goal is first assigned. A newly arrived armed enemy must outrank an older
    // building order, and the nearest candidate wins within each policy tier.
    const excludedTarget = (commander.aiFailedTargetCooldown || 0) > 0
      ? commander.aiFailedTargetId
      : undefined;
    let policyTarget = findPriorityHostileTarget(
      commander, allEntities, buildings, Number.POSITIVE_INFINITY, excludedTarget
    );
    const teamId = getCombatTeamId(commander);
    const homeCore = buildings.find(building => building.type === 'CORE' && building.hp > 0 && belongsToTeam(building, teamId));
    if (homeCore && homeCore.hp < homeCore.maxHp) {
      // While the Core is damaged, attack only hostiles close enough to threaten it.
      // Do not let the general assault target picker drag the defender away.
      policyTarget = findPriorityHostileTarget(homeCore, allEntities, buildings, 390, excludedTarget);
    }
    if (!policyTarget) {
      commander.aiTargetEntityId = null;
      commander.aiTargetBuildingId = null;
      commander.aiGoal = 'IDLE';
      return;
    }
    commander.aiTargetEntityId = policyTarget.kind === 'ENTITY' ? policyTarget.entity.id : null;
    commander.aiTargetBuildingId = policyTarget.kind === 'BUILDING' ? policyTarget.building.id : null;

    let targetX = 0;
    let targetY = 0;
    let targetVx = 0;
    let targetVy = 0;
    let targetFound = false;

    if (commander.aiTargetEntityId) {
      const target = allEntities.find(
        e => e.id === commander.aiTargetEntityId && e.hp > 0 && !e.isDead
      );
      if (target) {
        targetX = target.x;
        targetY = target.y;
        targetVx = target.vx || 0;
        targetVy = target.vy || 0;
        targetFound = true;
      }
    }

    if (!targetFound && commander.aiTargetBuildingId) {
      const bTarget = buildings.find(b => b.id === commander.aiTargetBuildingId && b.hp > 0 && isBuildingOperational(b, buildings));
      if (bTarget) {
        targetX = bTarget.x;
        targetY = bTarget.y;
        targetFound = true;
      }
    }

    if (!targetFound) {
      commander.aiGoal = 'IDLE';
      return;
    }

    const d = distance(commander.x, commander.y, targetX, targetY);

    // Predictive leading aim
    const leadTime = Math.min(0.3, d / BASE_WEAPON_TUNING.projectileSpeed);
    const aimX = targetX + targetVx * leadTime;
    const aimY = targetY + targetVy * leadTime;
    const angle = Math.atan2(aimY - commander.y, aimX - commander.x);
    commander.angle = angle;

    const targetEntity = commander.aiTargetEntityId
      ? allEntities.find(entity => entity.id === commander.aiTargetEntityId && entity.hp > 0 && !entity.isDead)
      : undefined;
    const targetBuilding = commander.aiTargetBuildingId
      ? buildings.find(building => building.id === commander.aiTargetBuildingId && building.hp > 0 && isBuildingOperational(building, buildings))
      : undefined;
    const comfortableRange = Math.min(265, Math.max(190, (commander.range || 320) * 0.74));
    if (targetBuilding) {
      // Do not pathfind to the building's blocked center and end up pressed
      // against its footprint. Approach a free stand-off point instead, choosing
      // a distance that outranges the weapon structure whenever our own weapon can.
      const isWeaponBuilding = targetBuilding.type === 'AUTO_TURRET' || targetBuilding.type === 'FIRE_TOWER';
      const ownRange = Math.max(160, commander.range || 320);
      const desiredRange = isWeaponBuilding
        ? Math.max(185, Math.min(ownRange - 24, (targetBuilding.range || 200) + 36))
        : comfortableRange;
      const awayLength = Math.max(1, d);
      const awayX = (commander.x - targetX) / awayLength;
      const awayY = (commander.y - targetY) / awayLength;
      if (d > desiredRange + 12) {
        this.moveTowards(
          commander,
          targetX + awayX * desiredRange,
          targetY + awayY * desiredRange,
          buildings,
          resources,
          dt
        );
      } else if (d < desiredRange - 32) {
        this.moveTowards(
          commander,
          commander.x + awayX * 110,
          commander.y + awayY * 110,
          buildings,
          resources,
          dt
        );
      }
    } else if (d > comfortableRange) {
      // Advance to weapon range, then stay and fire—even at point-blank range
      // and regardless of current HP. The commander never disengages for safety.
      this.moveTowards(commander, targetX, targetY, buildings, resources, dt);
    }

    // Fire at the same practical weapon range as a player commander while advancing.
    commander.lastFireTime = (commander.lastFireTime || 0) + dt;
    if (d <= (commander.range || 320) && commander.lastFireTime >= (commander.fireCooldown || 0.18) / getBuffMultiplier(commander, 'fireRateMultiplier')) {
      commander.lastFireTime = 0;
      commander.angle = angle;
      projectiles.push({
        id: `enemy-proj-${Date.now()}-${Math.random()}`,
        ownerPlayerId: commander.ownerPlayerId,
        x: commander.x + Math.cos(angle) * BASE_WEAPON_TUNING.muzzleOffset,
        y: commander.y + Math.sin(angle) * BASE_WEAPON_TUNING.muzzleOffset,
        rangeOriginX: commander.x, rangeOriginY: commander.y, maxRange: commander.range || BASE_WEAPON_TUNING.range,
        vx: Math.cos(angle) * BASE_WEAPON_TUNING.projectileSpeed,
        vy: Math.sin(angle) * BASE_WEAPON_TUNING.projectileSpeed,
        damage: (commander.damage || 30) * getBuffMultiplier(commander, 'powerMultiplier'),
        faction: commander.faction,
        teamId: getCombatTeamId(commander),
        allianceId: commander.allianceId || getCombatTeamId(commander),
        color: '#f43f5e',
        radius: 4,
        life: Math.min(1.2, (commander.range || BASE_WEAPON_TUNING.range) / BASE_WEAPON_TUNING.projectileSpeed),
        maxLife: Math.min(1.2, (commander.range || BASE_WEAPON_TUNING.range) / BASE_WEAPON_TUNING.projectileSpeed)
      });
      sound.playShoot();
    }
  }

  protected override handleCombatSelfDefense(
    commander: GameEntity,
    allEntities: GameEntity[],
    buildings: Building[],
    projectiles: Projectile[],
    dt: number
  ) {
    if (commander.isActivelyMining) return;

    const target = findPriorityHostileTarget(commander, allEntities, buildings, commander.range || 260);

    commander.lastFireTime = (commander.lastFireTime || 0) + dt;

    if (target && commander.lastFireTime >= (commander.fireCooldown || 0.18) / getBuffMultiplier(commander, 'fireRateMultiplier')) {
      commander.lastFireTime = 0;
      const targetX = target.kind === 'ENTITY' ? target.entity.x : target.building.x;
      const targetY = target.kind === 'ENTITY' ? target.entity.y : target.building.y;
      const targetVx = target.kind === 'ENTITY' ? (target.entity.vx || 0) : 0;
      const targetVy = target.kind === 'ENTITY' ? (target.entity.vy || 0) : 0;
      const leadTime = Math.min(0.25, target.distance / BASE_WEAPON_TUNING.projectileSpeed);
      const aimX = targetX + targetVx * leadTime;
      const aimY = targetY + targetVy * leadTime;
      const angle = Math.atan2(aimY - commander.y, aimX - commander.x);
      commander.angle = angle;

      projectiles.push({
        id: `def-proj-${Date.now()}-${Math.random()}`,
        ownerPlayerId: commander.ownerPlayerId,
        x: commander.x + Math.cos(angle) * BASE_WEAPON_TUNING.muzzleOffset,
        y: commander.y + Math.sin(angle) * BASE_WEAPON_TUNING.muzzleOffset,
        rangeOriginX: commander.x, rangeOriginY: commander.y, maxRange: commander.range || BASE_WEAPON_TUNING.range,
        vx: Math.cos(angle) * BASE_WEAPON_TUNING.projectileSpeed,
        vy: Math.sin(angle) * BASE_WEAPON_TUNING.projectileSpeed,
        damage: (commander.damage || 30) * getBuffMultiplier(commander, 'powerMultiplier'),
        faction: commander.faction,
        teamId: getCombatTeamId(commander),
        allianceId: commander.allianceId || getCombatTeamId(commander),
        color: '#f43f5e',
        radius: 4,
        life: Math.min(1.2, (commander.range || BASE_WEAPON_TUNING.range) / BASE_WEAPON_TUNING.projectileSpeed),
        maxLife: Math.min(1.2, (commander.range || BASE_WEAPON_TUNING.range) / BASE_WEAPON_TUNING.projectileSpeed)
      });
      sound.playShoot();
    }
  }

  protected override moveTowards(
    entity: GameEntity,
    targetX: number,
    targetY: number,
    buildings: Building[],
    resources: ResourceNode[],
    dt: number
  ) {
    const beforeX = entity.x;
    const beforeY = entity.y;
    moveEntityAlongPath(entity, targetX, targetY, buildings, resources, dt, 18);
    const moved = distance(beforeX, beforeY, entity.x, entity.y);
    entity.aiMovementNoProgressTimer = moved >= 0.75
      ? 0
      : (entity.aiMovementNoProgressTimer || 0) + dt;
    entity.aiLastMoveX = entity.x;
    entity.aiLastMoveY = entity.y;

    if ((entity.aiMovementNoProgressTimer || 0) >= 2.4) {
      const failedTargetId = entity.aiTargetResourceId || entity.aiTargetBuildingId || entity.aiTargetEntityId;
      if (failedTargetId) {
        entity.aiFailedTargetId = failedTargetId;
        entity.aiFailedTargetCooldown = 8;
      }
      entity.aiMovementNoProgressTimer = 0;
      entity.aiGoal = 'IDLE';
      entity.aiTargetResourceId = null;
      entity.aiTargetBuildingId = null;
      entity.aiTargetEntityId = null;
      entity.aiBuildType = null;
      entity.isActivelyMining = false;
      entity.miningProgress = 0;
      entity.path = [];
      entity.pathIndex = 0;
      entity.pathRecalcTimer = 0;
    }
  }
}
