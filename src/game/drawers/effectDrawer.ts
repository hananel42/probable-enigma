import { FloatingText, Particle, Projectile, BuildingType } from '../types';
import { BUILDING_BLUEPRINTS, canAfford, isAreaBuildable, GRID_SIZE } from '../rules';

/**
 * Dedicated drawer for game effects: Projectiles, Particles, Floating Text, and Placement Ghost Preview.
 */
/** Range overlays are reserved for weapons. Stations use economy/zone rules, not an attack radius. */
export function shouldDrawRangePreview(type: BuildingType): boolean {
  return type !== 'DRONE_STATION' && type !== 'HARVESTER_STATION' && type !== 'CORE';
}

export class EffectDrawer {
  public drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]) {
    for (const p of projectiles) {
      // Outer glow tracer
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      // Bright white energetic core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  public drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;
  }

  public drawFloatingTexts(ctx: CanvasRenderingContext2D, texts: FloatingText[]) {
    ctx.font = 'bold 12px Chakra Petch';
    ctx.textAlign = 'center';
    for (const t of texts) {
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
  }

  public drawPlacementOverlay(
    ctx: CanvasRenderingContext2D,
    type: BuildingType | null,
    targetGx: number,
    targetGy: number,
    buildings: any[],
    resources: any[],
    playerResources: any
  ) {
    if (!type || type === 'CORE') return;

    const bp = BUILDING_BLUEPRINTS[type];
    const w = bp.widthInCells;
    const h = bp.heightInCells;
    const pxW = w * GRID_SIZE;
    const pxH = h * GRID_SIZE;
    const pxX = targetGx * GRID_SIZE;
    const pxY = targetGy * GRID_SIZE;
    const centerX = pxX + pxW / 2;
    const centerY = pxY + pxH / 2;

    const buildable = isAreaBuildable(targetGx, targetGy, w, h, buildings, resources);
    const affordable = canAfford(playerResources, bp.cost);
    const isValid = buildable && affordable;

    // Fill & Border. Keep the edge readable at every camera zoom level.
    const inverseZoom = 1 / Math.max(0.25, (ctx.getTransform?.().a || 1));
    ctx.fillStyle = isValid ? 'rgba(74, 222, 128, 0.30)' : 'rgba(239, 68, 68, 0.38)';
    ctx.strokeStyle = isValid ? '#4ade80' : '#fb7185';
    ctx.lineWidth = 2.5 * inverseZoom;
    ctx.setLineDash([]);

    ctx.fillRect(pxX, pxY, pxW, pxH);
    ctx.strokeRect(pxX, pxY, pxW, pxH);

    // If 2x2, show inner tile grid lines for clarity
    if (w > 1 || h > 1) {
      ctx.strokeStyle = isValid ? 'rgba(74, 222, 128, 0.5)' : 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = inverseZoom;
      for (let dx = 1; dx < w; dx++) {
        ctx.beginPath();
        ctx.moveTo(pxX + dx * GRID_SIZE, pxY);
        ctx.lineTo(pxX + dx * GRID_SIZE, pxY + pxH);
        ctx.stroke();
      }
      for (let dy = 1; dy < h; dy++) {
        ctx.beginPath();
        ctx.moveTo(pxX, pxY + dy * GRID_SIZE);
        ctx.lineTo(pxX + pxW, pxY + dy * GRID_SIZE);
        ctx.stroke();
      }
    }

    // Range preview circle
    if (bp.range > 0 && shouldDrawRangePreview(type)) {
      ctx.strokeStyle = isValid ? 'rgba(74, 222, 128, 0.25)' : 'rgba(239, 68, 68, 0.2)';
      ctx.lineWidth = 1.5 * inverseZoom;
      ctx.beginPath();
      ctx.arc(centerX, centerY, bp.range, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Compact world-space label makes the preview's state obvious without obscuring the footprint.
    ctx.save();
    ctx.font = `bold ${11 * inverseZoom}px Chakra Petch, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = isValid ? '#bbf7d0' : '#fecdd3';
    const label = !affordable ? 'NOT ENOUGH RESOURCES' : buildable ? `${bp.name.toUpperCase()} · READY` : 'BLOCKED';
    ctx.fillText(label, centerX, pxY - 5 * inverseZoom);
    ctx.restore();
  }
}

export const effectDrawer = new EffectDrawer();
