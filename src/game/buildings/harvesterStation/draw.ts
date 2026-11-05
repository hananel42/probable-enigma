import type { BuildingDrawContext } from '../types';
import { drawCornerBolts, drawHexagon, upgradeInstalled } from '../shared/drawing';

/** Factory art procedurally exposes silos, workforce and industrial upgrades. */
export function draw({ ctx, building: b, left, top, width: w, height: h, accentColor: color, timeSeconds }: BuildingDrawContext) {
  const expanded = upgradeInstalled(b, 'expanded-workforce') || (b.maxBots || 1) > 1;
  const deep = upgradeInstalled(b, 'deep-silo');
  const rapid = upgradeInstalled(b, 'rapid-extraction');
  const heavy = upgradeInstalled(b, 'heavy-cargo-rigs');
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(left + 7, top + 7, w - 14, h - 14);
  drawCornerBolts(ctx, left, top, w, h, color, 3);
  const siloY = top + 11;
  const siloHeight = deep ? 37 : 29;
  for (const silo of [
    { x: left + 11, fill: '#064e3b', stroke: '#10b981', label: `${Math.floor(b.storedWood || 0)}W` },
    { x: left + w - 35, fill: '#334155', stroke: '#94a3b8', label: `${Math.floor(b.storedStone || 0)}S` }
  ]) {
    ctx.fillStyle = silo.fill; ctx.strokeStyle = silo.stroke; ctx.lineWidth = 1.5;
    ctx.fillRect(silo.x, siloY, 24, siloHeight); ctx.strokeRect(silo.x, siloY, 24, siloHeight);
    ctx.fillStyle = '#0f172a'; ctx.fillRect(silo.x + 4, siloY + 5, 16, siloHeight - 10);
    ctx.strokeStyle = silo.stroke; ctx.beginPath(); ctx.moveTo(silo.x + 4, siloY + 10); ctx.lineTo(silo.x + 20, siloY + 10); ctx.stroke();
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText(silo.label, silo.x + 12, siloY + siloHeight - 3);
  }
  ctx.fillStyle = '#0f172a'; ctx.strokeStyle = rapid ? '#a3e635' : '#eab308'; ctx.lineWidth = 1.5;
  ctx.fillRect(b.x - 17, top + h - 29, 34, 23); ctx.strokeRect(b.x - 17, top + h - 29, 34, 23);
  for (let i = 0; i < 4; i++) {
    const x = b.x - 12 + ((i * 8 + (rapid ? timeSeconds * 10 : 0)) % 32);
    ctx.beginPath(); ctx.moveTo(x, top + h - 25); ctx.lineTo(x + 5, top + h - 10); ctx.stroke();
  }
  if (heavy) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x - 22, top + h - 34); ctx.lineTo(b.x + 22, top + h - 34); ctx.stroke();
  }
  const robotSlots = Math.max(1, Math.min(4, b.maxBots || 1));
  for (let i = 0; i < robotSlots; i++) {
    const px = left + 13 + i * Math.min(10, (w - 28) / Math.max(1, robotSlots - 1));
    ctx.fillStyle = expanded ? '#34d399' : '#64748b';
    ctx.fillRect(px, top + h - 8, 6, 4);
  }
  if (b.faction === 'player' && ((b.storedWood || 0) > 0 || (b.storedStone || 0) > 0)) {
    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.fillText('CARGO READY', b.x, top + 8);
  }
  drawHexagon(ctx, b.x, b.y, 6, '#0f172a', color, 0);
  ctx.restore();
}
