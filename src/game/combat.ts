import { Building, Faction, GameEntity, Projectile } from './types';
import { BUILDING_COMBAT_PROFILES } from './content/buildingCatalog';
import { ENTITY_COMBAT_PROFILES } from './content/entityCatalog';
import { clearBuffs, getBuffMultiplier } from './statusEffects/buffSystem';
import { isBuildingOperational } from './coreStatus';

export interface CombatIdentity {
  faction: Faction;
  /** Stable player identity for awarding exclusive combat rewards. */
  ownerPlayerId?: string;
  /** Ownership group remains distinct across an alliance. */
  teamId?: string;
  /** Two different groups sharing this id are allied and never hostile to one another. */
  allianceId?: string;
}

/**
 * Player-owned structures and units share one team. Each enemy outpost receives
 * its own team id, allowing neighbouring hostile outposts to fight one another.
 */
export function getCombatTeamId(actor: CombatIdentity): string {
  return actor.teamId || actor.faction;
}

export function getCombatAllianceId(actor: CombatIdentity): string {
  return actor.allianceId && actor.allianceId !== actor.faction
    ? actor.allianceId
    : getCombatTeamId(actor);
}

export function areHostile(a: CombatIdentity, b: CombatIdentity): boolean {
  // A faction default defers to the current team; an explicit alliance can unite teams.
  return getCombatAllianceId(a) !== getCombatAllianceId(b);
}

export function isAliveEntity(entity: GameEntity): boolean {
  return entity.hp > 0 && !entity.isDead;
}

export function findClosestHostileEntity(
  source: CombatIdentity & Pick<GameEntity, 'x' | 'y' | 'id'>,
  entities: GameEntity[],
  maxRange = Number.POSITIVE_INFINITY
): { entity: GameEntity; distance: number } | undefined {
  let closest: { entity: GameEntity; distance: number } | undefined;
  const maxRangeSq = maxRange * maxRange;

  for (const entity of entities) {
    if (entity.id === source.id || !isAliveEntity(entity) || !areHostile(source, entity)) continue;
    const dx = entity.x - source.x;
    const dy = entity.y - source.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxRangeSq) continue;
    if (!closest || distanceSq < closest.distance * closest.distance) {
      closest = { entity, distance: Math.sqrt(distanceSq) };
    }
  }

  return closest;
}

export function isProjectileHostileTo(projectile: Projectile, target: CombatIdentity): boolean {
  return areHostile(
    { faction: projectile.faction, teamId: projectile.teamId, allianceId: projectile.allianceId },
    target
  );
}

export function belongsToTeam(actor: CombatIdentity, teamId: string): boolean {
  return getCombatTeamId(actor) === teamId;
}

export function findClosestHostileBuilding<T extends Building>(
  source: CombatIdentity & Pick<GameEntity, 'x' | 'y'>,
  buildings: T[],
  maxRange = Number.POSITIVE_INFINITY
): { building: T; distance: number } | undefined {
  let closest: { building: T; distance: number } | undefined;
  const maxRangeSq = maxRange * maxRange;
  for (const building of buildings) {
    if (building.hp <= 0 || !isBuildingOperational(building, buildings) || !areHostile(source, building)) continue;
    const dx = building.x - source.x;
    const dy = building.y - source.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxRangeSq) continue;
    if (!closest || distanceSq < closest.distance * closest.distance) {
      closest = { building, distance: Math.sqrt(distanceSq) };
    }
  }
  return closest;
}



export interface ProjectileDodgeDirection {
  x: number;
  y: number;
  timeToClosestApproach: number;
  missDistance: number;
}

/** Predicts whether a hostile projectile is on a collision course and returns a
 * stable perpendicular dodge direction. This is shared by AI controllers rather
 * than relying on late, reactive collision handling. */
