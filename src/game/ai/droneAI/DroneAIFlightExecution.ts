import type { Building, GameEntity, ResourceNode } from '../../types';
import { distance, GRID_SIZE } from '../../rules';
import { applyBuildingDamage, applyEntityDamage, areHostile, isAliveEntity } from '../../combat';
import { applyRadialExplosion } from '../../explosions';
import { moveEntityWithDesiredVelocity, moveWithGridCollisionSubstepped } from '../../movement';
import { BASE_DRONE_TUNING } from '../../combatTuning';
import { behavior as droneStationBehavior } from '../../buildings/droneStation/behavior';
import type { DefenseOrbitRoute, DroneFlightCurve } from './model';
import { DroneAIFlightPlanning } from './DroneAIFlightPlanning';
import { getNavigationPoint, invalidateDroneFlightPath, maintainDronePath } from './DroneFlightPathPlanner';
import { measurePerformance, recordPerformanceSample } from '../../performance/PerformanceDiagnostics';

export abstract class DroneAIFlightExecution extends DroneAIFlightPlanning {

  protected override moveOnDefenseOrbit(
    drone: GameEntity,
    route: DefenseOrbitRoute,
    buildings: Building[],
    resourceNodes: ResourceNode[],
    dt: number,
    maxSpeed: number
  ) {
    if (dt <= 0) return;
    const phase = drone.patrolAngle || 0;
    const cruiseSpeed = Math.min(maxSpeed * 0.82, droneStationBehavior.formationSpeed);
    const nextPhase = this.advanceEllipsePhase(phase, route.radiusX, route.radiusY, cruiseSpeed, dt);
    const targetX = route.centerX + Math.cos(nextPhase) * route.radiusX;
    const targetY = route.centerY + Math.sin(nextPhase) * route.radiusY;

    // Follow the patrol ellipse as a continuous curve. The tangent velocity is
    // feed-forward; a proportional correction gently converges to the curve if
    // collision handling or a return path left the drone slightly off-course.
    // Never assign x/y directly here: that creates a visible teleport on re-entry.
    const tangentX = -Math.sin(nextPhase) * route.radiusX;
    const tangentY = Math.cos(nextPhase) * route.radiusY;
    const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
    const feedForwardVx = (tangentX / tangentLength) * cruiseSpeed;
    const feedForwardVy = (tangentY / tangentLength) * cruiseSpeed;
    const correctionGain = 2.4;
    const desiredVx = feedForwardVx + (targetX - drone.x) * correctionGain;
    const desiredVy = feedForwardVy + (targetY - drone.y) * correctionGain;
    moveEntityWithDesiredVelocity(
      drone, desiredVx, desiredVy, buildings, resourceNodes, dt, maxSpeed, droneStationBehavior.acceleration
    );
    if (Math.hypot(drone.vx, drone.vy) > 1) drone.angle = Math.atan2(drone.vy, drone.vx);
    drone.patrolAngle = nextPhase % (Math.PI * 2);
  }

  protected override pointOnCurve(curve: DroneFlightCurve, phase: number) {
    let x = curve.centerX + Math.cos(phase) * curve.radiusX;
    let y = curve.centerY + Math.sin(phase) * curve.radiusY;
    if (curve.leash) {
      const leashDx = x - curve.leash.x;
      const leashDy = y - curve.leash.y;
      const leashDistance = Math.hypot(leashDx, leashDy);
      if (leashDistance > curve.leash.radius && leashDistance > 0) {
        const scale = curve.leash.radius / leashDistance;
        x = curve.leash.x + leashDx * scale;
        y = curve.leash.y + leashDy * scale;
      }
    }
    return { x, y };
  }

  /**
   * Tracks a continuously moving ellipse parametrically. Feed-forward tangent
   * velocity keeps the drone moving around the curve; proportional position
   * correction only pulls it back onto the path. This avoids arrival-braking at
   * a waypoint which moves again next frame.
   */
  protected override moveDroneOnCurve(
    drone: GameEntity,
    curve: DroneFlightCurve,
    dt: number,
    buildings: Building[],
    resources: ResourceNode[],
    maxSpeed: number
  ): { moved: boolean; target: { x: number; y: number } } {
    const target = this.pointOnCurve(curve, curve.phase);
    const epsilon = 0.015;
    const ahead = this.pointOnCurve(curve, curve.phase + epsilon);
    const behind = this.pointOnCurve(curve, curve.phase - epsilon);
    const derivativeScale = curve.angularSpeed / (epsilon * 2);
    const tangentVx = (ahead.x - behind.x) * derivativeScale + curve.centerVx;
    const tangentVy = (ahead.y - behind.y) * derivativeScale + curve.centerVy;
    const correctionGain = 2.35;
    const desiredVx = tangentVx + (target.x - drone.x) * correctionGain;
    const desiredVy = tangentVy + (target.y - drone.y) * correctionGain;
    const moved = moveEntityWithDesiredVelocity(
      drone,
      desiredVx,
      desiredVy,
      buildings,
      resources,
      dt,
      maxSpeed,
      droneStationBehavior.acceleration
    );
    return { moved, target };
  }

