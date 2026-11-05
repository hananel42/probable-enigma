import type { GameEntity } from '../types';
import { getBuildingCandidatesInCellBounds, GRID_SIZE } from '../rules';
import { sound } from '../audio';
import { applyEntityDamage, isProjectileHostileTo } from '../combat';
import { isBuildingOperational } from '../coreStatus';
import { EngineCombat } from './EngineCombat';

export abstract class EngineProjectileRuntime extends EngineCombat {


  protected override updateProjectiles(dt: number) {
    // Projectiles move after autonomous units/buildings, so a single spatial
    // snapshot is valid for the entire collision pass. This replaces the old
    // O(projectiles × all entities/buildings) scan that caused late-game freezes.
    const bucketSize = GRID_SIZE * 2;
    const entityBuckets = new Map<string, GameEntity[]>();
    const bucketKey = (x: number, y: number) => `${Math.floor(x / bucketSize)},${Math.floor(y / bucketSize)}`;
    for (const entity of this.state.entities) {
      if (entity.hp <= 0 || entity.isDead) continue;
      const key = bucketKey(entity.x, entity.y);
      const bucket = entityBuckets.get(key);
      if (bucket) bucket.push(entity);
      else entityBuckets.set(key, [entity]);
    }

    // Search a generous entity-radius window, then perform exact circle tests.
    // Unit radii are data-driven and this window is intentionally above the
    // current largest body to keep newly added units from becoming unhittable.
    const maxEntityHitRadius = 40;
    projectileLoop: for (let i = this.state.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.state.projectiles[i];
      this.steerGuidedProjectile(projectile, dt);
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.life -= dt;

      if (projectile.life <= 0) {
        this.state.projectiles.splice(i, 1);
        continue;
      }

      let hit = false;
      let reflected = false;
      let directTargetId = '';
      const minGx = Math.floor((projectile.x - projectile.radius - 52) / GRID_SIZE);
      const maxGx = Math.floor((projectile.x + projectile.radius + 52) / GRID_SIZE);
      const minGy = Math.floor((projectile.y - projectile.radius - 52) / GRID_SIZE);
      const maxGy = Math.floor((projectile.y + projectile.radius + 52) / GRID_SIZE);

      const minEntityBx = Math.floor((projectile.x - maxEntityHitRadius) / bucketSize);
      const maxEntityBx = Math.floor((projectile.x + maxEntityHitRadius) / bucketSize);
      const minEntityBy = Math.floor((projectile.y - maxEntityHitRadius) / bucketSize);
      const maxEntityBy = Math.floor((projectile.y + maxEntityHitRadius) / bucketSize);
      entityScan:
      for (let bx = minEntityBx; bx <= maxEntityBx; bx++) {
        for (let by = minEntityBy; by <= maxEntityBy; by++) {
          const bucket = entityBuckets.get(`${bx},${by}`);
          if (!bucket) continue;
          for (const entity of bucket) {
            if (!isProjectileHostileTo(projectile, entity) || entity.hp <= 0 || entity.isDead ||
                !this.projectileCanReachTarget(projectile, entity.x, entity.y)) continue;
            const dx = projectile.x - entity.x;
            const dy = projectile.y - entity.y;
            const hitRadius = projectile.radius + entity.radius;
            if (dx * dx + dy * dy >= hitRadius * hitRadius) continue;

            const damageResult = applyEntityDamage(entity, projectile.damage);
            sound.playHit();
            this.createSparks(projectile.x, projectile.y, projectile.color, 6);
            this.addFloatingText(entity.x, entity.y - 12, `-${Math.round(damageResult.damage)}`, '#f43f5e');
            if (damageResult.becameLethal && entity.kind === 'COMMANDER') {
              this.createSparks(entity.x, entity.y, '#f43f5e', 14);
              sound.playExplosion(false);
            }
            hit = true;
            directTargetId = entity.id;
            this.applyProjectileExplosion(projectile, projectile.x, projectile.y, directTargetId);
            break entityScan;
          }
        }
      }

      if (!hit) {
        const buildingCandidates = getBuildingCandidatesInCellBounds(
          this.state.buildings, minGx, minGy, maxGx, maxGy
        );
        for (const building of buildingCandidates) {
          if (!isProjectileHostileTo(projectile, building) || building.hp <= 0 || !isBuildingOperational(building, this.state.buildings) ||
              !this.projectileCanReachTarget(projectile, building.x, building.y)) continue;
          const hitDist = (building.widthInCells || 1) * 22;
          const dx = projectile.x - building.x;
          const dy = projectile.y - building.y;
          const hitRadius = projectile.radius + hitDist;
          if (dx * dx + dy * dy >= hitRadius * hitRadius) continue;

          if (building.type === 'WALL' && this.tryReflectProjectile(projectile, building)) {
            reflected = true;
            break;
          }
          const damageResult = this.damageBuilding(building, projectile.damage, projectile);
          sound.playHit();
          this.createSparks(projectile.x, projectile.y, projectile.color, 6);
          this.addFloatingText(building.x, building.y - 15, `-${Math.round(damageResult.damage)}`, '#f43f5e');
          hit = true;
          directTargetId = building.id;
          this.applyProjectileExplosion(projectile, projectile.x, projectile.y, directTargetId);
          break;
        }
      }

      if (reflected) continue projectileLoop;
      if (hit) this.state.projectiles.splice(i, 1);
    }
  }


  protected override updateParticles(dt: number) {
    for (let i = this.state.particles.length - 1; i >= 0; i--) {
      const p = this.state.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.state.particles.splice(i, 1);
      }
    }
  }


  protected override updateFloatingTexts(dt: number) {
    for (let i = this.state.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.state.floatingTexts[i];
      t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) {
        this.state.floatingTexts.splice(i, 1);
      }
    }
  }


  public override addFloatingText(x: number, y: number, text: string, color: string) {
    if (this.state.floatingTexts.length >= 96) this.state.floatingTexts.splice(0, this.state.floatingTexts.length - 95);
    this.state.floatingTexts.push({
      id: `txt-${Date.now()}-${Math.random()}`,
      x,
      y,
      text,
      color,
      life: 1.1,
      vy: -24
    });
  }


  public override createSparks(x: number, y: number, color: string, count: number = 8, particleSize = 2.5) {
    // A combat swarm can emit thousands of particles in a few frames. Keep visual
    // effects bounded so their short lifetime cannot create unbounded draw cost.
    const particleBudget = Math.max(0, 1800 - this.state.particles.length);
    const safeCount = Math.min(count, particleBudget);
    for (let i = 0; i < safeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 90;
      this.state.particles.push({
        id: `particle-${this.nextParticleSerial++}`,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: Math.max(0.5, particleSize * (0.75 + Math.random() * 0.5)),
        alpha: 1,
        life: 0.25 + Math.random() * 0.25,
        maxLife: 0.5
      });
    }
  }
}
