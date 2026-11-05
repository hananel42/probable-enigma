import type { Building, GameEntity } from '../types';
import { distance } from '../rules';
import { generateProceduralEnemyBase } from '../world';
import { sound } from '../audio';
import { enemyCommanderAI } from '../ai/enemyCommanderAI';
import { areHostile, findPriorityHostileTarget } from '../combat';
import { isPerformanceDiagnosticsEnabled, measurePerformance, recordPerformanceSample } from '../performance/PerformanceDiagnostics';
import { isBuildingOperational } from '../coreStatus';
import { EngineAutonomousSystems } from './EngineAutonomousSystems';

export abstract class EngineEnemyBases extends EngineAutonomousSystems {


  /** Resolve a cached weapon target without a full priority scan every frame. */
  public override resolveCachedBuildingTarget(
    building: Building,
    entities: GameEntity[],
    buildings: Building[],
    range: number
  ): ReturnType<typeof findPriorityHostileTarget> {
    const entity = building.targetEntityId
      ? entities.find(candidate => candidate.id === building.targetEntityId && candidate.hp > 0 && !candidate.isDead && areHostile(building, candidate))
      : undefined;
    if (entity) {
      const targetDistance = distance(building.x, building.y, entity.x, entity.y);
      if (targetDistance <= range) return { kind: 'ENTITY', entity, distance: targetDistance };
    }
    const targetBuilding = building.targetBuildingId
      ? buildings.find(candidate => candidate.id === building.targetBuildingId && candidate.hp > 0 && isBuildingOperational(candidate, buildings) && areHostile(building, candidate))
      : undefined;
    if (targetBuilding) {
      const targetDistance = distance(building.x, building.y, targetBuilding.x, targetBuilding.y);
      if (targetDistance <= range) return { kind: 'BUILDING', building: targetBuilding, distance: targetDistance };
    }
    return undefined;
  }


