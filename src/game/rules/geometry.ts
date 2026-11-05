import { GRID_SIZE } from './constants';

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function checkCircleCollision(
  x1: number,
  y1: number,
  r1: number,
  x2: number,
  y2: number,
  r2: number
): boolean {
  return distance(x1, y1, x2, y2) < r1 + r2;
}

export function snapToGrid(
  worldX: number,
  worldY: number,
  gridSize: number = GRID_SIZE
): { gx: number; gy: number; x: number; y: number } {
  const gx = Math.floor(worldX / gridSize);
  const gy = Math.floor(worldY / gridSize);
  return {
    gx,
    gy,
    x: gx * gridSize + gridSize / 2,
    y: gy * gridSize + gridSize / 2
  };
}
