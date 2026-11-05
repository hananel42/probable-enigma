import React from 'react';
import type { Building, GameEntity, Resources } from '../game/types';
import type { BuildingUpgradeOption, BuildingUpgradeTier } from '../game/upgrades/types';
import { canAfford, getBuildingUpgradeCost } from '../game/rules';
import { describeUpgradeEffects } from '../game/upgrades/upgradeSystem';
import { CostInline } from './HUDShared';
import { RotateCcw, Wrench, Zap } from 'lucide-react';

interface HUDStructureActionsProps {
  contextBuilding: Building | undefined;
  player: GameEntity;
  contextIsActionable: boolean;
  contextUpgradeOptions: BuildingUpgradeOption[];
  contextUpgradeTier: BuildingUpgradeTier | undefined;
  contextUpgradeCost: Resources | null;
  canAffordUpgrade: boolean;
  nearbyDamaged: Building | null;
  repairCost: Resources | null;
  canAffordRepair: boolean;
  contextRefund: Resources | null;
  resources: Resources;
  onRepair: (buildingId: string) => void;
  onDismantle: (buildingId: string) => void;
}

export const HUDStructureActions: React.FC<HUDStructureActionsProps> = ({
  contextBuilding,
  player,
  contextIsActionable,
  contextUpgradeOptions,
  contextUpgradeTier,
  contextUpgradeCost,
  canAffordUpgrade,
  nearbyDamaged,
  repairCost,
  canAffordRepair,
  contextRefund,
  resources,
  onRepair,
  onDismantle
}) => (
  <>
      {/* Detailed structure telemetry is kept in the top bar; this panel contains only nearby actions. */}
      {contextBuilding && (contextUpgradeOptions.length > 0 || nearbyDamaged || contextRefund) && (
        <section className="hud-context pointer-events-auto" aria-label="Nearby structure actions">
          {contextIsActionable && !player.isDead && player.hp > 0 && contextUpgradeOptions.length > 0 && contextUpgradeTier && (
            <div className="hud-upgrade-section">
              <div className="hud-section-header">
                <span><Zap className="inline h-3 w-3 mr-1 text-amber-300" />UPGRADE <span className="hud-muted">L{contextUpgradeTier.targetLevel}</span></span>
                {contextUpgradeCost
                  ? <CostInline wood={contextUpgradeCost.wood} stone={contextUpgradeCost.stone} diamonds={contextUpgradeCost.diamonds} affordable={canAffordUpgrade} />
                  : <span className="hud-muted text-[10px]">BRANCH COSTS BELOW{contextBuilding.type === 'CORE' ? ' · 1 DIAMOND MINIMUM' : ''}</span>}
              </div>
              <div className={`hud-choice-grid ${contextUpgradeOptions.length === 1 ? 'hud-choice-single' : ''}`}>
                {contextUpgradeOptions.map((option, index) => {
                  const effectLines = describeUpgradeEffects(option);
                  const optionCost = getBuildingUpgradeCost(contextBuilding, option.id);
                  const optionAffordable = canAfford(resources, optionCost);
                  const key = contextUpgradeTier.mode === 'LINEAR' ? 'E' : index === 0 ? 'Q' : 'E';
                  return (
                    <div
                      key={option.id}
                      className={`hud-choice ${index === 0 ? 'hud-choice-cyan' : 'hud-choice-amber'} ${!optionAffordable ? 'hud-choice-disabled' : ''}`}
                      title={`${option.description} · ${effectLines.join(', ')}`}
                    >
                      <div className="hud-choice-heading">
                        <kbd className="hud-keycap">{key}</kbd>
                        <b>{option.name}</b>
                      </div>
                      <div className="hud-choice-description">{option.description}</div>
                      <div className="hud-choice-effects">{effectLines.join(' · ')}</div>
                      <div className="hud-choice-cost"><CostInline wood={optionCost.wood} stone={optionCost.stone} diamonds={optionCost.diamonds} affordable={optionAffordable} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="hud-footer-status">
                {canAffordUpgrade
                  ? contextUpgradeTier.mode === 'LINEAR' ? 'E / INSTALL UPGRADE' : 'Q / LEFT PATH     E / RIGHT PATH'
                  : 'INSUFFICIENT RESOURCES'}
              </div>
            </div>
          )}

          {contextIsActionable && !player.isDead && player.hp > 0 && (
            <div className="hud-actions">
              {nearbyDamaged && repairCost && (
                <button
                  onClick={() => onRepair(contextBuilding.id)}
                  disabled={!canAffordRepair}
                  className={`hud-action-button ${canAffordRepair ? 'hud-action-repair' : 'hud-action-disabled'}`}
                  aria-label={`Repair nearby structure · ${repairCost.wood} wood, ${repairCost.stone} stone`} title={`Repair (R) · ${repairCost.wood} wood, ${repairCost.stone} stone`}
                >
                  <Wrench className="h-4 w-4" /><CostInline wood={repairCost.wood} stone={repairCost.stone} diamonds={repairCost.diamonds} affordable={canAffordRepair} />
                </button>
              )}
              {contextRefund && (
                <button onClick={() => onDismantle(contextBuilding.id)} className="hud-action-button hud-action-salvage" aria-label={`Dismantle for ${contextRefund.wood} wood and ${contextRefund.stone} stone`} title={`Dismantle (X) · +${contextRefund.wood} wood, +${contextRefund.stone} stone`}>
                  <RotateCcw className="h-4 w-4" /><span className="hud-action-yield">+{contextRefund.wood}W · +{contextRefund.stone}S</span>
                </button>
              )}
            </div>
          )}
        </section>
      )}
  </>
);
