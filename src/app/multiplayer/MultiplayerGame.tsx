import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HUD } from '../../components/HUD';
import type { CanvasGameClient } from '../../game/client/CanvasGameClient';
import type { GameSnapshot, GameClientPort } from '../../game/server/protocol';
import { AlertTriangle, Check, Copy, Link2, LoaderCircle, LogOut, MessageSquare, Send, UserX, Users, Wifi, X } from 'lucide-react';
import type { RoomConnectionView } from '../../game/multiplayer/roomView';
import type { HostRoomController } from '../../game/multiplayer/HostRoomController';
import type { GameDataTransport } from '../../game/multiplayer/transport';
import type { RemoteGameClientPort, RoomRemovalNotice } from '../../game/multiplayer/RemoteGameClientPort';
import type { RoomChatMessage } from '../../game/multiplayer/chat';
import type { GameMode } from '../../game/multiplayer/types';
import type { RoomManagementStatus } from '../../game/multiplayer/roomManagement';
import { useGuidance } from '../../guidance/GuidanceProvider';
import { isTextEntryTarget, resolveEscapeAction } from '../../game/client/escapeRouting';
import { useMultiplayerSessionLifecycle } from './useMultiplayerSessionLifecycle';
import { useRoomActions } from './useRoomActions';
import { RoomManagementPanel } from './RoomManagementPanel';

