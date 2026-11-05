import type { BuildingType } from '../game/types';
import { Gem, Layers, Crosshair, Pickaxe, Radio, ShieldCheck, TreePine, Mountain, Waves } from 'lucide-react';

export const BUILDING_TYPES: Array<Exclude<BuildingType, 'CORE'>> = [
  'WALL',
  'AUTO_TURRET',
  'HARVESTER_STATION',
  'DRONE_STATION',
  'FIRE_TOWER'
];

export function BuildingGlyph({ type, className = 'h-4 w-4' }: { type: BuildingType; className?: string }) {
  switch (type) {
    case 'CORE': return <ShieldCheck className={className} />;
    case 'WALL': return <Layers className={className} />;
    case 'AUTO_TURRET': return <Crosshair className={className} />;
    case 'HARVESTER_STATION': return <Pickaxe className={className} />;
    case 'DRONE_STATION': return <Radio className={className} />;
    case 'FIRE_TOWER': return <Waves className={className} />;
  }
}

export function Meter({ value, color = 'cyan' }: { value: number; color?: 'cyan' | 'rose' | 'amber' | 'emerald' }) {
  const colors = {
    cyan: 'bg-cyan-300',
    rose: 'bg-rose-400',
    amber: 'bg-amber-300',
    emerald: 'bg-emerald-300'
  };
  return (
    <div className="hud-meter" aria-hidden="true">
      <span className={colors[color]} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function CostInline({ wood, stone, diamonds = 0, affordable }: { wood: number; stone: number; diamonds?: number; affordable: boolean }) {
  return (
    <span className={`hud-cost ${affordable ? '' : 'hud-cost-low'}`}>
      <TreePine aria-hidden="true" /> <b>{wood}</b>
      <Mountain aria-hidden="true" /> <b>{stone}</b>
      {diamonds > 0 && <><Gem aria-hidden="true" className="text-cyan-300" /> <b>{diamonds}</b></>}
    </span>
  );
}

