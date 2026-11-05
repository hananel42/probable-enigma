import { canManagePlayerStructure } from '../game/multiplayer/structureAccess';
import { isOrphanedStructure } from '../game/coreStatus';
import React from 'react';
import type { GameSnapshot } from '../game/server/protocol';
import { resolveHudCore, resolveHudSurvivalTime } from '../game/multiplayer/playerHudProjection';
import { canAfford, getBuildingSalvageRefund, getBuildingUpgradeCost, getRepairCost } from '../game/rules';
import { BuildingType, DroneStationMode } from '../game/types';
import {
  getBuildingUpgradeOptions,
  getBuildingUpgradeTier
} from '../game/upgrades/upgradeSystem';
import { Activity, Bot, Gem, HeartPulse, Mountain, ShieldCheck, TreePine, Volume2, VolumeX } from 'lucide-react';
import { sound } from '../game/audio';
import { resolveContextBuilding, STRUCTURE_INTERACTION_RANGE } from '../game/buildingSelection';
import { BuildingGlyph, Meter } from './HUDShared';
import { HUDStructureActions } from './HUDStructureActions';
import { HUDConstructionBar } from './HUDConstructionBar';
import { HUDGameOverOverlay } from './HUDGameOverOverlay';

interface HUDProps {
  state: GameSnapshot;
  onSelectBuilding: (type: BuildingType | null) => void;
  onSetDroneMode: (stationId: string, mode: DroneStationMode) => void;
  onRepair: (buildingId: string) => void;
  onDismantle: (buildingId: string) => void;
  onRestart: () => void;
  allowRestart?: boolean;
  gameOverMessage?: string;
  topBarAddon?: React.ReactNode;
}

