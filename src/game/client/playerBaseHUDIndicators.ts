import type { GameEngineState } from '../engine';
import { distance, GRID_SIZE } from '../rules';
import { resolvePlayerBaseNavigationTargets } from './playerPresentation';

/** Screen-space home and participant-base arrows, independent of camera zoom. */
export function drawPlayerBaseHUDIndicators(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameEngineState>,
  viewportWidth: number,
  viewportHeight: number
): void {
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  const margin = 30;
  const halfWidth = Math.max(1, centerX - margin);
  const halfHeight = Math.max(1, centerY - margin);

  for (const target of resolvePlayerBaseNavigationTargets(state)) {
    const screenX = (target.core.x - state.camera.x) * state.camera.zoom + centerX;
    const screenY = (target.core.y - state.camera.y) * state.camera.zoom + centerY;
    const dx = screenX - centerX;
    const dy = screenY - centerY;
    const angle = Math.atan2(dy, dx);
    const isInside = screenX >= margin && screenX <= viewportWidth - margin &&
      screenY >= margin && screenY <= viewportHeight - margin;
    const distanceBlocks = Math.round(distance(state.player.x, state.player.y, target.core.x, target.core.y) / GRID_SIZE);
    const label = `${target.label} · ${distanceBlocks} BLK${target.core.hp <= 0 ? ' · DOWN' : ''}`;

    if (isInside) {
      ctx.save();
      try {
        ctx.translate(screenX, screenY - 43);
        const pulse = (Math.sin(state.gameTime * 4.2) + 1) * 0.5;
        ctx.globalAlpha = 0.75 + pulse * 0.25;
        ctx.fillStyle = target.color;
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 12);
        ctx.lineTo(-9, -2);
        ctx.lineTo(9, -2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = 'bold 9px Chakra Petch';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.95)';
        ctx.strokeText(label, 0, -12, 180);
        ctx.fillStyle = target.color;
        ctx.fillText(label, 0, -12, 180);
      } finally {
        ctx.restore();
      }
      continue;
    }

    // Intersect the center-to-target ray with the safe viewport rectangle.
    const scaleX = Math.abs(dx) > 0.0001 ? halfWidth / Math.abs(dx) : Number.POSITIVE_INFINITY;
    const scaleY = Math.abs(dy) > 0.0001 ? halfHeight / Math.abs(dy) : Number.POSITIVE_INFINITY;
    const edgeScale = Math.min(scaleX, scaleY);
    const edgeX = centerX + dx * edgeScale;
    const edgeY = centerY + dy * edgeScale;

    ctx.save();
    try {
      const pulse = (Math.sin(state.gameTime * 4.2) + 1) * 0.5;
      ctx.fillStyle = target.color;
      ctx.globalAlpha = 0.16 + pulse * 0.18;
      ctx.beginPath();
      ctx.arc(edgeX, edgeY, 15 + pulse * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.translate(edgeX, edgeY);
      ctx.rotate(angle);
      ctx.fillStyle = target.color;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-8, -10);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } finally {
      ctx.restore();
    }

    const labelWidth = 150;
    const labelX = Math.min(viewportWidth - labelWidth / 2 - 6,
      Math.max(labelWidth / 2 + 6, edgeX - Math.cos(angle) * 39));
    const labelY = Math.min(viewportHeight - 18, Math.max(18, edgeY - Math.sin(angle) * 39));
    ctx.save();
    try {
      ctx.font = 'bold 9px Chakra Petch';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.fillRect(labelX - labelWidth / 2, labelY - 11, labelWidth, 22);
      ctx.strokeStyle = target.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX - labelWidth / 2, labelY - 11, labelWidth, 22);
      ctx.fillStyle = target.color;
      ctx.fillText(label, labelX, labelY, labelWidth - 8);
    } finally {
      ctx.restore();
    }
  }
}

