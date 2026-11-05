import type { Building, BuildingType, EnemyBase, GameEntity, ResourceNode, Resources } from '../../types';
import { BUILDING_BLUEPRINTS, canAfford, createBuildingInstance, distance, isAreaBuildable, GRID_SIZE } from '../../rules';
import { areHostile, belongsToTeam, getCombatTeamId } from '../../combat';
import { sound } from '../../audio';
import type { CommanderActionFeedback } from './model';
import { CommanderAIMiningActions } from './CommanderAIMiningActions';

export abstract class CommanderAIBuildingActions extends CommanderAIMiningActions {

  protected override executeBuildGoal(
    commander: GameEntity,
    wallet: Resources,
    buildings: Building[],
    resources: ResourceNode[],
    allEntities: GameEntity[],
    enemyBases: EnemyBase[],
    dt: number,
    feedback?: CommanderActionFeedback
  ) {
    const type = commander.aiBuildType;
    if (!type || type === 'CORE' || !BUILDING_BLUEPRINTS[type]) {
      commander.aiGoal = 'IDLE';
      return;
    }
    const blueprint = BUILDING_BLUEPRINTS[type];
    if (!canAfford(wallet, blueprint.cost)) {
      commander.aiGoal = 'IDLE';
      return;
    }

    const teamId = getCombatTeamId(commander);
    const core = buildings.find(b => b.type === 'CORE' && b.hp > 0 && belongsToTeam(b, teamId));
    if (!core) {
      commander.aiGoal = 'IDLE';
      return;
    }

    const radiusPreference: Record<BuildingType, number> = {
      CORE: 0,
      WALL: 4.5,
      AUTO_TURRET: 5.8,
      HARVESTER_STATION: 3.6,
      DRONE_STATION: 4.2,
      FIRE_TOWER: 3.8
    };
    const candidates: Array<{ gx: number; gy: number; score: number }> = [];
    const existingSameType = buildings.filter(building => building.type === type && belongsToTeam(building, teamId) && building.hp > 0);
    const friendlyBuildings = buildings.filter(building => belongsToTeam(building, teamId) && building.hp > 0);
    const hostileUnits = allEntities.filter(entity => entity.hp > 0 && !entity.isDead && areHostile(commander, entity));
    // Rank nearby known deposits once per construction decision. Previously each
    // legal Harvester Station tile scanned the entire streamed world independently.
    const resourceAnchors = type === 'HARVESTER_STATION'
      ? resources.filter(node => node.amount > 0)
        .map(node => ({ node, distanceToCore: distance(core.x, core.y, node.x, node.y) }))
        .sort((a, b) => a.distanceToCore - b.distanceToCore)
        .slice(0, 64)
        .map(entry => entry.node)
      : [];
    const nearestHostile = hostileUnits
      .map(entity => ({ x: entity.x, y: entity.y, d: distance(core.x, core.y, entity.x, entity.y) }))
      .sort((a, b) => a.d - b.d)[0];
    const nearestEnemyBase = enemyBases
      .filter(base => !base.isDestroyed && (base.teamId || base.id) !== teamId)
      .map(base => ({ x: base.x, y: base.y, d: distance(core.x, core.y, base.x, base.y) }))
      .sort((a, b) => a.d - b.d)[0];
    const threatPoint = nearestHostile || nearestEnemyBase;
    const threatDx = threatPoint ? threatPoint.x - core.x : 0;
    const threatDy = threatPoint ? threatPoint.y - core.y : 0;
    const threatLength = Math.max(1, Math.hypot(threatDx, threatDy));

    for (let radius = 2; radius <= 11; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const gx = core.gx + dx;
          const gy = core.gy + dy;
          if (!isAreaBuildable(gx, gy, blueprint.widthInCells, blueprint.heightInCells, buildings, resources)) continue;
          const occupiedByUnit = allEntities.some(entity => {
            if (entity.hp <= 0 || entity.isDead) return false;
            const entityGx = Math.floor(entity.x / GRID_SIZE);
            const entityGy = Math.floor(entity.y / GRID_SIZE);
            return entityGx >= gx && entityGx < gx + blueprint.widthInCells &&
              entityGy >= gy && entityGy < gy + blueprint.heightInCells;
          });
          if (occupiedByUnit) continue;

          const centerX = gx * GRID_SIZE + blueprint.widthInCells * GRID_SIZE / 2;
          const centerY = gy * GRID_SIZE + blueprint.heightInCells * GRID_SIZE / 2;
          const coreDistance = Math.hypot(centerX - core.x, centerY - core.y) / GRID_SIZE;
          const nearestSameType = existingSameType.length
            ? Math.min(...existingSameType.map(building => distance(centerX, centerY, building.x, building.y) / GRID_SIZE))
            : 10;
          const nearestAny = friendlyBuildings.length
            ? Math.min(...friendlyBuildings.map(building => distance(centerX, centerY, building.x, building.y) / GRID_SIZE))
            : 10;
          let score = Math.abs(coreDistance - radiusPreference[type]);

          // Avoid a single tight turret cluster; make each defense cover a different arc.
          if (type === 'AUTO_TURRET' || type === 'FIRE_TOWER') {
            score += Math.abs(nearestSameType - 4.8) * 0.42;
            if (nearestSameType < 2.5) score += (2.5 - nearestSameType) * 2.5;
          }
          // Keep non-overlapping buildings from packing against one another where
          // a little spacing improves access and provides room for deployed units.
          if (nearestAny < 1.7) score += (1.7 - nearestAny) * 1.8;
          if (type === 'WALL') score += Math.abs(coreDistance - 4.8) * 0.2;

          if (threatPoint) {
            const candidateDx = centerX - core.x;
            const candidateDy = centerY - core.y;
            const alignment = (candidateDx * threatDx + candidateDy * threatDy) /
              (Math.max(1, Math.hypot(candidateDx, candidateDy)) * threatLength);
            if (type === 'AUTO_TURRET' || type === 'FIRE_TOWER') {
              score -= alignment * 1.45;
              const threatDistanceCells = distance(centerX, centerY, threatPoint.x, threatPoint.y) / GRID_SIZE;
              score += Math.abs(threatDistanceCells - 6.5) * 0.16;
            }
          }

          if (type === 'HARVESTER_STATION' && resourceAnchors.length > 0) {
            let nearestDeposit = Number.POSITIVE_INFINITY;
            for (const node of resourceAnchors) {
              nearestDeposit = Math.min(nearestDeposit, distance(centerX, centerY, node.x, node.y) / GRID_SIZE);
            }
            if (Number.isFinite(nearestDeposit)) score += Math.max(0, nearestDeposit - 5) * 0.22;
          }
          candidates.push({ gx, gy, score });
        }
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const tile = candidates[0];
    if (!tile) {
      commander.aiGoal = 'IDLE';
      commander.aiBuildType = null;
      return;
    }

    wallet.wood -= blueprint.cost.wood;
    wallet.stone -= blueprint.cost.stone;
    const structure = createBuildingInstance(type, commander.faction, tile.gx, tile.gy, undefined, teamId);
    structure.allianceId = commander.allianceId || teamId;
    buildings.push(structure);
    sound.playBuild();
    feedback?.onSpark?.(structure.x, structure.y, '#f43f5e', 12);
    commander.aiGoal = 'IDLE';
    commander.aiBuildType = null;
  }
}
