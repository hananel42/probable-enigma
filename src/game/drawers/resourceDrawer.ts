import { ResourceNode } from '../types';
import { GRID_SIZE } from '../rules';

/**
 * Dedicated drawer for static resources (Wood Trees and Granite Stone blocks).
 * Renders crisp, square 48x48 blocks filling their uniform grid tile cleanly,
 * with high visual contrast and multi-stage degradation.
 */
export class ResourceDrawer {
  public draw(ctx: CanvasRenderingContext2D, node: ResourceNode) {
    const left = node.x - GRID_SIZE / 2;
    const top = node.y - GRID_SIZE / 2;
    const size = GRID_SIZE;

    if (node.amount <= 0) {
      this.drawDepletedTile(ctx, node, left, top, size);
      return;
    }

    const ratio = Math.max(0, Math.min(1, node.amount / node.maxAmount));

    if (node.type === 'wood') {
      this.drawWoodTile(ctx, node, left, top, size, ratio);
    } else {
      this.drawStoneTile(ctx, node, left, top, size, ratio);
    }
  }

  private drawDepletedTile(
    ctx: CanvasRenderingContext2D,
    node: ResourceNode,
    left: number,
    top: number,
    size: number
  ) {
    if (node.type === 'wood') {
      // Depleted Tree Stump Square Tile
      ctx.fillStyle = '#27170e';
      ctx.fillRect(left + 4, top + 4, size - 8, size - 8);
      ctx.strokeStyle = '#3e2415';
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 4, top + 4, size - 8, size - 8);

      // Central sawed stump circle
      ctx.fillStyle = '#5c3a21';
      ctx.beginPath();
      ctx.arc(node.x, node.y, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#784d2a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, 5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Depleted Stone Rubble Square Tile
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(left + 4, top + 4, size - 8, size - 8);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left + 4, top + 4, size - 8, size - 8);

      // Crushed gravel specks
      ctx.fillStyle = '#475569';
      ctx.fillRect(node.x - 8, node.y - 6, 5, 4);
      ctx.fillRect(node.x + 3, node.y - 8, 4, 5);
      ctx.fillRect(node.x - 4, node.y + 4, 6, 4);
      ctx.fillRect(node.x + 6, node.y + 5, 4, 4);
    }
  }

  private drawWoodTile(
    ctx: CanvasRenderingContext2D,
    node: ResourceNode,
    left: number,
    top: number,
    size: number,
    ratio: number
  ) {
    // 1. Drop Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(left + 2, top + 4, size - 4, size - 4);

    // 2. Square Wood Block Tile (48x48)
    ctx.fillStyle = '#064e3b'; // Deep emerald border
    ctx.fillRect(left + 2, top + 2, size - 4, size - 4);

    // Foliage inner square
    const innerPadding = 4 + (1 - ratio) * 6;
    ctx.fillStyle = ratio > 0.4 ? '#059669' : '#047857';
    ctx.fillRect(
      left + innerPadding,
      top + innerPadding,
      size - innerPadding * 2,
      size - innerPadding * 2
    );

    // Vibrant green canopy center
    ctx.fillStyle = '#10b981';
    ctx.fillRect(
      left + innerPadding + 4,
      top + innerPadding + 4,
      size - (innerPadding + 4) * 2,
      size - (innerPadding + 4) * 2
    );

    // Center Trunk Core
    ctx.fillStyle = '#78350f';
    ctx.fillRect(node.x - 4, node.y - 4, 8, 8);

    // Wood / Tree Iconography & Leaf Accents
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(node.x, top + innerPadding + 2);
    ctx.lineTo(node.x, node.y - 4);
    ctx.moveTo(left + innerPadding + 2, node.y);
    ctx.lineTo(node.x - 4, node.y);
    ctx.stroke();

    // Tile border outline
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 2, top + 2, size - 4, size - 4);
  }

  private drawStoneTile(
    ctx: CanvasRenderingContext2D,
    node: ResourceNode,
    left: number,
    top: number,
    size: number,
    ratio: number
  ) {
    // 1. Drop Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(left + 2, top + 4, size - 4, size - 4);

    // 2. High-Visibility Square Granite Stone Block (48x48)
    // Dark granite foundation
    ctx.fillStyle = '#334155';
    ctx.fillRect(left + 2, top + 2, size - 4, size - 4);

    // Mid-tone chiselled stone face
    const innerPadding = 3 + (1 - ratio) * 5;
    ctx.fillStyle = '#64748b';
    ctx.fillRect(
      left + innerPadding,
      top + innerPadding,
      size - innerPadding * 2,
      size - innerPadding * 2
    );

    // Bright stone facets (stands out prominently against dark terrain!)
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(left + innerPadding, top + innerPadding);
    ctx.lineTo(left + size - innerPadding, top + innerPadding);
    ctx.lineTo(node.x + 4, node.y - 2);
    ctx.lineTo(node.x - 6, node.y + 4);
    ctx.closePath();
    ctx.fill();

    // Lighter highlight facet
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(left + innerPadding + 3, top + innerPadding + 3);
    ctx.lineTo(node.x + 8, top + innerPadding + 3);
    ctx.lineTo(node.x, node.y - 4);
    ctx.closePath();
    ctx.fill();

    // Prominent Stone glyph mark in center
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(node.x - 7, node.y + 6);
    ctx.lineTo(node.x, node.y - 7);
    ctx.lineTo(node.x + 7, node.y + 6);
    ctx.stroke();

    // Fractures if partially mined
    if (ratio < 0.75) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(node.x - 3, top + innerPadding + 4);
      ctx.lineTo(node.x + 2, node.y);
      ctx.lineTo(node.x + 8, node.y + 6);
      ctx.stroke();
    }

    // High-contrast border outline
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 2, top + 2, size - 4, size - 4);
  }
}

export const resourceDrawer = new ResourceDrawer();
