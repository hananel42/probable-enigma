import { CHUNK_SIZE } from '../world';
import { sound } from '../audio';
import { droneAI } from '../ai/droneAI';
import { harvesterAI } from '../ai/harvesterAI';
import { commanderAI } from '../ai/commanderAI';
import { applyEntityDamage, getCombatTeamId } from '../combat';
import { updateBuildingsRuntime } from '../buildings/runtime';
import { tickBuffs } from '../statusEffects/buffSystem';
import { EngineSinglePlayer } from './EngineSinglePlayer';
import { measurePerformance } from '../performance/PerformanceDiagnostics';

export abstract class EngineAutonomousSystems extends EngineSinglePlayer {



  protected override updateAutonomousUnits(dt: number) {
    for (let i = this.state.entities.length - 1; i >= 0; i--) {
      const entity = this.state.entities[i];
      if (entity === this.state.player) continue;

      if (!entity.isDead) {
        const buffTick = tickBuffs(entity, dt);
        if (buffTick.healthDelta < 0) {
          const damageResult = applyEntityDamage(entity, -buffTick.healthDelta);
          if (damageResult.becameLethal && entity.kind === 'COMMANDER') {
            this.createSparks(entity.x, entity.y, '#f43f5e', 14);
            sound.playExplosion(false);
          }
        } else if (buffTick.healthDelta > 0) {
          entity.hp = Math.min(entity.maxHp, entity.hp + buffTick.healthDelta);
        }
        for (const effect of buffTick.particles) this.createSparks(entity.x, entity.y, effect.color, effect.count, effect.size);
      }

      // Check if dead
      if (entity.hp <= 0 && !entity.isDead) {
        this.harvesterChunkLocations.delete(entity.id);
        if (entity.kind === 'COMMANDER') {
          // Recover commanders only while their team's Core still exists.
          const friendlyCore = this.state.buildings.find(
            b => b.type === 'CORE' && getCombatTeamId(b) === getCombatTeamId(entity) && b.hp > 0
          );
          if (friendlyCore) {
            entity.hp = 0;
            entity.isDead = true;
            entity.respawnTimer = Math.max(entity.respawnTimer || 0, 3.0);
            entity.vx = 0;
            entity.vy = 0;
            this.createSparks(entity.x, entity.y, '#f43f5e', 14);
            sound.playExplosion(false);
            continue;
          }
        }
        sound.playExplosion(false);
        this.createSparks(entity.x, entity.y, '#f43f5e', 12);
        this.state.entities.splice(i, 1);
        continue;
      }

      if (entity.kind === 'COMMANDER' && entity.faction === 'enemy') {
        const enemyBase = this.state.enemyBases.find(
          base => base.commanderId === entity.id || (base.teamId || base.id) === getCombatTeamId(entity)
        );
        const baseWallet = enemyBase ? enemyBase.resources : { wood: 60, stone: 60, diamonds: 0 };

        measurePerformance('ai.enemyCommander.update', () => commanderAI.updateCommander(
          entity,
          baseWallet,
          this.state.buildings,
          this.state.resourceNodes,
          this.state.entities,
          this.state.projectiles,
          this.state.enemyBases,
          dt,
          {
            onSpark: (x, y, color, count) => this.createSparks(x, y, color, count),
            onFloatingText: (x, y, text, color) => this.addFloatingText(x, y, text, color)
          }
        ), { commanderId: entity.id, buildingCount: this.state.buildings.length, entityCount: this.state.entities.length });
      } else if (entity.kind === 'HARVESTER_BOT') {
        const chunkX = Math.floor(entity.x / CHUNK_SIZE);
        const chunkY = Math.floor(entity.y / CHUNK_SIZE);
        const chunkKey = `${chunkX},${chunkY}`;
        if (this.harvesterChunkLocations.get(entity.id) !== chunkKey) {
          this.harvesterChunkLocations.set(entity.id, chunkKey);
          this.loadChunksAroundWorld(entity.x, entity.y, 1);
        }
        measurePerformance('ai.harvester.update', () => harvesterAI.updateBot(
          entity,
          this.state.buildings,
          this.state.resourceNodes,
          dt,
          (station, wood, stone) => {
            this.triggerStateChange();
          }
        ), { entityId: entity.id, buildingCount: this.state.buildings.length, resourceNodeCount: this.state.resourceNodes.length });
      } else if (entity.kind === 'DRONE') {
        measurePerformance('ai.drone.update', () => droneAI.updateDrone(
          entity,
          this.state.player,
          this.state.buildings,
          this.state.entities,
          this.state.projectiles,
          dt,
          this.state.resourceNodes,
          this.state.gameTime
        ), { droneId: entity.id, buildingCount: this.state.buildings.length, entityCount: this.state.entities.length });
      }
    }
  }


  protected override updateBuildings(dt: number) {
    updateBuildingsRuntime(this, dt);
  }
}
