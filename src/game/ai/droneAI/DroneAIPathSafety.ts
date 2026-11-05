import type { Building } from '../../types';
import { distance, GRID_SIZE, isCellInsideBuildingFootprint } from '../../rules';
import { DroneAICombatTargets } from './DroneAICombatTargets';

export abstract class DroneAIPathSafety extends DroneAICombatTargets {

  protected override isDirectAirRouteBlocked(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number,
    blockedCells: Set<string>
  ): boolean {
    const dx = targetX - startX;
    const dy = targetY - startY;
    const length = Math.hypot(dx, dy);
    const samples = Math.max(1, Math.ceil(length / (GRID_SIZE * 0.35)));
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const gx = Math.floor((startX + dx * t) / GRID_SIZE);
      const gy = Math.floor((startY + dy * t) / GRID_SIZE);
      if (this.isAirCellBlocked(gx, gy, blockedCells)) return true;
    }
    return false;
  }

  /** Find a safe hover cell; the shared obstacle index keeps recovery inexpensive. */
  protected override findSafeHoverTarget(
    desiredX: number,
    desiredY: number,
    currentX: number,
    currentY: number,
    blockedCells: Set<string>,
    buildings: Building[]
  ): { x: number; y: number } {
    const originGx = Math.floor(desiredX / GRID_SIZE);
    const originGy = Math.floor(desiredY / GRID_SIZE);
    const cellCenter = (gx: number, gy: number) => ({
      x: gx * GRID_SIZE + GRID_SIZE / 2,
      y: gy * GRID_SIZE + GRID_SIZE / 2
    });
    if (!this.isAirCellBlocked(originGx, originGy, blockedCells)) return cellCenter(originGx, originGy);

    // Prefer the nearest cell, with a slight bias toward the current position.
    // Search much farther than the old 10-cell radius so crowded bases do not
    // leave a drone permanently assigned to its current location.
    for (let radius = 1; radius <= 32; radius++) {
      let best: { x: number; y: number; score: number } | undefined;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const gx = originGx + dx;
          const gy = originGy + dy;
          if (this.isAirCellBlocked(gx, gy, blockedCells)) continue;
          const { x, y } = cellCenter(gx, gy);
          const score = distance(x, y, desiredX, desiredY) + distance(x, y, currentX, currentY) * 0.015;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    // If the requested patrol/escort point is enclosed by a very large base,
    // prioritize a legal escape waypoint near the drone before giving up. This
    // search happens only when the preferred point has no safe tile nearby.
    const currentGx = Math.floor(currentX / GRID_SIZE);
    const currentGy = Math.floor(currentY / GRID_SIZE);
    for (let radius = 1; radius <= 48; radius++) {
      let best: { x: number; y: number; score: number } | undefined;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const gx = currentGx + dx;
          const gy = currentGy + dy;
          if (this.isAirCellBlocked(gx, gy, blockedCells)) continue;
          const { x, y } = cellCenter(gx, gy);
          const score = distance(x, y, currentX, currentY) + distance(x, y, desiredX, desiredY) * 0.015;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (best) return best;
    }
    // A densely packed fortress can have a clearance ring wider than the normal
    // search. Find a physically free nearby tile and leave the air-clearance ring
    // with ordinary collision-safe movement. This is a bounded emergency fallback
    // and its target is cached so it cannot trigger an expensive spiral every frame.
    for (let radius = 1; radius <= 12; radius++) {
      let best: { x: number; y: number; score: number } | undefined;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const gx = currentGx + dx;
          const gy = currentGy + dy;
          if (isCellInsideBuildingFootprint(gx, gy, buildings)) continue;
          const { x, y } = cellCenter(gx, gy);
          const escapeSpace = [
            [gx + 1, gy], [gx - 1, gy], [gx, gy + 1], [gx, gy - 1]
          ].filter(([nx, ny]) => !this.isAirCellBlocked(nx, ny, blockedCells)).length;
          const score = distance(x, y, currentX, currentY) - escapeSpace * GRID_SIZE * 0.35 +
            distance(x, y, desiredX, desiredY) * 0.001;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (best) return { x: best.x, y: best.y };
    }
    // No physically empty nearby cell exists (for example, a fully sealed wall
    // box). Keep the unit alive and schedule another bounded search, rather than
    // teleporting or running a world-wide search inside every animation frame.
    return cellCenter(currentGx, currentGy);
  }
}
