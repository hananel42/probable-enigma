import React from 'react';
import type { BuildingType, Resources } from '../game/types';
import { BUILDING_BLUEPRINTS, canAfford } from '../game/rules';
import { BUILDING_TYPES, BuildingGlyph } from './HUDShared';

interface HUDConstructionBarProps {
  selectedBuildingType: BuildingType | null;
  resources: Resources;
  disabled: boolean;
  onSelectBuilding: (type: BuildingType | null) => void;
}

export const HUDConstructionBar: React.FC<HUDConstructionBarProps> = ({ selectedBuildingType, resources, disabled, onSelectBuilding }) => (
      <footer className="hud-bottom pointer-events-none">
        <div className="hud-build-strip pointer-events-auto" aria-label="Construction hotbar">
          {BUILDING_TYPES.map((type, index) => {
            const blueprint = BUILDING_BLUEPRINTS[type];
            const selected = selectedBuildingType === type;
            const affordable = canAfford(resources, blueprint.cost);
            
            return (
              <button
                key={type}
                onClick={() => onSelectBuilding(type)}
                disabled={disabled}
                aria-pressed={selected}
                title={`${blueprint.name} · ${blueprint.cost.wood} wood · ${blueprint.cost.stone} stone`}
                className={`hud-build-item ${selected ? 'hud-build-selected' : ''} ${!affordable ? 'hud-build-unaffordable' : ''} ${disabled ? 'hud-build-disabled' : ''}`}
              >
                <div className="hud-build-heading">
                  <BuildingGlyph type={type} className={`h-5 w-5 ${selected ? 'text-cyan-200' : 'text-slate-300'}`} />
                  <kbd>{index + 1}</kbd>
                </div>
                <div className="hud-build-cost">
                  <span className={resources.wood >= blueprint.cost.wood ? 'text-emerald-300' : 'text-rose-300'}>{blueprint.cost.wood}W</span>
                  <span className="text-slate-600">/</span>
                  <span className={resources.stone >= blueprint.cost.stone ? 'text-slate-200' : 'text-rose-300'}>{blueprint.cost.stone}S</span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="hud-controls-line">
          <span><kbd>WASD / ARROWS</kbd> MOVE</span><span><kbd>CLICK / SPACE</kbd> FIRE</span><span><kbd>F</kbd> MINE</span>
          <span><kbd>1–5</kbd> BUILD</span><span><kbd>Q / E</kbd> UPGRADE</span><span><kbd>R</kbd> REPAIR</span>
          <span><kbd>C</kbd> DRONE MODE · SELECT PAD</span><span><kbd>T</kbd> CHAT</span><span><kbd>X</kbd> SALVAGE</span>
        </div>
      </footer>


);