export const HUD: React.FC<HUDProps> = ({
  state,
  onSelectBuilding,
  onSetDroneMode,
  onRepair,
  onDismantle,
  onRestart,
  allowRestart = true,
  gameOverMessage,
  topBarAddon
}) => {
  const {
    player,
    buildings,
    resources,
    selectedBuildingType,
    enemyBases,
    difficultyLevel,
    isGameOver,
    gameTime
  } = state;

  const [soundEnabled, setSoundEnabled] = React.useState(sound.enabled);
  const toggleSound = () => {
    sound.enabled = !sound.enabled;
    setSoundEnabled(sound.enabled);
  };

  const playerGroup = state.groups.find(group => group.id === (player.teamId || player.faction));
  const playerGroupHasAllies = Boolean(playerGroup && state.groups.some(group =>
    group.id !== playerGroup.id && group.allianceId === playerGroup.allianceId
  ));
  // Player identity is projected by the game client; the HUD helper resolves
  // the participant-specific Core and survival clock independently of array order.
  const playerCore = resolveHudCore(state);
  const coreHpPercent = playerCore ? (playerCore.hp / Math.max(1, playerCore.maxHp)) * 100 : 0;
  const survivalTime = resolveHudSurvivalTime(state);
  const playerHpPercent = (player.hp / Math.max(1, player.maxHp)) * 100;

  // Resolve the nearby structure before deriving its group; keeping dependent values
  // below this declaration prevents a temporal-dead-zone crash during the first render.
  const contextBuilding = resolveContextBuilding(buildings, player, state.mouseWorld);
  const contextDistance = contextBuilding
    ? Math.hypot(contextBuilding.x - player.x, contextBuilding.y - player.y)
    : Number.POSITIVE_INFINITY;
  const contextCanManage = Boolean(contextBuilding && canManagePlayerStructure(player.ownerPlayerId || 'player-host', state.multiplayerMode, contextBuilding));
  const contextCanSalvage = Boolean(contextBuilding && (contextCanManage || isOrphanedStructure(contextBuilding, buildings)));
  const contextIsActionable = Boolean(
    !player.isDead && player.hp > 0 && contextBuilding && contextCanManage &&
    contextDistance <= STRUCTURE_INTERACTION_RANGE
  );
  const nearbyDamaged = contextIsActionable && contextBuilding &&
    contextBuilding.hp < contextBuilding.maxHp && contextBuilding.hp > 0
    ? contextBuilding
    : null;
  const repairCost = nearbyDamaged ? getRepairCost(nearbyDamaged) : null;
  const canAffordRepair = repairCost ? canAfford(resources, repairCost) : false;
  const contextUpgradeOptions = contextIsActionable && contextBuilding
    ? getBuildingUpgradeOptions(contextBuilding)
    : [];
  const contextUpgradeTier = contextIsActionable && contextBuilding
    ? getBuildingUpgradeTier(contextBuilding)
    : undefined;
  const contextUpgradeCost = contextUpgradeOptions.length === 1 && contextBuilding
    ? getBuildingUpgradeCost(contextBuilding, contextUpgradeOptions[0].id)
    : null;
  const canAffordUpgrade = Boolean(contextBuilding && contextUpgradeOptions.some(option =>
    canAfford(resources, getBuildingUpgradeCost(contextBuilding, option.id))
  ));
  const contextDroneStationCanManage = Boolean(
    contextBuilding?.type === 'DRONE_STATION' && contextIsActionable && !player.isDead && player.hp > 0 &&
    contextCanManage && !isOrphanedStructure(contextBuilding, buildings) &&
    contextBuilding.hp > 0
  );
  // HUD actions and the normal cyan world outline share one context target;
  // selecting a station never creates a separate persistent yellow highlight.
  const topBarBuilding = contextBuilding;
  const topBarGroup = topBarBuilding
    ? state.groups.find(group => group.id === (topBarBuilding.teamId || topBarBuilding.faction))
    : undefined;
  const topBarIsAllied = Boolean(
    topBarGroup && playerGroup && topBarGroup.id !== playerGroup.id &&
    topBarGroup.allianceId === playerGroup.allianceId
  );
  const topBarCanManage = Boolean(topBarBuilding && canManagePlayerStructure(
    player.ownerPlayerId || 'player-host', state.multiplayerMode, topBarBuilding
  ));
  const contextRefund = !state.isGameOver && !player.isDead && player.hp > 0 && contextBuilding &&
    contextBuilding.type !== 'CORE' && contextBuilding.hp > 0 && contextCanSalvage &&
    contextDistance <= STRUCTURE_INTERACTION_RANGE
    ? getBuildingSalvageRefund(contextBuilding)
    : null;
  const topBarBuildingName = topBarBuilding ? topBarBuilding.type.replaceAll('_', ' ') : '';
  const activeOutposts = enemyBases.filter(base => !base.isDestroyed).length;

  return (
    <div className="hud-root absolute inset-0 pointer-events-none flex flex-col justify-start p-2 sm:p-3 md:p-4 font-mono select-none text-slate-100">
      {/* Thin system telemetry: resources and health are inline readouts, not large cards. */}
      <header className={`hud-topline pointer-events-none flex flex-wrap items-start justify-between gap-x-4 gap-y-2${topBarAddon ? ' hud-topline-with-addon' : ''}`}>
        <div className="hud-topgroup flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="hud-readout hud-core-readout">
            <ShieldCheck className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
            <div className="min-w-0">
              <div className="hud-label">CORE <span className="text-slate-500">/ INTEGRITY</span></div>
              <div className="hud-number text-cyan-100">{playerCore ? Math.max(0, Math.ceil(playerCore.hp)) : 0}<span className="hud-muted"> / {playerCore?.maxHp ?? 1200}</span></div>
              <Meter value={coreHpPercent} color={coreHpPercent < 30 ? 'rose' : 'cyan'} />
            </div>
          </div>
          <div className="hud-readout hud-mech-readout">
            <HeartPulse className={`h-3.5 w-3.5 shrink-0 ${player.isDead ? 'text-rose-400' : 'text-emerald-300'}`} />
            <div className="min-w-0">
              <div className="hud-label">COMMANDER <span className="text-slate-500">/ VITALS</span></div>
              <div className={`hud-number ${player.isDead ? 'text-rose-300' : 'text-emerald-100'}`}>
                {player.isDead ? `REBOOT ${(player.respawnTimer || 3).toFixed(1)}s` : <>{Math.max(0, Math.ceil(player.hp))}<span className="hud-muted"> / {Math.ceil(player.maxHp)} HP</span></>}
              </div>
              <div className="hud-label" style={{ color: playerGroupHasAllies ? '#4ade80' : (playerGroup?.color || '#38bdf8') }}>
                {(playerGroup?.name || 'PIONEER COLLECTIVE').toUpperCase()} <span className="text-slate-500">/</span> {(playerGroup?.commanderName || 'PILOT-01').toUpperCase()}
              </div>
              <Meter value={playerHpPercent} color={playerHpPercent < 30 ? 'rose' : 'emerald'} />
            </div>
          </div>
        </div>

        <div className="hud-resources flex items-center gap-3 sm:gap-4" aria-label="Resources">
          <div className="hud-resource text-emerald-300" title="Wood stockpile">
            <TreePine className="h-3.5 w-3.5" />
            <span className="hud-label">WOOD</span>
            <b>{Math.floor(Math.max(0, resources.wood))}</b>
          </div>
          <div className="hud-resource text-slate-200" title="Stone stockpile">
            <Mountain className="h-3.5 w-3.5" />
            <span className="hud-label">STONE</span>
            <b>{Math.floor(Math.max(0, resources.stone))}</b>
          </div>
          <div className="hud-resource text-cyan-200" title="Diamonds are only awarded when a hostile Commander Core is destroyed and can only be spent on Core upgrades">
            <Gem className="h-3.5 w-3.5" />
            <span className="hud-label">DIAMOND</span>
            <b>{Math.floor(Math.max(0, resources.diamonds))}</b>
          </div>
        </div>

        {topBarBuilding && (
          <div className="hud-nearby-readout" aria-label={`${contextDroneStationCanManage ? 'Drone station' : 'Nearby structure'} ${topBarBuildingName}`}>
            <BuildingGlyph type={topBarBuilding.type} className={`hud-nearby-glyph ${topBarCanManage ? 'text-cyan-300' : topBarBuilding.faction === 'player' ? 'text-amber-300' : topBarIsAllied ? 'text-emerald-300' : 'text-rose-300'}`} />
            <div className="hud-nearby-main">
              <span className="hud-label">{contextDroneStationCanManage ? 'DRONE PAD' : 'NEARBY'}</span>
              <b className={`hud-nearby-title ${topBarCanManage ? 'text-cyan-100' : topBarBuilding.faction === 'player' ? 'text-amber-200' : topBarIsAllied ? 'text-emerald-200' : 'text-rose-200'}`}>
                {topBarBuildingName}
              </b>
              <span className="hud-nearby-hp">HP <b>{Math.max(0, Math.ceil(topBarBuilding.hp))}</b><i>/{topBarBuilding.maxHp}</i></span>
              <span className="hud-nearby-level">LV {topBarBuilding.level}</span>
              {contextDroneStationCanManage && (
                <span className="hud-drone-mode-controls pointer-events-auto" aria-label="Drone station mode">
                  <button type="button" onClick={() => onSetDroneMode(topBarBuilding.id, 'DEFENSE')} aria-label="Set drone station to defense patrol" title="Defense patrol" aria-pressed={topBarBuilding.droneMode !== 'ESCORT'} className={`hud-mode-button ${topBarBuilding.droneMode !== 'ESCORT' ? 'hud-action-selected' : ''}`}>
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => onSetDroneMode(topBarBuilding.id, 'ESCORT')} aria-label="Set drone station to escort" title="Escort commander" aria-pressed={topBarBuilding.droneMode === 'ESCORT'} className={`hud-mode-button ${topBarBuilding.droneMode === 'ESCORT' ? 'hud-action-selected' : ''}`}>
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
          </div>
        )}

        <div className="hud-topgroup hud-status-group flex items-center gap-2 sm:gap-3 text-right ml-auto">
          {topBarAddon}
          <Activity className={`h-3.5 w-3.5 shrink-0 ${activeOutposts > 0 ? 'text-rose-300' : 'text-emerald-300'}`} />
          <div>
            <div className={`hud-label ${activeOutposts > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
              {activeOutposts > 0 ? `${activeOutposts} HOSTILE ${activeOutposts === 1 ? 'OUTPOST' : 'OUTPOSTS'}` : 'SECTOR CLEAR'}
            </div>
            <div className="hud-number text-slate-300">THREAT {difficultyLevel}<span className="hud-muted"> · </span>{Math.floor(gameTime / 60).toString().padStart(2, '0')}:{Math.floor(gameTime % 60).toString().padStart(2, '0')}</div>
          </div>
          <button onClick={toggleSound} className="hud-icon-button pointer-events-auto" title="Toggle sound" aria-label="Toggle sound">
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <HUDStructureActions
        contextBuilding={contextBuilding}
        player={player}
        contextIsActionable={contextIsActionable}
        contextUpgradeOptions={contextUpgradeOptions}
        contextUpgradeTier={contextUpgradeTier}
        contextUpgradeCost={contextUpgradeCost}
        canAffordUpgrade={canAffordUpgrade}
        nearbyDamaged={nearbyDamaged}
        repairCost={repairCost}
        canAffordRepair={canAffordRepair}
        contextRefund={contextRefund}
        resources={resources}
        onRepair={onRepair}
        onDismantle={onDismantle}
      />

      <HUDConstructionBar
        selectedBuildingType={selectedBuildingType}
        resources={resources}
        disabled={player.isDead || player.hp <= 0}
        onSelectBuilding={onSelectBuilding}
      />
      <HUDGameOverOverlay
        visible={isGameOver}
        survivalTime={survivalTime}
        destroyedBaseCount={enemyBases.filter(base => base.isDestroyed).length}
        message={gameOverMessage ?? (allowRestart ? 'The central command core was destroyed by a hostile outpost.' : 'The shared Core was destroyed. This run has ended; leave the room to start a new one.')}
        allowRestart={allowRestart}
        onRestart={onRestart}
      />

    </div>
  );
};