export function getProjectileDodgeDirection(
  source: CombatIdentity & Pick<GameEntity, 'x' | 'y' | 'radius'>,
  projectiles: Projectile[],
  horizonSeconds = 0.58
): ProjectileDodgeDirection | undefined {
  let chosen: ProjectileDodgeDirection | undefined;
  let chosenRisk = Number.NEGATIVE_INFINITY;

  for (const projectile of projectiles) {
    if (projectile.life <= 0 || !isProjectileHostileTo(projectile, source)) continue;
    const speedSq = projectile.vx * projectile.vx + projectile.vy * projectile.vy;
    if (speedSq < 1) continue;

    // Relative position is projectile minus target. Negative dot product means
    // the projectile is travelling towards the target's current position.
    const rx = projectile.x - source.x;
    const ry = projectile.y - source.y;
    const dot = rx * projectile.vx + ry * projectile.vy;
    if (dot >= 0) continue;
    const time = Math.max(0, Math.min(projectile.life, -dot / speedSq));
    if (time > horizonSeconds) continue;

    const closestX = rx + projectile.vx * time;
    const closestY = ry + projectile.vy * time;
    const missDistance = Math.hypot(closestX, closestY);
    const dangerRadius = Math.max(4, source.radius) + Math.max(2, projectile.radius) + 16;
    if (missDistance >= dangerRadius) continue;

    const speed = Math.sqrt(speedSq);
    const tangentX = -projectile.vy / speed;
    const tangentY = projectile.vx / speed;
    const side = projectile.vx * (-ry) - projectile.vy * (-rx) >= 0 ? 1 : -1;
    // Prefer urgent, near-direct hits, but compare risks across simultaneous fire.
    const risk = (dangerRadius - missDistance) / dangerRadius + (horizonSeconds - time) * 0.45;
    if (risk <= chosenRisk) continue;
    chosenRisk = risk;
    chosen = {
      x: tangentX * side,
      y: tangentY * side,
      timeToClosestApproach: time,
      missDistance
    };
  }

  return chosen;
}

export type PrioritizedCombatTarget =
  | { kind: 'ENTITY'; entity: GameEntity; distance: number }
  | { kind: 'BUILDING'; building: Building; distance: number };

/**
 * Shared, allocation-light targeting policy used by all automated weapons:
 * 1) nearest armed hostile entity,
 * 2) nearest hostile weapon structure,
 * 3) critical infrastructure (Core/spawn),
 * 4) support structures, then other structures and harmless units.
 *
 * This intentionally performs one pass over each collection. Older code built
 * filtered arrays for every priority tier on every turret/drone update, creating
 * substantial garbage and frame spikes in large battles.
 */
export function findPriorityHostileTarget(
  source: CombatIdentity & Pick<GameEntity, 'x' | 'y' | 'id'>,
  entities: GameEntity[],
  buildings: Building[],
  maxRange = Number.POSITIVE_INFINITY,
  excludedTargetId?: string | null
): PrioritizedCombatTarget | undefined {
  const maxRangeSq = maxRange * maxRange;
  let bestTier = Number.POSITIVE_INFINITY;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  let bestEntity: GameEntity | undefined;
  let bestBuilding: Building | undefined;

  const consider = (
    tier: number,
    dx: number,
    dy: number,
    entity?: GameEntity,
    building?: Building
  ) => {
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxRangeSq) return;
    if (tier < bestTier || (tier === bestTier && distanceSq < bestDistanceSq)) {
      bestTier = tier;
      bestDistanceSq = distanceSq;
      bestEntity = entity;
      bestBuilding = building;
    }
  };

  for (const entity of entities) {
    if (entity.id === source.id || entity.id === excludedTargetId || !isAliveEntity(entity) || !areHostile(source, entity)) continue;
    const profile = ENTITY_COMBAT_PROFILES[entity.kind];
    if (!profile) continue;
    // Armed entities only belong to the top threat tier while their weapon is
    // functional. Non-attacking entities remain targetable in their data tier.
    if (profile.canAttack) {
      if ((entity.damage || 0) <= 0 || (entity.range || 0) <= 0) continue;
    } else if (profile.targetTier <= 0) {
      continue;
    }
    consider(profile.targetTier, entity.x - source.x, entity.y - source.y, entity, undefined);
  }

  for (const building of buildings) {
    if (building.hp <= 0 || !isBuildingOperational(building, buildings) || building.id === excludedTargetId || !areHostile(source, building)) continue;
    const profile = BUILDING_COMBAT_PROFILES[building.type];
    if (!profile) continue;
    if (profile.targetTier === 1 && !profile.canAttack) continue;
    consider(profile.targetTier, building.x - source.x, building.y - source.y, undefined, building);
  }

  if (bestEntity) return { kind: 'ENTITY', entity: bestEntity, distance: Math.sqrt(bestDistanceSq) };
  if (bestBuilding) return { kind: 'BUILDING', building: bestBuilding, distance: Math.sqrt(bestDistanceSq) };
  return undefined;
}