  /**
   * Low-health drones switch permanently to a one-way interception run. The
   * blast is hostile-only and uses quadratic falloff, so damage drops sharply
   * away from the centre and reaches zero at three grid cells.
   */
  protected override updateKamikazeDrone(drone: GameEntity, entities: GameEntity[], buildings: Building[], dt: number, nowSeconds = performance.now() / 1000): boolean {
    if (![drone.x, drone.y, drone.vx, drone.vy, drone.hp, drone.maxHp, dt].every(Number.isFinite) || dt < 0) {
      throw new RangeError(`Kamikaze drone '${drone.id}' has non-finite state or an invalid delta.`);
    }
    const triggerHp = drone.maxHp * 0.2;
    if (!drone.droneKamikazeActive && drone.hp > triggerHp) return false;
    drone.droneKamikazeActive = true;

    let targetEntity = drone.droneKamikazeTargetId
      ? entities.find(candidate => candidate.id === drone.droneKamikazeTargetId && isAliveEntity(candidate) && areHostile(drone, candidate))
      : undefined;
    let targetBuilding = drone.droneKamikazeTargetBuildingId
      ? buildings.find(candidate => candidate.id === drone.droneKamikazeTargetBuildingId && candidate.hp > 0 && areHostile(drone, candidate))
      : undefined;

    if (!targetEntity && !targetBuilding) {
      drone.droneKamikazeTargetId = null;
      drone.droneKamikazeTargetBuildingId = null;
      const targetScanStartedAtMs = performance.now();
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of entities) {
        if (candidate.id === drone.id || !isAliveEntity(candidate) || !areHostile(drone, candidate)) continue;
        const candidateDistance = distance(drone.x, drone.y, candidate.x, candidate.y);
        if (candidateDistance < nearestDistance) {
          nearestDistance = candidateDistance;
          targetEntity = candidate;
          targetBuilding = undefined;
        }
      }
      for (const candidate of buildings) {
        if (candidate.hp <= 0 || !areHostile(drone, candidate)) continue;
        const candidateDistance = distance(drone.x, drone.y, candidate.x, candidate.y);
        if (candidateDistance < nearestDistance) {
          nearestDistance = candidateDistance;
          targetBuilding = candidate;
          targetEntity = undefined;
        }
      }
      if (targetEntity) drone.droneKamikazeTargetId = targetEntity.id;
      if (targetBuilding) drone.droneKamikazeTargetBuildingId = targetBuilding.id;
      // Keep reacquisition separate from the whole-drone metric; new enemies can
      // synchronously trigger this full-list scan on every low-health drone.
      recordPerformanceSample('ai.drone.kamikaze.scanHostileTargets', performance.now() - targetScanStartedAtMs, {
        droneId: drone.id, entityCount: entities.length, buildingCount: buildings.length
      });
    }

    if (!targetEntity && !targetBuilding) {
      // No valid target: invalidate any old route and decelerate physically instead
      // of freezing velocity instantaneously or reusing a stale target as a fallback.
      invalidateDroneFlightPath(drone);
      drone.path = [];
      drone.pathIndex = 0;
      drone.flightPathActive = false;
      const braking = droneStationBehavior.acceleration * dt;
      const speed = Math.hypot(drone.vx, drone.vy);
      if (speed > 0 && braking > 0) {
        const scale = Math.max(0, speed - braking) / speed;
        drone.vx *= scale;
        drone.vy *= scale;
      }
      return true;
    }

