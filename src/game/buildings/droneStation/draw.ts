import type { BuildingDrawContext } from '../types';
import { drawCornerBolts, drawLevelTechRing, upgradeInstalled } from '../shared/drawing';

/** Launch-pad geometry changes with drone wing size, armor, sensors and deployment upgrades. */
export function draw({ ctx, building: b, left, top, width: w, height: h, accentColor: color, timeSeconds }: BuildingDrawContext) {
  const hardened = upgradeInstalled(b, 'hardened-drone-frames');
  const wideSensors = upgradeInstalled(b, 'wide-area-control');
  const rapid = upgradeInstalled(b, 'rapid-deployment');
  const slots = Math.max(2, Math.min(10, b.maxDrones || 2));
  ctx.save();
  drawCornerBolts(ctx, left, top, w, h, color, 3);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(b.x, b.y, 28, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = hardened ? 3 : 1.8;
  ctx.beginPath(); ctx.arc(b.x, b.y, 24, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = wideSensors ? 'rgba(56,189,248,0.8)' : 'rgba(148,163,184,0.55)';
  ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(b.x, b.y, wideSensors ? 41 : 34, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // Sensor pips orbit slowly; wide-area sensor upgrades get a wider, brighter orbit.
  const sensorRadius = wideSensors ? 41 : 34;
  const sensorCount = wideSensors ? 4 : 2;
  for (let i = 0; i < sensorCount; i++) {
    const angle = timeSeconds * (wideSensors ? 0.72 : 0.42) + (Math.PI * 2 * i) / sensorCount;
    ctx.fillStyle = wideSensors ? '#bae6fd' : color;
    ctx.beginPath(); ctx.arc(b.x + Math.cos(angle) * sensorRadius, b.y + Math.sin(angle) * sensorRadius, wideSensors ? 2.5 : 2, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < slots; i++) {
    const angle = (Math.PI * 2 * i) / slots - Math.PI / 2;
    const radius = slots > 6 ? 36 : 31;
    const x = b.x + Math.cos(angle) * radius; const y = b.y + Math.sin(angle) * radius;
    ctx.fillStyle = rapid ? '#bae6fd' : hardened ? '#7dd3fc' : '#0f172a';
    ctx.strokeStyle = color; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, slots > 6 ? 3 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - Math.cos(angle) * 4, y - Math.sin(angle) * 4);
    ctx.lineTo(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4); ctx.stroke();
  }
  ctx.fillStyle = '#0f172a'; ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(b.x, b.y, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(b.droneMode === 'ESCORT' ? 'ESC' : 'DEF', b.x, b.y + 4);
  drawLevelTechRing(ctx, b, 46, color);
  ctx.restore();
}
