import type { BuildingDrawContext } from '../types';
import { upgradeInstalled } from '../shared/drawing';

/** Procedural modular barricade. Armor and plating choices have distinct silhouettes. */
export function draw({ ctx, building: b, left, top, width: w, height: h, accentColor: color }: BuildingDrawContext) {
  const reinforced = upgradeInstalled(b, 'reinforced-plating') || upgradeInstalled(b, 'bastion-frame');
  const reactive = upgradeInstalled(b, 'reactive-armor');
  const reflecting = (b.projectileReflectChance || 0) > 0;
  const selfRepair = upgradeInstalled(b, 'self-repairing-alloy');
  ctx.save();
  ctx.fillStyle = reinforced ? '#475569' : '#334155';
  ctx.strokeStyle = color; ctx.lineWidth = reinforced ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.moveTo(left + 4, top + 12); ctx.lineTo(left + 12, top + 4);
  ctx.lineTo(left + w - 12, top + 4); ctx.lineTo(left + w - 4, top + 12);
  ctx.lineTo(left + w - 4, top + h - 12); ctx.lineTo(left + w - 12, top + h - 4);
  ctx.lineTo(left + 12, top + h - 4); ctx.lineTo(left + 4, top + h - 12); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#0f172a'; ctx.fillRect(left + 9, top + 10, w - 18, h - 20);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(left + 12, top + h / 2); ctx.lineTo(left + w - 12, top + h / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left + w / 2, top + 10); ctx.lineTo(left + w / 2, top + h - 10); ctx.stroke();
  if (reinforced || (b.armor || 0) >= 0.15) {
    ctx.fillStyle = '#64748b'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
    ctx.fillRect(left + 8, top + 8, w - 16, 5); ctx.strokeRect(left + 8, top + 8, w - 16, 5);
    ctx.fillRect(left + 8, top + h - 13, w - 16, 5); ctx.strokeRect(left + 8, top + h - 13, w - 16, 5);
  }
  if (reactive || reflecting || (b.armor || 0) > 0) {
    // Reactive armor is represented by individual outer plates; the health pool remains unchanged.
    for (let i = 0; i < 3; i++) {
      const px = left + 11 + i * ((w - 22) / 3);
      ctx.fillStyle = reflecting ? '#67e8f9' : reactive ? '#38bdf8' : '#cbd5e1';
      ctx.fillRect(px, top + 16, 5, h - 32);
    }
  }
  if (reflecting) {
    // Inward chevrons make bullet reflection visible even if the upgrade path has changed.
    ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 2;
    for (let i = 0; i < Math.min(4, Math.max(1, Math.ceil((b.projectileReflectChance || 0) * 6))); i++) {
      const cx = left + 13 + i * Math.max(8, (w - 26) / Math.max(1, Math.ceil((b.projectileReflectChance || 0) * 6)));
      ctx.beginPath(); ctx.moveTo(cx - 2.5, top + h / 2 - 3); ctx.lineTo(cx, top + h / 2); ctx.lineTo(cx + 2.5, top + h / 2 - 3); ctx.stroke();
    }
  }
  if (selfRepair || (b.passiveRepairPerSecond || 0) > 0) {
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(left + w / 2 - 5, top + h / 2); ctx.lineTo(left + w / 2 + 5, top + h / 2);
    ctx.moveTo(left + w / 2, top + h / 2 - 5); ctx.lineTo(left + w / 2, top + h / 2 + 5); ctx.stroke();
  }
  if (b.level >= 4) {
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.strokeRect(left + 3, top + 3, w - 6, h - 6);
  }
  ctx.restore();
}