    const targetX = targetEntity ? targetEntity.x : targetBuilding!.x;
    const targetY = targetEntity ? targetEntity.y : targetBuilding!.y;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      throw new RangeError(`Kamikaze drone '${drone.id}' acquired a target with non-finite coordinates.`);
    }
    const dx = targetX - drone.x;
    const dy = targetY - drone.y;
    if (targetEntity && (!Number.isFinite(targetEntity.radius) || targetEntity.radius < 0 || !Number.isFinite(drone.radius) || drone.radius < 0)) {
      throw new RangeError(`Kamikaze drone '${drone.id}' or target '${targetEntity.id}' has an invalid collision radius.`);
    }
    if (targetBuilding && (!Number.isInteger(targetBuilding.widthInCells) || targetBuilding.widthInCells < 1 ||
        !Number.isInteger(targetBuilding.heightInCells) || targetBuilding.heightInCells < 1)) {
      throw new RangeError(`Kamikaze target building '${targetBuilding.id}' has invalid footprint dimensions.`);
    }
    const targetContactRadius = targetEntity
      ? Math.max(12, targetEntity.radius + drone.radius * 0.5)
      : Math.max(20, Math.max(targetBuilding!.widthInCells, targetBuilding!.heightInCells) * GRID_SIZE * 0.5);
    const targetDistance = Math.hypot(dx, dy);

    if (targetDistance <= targetContactRadius) {
      const blastRadius = GRID_SIZE * 3;
      const kamikazeDamage = drone.damage;
      if (typeof kamikazeDamage !== 'number' || !Number.isFinite(kamikazeDamage) || kamikazeDamage < 0) {
        throw new RangeError(`Kamikaze drone '${drone.id}' has invalid damage: ${String(kamikazeDamage)}.`);
      }
      const baseDamage = 220 * (kamikazeDamage / 32);
      const hostileEntity = (candidate: GameEntity) => candidate.id !== drone.id && isAliveEntity(candidate) && areHostile(drone, candidate);
      const hostileBuilding = (candidate: Building) => candidate.hp > 0 && areHostile(drone, candidate);
      // Use the same radial blast implementation as explosive projectiles. The
      // drone blast is point-based and quadratic, so edge damage falls to zero.
      applyRadialExplosion({
        origin: { x: targetX, y: targetY }, radius: blastRadius, baseDamage,
        falloff: 'quadratic', targets: entities, canDamage: hostileEntity,
        applyDamage: (candidate, damage) => applyEntityDamage(candidate, damage)
      });
      applyRadialExplosion({
        origin: { x: targetX, y: targetY }, radius: blastRadius, baseDamage,
        falloff: 'quadratic', targets: buildings, canDamage: hostileBuilding,
        applyDamage: (candidate, damage) => applyBuildingDamage(candidate, damage)
      });
      drone.hp = 0;
      drone.vx = 0;
      drone.vy = 0;
      drone.droneKamikazeActive = false;
      drone.droneKamikazeTargetId = null;
      drone.droneKamikazeTargetBuildingId = null;
      return true;
    }

    // Kamikaze has no orbit spring, but still uses bounded acceleration and the
    // same grid collision integration. A* supplies a route around structures when
    // the direct corridor is blocked; neither target contact nor route changes snap x/y.
    if (!Number.isFinite(drone.speed) || drone.speed < 0) {
      throw new RangeError(`Kamikaze drone '${drone.id}' has invalid normal flight speed: ${drone.speed}.`);
    }
    const speed = drone.speed * BASE_DRONE_TUNING.kamikazeSpeedMultiplier;
    drone.droneFlightGoalX = targetX;
    drone.droneFlightGoalY = targetY;
    drone.droneFlightPathRefreshTimer = (drone.droneFlightPathRefreshTimer ?? 0) + dt;
    measurePerformance('drone.kamikaze.pathPlanner', () =>
      maintainDronePath(drone, targetX, targetY, buildings, [], nowSeconds),
      { droneId: drone.id, buildingCount: buildings.length }
    );
    const waypoint = getNavigationPoint(drone, targetX, targetY);
    const toWaypointX = waypoint.x - drone.x;
    const toWaypointY = waypoint.y - drone.y;
    const waypointDistance = Math.hypot(toWaypointX, toWaypointY);
    const desiredVx = waypointDistance > 1e-4 ? toWaypointX / waypointDistance * speed : 0;
    const desiredVy = waypointDistance > 1e-4 ? toWaypointY / waypointDistance * speed : 0;
    const acceleration = droneStationBehavior.acceleration * dt;
    const velocityDelta = Math.hypot(desiredVx - drone.vx, desiredVy - drone.vy);
    if (dt > 0 && velocityDelta > acceleration && acceleration > 0) {
      const blend = acceleration / velocityDelta;
      drone.vx += (desiredVx - drone.vx) * blend;
      drone.vy += (desiredVy - drone.vy) * blend;
    } else if (dt > 0) {
      drone.vx = desiredVx;
      drone.vy = desiredVy;
    }

    const beforeX = drone.x;
    const beforeY = drone.y;
    let stepX = drone.vx * dt;
    let stepY = drone.vy * dt;
    const requestedStep = Math.hypot(stepX, stepY);
    // On a clear direct approach, cap this tick at the contact boundary. We move
    // continuously to that boundary and detonate on the next proximity check.
    if (!drone.flightPathActive && requestedStep > 0) {
      const safeDistance = Math.max(0, targetDistance - targetContactRadius);
      if (requestedStep > safeDistance) {
        const scale = safeDistance / requestedStep;
        stepX *= scale;
        stepY *= scale;
      }
    }
    if (dt > 0) {
      measurePerformance('drone.kamikaze.collisionIntegration', () =>
        moveWithGridCollisionSubstepped(drone, beforeX + stepX, beforeY + stepY, buildings, []),
        { droneId: drone.id, buildingCount: buildings.length }
      );
      drone.vx = (drone.x - beforeX) / dt;
      drone.vy = (drone.y - beforeY) / dt;
    }
    if (Math.hypot(drone.vx, drone.vy) > 1) drone.angle = Math.atan2(drone.vy, drone.vx);
    drone.visualAngle = drone.angle;
    return true;
  }
}
