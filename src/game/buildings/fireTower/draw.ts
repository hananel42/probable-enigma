import type { Building, TowerEffectId } from '../../types';
import type { BuildingDrawContext } from '../types';
import { drawHexagon, drawLevelTechRing, upgradeInstalled } from '../shared/drawing';
import { TOWER_EFFECTS } from '../../statusEffects/towerEffects';
import { assertFireTowerBuilding } from './state';

export interface EffectTowerVisualProfile {
  activeEffects: TowerEffectId[];
  flashoverCoils: boolean;
  rapidWave: boolean;
  wideSpectrum: boolean;
}

/**
 * Resolves the display cues from active effect modes and stable upgrade IDs.
 * The renderer uses the effect registry for modes and only adds special
 * hardware cues for upgrades that change stats without installing a new mode.
 */
export function getEffectTowerVisualProfile(building: Building): EffectTowerVisualProfile {
  assertFireTowerBuilding(building);
  const activeEffects: TowerEffectId[] = [...building.towerEffectIds];
  return {
    activeEffects,
    flashoverCoils: upgradeInstalled(building, 'flashover-coils'),
    rapidWave: upgradeInstalled(building, 'rapid-wave') || building.fireCooldown < 3.2,
    wideSpectrum: upgradeInstalled(building, 'wide-spectrum') || activeEffects.length >= 3
  };
}

/** Procedural Effect Tower rendering: installed effect modes and special modules drive its palette and emitters. */
export function draw({ ctx, building: b, accentColor, timeSeconds }: BuildingDrawContext) {
  assertFireTowerBuilding(b);
  const profile = getEffectTowerVisualProfile(b);
  const activeEffects = profile.activeEffects.map(id => TOWER_EFFECTS[id]);
  const mainColor = activeEffects[0].color;
  const rapid = profile.rapidWave;
  ctx.save();
  drawHexagon(ctx, b.x, b.y, 21, '#172033', '#64748b');
  drawHexagon(ctx, b.x, b.y, 15, '#273449', mainColor);

  // Every installed effect mode gets its own arc. Several arcs communicate
  // combinations without requiring a unique sprite for every possible path.
  const modeCount = Math.min(activeEffects.length, 6);
  for (let i = 0; i < modeCount; i++) {
    const start = -Math.PI / 2 + (i / modeCount) * Math.PI * 2;
    const end = -Math.PI / 2 + ((i + 0.78) / modeCount) * Math.PI * 2;
    ctx.strokeStyle = activeEffects[i].color;
    ctx.lineWidth = activeEffects.length === 1 ? 2.5 : 3.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, 24, start, end); ctx.stroke();
  }

  if (profile.flashoverCoils) {
    // Flashover changes burning intensity but does not add a second status ID,
    // so glowing copper windings make this stat-only branch visible on the block.
    ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const angle = timeSeconds * 0.65 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 28 + i * 2, angle, angle + Math.PI * 0.62);
      ctx.stroke();
    }
    ctx.fillStyle = '#fed7aa';
    for (let i = 0; i < 3; i++) {
      const angle = timeSeconds * 0.65 + (i * Math.PI * 2) / 3;
      ctx.beginPath(); ctx.arc(b.x + Math.cos(angle) * 29, b.y + Math.sin(angle) * 29, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  const beat = 0.78 + Math.sin(timeSeconds * (rapid ? 12 : 6)) * 0.13;
  ctx.globalAlpha = beat;
  ctx.fillStyle = profile.flashoverCoils ? '#fb923c' : mainColor;
  ctx.beginPath(); ctx.arc(b.x, b.y, 6 + Math.sin(timeSeconds * 4) * 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Six small emitters correspond to the maximum number of combinable effect modes.
  for (let i = 0; i < modeCount; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / modeCount;
    ctx.fillStyle = activeEffects[i].color;
    ctx.beginPath(); ctx.arc(b.x + Math.cos(angle) * 13, b.y + Math.sin(angle) * 13, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  if (profile.wideSpectrum) {
    // A pair of outer spectral rings indicates a multi-mode tower at a glance.
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(b.x, b.y, 31, 0.15, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = '#c4b5fd';
    ctx.beginPath(); ctx.arc(b.x, b.y, 34, Math.PI * 1.1, Math.PI * 2.9); ctx.stroke();
  }

  if (b.isPulsing) {
    const progress = Math.max(0, Math.min(1, b.pulseProgress));
    const waveRadius = b.fireRadius * progress;
    ctx.strokeStyle = `${mainColor}bb`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(b.x, b.y, waveRadius, 0, Math.PI * 2); ctx.stroke();
    if (activeEffects.length > 1) {
      ctx.strokeStyle = `${activeEffects[activeEffects.length - 1].color}70`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(0, waveRadius - 7), 0, Math.PI * 2); ctx.stroke();
    }
  }
  drawLevelTechRing(ctx, b, 32, mainColor);
  ctx.restore();
}
