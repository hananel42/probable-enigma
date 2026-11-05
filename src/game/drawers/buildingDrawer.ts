import { Building, GameGroup } from '../types';
import { GRID_SIZE } from '../rules';
import { BUILDING_MODULES } from '../buildings/registry';
import { drawUpgradePips } from '../buildings/shared/drawing';
import { isOrphanedStructure } from '../coreStatus';
import { BuildingNeighborhoodIndex } from '../buildings/neighbors';

/**
 * Shared frame renderer. Every structure-specific silhouette is owned by its
 * module under game/buildings/<building>/draw.ts and reads live stats/upgrades.
 */
export class BuildingDrawer {
  public draw(
    ctx: CanvasRenderingContext2D,
    building: Building,
    timeSeconds = 0,
    group?: GameGroup,
    allied = false,
    allBuildings: Building[] = [building],
    neighborhoods: BuildingNeighborhoodIndex = new BuildingNeighborhoodIndex(allBuildings)
  ) {
    const module = BUILDING_MODULES[building.type];
    const primaryColor = module.definition.accentColor;
    const isPlayer = building.faction === 'player';
    const orphaned = isOrphanedStructure(building, allBuildings);
    const baseBg = orphaned ? '#475569' : (isPlayer ? '#1e293b' : '#3f151e');
    const borderCol = orphaned ? '#94a3b8' : (allied ? '#4ade80' : (group?.color || (isPlayer ? '#0284c7' : '#e11d48')));
    const width = (building.widthInCells || 1) * GRID_SIZE;
    const height = (building.heightInCells || 1) * GRID_SIZE;
    const left = building.x - width / 2;
    const top = building.y - height / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(left - 2, top + 4, width + 4, height + 4);

    // Procedural metal foundation shared by every module.
    ctx.fillStyle = baseBg;
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 2;
    ctx.fillRect(left + 2, top + 2, width - 4, height - 4);
    ctx.strokeRect(left + 2, top + 2, width - 4, height - 4);
    ctx.strokeStyle = allied ? 'rgba(74,222,128,0.24)' : (group ? `${group.color}40` : (isPlayer ? 'rgba(56,189,248,0.18)' : 'rgba(244,63,94,0.18)'));
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 6, top + 6, width - 12, height - 12);

    // Isolate module-specific Canvas state. Orphaned structures are rendered
    // desaturated as well as covered with a gray tint, so bright module accents
    // cannot leak through and make an inactive building look operational.
    ctx.save();
    if (orphaned) {
      ctx.filter = 'grayscale(1)';
      ctx.globalAlpha = 0.78;
    }
    module.draw({
      ctx, building, left, top, width, height, accentColor: primaryColor, timeSeconds,
      neighbors: neighborhoods.getNeighbors(building)
    });
    drawUpgradePips(ctx, building, left, top, width);
    ctx.restore();

    // Structures survive Core destruction, but their machinery and ownership glow go inert.
    if (orphaned) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.56)';
      ctx.fillRect(left + 2, top + 2, width - 4, height - 4);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 2, top + 2, width - 4, height - 4);
    }

    // Shared, truthful health bar. Armor has a separate indicator in the inspector.
    if (building.hp < building.maxHp) {
      const ratio = Math.max(0, Math.min(1, building.hp / Math.max(1, building.maxHp)));
      const barWidth = width - 8;
      ctx.fillStyle = '#0f172a'; ctx.fillRect(left + 4, top - 8, barWidth, 4);
      ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(left + 4, top - 8, barWidth * ratio, 4);
    }
    ctx.restore();
  }
}

export const buildingDrawer = new BuildingDrawer();
