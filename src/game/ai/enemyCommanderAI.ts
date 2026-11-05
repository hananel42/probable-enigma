import { Building, BuildingType, EnemyBase, GameEntity, ResourceNode } from '../types';
import {
  BUILDING_BLUEPRINTS,
  canAfford,
  createBuildingInstance,
  deductCost,
  distance,
  getRepairCost,
  getBuildingUpgradeCost,
  isAreaBuildable,
  GRID_SIZE
} from '../rules';
import { areHostile, belongsToTeam, getCombatTeamId } from '../combat';
import { sound } from '../audio';
import { getBuildingUpgradeOptions, getRecommendedBuildingUpgradeId } from '../upgrades/upgradeSystem';

export interface FortressSlot {
  relGx: number;
  relGy: number;
  type: Exclude<BuildingType, 'CORE'>;
  priority: number;
}

/**
 * Keep the fortress construction pass from spending resources already committed
 * to a Commander goal. CommanderAI plans/evaluates first; this secondary builder
 * runs later in the same frame and must respect that planned investment.
 */
function getPlannedCommanderSpend(commander: GameEntity | undefined, buildings: Building[], teamId: string) {
  if (!commander || commander.hp <= 0 || commander.isDead) return undefined;
  if (commander.aiGoal === 'BUILD_STRUCTURE' && commander.aiBuildType && commander.aiBuildType !== 'CORE') {
    const blueprint = BUILDING_BLUEPRINTS[commander.aiBuildType];
    return blueprint ? blueprint.cost : undefined;
  }
  if (commander.aiGoal === 'UPGRADE_STRUCTURE' && commander.aiTargetBuildingId) {
    const target = buildings.find(building => building.id === commander.aiTargetBuildingId &&
      building.hp > 0 && belongsToTeam(building, teamId));
    const upgradeId = target ? getRecommendedBuildingUpgradeId(target) : undefined;
    if (target && getBuildingUpgradeOptions(target).length > 0 && upgradeId) {
      return getBuildingUpgradeCost(target, upgradeId);
    }
  }
  return undefined;
}

/**
 * Procedural symmetrical fortress layout blueprint.
 * Places corner bastions with auto-turrets, fire towers, and fortified perimeter curtains
 * with a tactical gateway corridor.
 */
export function getFortressBlueprint(level: number): FortressSlot[] {
  const slots: FortressSlot[] = [
    // 1. Bastion Corner Turrets (Crossfire lines)
    { relGx: -4, relGy: -4, type: 'AUTO_TURRET', priority: 1 },
    { relGx: 4, relGy: -4, type: 'AUTO_TURRET', priority: 1 },
    { relGx: -4, relGy: 4, type: 'AUTO_TURRET', priority: 2 },
    { relGx: 4, relGy: 4, type: 'AUTO_TURRET', priority: 2 },

    // 2. Fire Tower (Area denial)
    { relGx: -2, relGy: -2, type: 'FIRE_TOWER', priority: 3 },

    // 3. North Curtain Wall
    { relGx: -3, relGy: -4, type: 'WALL', priority: 4 },
    { relGx: -2, relGy: -4, type: 'WALL', priority: 4 },
    { relGx: -1, relGy: -4, type: 'WALL', priority: 4 },
    { relGx: 1, relGy: -4, type: 'WALL', priority: 4 },
    { relGx: 2, relGy: -4, type: 'WALL', priority: 4 },
    { relGx: 3, relGy: -4, type: 'WALL', priority: 4 },

    // 4. South Curtain Wall
    { relGx: -3, relGy: 4, type: 'WALL', priority: 4 },
    { relGx: -2, relGy: 4, type: 'WALL', priority: 4 },
    { relGx: -1, relGy: 4, type: 'WALL', priority: 4 },
    { relGx: 1, relGy: 4, type: 'WALL', priority: 4 },
    { relGx: 2, relGy: 4, type: 'WALL', priority: 4 },
    { relGx: 3, relGy: 4, type: 'WALL', priority: 4 },

    // 5. West Curtain Wall
    { relGx: -4, relGy: -3, type: 'WALL', priority: 5 },
    { relGx: -4, relGy: -2, type: 'WALL', priority: 5 },
    { relGx: -4, relGy: -1, type: 'WALL', priority: 5 },
    { relGx: -4, relGy: 1, type: 'WALL', priority: 5 },
    { relGx: -4, relGy: 2, type: 'WALL', priority: 5 },
    { relGx: -4, relGy: 3, type: 'WALL', priority: 5 },

    // 6. East Curtain Wall (Leaves (4, 0) and (4, 1) open for troop deployment gate)
    { relGx: 4, relGy: -3, type: 'WALL', priority: 5 },
    { relGx: 4, relGy: -2, type: 'WALL', priority: 5 },
    { relGx: 4, relGy: 2, type: 'WALL', priority: 5 },
    { relGx: 4, relGy: 3, type: 'WALL', priority: 5 }
  ];

  if (level >= 2) {
    slots.push(
      { relGx: 2, relGy: 2, type: 'AUTO_TURRET', priority: 2 },
      { relGx: -2, relGy: 2, type: 'FIRE_TOWER', priority: 3 }
    );
  }
  if (level >= 3) {
    // Wider crossfire lanes and a secondary inner guard ring prevent the base
    // from being solved by approaching through one predictable side.
    slots.push(
      { relGx: 0, relGy: -5, type: 'AUTO_TURRET', priority: 1 },
      { relGx: 0, relGy: 5, type: 'AUTO_TURRET', priority: 1 },
      { relGx: -5, relGy: 0, type: 'FIRE_TOWER', priority: 2 },
      { relGx: 5, relGy: 0, type: 'FIRE_TOWER', priority: 2 }
    );
  }
  if (level >= 4) {
    slots.push(
      { relGx: -5, relGy: -3, type: 'WALL', priority: 5 },
      { relGx: -5, relGy: 3, type: 'WALL', priority: 5 },
      { relGx: 5, relGy: -3, type: 'WALL', priority: 5 },
      { relGx: 5, relGy: 3, type: 'WALL', priority: 5 }
    );
  }

  return slots;
}