  protected override updateEnemyBases(dt: number) {
    const firstOutpostDelay = 90;
    const outpostInterval = 170;
    const expectedBaseCount = this.state.gameTime < firstOutpostDelay
      ? 0
      : 1 + Math.floor((this.state.gameTime - firstOutpostDelay) / outpostInterval);
    // Defeated participants remain connected until they leave the room, but
    // their Commanders have been permanently retired. They must not be treated
    // as broken live participants or as spawn anchors for future enemy bases.
    const liveParticipants = this.state.humanPlayers.filter(
      participant => participant.connected && !this.isParticipantDefeated(participant.playerId)
    );
    if (liveParticipants.length === 0) return;

    const spawnAnchors = liveParticipants.map(participant => {
      const commander = this.state.entities.find(entity => entity.id === participant.commanderId);
      if (!commander) throw new Error(`Cannot choose an enemy outpost spawn anchor: active participant '${participant.playerId}' is missing commander '${participant.commanderId}'.`);
      return commander;
    });
    if (expectedBaseCount > this.state.enemyBases.length && spawnAnchors.length === 0) {
      throw new Error('Cannot spawn an enemy outpost: no undefeated connected participant commander is available as a spawn anchor.');
    }
    while (this.state.enemyBases.length < expectedBaseCount) {
      const baseIndex = this.state.enemyBases.length;
      // Disconnected players are excluded so abandoned guest coordinates never
      // become procedural enemy-base anchors.
      const anchor = spawnAnchors[baseIndex % spawnAnchors.length];
      const spawnStartedAt = performance.now();
      const newBaseData = measurePerformance('enemyBase.generate', () => generateProceduralEnemyBase(
        baseIndex,
        this.state.difficultyLevel,
        anchor.x,
        anchor.y,
        this.worldSeed,
        this.state.resourceNodes
      ), { baseIndex, currentBuildingCount: this.state.buildings.length, resourceNodeCount: this.state.resourceNodes.length });

      // Join the generated objects before loading chunks so new resource nodes are
      // filtered against the new base. Spawn positions were already validated by
      // generateProceduralEnemyBase, including existing resource cells for ground units.
      this.state.enemyBases.push(newBaseData.base);
      this.state.groups.push(newBaseData.group);
      this.state.buildings.push(...newBaseData.buildings);
      this.state.entities.push(...newBaseData.entities);

      measurePerformance('enemyBase.loadChunks', () =>
        this.loadChunksAroundWorld(newBaseData.base.x, newBaseData.base.y, 1),
        { baseIndex, buildingCount: this.state.buildings.length }
      );

      // Only the newly-created base can introduce resource/building overlap here.
      // Avoid rebuilding an occupancy set for every historical building in the world.
      const occupiedCells = new Set<string>();
      for (const building of newBaseData.buildings) {
        const width = Math.max(1, building.widthInCells);
        const height = Math.max(1, building.heightInCells);
        for (let dx = 0; dx < width; dx++) {
          for (let dy = 0; dy < height; dy++) occupiedCells.add(`${building.gx + dx},${building.gy + dy}`);
        }
      }
      const resourceCountBeforePrune = this.state.resourceNodes.length;
      const resourcePruneStartedAt = performance.now();
      if (occupiedCells.size > 0) {
        // Compact in place: this avoids allocating a second full-world resource array
        // at the exact moment an outpost appears. Only the new base footprint is tested.
        const resources = this.state.resourceNodes;
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < resources.length; readIndex++) {
          const node = resources[readIndex];
          if (occupiedCells.has(`${node.gx},${node.gy}`)) continue;
          resources[writeIndex++] = node;
        }
        if (writeIndex !== resources.length) resources.length = writeIndex;
      }
      const resourcePruneMs = performance.now() - resourcePruneStartedAt;
      this.addFloatingText(this.state.player.x, this.state.player.y - 35, 'WARNING: HOSTILE OUTPOST EXPANSION!', '#f43f5e');
      sound.playWaveAlert();
      this.triggerStateChange();
      const spawnDurationMs = performance.now() - spawnStartedAt;
      recordPerformanceSample('enemyBase.spawn.total', spawnDurationMs, {
        baseIndex,
        generatedBuildingCount: newBaseData.buildings.length,
        generatedEntityCount: newBaseData.entities.length,
        buildingsAfterSpawn: this.state.buildings.length,
        entitiesAfterSpawn: this.state.entities.length,
        resourcesBeforePrune: resourceCountBeforePrune,
        resourcesAfterPrune: this.state.resourceNodes.length,
        resourcePruneMs: Number(resourcePruneMs.toFixed(3))
      });
      if (isPerformanceDiagnosticsEnabled()) {
        console.info('[perf] Enemy outpost spawned.', {
          baseId: newBaseData.base.id,
          baseIndex,
          durationMs: Number(spawnDurationMs.toFixed(3)),
          generationBuildingCount: newBaseData.buildings.length,
          generationEntityCount: newBaseData.entities.length,
          worldBuildingCount: this.state.buildings.length,
          worldEntityCount: this.state.entities.length,
          worldResourceNodeCount: this.state.resourceNodes.length,
          anchorX: anchor.x,
          anchorY: anchor.y,
          spawnX: newBaseData.base.x,
          spawnY: newBaseData.base.y
        });
      }
    }

    // Run modular autonomous EnemyCommanderAI for each base
    measurePerformance('enemyBase.aiUpdateAll', () => this.state.enemyBases.forEach(base => {
      measurePerformance('enemyBase.aiUpdateOne', () => enemyCommanderAI.updateBase(
        base,
        this.state.buildings,
        this.state.entities,
        this.state.resourceNodes,
        this.state.difficultyLevel,
        dt,
        (x, y, color, count) => this.createSparks(x, y, color, count),
        (x, y, text, color) => this.addFloatingText(x, y, text, color)
      ), { baseId: base.id, buildingCount: this.state.buildings.length, entityCount: this.state.entities.length });
    }), { baseCount: this.state.enemyBases.length, buildingCount: this.state.buildings.length, entityCount: this.state.entities.length });
  }
}
