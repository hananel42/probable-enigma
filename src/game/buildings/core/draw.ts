import type { Building } from '../../types';
import type { BuildingDrawContext } from '../types';
import { drawCornerBolts, drawHexagon, drawLevelTechRing } from '../shared/drawing';

/**
 * Stable drawing cues for Core upgrades. Gameplay remains data-driven in
 * `core/upgrades.ts`; this profile only maps installed upgrade IDs to visual
 * vocabulary, so adding a new Core option requires one explicit presentation
 * decision rather than another branch in the generic renderer.
 */
export interface CoreVisualProfile {
  reinforcedMatrix: boolean;
  miningAccelerator: boolean;
  efficientExtraction: boolean;
  swiftFrame: boolean;
  weaponCalibration: boolean;
  rapidTrigger: boolean;
  siegeOptics: boolean;
  heavyPulse: boolean;
}

export function getCoreVisualProfile(building: Pick<Building, 'upgradeIds'>): CoreVisualProfile {
  const installed = new Set(building.upgradeIds);
  return {
    reinforcedMatrix: installed.has('core_reinforced_matrix'),
    miningAccelerator: installed.has('core_mining_accelerator'),
    efficientExtraction: installed.has('core_efficient_extraction'),
    swiftFrame: installed.has('core_swift_frame'),
    weaponCalibration: installed.has('core_weapon_calibration'),
    rapidTrigger: installed.has('core_rapid_trigger'),
    siegeOptics: installed.has('core_siege_optics'),
    heavyPulse: installed.has('core_heavy_pulse')
  };
}

/** Procedural reactor assembly. Each installed Core specialization adds a readable visual cue. */
export function draw({ ctx, building: b, left, top, width: w, height: h, accentColor: color, timeSeconds }: BuildingDrawContext) {
  const cx = b.x;
  const cy = b.y;
  const profile = getCoreVisualProfile(b);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(left + 9, top + 9, w - 18, h - 18);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 15, top + 15, w - 30, h - 30);
  drawCornerBolts(ctx, left, top, w, h, color, 3.5);

  if (profile.reinforcedMatrix) {
    // Four silver corner plates visually identify the Core HP branch.
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    for (const [px, py] of [[left + 5, top + 14], [left + w - 17, top + 14], [left + 5, top + h - 17], [left + w - 17, top + h - 17]]) {
      ctx.fillRect(px, py, 12, 4);
      ctx.strokeRect(px, py, 12, 4);
    }
  }

  drawHexagon(ctx, cx, cy, 27, '#172033', color, Math.PI / 6);
  drawHexagon(ctx, cx, cy, 20, '#293348', '#e2e8f0', Math.PI / 6);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();

  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i + Math.PI / 4;
    ctx.strokeStyle = profile.reinforcedMatrix ? '#cbd5e1' : color;
    ctx.lineWidth = profile.reinforcedMatrix ? 4 : 3;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 29, cy + Math.sin(a) * 29);
    ctx.lineTo(cx + Math.cos(a) * 39, cy + Math.sin(a) * 39); ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 39, cy + Math.sin(a) * 39, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.stroke();
  }

  if (b.level >= 2) {
    ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 32, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 32, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }

  const energyAngle = timeSeconds * (profile.rapidTrigger ? 1.4 : b.level >= 4 ? 1.15 : 0.7);
  ctx.strokeStyle = profile.heavyPulse ? '#fb7185' : color;
  ctx.lineWidth = profile.heavyPulse ? 2.6 : b.level >= 4 ? 2.2 : 1.2;
  ctx.beginPath(); ctx.arc(cx, cy, profile.heavyPulse ? 39 : 35, energyAngle, energyAngle + Math.PI * 0.42); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const a = energyAngle + i * (Math.PI * 2 / 3);
    ctx.fillStyle = profile.rapidTrigger ? '#fbbf24' : color;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 35, cy + Math.sin(a) * 35, profile.rapidTrigger ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
  }

  if (profile.miningAccelerator) {
    // A small animated pick-head marks faster extraction without implying a combat buff.
    ctx.save(); ctx.translate(cx - 31, cy + 1); ctx.rotate(Math.sin(timeSeconds * 3) * 0.1);
    ctx.strokeStyle = '#86efac'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(5, -7); ctx.lineTo(8, -3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, -4); ctx.lineTo(-1, 7); ctx.stroke(); ctx.restore();
  }
  if (profile.efficientExtraction) {
    // Emerald crystal motes distinguish yield specialization from mining speed.
    ctx.fillStyle = '#34d399';
    for (const offset of [{ x: 0, y: -45 }, { x: 45, y: 0 }, { x: 0, y: 45 }, { x: -45, y: 0 }]) {
      ctx.beginPath(); ctx.moveTo(cx + offset.x, cy + offset.y - 3); ctx.lineTo(cx + offset.x + 3, cy + offset.y);
      ctx.lineTo(cx + offset.x, cy + offset.y + 3); ctx.lineTo(cx + offset.x - 3, cy + offset.y); ctx.closePath(); ctx.fill();
    }
  }
  if (profile.swiftFrame) {
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + energyAngle * 0.25;
      const r = 46;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - 0.13) * r, cy + Math.sin(a - 0.13) * r);
      ctx.lineTo(cx + Math.cos(a) * (r + 5), cy + Math.sin(a) * (r + 5));
      ctx.lineTo(cx + Math.cos(a + 0.13) * r, cy + Math.sin(a + 0.13) * r);
      ctx.stroke();
    }
  }
  if (profile.weaponCalibration || profile.siegeOptics) {
    const radius = profile.siegeOptics ? 51 : 47;
    ctx.strokeStyle = profile.siegeOptics ? '#c4b5fd' : '#fbbf24';
    ctx.lineWidth = profile.siegeOptics ? 2 : 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    const reticleSize = profile.siegeOptics ? 7 : 4;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (radius - reticleSize), cy + Math.sin(a) * (radius - reticleSize));
      ctx.lineTo(cx + Math.cos(a) * (radius + reticleSize), cy + Math.sin(a) * (radius + reticleSize));
      ctx.stroke();
    }
  }
  if (profile.heavyPulse) {
    ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 46 + Math.sin(timeSeconds * 5) * 2, 0.15, Math.PI * 1.85); ctx.stroke();
  }

  drawLevelTechRing(ctx, b, 43, color);
  ctx.restore();
}