export class EnemyCommanderAI {
  public updateBase(
    base: EnemyBase,
    buildings: Building[],
    entities: GameEntity[],
    resourceNodes: ResourceNode[],
    difficultyLevel: number,
    dt: number,
    onSpark?: (x: number, y: number, color: string, count: number) => void,
    onFloatingText?: (x: number, y: number, text: string, color: string) => void
  ) {
    if (base.isDestroyed) return;

    // Check if enemy Core is still alive
    const core = buildings.find(b => b.id === base.coreId && b.hp > 0);
    if (!core) {
      base.isDestroyed = true;
      const teamId = base.teamId || base.id;

      // A destroyed Core disables its outpost; it must not erase the player's
      // salvage opportunity. Keep surviving structures in the world so they
      // render as inert/gray and can be dismantled for HP-proportional salvage.
      // Remove the dead Core itself (it may still be present in direct AI tests
      // or if this system is called before the normal building cleanup pass).
      for (let i = buildings.length - 1; i >= 0; i--) {
        if (buildings[i].id === base.coreId) buildings.splice(i, 1);
      }

      // Destroy the outpost's commander and remaining team units when its Core
      // falls. Only surviving structures remain as inert, gray salvage targets.
      // Removing the commander here (rather than waiting for a later combat tick)
      // prevents a coreless enemy from lingering or continuing its AI routines.
      for (let i = entities.length - 1; i >= 0; i--) {
        if (getCombatTeamId(entities[i]) === teamId) entities.splice(i, 1);
      }
      return;
    }

    if (!base.stance) base.stance = 'FORTIFYING';
    base.stanceTimer = (base.stanceTimer || 0) + dt;

    // 1. Hostile Proximity Detection & Stance Arbitration
    const baseIdentity = { faction: 'enemy' as const, teamId: base.teamId || base.id, allianceId: base.allianceId || base.teamId || base.id };
    const hostileUnitNearby = entities.some(
      e => areHostile(baseIdentity, e) && e.hp > 0 && !e.isDead && distance(base.x, base.y, e.x, e.y) <= 480
    );

    if (hostileUnitNearby) {
      if (base.stance !== 'DEFENDING') {
        base.stance = 'DEFENDING';
        if (onFloatingText) {
          onFloatingText(base.x, base.y - 25, 'ALERT: BASE DEFENSE PROTOCOL ACTIVE!', '#f43f5e');
        }
        // Switch friendly drone stations to Defense doctrine to secure the perimeter
        buildings
          .filter(b => belongsToTeam(b, base.teamId || base.id) && b.type === 'DRONE_STATION' && b.hp > 0)
          .forEach(s => { s.droneMode = 'DEFENSE'; });
      }
    } else if (base.stance === 'DEFENDING' && !hostileUnitNearby) {
      // Disengage defense protocol
      base.stance = 'FORTIFYING';
    }

    // 2. Autonomous Emergency Repair Logic (higher frequency during defense)
    const repairInterval = base.stance === 'DEFENDING' ? 3.0 : 6.0;
    base.repairTimer = (base.repairTimer || repairInterval) - dt;
    if (base.repairTimer <= 0) {
      base.repairTimer = repairInterval;
      const baseTeam = base.teamId || base.id;
      const immediateThreat = entities
        .filter(entity => areHostile(baseIdentity, entity) && entity.hp > 0 && !entity.isDead)
        .sort((a, b) => distance(a.x, a.y, core.x, core.y) - distance(b.x, b.y, core.x, core.y))[0];
      const damagedEnemyBldg = buildings
        .filter(b => belongsToTeam(b, baseTeam) && b.hp < b.maxHp && b.hp > 0 && distance(b.x, b.y, base.x, base.y) <= 520)
        .map(building => {
          const missingRatio = 1 - building.hp / Math.max(1, building.maxHp);
          let score = missingRatio * 9;
          if (building.type === 'CORE') score += building.hp / building.maxHp < 0.65 ? 18 : 8;
          if (building.type === 'AUTO_TURRET' || building.type === 'FIRE_TOWER') score += 7;
          if (building.type === 'DRONE_STATION') score += 4;
          if (immediateThreat && distance(building.x, building.y, immediateThreat.x, immediateThreat.y) < 250) score += 3;
          return { building, score };
        })
        .sort((a, b) => b.score - a.score)[0]?.building;

      if (damagedEnemyBldg) {
        const cost = getRepairCost(damagedEnemyBldg);
        if (canAfford(base.resources, cost)) {
          base.resources = deductCost(base.resources, cost);
          damagedEnemyBldg.hp = damagedEnemyBldg.maxHp;
          sound.playRepair();
          if (onSpark) {
            onSpark(damagedEnemyBldg.x, damagedEnemyBldg.y, '#f43f5e', 8);
          }
          if (onFloatingText) {
            onFloatingText(damagedEnemyBldg.x, damagedEnemyBldg.y - 15, 'REPAIRED', '#4ade80');
          }
        }
      }
    }

    // 3. Fortress Blueprint Construction & Gap Reconstruction
    base.buildTimer = (base.buildTimer || 12.0) - dt;
    if (base.buildTimer <= 0) {
      base.buildTimer = base.stance === 'FORTIFYING' ? 9.0 : 16.0;

      const blueprint = getFortressBlueprint(Math.max(difficultyLevel, base.level));
      // The nearest hostile combat force defines a front. Within each build tier,
      // complete weapon coverage on that front first, then close the exposed wall gaps.
      const frontThreat = entities
        .filter(entity => areHostile(baseIdentity, entity) && entity.hp > 0 && !entity.isDead)
        .map(entity => ({ entity, distance: distance(core.x, core.y, entity.x, entity.y) }))
        .sort((a, b) => a.distance - b.distance)[0]?.entity;
      const frontDx = frontThreat ? frontThreat.x - core.x : 0;
      const frontDy = frontThreat ? frontThreat.y - core.y : 0;
      const frontLength = Math.max(1, Math.hypot(frontDx, frontDy));
      blueprint.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        const frontage = (slot: FortressSlot) => {
          const bp = BUILDING_BLUEPRINTS[slot.type];
          const px = (base.gx + slot.relGx) * GRID_SIZE + bp.widthInCells * GRID_SIZE / 2;
          const py = (base.gy + slot.relGy) * GRID_SIZE + bp.heightInCells * GRID_SIZE / 2;
          const dx = px - core.x;
          const dy = py - core.y;
          return (dx * frontDx + dy * frontDy) / (Math.max(1, Math.hypot(dx, dy)) * frontLength);
        };
        return frontage(b) - frontage(a);
      });

