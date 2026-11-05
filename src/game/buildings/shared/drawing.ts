import type { Building } from '../../types';

export function polygon(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  fill: string,
  stroke = '#0f172a',
  lineWidth = 1.5
) {
  if (points.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

export function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, stroke: string, rotation = Math.PI / 6) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / 6;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
  polygon(ctx, points, fill, stroke, 2);
}

export function upgradeInstalled(building: Building, id: string): boolean {
  return building.upgradeIds.includes(id);
}

export function drawCornerBolts(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number, color: string, size = 3) {
  ctx.fillStyle = color;
  const points = [
    [left + 8, top + 8], [left + width - 8, top + 8],
    [left + 8, top + height - 8], [left + width - 8, top + height - 8]
  ];
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLevelTechRing(ctx: CanvasRenderingContext2D, building: Building, radius: number, color: string) {
  if (building.level < 3) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = building.level >= 5 ? 0.95 : 0.62;
  ctx.lineWidth = building.level >= 5 ? 2 : 1;
  ctx.setLineDash(building.level >= 4 ? [4, 3] : [2, 4]);
  ctx.beginPath();
  ctx.arc(building.x, building.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawUpgradePips(ctx: CanvasRenderingContext2D, building: Building, left: number, top: number, width: number) {
  if (building.level <= 1) return;
  const count = Math.min(4, building.level - 1);
  const start = left + width - 9 - count * 7;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = building.upgradeIds.length > i + 1 ? '#fbbf24' : '#94a3b8';
    ctx.beginPath();
    ctx.arc(start + i * 7, top + 9, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