export interface DamageApplication {
  /** Actual HP removed. Never exceeds the target's remaining health. */
  damage: number;
  /** True only on the transition from positive HP to zero. */
  becameLethal: boolean;
}

/**
 * Applies damage without allowing underflow. Lethal damage to a commander starts
 * the same respawn state for player and enemy commanders; non-commanders are
 * removed by the engine's standard entity cleanup pass.
 */
export function applyEntityDamage(entity: GameEntity, rawDamage: number): DamageApplication {
  if (!Number.isFinite(entity.hp) || entity.hp < 0) throw new RangeError(`Entity '${entity.id}' has invalid HP: ${entity.hp}.`);
  if (!Number.isFinite(rawDamage) || rawDamage < 0) throw new RangeError(`Damage to entity '${entity.id}' must be finite and non-negative; received ${rawDamage}.`);
  if (entity.armor !== undefined && (!Number.isFinite(entity.armor) || entity.armor < 0)) throw new RangeError(`Entity '${entity.id}' has invalid armor: ${entity.armor}.`);
  const before = entity.hp;
  const incomingDamage = rawDamage;
  const armor = Math.max(0, Math.min(0.75, (entity.armor ?? 0) * getBuffMultiplier(entity, 'armorMultiplier')));
  const damage = incomingDamage * (1 - armor);
  if (damage <= 0 || before <= 0 || entity.isDead) {
    entity.hp = before;
    return { damage: 0, becameLethal: false };
  }

  entity.hp = Math.max(0, before - damage);
  const becameLethal = before > 0 && entity.hp === 0;
  if (becameLethal && entity.kind === 'COMMANDER') {
    entity.isDead = true;
    entity.respawnTimer = 3;
    entity.vx = 0;
    entity.vy = 0;
    entity.path = [];
    entity.pathIndex = 0;
    entity.isActivelyMining = false;
    entity.miningProgress = 0;
    clearBuffs(entity);
  }

  return { damage: before - entity.hp, becameLethal };
}

/** Buildings are removed by the engine on the next structure pass after HP hits zero. */
export function applyBuildingDamage(building: Building, rawDamage: number): DamageApplication {
  if (!Number.isFinite(building.hp) || building.hp < 0) throw new RangeError(`Building '${building.id}' has invalid HP: ${building.hp}.`);
  if (!Number.isFinite(rawDamage) || rawDamage < 0) throw new RangeError(`Damage to building '${building.id}' must be finite and non-negative; received ${rawDamage}.`);
  if (building.armor !== undefined && (!Number.isFinite(building.armor) || building.armor < 0)) throw new RangeError(`Building '${building.id}' has invalid armor: ${building.armor}.`);
  const before = building.hp;
  const incomingDamage = rawDamage;
  const armor = Math.max(0, Math.min(0.75, building.armor ?? 0));
  const damage = incomingDamage * (1 - armor);
  if (damage <= 0 || before <= 0) {
    building.hp = before;
    return { damage: 0, becameLethal: false };
  }
  building.hp = Math.max(0, before - damage);
  return { damage: before - building.hp, becameLethal: before > 0 && building.hp === 0 };
}

