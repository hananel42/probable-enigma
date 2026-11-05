import type { BuildingDrawContext } from '../types';
import { drawHexagon, drawLevelTechRing, upgradeInstalled } from '../shared/drawing';

/** Procedural render profile derived from stable upgrade IDs. Exported for regression coverage. */
export function getTurretVisualProfile(building: import('../../types').Building) {
  return {
    twin: (building.shotsPerAttack || 1) > 1 || upgradeInstalled(building, 'twin-barrel'),
    longBarrel: upgradeInstalled(building, 'long-barrel'),
    overcharged: upgradeInstalled(building, 'overcharged-rounds'),
    rapidCycle: upgradeInstalled(building, 'rapid-cycle'),
    guided: upgradeInstalled(building, 'guided-rounds'),
    explosive: upgradeInstalled(building, 'explosive-ordnance'),
    // This ID must match autoTurret/upgrades.ts; the old shorter ID hid the cyan module.
    highVelocity: upgradeInstalled(building, 'high-velocity-rounds'),
    reinforced: upgradeInstalled(building, 'reinforced-bearing')
  };
}

/** Turret geometry changes with installed weapon modules and live weapon stats. */
export function draw({ ctx, building: b, accentColor: color, timeSeconds }: BuildingDrawContext) {
  const { twin, longBarrel, overcharged, rapidCycle, guided, explosive, highVelocity, reinforced } = getTurretVisualProfile(b);
  const barrelLength = longBarrel ? 31 : 21;
  const cx = b.x; const cy = b.y;
  ctx.save();
  ctx.fillStyle = reinforced ? '#263c52' : '#111827'; ctx.strokeStyle = reinforced ? '#67e8f9' : '#64748b'; ctx.lineWidth = reinforced ? 3 : 2;
  drawHexagon(ctx, cx, cy, 18, '#334155', '#64748b');
  ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = b.level >= 3 ? 2.5 : 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.barrelAngle || 0);
  const offsets = twin ? [-5, 5] : [0];
  for (const y of offsets) {
    ctx.fillStyle = overcharged ? '#fbbf24' : highVelocity ? '#67e8f9' : guided ? '#c4b5fd' : '#cbd5e1';
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5;
    ctx.fillRect(3, y - 3.5, barrelLength, 7); ctx.strokeRect(3, y - 3.5, barrelLength, 7);
    ctx.fillStyle = explosive ? '#fb923c' : guided ? '#c4b5fd' : overcharged ? '#fff7ed' : color;
    ctx.fillRect(3 + barrelLength - 5, y - 2, 5, 4);
  }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  for (let i = 0; i < Math.min(4, Math.max(0, b.level - 1)); i++) {
    const angle = (Math.PI * 2 * i) / Math.max(3, b.level);
    ctx.fillStyle = overcharged ? '#fbbf24' : color;
    ctx.beginPath(); ctx.arc(cx + Math.cos(angle) * 22, cy + Math.sin(angle) * 22, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  if (rapidCycle || (b.fireCooldown || 0) < 0.8) {
    // Fast-cycle upgrades add visible actuator fins around the turret's bearing.
    ctx.strokeStyle = rapidCycle ? '#67e8f9' : color;
    ctx.lineWidth = rapidCycle ? 2.5 : 1;
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4 + (rapidCycle ? timeSeconds * 0.5 : 0);
      const inner = 17;
      const outer = rapidCycle ? 26 : 22;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      ctx.stroke();
    }
  }
  if (guided) {
    // A loose forward chevron signals bounded homing rather than perfect tracking.
    ctx.strokeStyle = '#c4b5fd'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - 3, cy - 23); ctx.lineTo(cx, cy - 27); ctx.lineTo(cx + 3, cy - 23); ctx.stroke();
  }
  if (explosive) {
    ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, 24 + Math.sin(timeSeconds * 3) * 1.5, 0.15, Math.PI * 1.85); ctx.stroke();
  }
  drawLevelTechRing(ctx, b, 27, color);
  ctx.restore();
}
