import React from 'react';
import { Activity, UserX } from 'lucide-react';
import type { RoomPlayerStatus } from '../../game/multiplayer/roomManagement';

interface RoomPlayerRowProps {
  player: RoomPlayerStatus;
  isLocal: boolean;
  isHost: boolean;
  showRevive: boolean;
  onRevive: (playerId: string) => void;
  onKick: (playerId: string) => void;
}

function formatSurvivalDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

function statusLabel(player: RoomPlayerStatus): string {
  if (player.phase === 'alive') return 'ALIVE';
  if (player.phase === 'defeated') return 'DEFEATED';
  if (player.phase === 'kicked') return 'KICKED';
  return 'DISCONNECTED';
}

export const RoomPlayerRow: React.FC<RoomPlayerRowProps> = ({ player, isLocal, isHost, showRevive, onRevive, onKick }) => {
  const connected = player.connected;
  const defeated = player.phase === 'defeated';

  return (
    <div className={`flex items-center gap-3 border p-3 ${isLocal ? 'border-cyan-300/35 bg-cyan-300/[0.045]' : 'border-slate-800 bg-slate-900/30'}`}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${!connected ? 'bg-slate-600' : player.phase === 'alive' ? 'bg-emerald-400' : defeated ? 'bg-rose-400' : 'bg-amber-300'}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-100">{player.displayName}</span>
          {player.isHost && <span className="border border-amber-300/25 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.1em] text-amber-200">HOST</span>}
          {isLocal && <span className="border border-cyan-300/20 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.1em] text-cyan-300">YOU</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`font-bold tracking-[0.1em] ${!connected ? 'text-slate-500' : player.phase === 'alive' ? 'text-emerald-300' : defeated ? 'text-rose-300' : 'text-amber-200'}`}>{statusLabel(player)}</span>
          <span className="text-slate-700">·</span>
          <span className="text-slate-500">{connected ? 'PEER CONNECTED' : 'NOT CONNECTED'}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm font-bold tabular-nums text-slate-200">{formatSurvivalDuration(player.survivalSeconds)}</div>
        <div className="text-[8px] font-bold tracking-[0.12em] text-slate-600">SURVIVED</div>
      </div>
      {showRevive && (
        <button type="button" onClick={() => onRevive(player.playerId)} title={`Revive ${player.displayName} with a new Core`} aria-label={`Revive ${player.displayName}`} className="flex min-h-9 shrink-0 items-center justify-center gap-1 border border-emerald-300/35 px-2 text-[9px] font-bold tracking-[0.08em] text-emerald-200 hover:border-emerald-300/70 hover:bg-emerald-300/10">
          <Activity size={13} /> REVIVE
        </button>
      )}
      {isHost && !player.isHost && connected && (
        <button type="button" onClick={() => onKick(player.playerId)} title={`Remove ${player.displayName} from room`} aria-label={`Remove ${player.displayName} from room`} className="flex h-9 w-9 shrink-0 items-center justify-center border border-rose-300/25 text-rose-200 hover:border-rose-300/60 hover:bg-rose-300/10">
          <UserX size={15} />
        </button>
      )}
    </div>
  );
};