      const baseTeamId = base.teamId || base.id;
      const owningCommander = entities.find(entity => entity.kind === 'COMMANDER' &&
        !entity.isDead && entity.hp > 0 && getCombatTeamId(entity) === baseTeamId);
      const plannedSpend = base.stance === 'DEFENDING'
        ? undefined
        : getPlannedCommanderSpend(owningCommander, buildings, baseTeamId);
      // Routine fortification must not consume the last resources needed to build
      // or upgrade economy/command systems. Emergency defense can spend that reserve.
      const routineWallReserve = 35 + Math.max(0, Math.min(5, base.level - 1)) * 10;

      for (const slot of blueprint) {
        const targetGx = base.gx + slot.relGx;
        const targetGy = base.gy + slot.relGy;

        // Check if building already exists at this blueprint cell
        const existingBuilding = buildings.find(
          b => belongsToTeam(b, base.teamId || base.id) && b.hp > 0 && b.gx === targetGx && b.gy === targetGy
        );

        if (!existingBuilding) {
          const bp = BUILDING_BLUEPRINTS[slot.type];
          if (canAfford(base.resources, bp.cost)) {
            const woodAfter = base.resources.wood - bp.cost.wood;
            const stoneAfter = base.resources.stone - bp.cost.stone;
            const isEmergencyDefense = base.stance === 'DEFENDING' &&
              (slot.type === 'AUTO_TURRET' || slot.type === 'FIRE_TOWER' || slot.type === 'WALL');
            const breaksPlannedInvestment = Boolean(plannedSpend && !isEmergencyDefense &&
              (woodAfter < plannedSpend.wood || stoneAfter < plannedSpend.stone));
            const breaksRoutineReserve = slot.type === 'WALL' && base.stance !== 'DEFENDING' && !plannedSpend &&
              (woodAfter < routineWallReserve || stoneAfter < routineWallReserve);
            if (breaksPlannedInvestment || breaksRoutineReserve) continue;
            const occupiedByUnit = entities.some(entity => {
              if (entity.hp <= 0 || entity.isDead) return false;
              const gx = Math.floor(entity.x / GRID_SIZE);
              const gy = Math.floor(entity.y / GRID_SIZE);
              return gx >= targetGx && gx < targetGx + bp.widthInCells &&
                gy >= targetGy && gy < targetGy + bp.heightInCells;
            });
            if (!occupiedByUnit && isAreaBuildable(targetGx, targetGy, bp.widthInCells, bp.heightInCells, buildings, resourceNodes)) {
              base.resources = deductCost(base.resources, bp.cost);
              const newStructure = createBuildingInstance(slot.type, 'enemy', targetGx, targetGy, undefined, base.teamId || base.id);
              newStructure.allianceId = base.allianceId || base.teamId || base.id;
              buildings.push(newStructure);
              sound.playBuild();
              if (onSpark) {
                onSpark(newStructure.x, newStructure.y, '#f43f5e', 10);
              }
              if (onFloatingText) {
                onFloatingText(newStructure.x, newStructure.y - 15, `FORTIFIED: ${bp.name}`, '#f43f5e');
              }
              break; // Build one structure per cycle
            }
          }
        }
      }
    }

    // 4. Raid & Assault Stance Coordination
    // Never let a raid timer override the defense protocol on the same frame.
    // A commander that is hurt or has hostiles near its outpost should first
    // stabilize the perimeter; once the threat is gone, it still gets a short
    // short tactical pause while a real local threat remains; low HP alone never
    // cancels an assault because the correct strategy is to keep fighting.
    if (base.stance === 'DEFENDING' || hostileUnitNearby) {
      base.raidTimer = Math.max(base.raidTimer || 0, Math.min(base.raidInterval, 8));
    } else {
      base.raidTimer -= dt;
      if (base.raidTimer <= 0) {
        base.raidTimer = base.raidInterval;
        base.stance = 'ASSAULT';

        // The central commander leads the assault; its drones accompany it.
        // Keep the combat roster limited to the central commander and its drones.
        buildings
          .filter(b => belongsToTeam(b, base.teamId || base.id) && b.type === 'DRONE_STATION' && b.hp > 0)
          .forEach(station => { station.droneMode = 'ESCORT'; });

        if (onFloatingText) {
          onFloatingText(base.x, base.y - 30, 'ASSAULT FORMATION DISPATCHED!', '#f43f5e');
        }
        sound.playWaveAlert();
      }
    }
  }
}

export const enemyCommanderAI = new EnemyCommanderAI();
