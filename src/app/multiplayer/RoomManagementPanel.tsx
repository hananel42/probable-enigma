import React from 'react';
import { Activity, Users, Wifi, Copy, Check, AlertTriangle, LogOut, X, DoorOpen, Trophy, Link2, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import type { RoomManagementStatus } from '../../game/multiplayer/roomManagement';
import type { RoomConnectionView } from '../../game/multiplayer/roomView';
import { RoomPlayerRow } from './RoomPlayerRow';
import type { GameMode } from '../../game/multiplayer/types';

function formatRoomDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

interface RoomManagementPanelProps {
  status: RoomManagementStatus;
  connectionView: RoomConnectionView;
  onRetrySignaling: () => void;
  role: 'host' | 'guest';
  localPlayerId: string;
  roomCode: string;
  roomJoinUrl: string;
  error: string | null;
  copyCodeStatus: 'idle' | 'success' | 'error';
  copyLinkStatus: 'idle' | 'success' | 'error';
  onCopyRoomCode: () => void;
  onCopyRoomLink: () => void;
  onClose: () => void;
  canReturnToGame: boolean;
  onLeave: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRevive: (playerId: string) => void;
  onSetMode: (mode: GameMode) => void;
  onKick: (playerId: string) => void;
  onNewLobby: () => void;
}

/** Full-screen room control center: invitation, roster, mode, match actions, and results. */
export const RoomManagementPanel: React.FC<RoomManagementPanelProps> = ({
  status,
  connectionView,
  onRetrySignaling,
  role,
  localPlayerId,
  roomCode,
  roomJoinUrl,
  error,
  copyCodeStatus,
  copyLinkStatus,
  onCopyRoomCode,
  onCopyRoomLink,
  onClose,
  canReturnToGame,
  onLeave,
  onStart,
  onPause,
  onResume,
  onRevive,
  onSetMode,
  onKick,
  onNewLobby,
}) => {
  const host = role === 'host';
  const phaseTitle = status.phase === 'lobby'
    ? 'ROOM LOBBY'
    : status.phase === 'playing'
      ? 'MATCH IN PROGRESS'
      : status.phase === 'paused'
        ? 'WORLD PAUSED'
        : 'MATCH RESULTS';
  // Treat room status as input data, not as an authority to display disconnected
  // peers. Older or delayed envelopes may still contain a stale roster row.
  const visiblePlayers = status.players.filter(player => player.connected);
  const connectedCount = visiblePlayers.length;

  const copyButtonClass = (state: 'idle' | 'success' | 'error') =>
    `inline-flex min-h-10 items-center justify-center gap-2 border px-3 text-[10px] font-bold tracking-[0.1em] transition-colors ${
      state === 'success'
        ? 'border-emerald-300/50 bg-emerald-300/10 text-emerald-200'
        : state === 'error'
          ? 'border-rose-300/50 bg-rose-300/10 text-rose-200'
          : 'border-slate-700 text-slate-300 hover:border-cyan-300/50 hover:text-cyan-100'
    }`;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[280] h-[100dvh] w-[100dvw] overflow-hidden bg-[#070b13] text-slate-100"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-management-title"
      data-testid="room-management-panel"
    >
      <section className="flex h-full min-h-0 w-full flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-cyan-300/15 bg-slate-950/95 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-cyan-300/25 bg-cyan-300/5 text-cyan-200">
              <Users size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold tracking-[0.2em] text-cyan-300">
                <span>OUTPOST COMMAND</span>
                <span className="text-slate-700">/</span>
                <span>ROOM {roomCode}</span>
              </div>
              <h2 id="room-management-title" className="mt-1 text-lg font-bold tracking-[0.1em] sm:text-xl">
                {phaseTitle}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-2 text-[10px] font-bold tracking-[0.1em] text-slate-400 sm:flex">
              <span className={`h-2 w-2 rounded-full ${connectedCount > 0 ? 'bg-emerald-300' : 'bg-amber-300'}`} />
              {connectedCount} CONNECTED
            </div>
            {status.phase === 'playing' && canReturnToGame && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-10 items-center gap-2 border border-cyan-300/40 bg-cyan-300/5 px-3 text-[10px] font-bold tracking-[0.1em] text-cyan-100 hover:bg-cyan-300/15"
              >
                <Play size={13} fill="currentColor" /> RETURN TO GAME
              </button>
            )}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.3fr)_minmax(250px,0.78fr)] xl:overflow-hidden">
          <aside className="flex min-w-0 flex-col gap-4 border-b border-slate-800 p-4 sm:p-5 xl:overflow-y-auto xl:border-b-0 xl:border-r xl:p-6">
            <section className="border border-cyan-300/20 bg-cyan-300/[0.035] p-4 sm:p-5">
              <div className="text-[9px] font-bold tracking-[0.18em] text-cyan-300">INVITE PLAYERS</div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">Share the room code or send a direct link. Players who open the link will automatically prepare to join this room.</p>
              <div className="mt-4 border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-[9px] font-bold tracking-[0.14em] text-slate-500">ROOM CODE</div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                  <strong className="font-mono text-3xl font-bold tracking-[0.22em] text-cyan-100">{roomCode}</strong>
                  <button type="button" onClick={onCopyRoomCode} className={copyButtonClass(copyCodeStatus)} title="Copy the five-letter room code">
                    {copyCodeStatus === 'success' ? <Check size={14} /> : copyCodeStatus === 'error' ? <AlertTriangle size={14} /> : <Copy size={14} />}
                    {copyCodeStatus === 'success' ? 'COPIED' : copyCodeStatus === 'error' ? 'COPY FAILED' : 'COPY CODE'}
                  </button>
                </div>
              </div>
              <div className="mt-3 border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-[9px] font-bold tracking-[0.14em] text-slate-500">DIRECT ROOM LINK</div>
                <div
                  aria-label="Direct room invitation URL"
                  title={roomJoinUrl}
                  className="mt-2 max-h-24 select-text break-all rounded border border-slate-800 bg-slate-950/70 p-2 font-mono text-[11px] leading-relaxed text-slate-300"
                >
                  {roomJoinUrl}
                </div>
                <button type="button" onClick={onCopyRoomLink} className={`mt-3 w-full ${copyButtonClass(copyLinkStatus)}`} title="Copy the direct invitation link">
                  {copyLinkStatus === 'success' ? <Check size={14} /> : copyLinkStatus === 'error' ? <AlertTriangle size={14} /> : <Link2 size={14} />}
                  {copyLinkStatus === 'success' ? 'LINK COPIED' : copyLinkStatus === 'error' ? 'COPY FAILED' : 'COPY INVITATION LINK'}
                </button>
              </div>
              {connectionView.signalingUnavailable && <div className="mt-3 border border-amber-300/30 bg-amber-300/[0.06] p-3" role="status" aria-live="polite">
                <div className="flex items-start gap-2 text-xs font-semibold text-amber-100"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> ROOM SERVICE UNAVAILABLE</div>
                <p className="mt-2 text-[10px] leading-relaxed text-slate-300">Existing players and their direct connection remain active. New players cannot join until the room service recovers. Automatic retries continue in the background.</p>
                <button type="button" onClick={onRetrySignaling} className="mt-3 inline-flex min-h-9 items-center justify-center gap-2 border border-amber-200/40 px-3 text-[10px] font-bold tracking-[0.1em] text-amber-100 hover:bg-amber-200/10"><RefreshCw size={12} /> RETRY ROOM SERVICE</button>
              </div>}
              {!connectionView.signalingUnavailable && connectionView.signalingRetryAttempts && connectionView.signalingRetryAttempts > 0 && <p className="mt-3 text-[10px] leading-relaxed text-amber-200" role="status">Room service reconnecting in background (attempt {connectionView.signalingRetryAttempts}). Existing players remain connected.</p>}
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Keep this panel open while players join. The match does not start until the host selects a mode and starts it.</p>
            </section>

            <section className="border border-slate-800 bg-slate-900/35 p-4">
              <div className="text-[9px] font-bold tracking-[0.18em] text-slate-500">ROOM STATUS</div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Phase</span>
                <span className="text-[10px] font-bold tracking-[0.1em] text-cyan-100">{status.phase.toUpperCase()}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Connected players</span>
                <strong className="font-mono text-sm text-slate-100">{connectedCount} / 8</strong>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Match time</span>
                <strong className="font-mono text-sm tabular-nums text-slate-100">{formatRoomDuration(status.gameTimeSeconds)}</strong>
              </div>
            </section>
          </aside>

          <section className="flex min-w-0 flex-col border-b border-slate-800 p-4 sm:p-5 xl:min-h-0 xl:border-b-0 xl:border-r xl:p-6">
            <div className="mb-4 flex shrink-0 items-end justify-between gap-3">
              <div>
                <div className="text-[9px] font-bold tracking-[0.18em] text-slate-500">ROOM ROSTER</div>
                <h3 className="mt-1 text-base font-bold tracking-[0.08em]">PARTICIPANTS</h3>
              </div>
              <span className="text-[10px] text-slate-500">{visiblePlayers.length} CONNECTED</span>
            </div>
            <div className="space-y-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              {visiblePlayers.slice().sort((a, b) => Number(b.isHost) - Number(a.isHost) || b.survivalSeconds - a.survivalSeconds).map(player => (
                <RoomPlayerRow
                  key={player.playerId}
                  player={player}
                  isLocal={player.playerId === localPlayerId}
                  isHost={host}
                  showRevive={host && status.hasWorld && status.mode !== 'COOPERATIVE' && player.connected && player.phase === 'defeated'}
                  onRevive={onRevive}
                  onKick={onKick}
                />
              ))}
              {status.players.length === 0 && <p className="border border-dashed border-slate-800 py-12 text-center text-xs text-slate-500">Waiting for the first participant.</p>}
            </div>
          </section>

          <aside className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 xl:overflow-y-auto xl:p-6">
            <section className="border border-slate-800 bg-slate-900/35 p-4 sm:p-5">
              <div className="text-[9px] font-bold tracking-[0.18em] text-slate-500">MATCH SETTINGS</div>
              <h3 className="mt-1 text-base font-bold tracking-[0.08em]">GAME MODE</h3>
              {host && status.phase === 'lobby' ? (
                <>
                  <select aria-label="Room game mode" className="mt-4 min-h-11 w-full border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-cyan-100 outline-none focus:border-cyan-300/60" value={status.mode} onChange={event => onSetMode(event.target.value as GameMode)}>
                    <option value="FREE_FOR_ALL">FREE FOR ALL — EVERY PLAYER FOR THEMSELVES</option>
                    <option value="TEAM">TEAM — SEPARATE CORES, ALLIES</option>
                    <option value="COOPERATIVE">CO-OP — ONE SHARED CORE</option>
                  </select>
                  <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Choose the rules before the match starts. The mode cannot be changed once the simulation begins.</p>
                </>
              ) : (
                <div className="mt-3 border border-cyan-300/20 bg-cyan-300/[0.04] p-3">
                  <div className="text-xs font-bold text-cyan-100">{status.mode === 'FREE_FOR_ALL' ? 'FREE FOR ALL' : status.mode === 'COOPERATIVE' ? 'CO-OP' : 'TEAM'}</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{status.phase === 'lobby' ? 'The host will choose the game mode.' : status.phase === 'playing' ? 'The mode is locked for this match.' : 'The match has ended.'}</p>
                </div>
              )}
            </section>

            {status.phase === 'lobby' && (
              <section className="mt-auto border border-cyan-300/25 bg-cyan-300/[0.035] p-4 sm:p-5">
                {host ? (
                  <>
                    <div className="text-[9px] font-bold tracking-[0.18em] text-cyan-300">HOST CONTROLS</div>
                    <button type="button" onClick={onStart} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 border border-cyan-300/50 bg-cyan-300/10 px-4 text-xs font-bold tracking-[0.14em] text-cyan-100 hover:bg-cyan-300/20">
                      <Play size={15} fill="currentColor" /> START MATCH
                    </button>
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-500">The room creator owns the simulation. Start only when the selected mode and player roster are ready.</p>
                  </>
                ) : (
                  <div className="flex items-start gap-3 py-1 text-slate-400">
                    <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-cyan-300" />
                    <div><div className="text-[10px] font-bold tracking-[0.14em]">WAITING FOR HOST</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">The host selects the mode and starts the match. You can leave this room at any time.</p></div>
                  </div>
                )}
              </section>
            )}

            {status.phase === 'playing' && (
              <section className="mt-auto border border-cyan-300/25 bg-cyan-300/[0.035] p-4 sm:p-5">
                <div className="text-[9px] font-bold tracking-[0.18em] text-cyan-300">WORLD CONTROLS</div>
                {host ? (
                  <>
                    <button type="button" onClick={onPause} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 border border-amber-300/40 bg-amber-300/10 px-4 text-xs font-bold tracking-[0.12em] text-amber-100 hover:bg-amber-300/20">PAUSE WORLD</button>
                    <button type="button" onClick={onNewLobby} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 border border-slate-600 px-4 text-xs font-bold tracking-[0.12em] text-slate-200 hover:border-cyan-300/40 hover:text-cyan-100"><DoorOpen size={14} /> RETURN TO ROOM</button>
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Returning to the room ends this world but keeps all connected participants and chat. You can start another world from here.</p>
                  </>
                ) : <p className="mt-3 text-[10px] leading-relaxed text-slate-400">The host controls the shared world. You can keep using the room chat while it runs.</p>}
              </section>
            )}

            {status.phase === 'paused' && (
              <section className="mt-auto border border-amber-300/25 bg-amber-300/[0.035] p-4 sm:p-5">
                <div className="text-[9px] font-bold tracking-[0.18em] text-amber-200">WORLD PAUSED</div>
                {host ? (
                  <>
                    <button type="button" onClick={onResume} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 border border-emerald-300/40 bg-emerald-300/10 px-4 text-xs font-bold tracking-[0.12em] text-emerald-100 hover:bg-emerald-300/20"><Play size={14} fill="currentColor" /> RESUME WORLD</button>
                    <button type="button" onClick={onNewLobby} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 border border-slate-600 px-4 text-xs font-bold tracking-[0.12em] text-slate-200 hover:border-cyan-300/40 hover:text-cyan-100"><DoorOpen size={14} /> RETURN TO ROOM</button>
                  </>
                ) : <p className="mt-3 text-[10px] leading-relaxed text-slate-400">The host paused the world. Your room connection remains active.</p>}
              </section>
            )}

            {status.phase === 'results' && (
              <section className="mt-auto border border-amber-300/20 bg-amber-300/[0.035] p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[9px] font-bold tracking-[0.18em] text-amber-200"><Trophy size={13} /> MATCH COMPLETE</div>
                {host ? (
                  <>
                    <button type="button" onClick={onNewLobby} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 border border-cyan-300/50 bg-cyan-300/10 px-4 text-xs font-bold tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/20"><DoorOpen size={15} /> RETURN TO ROOM</button>
                    {status.mode === 'COOPERATIVE' && <p className="mt-3 text-[10px] leading-relaxed text-slate-500">CO-OP shares one Core. Return to the room and start a new world to revive the whole team.</p>}
                  </>
                ) : (
                  <p className="mt-3 text-[10px] leading-relaxed text-slate-400">Results are final. The host can return the room to a new lobby.</p>
                )}
              </section>
            )}
          </aside>
        </div>

        {error && <p className="shrink-0 border-t border-rose-300/20 bg-rose-950/25 px-4 py-3 text-sm text-rose-200 sm:px-6" role="alert">{error}</p>}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-6 lg:px-8">
          <p className="text-[10px] text-slate-500">The room and participant connections persist when a world is paused or ended.</p>
          <button type="button" onClick={onLeave} className="inline-flex min-h-10 shrink-0 items-center gap-2 border border-slate-700 px-4 text-[10px] font-bold tracking-[0.1em] text-slate-300 hover:border-rose-300/60 hover:text-rose-200"><LogOut size={13} /> LEAVE ROOM</button>
        </footer>
      </section>
    </div>
  );
};