export const MultiplayerGame: React.FC<{ transport: GameDataTransport; role: 'host' | 'guest'; mode: 'FREE_FOR_ALL' | 'TEAM' | 'COOPERATIVE'; roomCode: string; roomJoinUrl: string; displayName: string; connectionView: RoomConnectionView; onLeaveRoom: () => void; onRoomRemoved: (notice: RoomRemovalNotice) => void; onCopyRoomCode: () => void; onCopyRoomLink: () => void; copyCodeStatus: 'idle' | 'success' | 'error'; copyLinkStatus: 'idle' | 'success' | 'error' }> = ({ transport, role, mode, roomCode, roomJoinUrl, displayName, connectionView, onLeaveRoom, onRoomRemoved, onCopyRoomCode, onCopyRoomLink, copyCodeStatus, copyLinkStatus }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState<GameSnapshot | null>(null);
  const [syncStatus, setSyncStatus] = useState(role === 'host' ? 'HOST AUTHORITY' : 'WAITING FOR HOST STATE');
  const [defeatNotice, setDefeatNotice] = useState(false);
  const [connectionDegraded, setConnectionDegraded] = useState(false);
  const [sessionStable, setSessionStable] = useState(role === 'host');
  const [chatOpen, setChatOpen] = useState(false);
  const chatOpenRef = useRef(false);
  const [chatDraft, setChatDraft] = useState('');
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([]);
  const [roomStatus, setRoomStatus] = useState<RoomManagementStatus | null>(null);
  const [roomPanelOpen, setRoomPanelOpen] = useState(true);
  const [roomActionError, setRoomActionError] = useState<string | null>(null);
  const [roomRemovalNotice, setRoomRemovalNotice] = useState<RoomRemovalNotice | null>(null);
  const roomPanelOpenRef = useRef(true);
  /** Last room lifecycle event prevents periodic status refreshes overriding user navigation. */
  const roomStatusLifecycleRef = useRef<RoomManagementStatus | null>(null);
  /** Readiness changes, unlike repeated true notifications, may close the initial sync panel. */
  const sessionReadyRef = useRef(role === 'host');
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const hostProtocolRef = useRef<HostRoomController | null>(null);
  const remoteClientRef = useRef<RemoteGameClientPort | null>(null);
  const clientPortRef = useRef<GameClientPort | null>(null);
  const rendererRef = useRef<CanvasGameClient | null>(null);
  const { activeGuide } = useGuidance();
  const setRoomPanelVisible = useCallback((visible: boolean) => {
    roomPanelOpenRef.current = visible;
    setRoomPanelOpen(visible);
    if (visible) rendererRef.current?.releaseAllInput();
  }, []);
  const appendChatMessage = useCallback((message: RoomChatMessage) => {
    setChatMessages(current => [...current, message].slice(-8));
    setChatNotice(null);
  }, []);
  const setChatVisible = useCallback((visible: boolean) => {
    chatOpenRef.current = visible;
    setChatOpen(visible);
    if (visible) rendererRef.current?.releaseAllInput();
    else canvasRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape is routed by the room UI, independent of whether a world renderer is
  // mounted. Opening/closing this panel never pauses the host's shared simulation.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const action = resolveEscapeAction({
        surface: 'multiplayer',
        guideOpen: Boolean(activeGuide),
        textEntryFocused: isTextEntryTarget(event.target),
        chatOpen: chatOpenRef.current,
        roomOpen: roomPanelOpenRef.current,
        hasWorld: roomStatusLifecycleRef.current?.hasWorld === true
      });
      if (action === 'ignore' || action === 'let-guide-handle') return;
      // Chat's input handles Escape locally. For every other action, consume the
      // event before a renderer can interpret it as an in-game command.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === 'close-chat') {
        setChatDraft('');
        setChatVisible(false);
      } else if (action === 'open-room' || action === 'keep-room-open') {
        setRoomPanelVisible(true);
      } else if (action === 'close-room') {
        setRoomPanelVisible(false);
      }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [activeGuide, setChatVisible, setRoomPanelVisible]);

  // Register before the renderer's keyboard handlers so T opens chat instead of
  // changing drone mode. Text-entry keystrokes are ignored by the game client.
  useEffect(() => {
    const onChatHotkey = (event: KeyboardEvent) => {
      const target = event.target;
      const isTextEntry = target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable);
      if (isTextEntry) return;
      if (event.code === 'KeyT' && !event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setChatVisible(!chatOpenRef.current);
      }
    };
    window.addEventListener('keydown', onChatHotkey);
    return () => window.removeEventListener('keydown', onChatHotkey);
  }, [setChatVisible]);

  useEffect(() => {
    if (chatOpen) chatInputRef.current?.focus({ preventScroll: true });
  }, [chatOpen]);

  useMultiplayerSessionLifecycle({
    canvasRef,
    transport,
    role,
    mode,
    displayName,
    appendChatMessage,
    onRoomRemoved,
    setRoomPanelVisible,
    setSyncStatus,
    setRoomActionError,
    setConnectionDegraded,
    setSessionStable,
    setDefeatNotice,
    setRoomStatus,
    setRoomRemovalNotice,
    setGameState,
    roomStatusLifecycleRef,
    sessionReadyRef,
    hostProtocolRef,
    remoteClientRef,
    clientPortRef,
    rendererRef,
    chatOpenRef
  });

  const {
    submitChat,
    handleSetRoomMode,
    handleStartMatch,
    handlePauseWorld,
    handleResumeWorld,
    handleReviveParticipant,
    handleKickParticipant,
    handleNewLobby,
    handleSelectBuilding,
    handleSetDroneMode,
    handleRepair,
    handleDismantle,
    handleRestart
  } = useRoomActions({
    role,
    chatDraft,
    setChatDraft,
    setChatNotice,
    setChatVisible,
    setRoomPanelVisible,
    setRoomActionError,
    setDefeatNotice,
    hostProtocolRef,
    remoteClientRef,
    clientPortRef
  });

  const effectiveMode = roomStatus?.mode ?? gameState?.multiplayerMode ?? mode;
  const localPlayerId = gameState?.player.ownerPlayerId || (role === 'host' ? 'player-host' : remoteClientRef.current?.assignedPlayerId || 'guest-player');
  const localRoomStatus = roomStatus?.players.find(player => player.playerId === localPlayerId);
  const localParticipant = gameState?.humanPlayers.find(player => player.playerId === localPlayerId);
  const localCore = localParticipant ? gameState?.buildings.find(building => building.type === 'CORE' && building.id === localParticipant.coreId) : undefined;
  const canReturnToGame = Boolean(roomStatus?.hasWorld && roomStatus.phase === 'playing' && sessionStable && localRoomStatus?.connected === true && localRoomStatus.phase === 'alive' && localCore && localCore.hp > 0);
  useEffect(() => {
    // The local host also needs the same defeat-to-room transition as guests.
    // Never infer another player's Core if local identity is not present.
    if (roomStatus?.phase !== 'playing' || !gameState) return;
    const participant = gameState.humanPlayers.find(player => player.playerId === localPlayerId);
    if (!participant) return;
    const core = gameState.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
    if (!core || core.hp <= 0) {
      if (!defeatNotice) setDefeatNotice(true);
      if (!roomPanelOpenRef.current) setRoomPanelVisible(true);
    } else if (defeatNotice) {
      setDefeatNotice(false);
    }
  }, [roomStatus?.phase, gameState, localPlayerId, defeatNotice, setRoomPanelVisible]);
  useEffect(() => {
    roomPanelOpenRef.current = roomPanelOpen;
    rendererRef.current?.setInputEnabled(!roomPanelOpen && sessionStable && !defeatNotice && roomStatus?.phase === 'playing');
  }, [roomPanelOpen, sessionStable, defeatNotice, roomStatus?.phase]);
  const canHostRestartRoom = role === 'host' && roomStatus?.phase === 'results';
  const gameOverMessage = effectiveMode === 'COOPERATIVE'
    ? 'The shared Core was destroyed. Stay in the room, open room management, or leave at any time.'
    : 'Your Core was destroyed. You can remain connected, chat, and watch the room; you do not need to reconnect.';

  return <main className="fixed inset-0 z-[100] h-[100dvh] w-[100dvw] overflow-hidden bg-[#0a0e17] select-none" data-testid="multiplayer-game">
    <canvas ref={canvasRef} tabIndex={0} className="block h-full w-full touch-none outline-none" data-testid="game-canvas" />
    {gameState && roomStatus?.hasWorld && <HUD
      state={gameState}
      onSelectBuilding={handleSelectBuilding}
      onSetDroneMode={handleSetDroneMode}
      onRepair={handleRepair}
      onDismantle={handleDismantle}
      onRestart={handleRestart}
      allowRestart={canHostRestartRoom}
      gameOverMessage={gameOverMessage}
      topBarAddon={(
        <div className="pointer-events-auto flex min-w-0 items-center gap-1 rounded border border-cyan-400/20 bg-slate-950/65 px-1.5 py-1 text-cyan-100" aria-label="Multiplayer room controls">
          <button type="button" onClick={() => setRoomPanelVisible(true)} className={`hud-icon-button !h-7 !w-7 ${roomPanelOpen ? '!border-cyan-300/60 !text-cyan-100' : ''}`} title="Open room management" aria-label="Open room management"><Users className="h-3.5 w-3.5" /></button>
          <span className="hud-label whitespace-nowrap text-cyan-300/80">ROOM</span>
          <strong className="font-mono text-xs font-bold tracking-[0.12em]">{roomCode}</strong>
          <button type="button" onClick={onCopyRoomCode} className={`hud-icon-button !h-7 !w-7 ${copyCodeStatus === 'success' ? '!text-emerald-300 !border-emerald-400/60' : copyCodeStatus === 'error' ? '!text-rose-300 !border-rose-400/60' : ''}`} title={copyCodeStatus === 'success' ? 'Room code copied' : copyCodeStatus === 'error' ? 'Copy failed — check browser clipboard permissions' : 'Copy room code'} aria-label={copyCodeStatus === 'success' ? 'Room code copied' : 'Copy room code'}>
            {copyCodeStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : copyCodeStatus === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={onCopyRoomLink} className={`hud-icon-button !h-7 !w-7 ${copyLinkStatus === 'success' ? '!text-emerald-300 !border-emerald-400/60' : copyLinkStatus === 'error' ? '!text-rose-300 !border-rose-400/60' : ''}`} title={copyLinkStatus === 'success' ? 'Direct room link copied' : copyLinkStatus === 'error' ? 'Copy failed — check browser clipboard permissions' : 'Copy direct room link'} aria-label={copyLinkStatus === 'success' ? 'Direct room link copied' : 'Copy direct room link'}>
            {copyLinkStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : copyLinkStatus === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          </button>
          <span className={`mx-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${syncStatus.startsWith('CONNECTED') || syncStatus.startsWith('HOST AUTHORITY') ? 'bg-emerald-300' : 'bg-amber-300'}`} title={syncStatus} aria-label={syncStatus} />
        </div>
      )}
    />}
    {roomStatus?.hasWorld && (!gameState || (role === 'guest' && !sessionStable)) && <div className="absolute inset-0 z-[260] flex items-center justify-center bg-slate-950/95 p-5" role="status" aria-live="polite">
      <div className="w-full max-w-md border border-cyan-300/25 bg-slate-950/95 p-6 text-center shadow-2xl">
        {connectionView.status === 'error' ? <AlertTriangle className="mx-auto mb-4 h-7 w-7 text-rose-300" /> : <LoaderCircle className="mx-auto mb-4 h-7 w-7 animate-spin text-cyan-300" />}
        <p className="text-[10px] font-bold tracking-[0.22em] text-cyan-300">MULTIPLAYER SESSION</p>
        <h2 className="mt-2 text-lg font-bold tracking-[0.1em] text-slate-100">{connectionView.status === 'error' ? 'CONNECTION FAILED' : role === 'host' ? 'STARTING WORLD' : gameState ? 'VERIFYING LIVE STATE STREAM' : 'SYNCHRONIZING WORLD'}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{connectionView.status === 'error' ? connectionView.message : role === 'host' ? 'Preparing the authoritative simulation…' : gameState ? 'Initial state received. Confirming that authoritative updates are flowing before enabling controls…' : 'Peer-to-peer link established. Waiting for the host’s authoritative initial state…'}</p>
        <p className="mt-3 text-[10px] text-slate-500">ROOM {roomCode} · PLAYER {displayName}</p>
        <button type="button" onClick={onLeaveRoom} className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 border border-slate-600 px-4 text-xs font-bold tracking-[0.12em] text-slate-200 hover:border-rose-300/60 hover:text-rose-200"><LogOut size={13} /> RETURN TO LOBBY</button>
      </div>
    </div>}
    {connectionDegraded && connectionView.status !== 'error' && <div className="pointer-events-none absolute inset-x-0 top-20 z-[250] flex justify-center px-3"><div role="alert" className="border border-amber-300/40 bg-slate-950/90 px-3 py-2 text-center text-[10px] font-bold tracking-[0.12em] text-amber-100">HOST CONNECTION LOST · WAITING FOR HEARTBEAT</div></div>}
    {(chatMessages.length > 0 || chatOpen || chatNotice) && <section className="pointer-events-none absolute bottom-4 left-3 z-[320] flex w-[min(92vw,420px)] flex-col items-start gap-1 font-mono" aria-label="Room chat">
      {chatMessages.length > 0 && <div className="flex max-w-full flex-col items-start gap-1" aria-live="polite">{chatMessages.slice(-6).map(message => <p key={message.messageId} className="max-w-full break-words rounded-sm bg-slate-950/70 px-2 py-1 text-left text-xs leading-relaxed text-slate-100 shadow-sm [text-shadow:0_1px_2px_#000]"><b className="mr-2 text-cyan-200">{message.senderName}</b><span>{message.text}</span></p>)}</div>}
      {chatNotice && <p role="alert" className="rounded-sm border border-rose-300/30 bg-slate-950/90 px-2 py-1 text-xs text-rose-200">{chatNotice}</p>}
      {chatOpen && <form className="pointer-events-auto flex w-full items-center gap-2 border border-cyan-300/35 bg-slate-950/95 p-2 shadow-xl" onSubmit={event => { event.preventDefault(); submitChat(); }}>
        <MessageSquare size={14} className="shrink-0 text-cyan-300" />
        <input ref={chatInputRef} value={chatDraft} onChange={event => setChatDraft(event.target.value.slice(0, 280))} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submitChat(); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setChatDraft(''); setChatVisible(false); }
        }} placeholder="Message the room…" aria-label="Chat message" maxLength={280} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" />
        <button type="submit" aria-label="Send chat message" title="Send message (Enter)" className="flex h-7 w-7 shrink-0 items-center justify-center text-cyan-200 hover:bg-cyan-300/10"><Send size={14} /></button>
        <button type="button" onClick={() => { setChatDraft(''); setChatVisible(false); }} aria-label="Close chat" title="Close chat (Escape)" className="flex h-7 w-7 shrink-0 items-center justify-center text-slate-400 hover:text-white"><X size={14} /></button>
      </form>}
      {!chatOpen && <span className="px-1 text-[9px] tracking-[0.12em] text-slate-500 [text-shadow:0_1px_2px_#000]">T · OPEN CHAT</span>}
    </section>}
    {(connectionDegraded || connectionView.status === 'error') && gameState && <div className="absolute inset-0 z-[255] flex items-center justify-center bg-slate-950/90 p-5" role="alert" aria-live="assertive"><div className="w-full max-w-md border border-amber-300/35 bg-slate-950/95 p-6 text-center">{connectionView.status === 'error' ? <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-rose-300" /> : <Wifi className="mx-auto mb-3 h-6 w-6 text-amber-300" />}<h2 className="text-sm font-bold tracking-[0.16em] text-amber-100">{connectionView.status === 'error' ? 'ROOM CONNECTION FAILED' : 'HOST CONNECTION DEGRADED'}</h2><p className="mt-2 text-sm leading-relaxed text-slate-300">{connectionView.status === 'error' ? connectionView.message : 'The latest world state may be stale. Waiting for the authoritative host connection to recover.'}</p><button type="button" onClick={onLeaveRoom} className="mt-5 min-h-10 border border-slate-600 px-4 text-xs font-bold tracking-[0.12em] text-slate-200 hover:border-rose-300/60 hover:text-rose-200">RETURN TO LOBBY</button></div></div>}
    {roomRemovalNotice && <div className="pointer-events-auto fixed inset-0 z-[400] flex items-center justify-center bg-slate-950/95 p-5" role="alertdialog" aria-modal="true" aria-labelledby="room-removal-title">
      <section className="w-full max-w-md border border-rose-300/35 bg-slate-950 p-6 text-center shadow-2xl">
        <UserX className="mx-auto mb-3 h-7 w-7 text-rose-200" />
        <h2 id="room-removal-title" className="text-sm font-bold tracking-[0.16em] text-rose-100">REMOVED FROM ROOM</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-200">{roomRemovalNotice.message}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">Your room session has ended. You can return to the menu and join another room with an invitation.</p>
        <button type="button" onClick={onLeaveRoom} className="mt-5 min-h-11 w-full border border-cyan-300/40 bg-cyan-300/10 px-4 text-xs font-bold tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/20">RETURN TO MAIN MENU</button>
      </section>
    </div>}
    {defeatNotice && !roomPanelOpen && <div className="pointer-events-none absolute inset-x-0 top-1/3 z-[250] flex justify-center px-3"><div role="alert" className="border border-rose-300/50 bg-slate-950/95 px-5 py-3 text-center shadow-2xl shadow-rose-950/40"><div className="text-xs font-bold tracking-[0.2em] text-rose-200">CORE DESTROYED</div><div className="mt-1 text-[10px] tracking-[0.12em] text-slate-300">YOU HAVE BEEN ELIMINATED</div></div></div>}
    {roomPanelOpen && roomStatus && <RoomManagementPanel
      status={roomStatus}
      connectionView={connectionView}
      onRetrySignaling={() => transport.retrySignaling?.()}
      role={role}
      localPlayerId={localPlayerId}
      roomCode={roomCode}
      roomJoinUrl={roomJoinUrl}
      error={roomActionError}
      copyCodeStatus={copyCodeStatus}
      copyLinkStatus={copyLinkStatus}
      onCopyRoomCode={onCopyRoomCode}
      onCopyRoomLink={onCopyRoomLink}
      onClose={() => setRoomPanelVisible(false)}
      canReturnToGame={canReturnToGame}
      onLeave={onLeaveRoom}
      onStart={handleStartMatch}
      onPause={handlePauseWorld}
      onResume={handleResumeWorld}
      onRevive={handleReviveParticipant}
      onSetMode={handleSetRoomMode}
      onKick={handleKickParticipant}
      onNewLobby={handleNewLobby}
    />}
  </main>;
};

/** PeerJS Cloud is the only multiplayer room transport exposed in the production UI. */
