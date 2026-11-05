import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Check, AlertTriangle, LoaderCircle, Link2, X, Users, Wifi } from 'lucide-react';
import type { RoomConnectionView } from '../../game/multiplayer/roomView';
import { MULTIPLAYER_SNAPSHOT_INTERVAL_MS, type GameDataTransport } from '../../game/multiplayer/transport';
import { PeerJsRoomClient } from '../../game/multiplayer/PeerJsRoomClient';
import { clearRoomFromUrl, createRoomJoinUrl, parseRoomLink } from '../../game/multiplayer/roomLink';
import { createRandomRobotName, resolveDisplayName } from '../../game/multiplayer/displayName';
import { describeRoomActionError } from '../../game/multiplayer/connectionErrors';
import type { RoomRemovalNotice } from '../../game/multiplayer/RemoteGameClientPort';
import { MultiplayerGame } from './MultiplayerGame';

export const MultiplayerLobby: React.FC<{ displayName: string; onResolveDisplayName: () => string }> = ({ displayName, onResolveDisplayName }) => {
  const peerClientRef = useRef<PeerJsRoomClient | null>(null);
  const activeClientRef = useRef<PeerJsRoomClient | null>(null);
  const dataTransportRef = useRef<GameDataTransport | null>(null);
  const copyCodeFeedbackTimerRef = useRef<number | null>(null);
  const copyLinkFeedbackTimerRef = useRef<number | null>(null);
  const autoJoinAttemptedRef = useRef(false);
  const resolvedNameForRoomRef = useRef(displayName);
  const [roomLink] = useState(() => parseRoomLink(window.location.href));
  const [clientsReady, setClientsReady] = useState(false);
  // New rooms start with TEAM as their provisional default; the host chooses the final mode in room management.
  const initialRoomMode = 'TEAM' as const;
  const [roomCodeInput, setRoomCodeInput] = useState(roomLink.roomCode ?? '');
  const [connection, setConnection] = useState<RoomConnectionView>({ status: 'idle', message: 'Not connected', peerConnected: false });
  const [busy, setBusy] = useState(false);
  const [copyCodeStatus, setCopyCodeStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copyLinkStatus, setCopyLinkStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [roomNotice, setRoomNotice] = useState<string | null>(null);

  useEffect(() => {
    const peerClient = new PeerJsRoomClient();
    peerClientRef.current = peerClient;
    activeClientRef.current = peerClient;
    dataTransportRef.current = peerClient;
    const unsubscribePeer = peerClient.subscribe(view => setConnection(view));
    setClientsReady(true);
    return () => {
      unsubscribePeer();
      if (copyCodeFeedbackTimerRef.current !== null) window.clearTimeout(copyCodeFeedbackTimerRef.current);
      if (copyLinkFeedbackTimerRef.current !== null) window.clearTimeout(copyLinkFeedbackTimerRef.current);
      peerClient.disconnect(false);
      peerClientRef.current = null;
      activeClientRef.current = null;
      dataTransportRef.current = null;
    };
  }, []);

  const runRoomAction = useCallback(async (action: 'create' | 'join') => {
    const peerClient = peerClientRef.current;
    if (!peerClient) throw new Error('PeerJS room client is not initialized.');
    resolvedNameForRoomRef.current = onResolveDisplayName();
    setRoomNotice(null);
    setBusy(true);
    try {
      if (action === 'create') await peerClient.createRoom();
      else await peerClient.joinRoom(roomCodeInput);
    } catch (error) {
      const message = describeRoomActionError(error);
      console.error(`[multiplayer UI] Could not ${action} the room.`, { error });
      const active = peerClient.getView();
      setConnection({ ...active, status: 'error', message, roomCode: undefined, role: undefined, peerConnected: false });
    } finally {
      setBusy(false);
    }
  }, [roomCodeInput, onResolveDisplayName]);

  useEffect(() => {
    if (!clientsReady || !roomLink.roomCode || autoJoinAttemptedRef.current) return;
    autoJoinAttemptedRef.current = true;
    void runRoomAction('join');
  }, [clientsReady, roomLink.roomCode, runRoomAction]);

  const copyCode = async (code = connection.roomCode) => {
    if (!code) {
      const error = new Error('Cannot copy a room code because no room is active.');
      console.error('[multiplayer UI] Room-code copy requested without an active room.', error);
      setCopyCodeStatus('error');
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable. Open the game over HTTPS or localhost and check browser permissions.');
      await navigator.clipboard.writeText(code);
      setCopyCodeStatus('success');
    } catch (error) {
      console.error('[multiplayer UI] Failed to copy the room code.', { code, error });
      setCopyCodeStatus('error');
    }
    if (copyCodeFeedbackTimerRef.current !== null) window.clearTimeout(copyCodeFeedbackTimerRef.current);
    copyCodeFeedbackTimerRef.current = window.setTimeout(() => setCopyCodeStatus('idle'), 1800);
  };

  const copyRoomLink = async (code = connection.roomCode) => {
    if (!code) {
      const error = new Error('Cannot copy a direct room link because no room is active.');
      console.error('[multiplayer UI] Room-link copy requested without an active room.', error);
      setCopyLinkStatus('error');
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable. Open the game over HTTPS or localhost and check browser permissions.');
      const joinUrl = createRoomJoinUrl(window.location.href, code);
      await navigator.clipboard.writeText(joinUrl);
      setCopyLinkStatus('success');
    } catch (error) {
      console.error('[multiplayer UI] Failed to copy the direct room link.', { code, error });
      setCopyLinkStatus('error');
    }
    if (copyLinkFeedbackTimerRef.current !== null) window.clearTimeout(copyLinkFeedbackTimerRef.current);
    copyLinkFeedbackTimerRef.current = window.setTimeout(() => setCopyLinkStatus('idle'), 1800);
  };

  const handleLeaveRoom = useCallback(() => {
    activeClientRef.current?.leaveRoom();
    const cleanedUrl = clearRoomFromUrl(window.location.href);
    window.history.replaceState(window.history.state, '', cleanedUrl);
    setRoomCodeInput('');
    setCopyCodeStatus('idle');
    setCopyLinkStatus('idle');
  }, []);

  const handleRoomRemoved = useCallback((notice: RoomRemovalNotice) => {
    setRoomNotice(notice.message);
  }, []);

  if (connection.roomCode && connection.role) return <MultiplayerGame
    transport={dataTransportRef.current!}
    role={connection.role}
    mode={initialRoomMode}
    roomCode={connection.roomCode}
    roomJoinUrl={createRoomJoinUrl(window.location.href, connection.roomCode)}
    displayName={resolvedNameForRoomRef.current}
    connectionView={connection}
    onLeaveRoom={handleLeaveRoom}
    onRoomRemoved={handleRoomRemoved}
    onCopyRoomCode={() => { void copyCode(connection.roomCode); }}
    onCopyRoomLink={() => { void copyRoomLink(connection.roomCode); }}
    copyCodeStatus={copyCodeStatus}
    copyLinkStatus={copyLinkStatus}
  />;

  const pending = busy || connection.status === 'connecting' || connection.status === 'signaling';
  const roomActionDisabled = pending;
  return (
    <section className="cb-multiplayer-panel" data-guide-target="home-multiplayer" aria-label="Multiplayer room setup">
      <div className="cb-multiplayer-heading"><Users size={16} /><span>MULTIPLAYER / ONLINE ROOMS</span><i>ROOM SERVICE</i></div>
      <div className="cb-transport-summary">
        <Link2 size={13} />
        <span>Create a room, share its code, and play together. The host keeps the group in sync.</span>
      </div>
      {(connection.status === 'connecting' || connection.status === 'signaling' || connection.status === 'waiting') && <div className="cb-lobby-note flex items-start gap-2" role="status" aria-live="polite"><LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-cyan-300" /><span>{connection.message}</span></div>}
      <button type="button" className="cb-room-primary" onClick={() => void runRoomAction('create')} disabled={roomActionDisabled}>
        {pending ? <LoaderCircle size={15} className="cb-spin" /> : <Wifi size={15} />} CREATE ROOM <span>HOST</span>
      </button>
      <div className="cb-lobby-or"><span /> OR JOIN EXISTING ROOM <span /></div>
      <div className="cb-join-row">
        <input className="cb-lobby-input cb-room-code-input" aria-label="Room code" value={roomCodeInput} onChange={event => setRoomCodeInput(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z]/g, '').slice(0, 5))} placeholder="5-LETTER CODE" maxLength={5} autoCapitalize="characters" spellCheck={false} disabled={pending} />
        <button type="button" className="cb-room-secondary" onClick={() => void runRoomAction('join')} disabled={roomActionDisabled || roomCodeInput.length !== 5}>JOIN</button>
      </div>

      {roomLink.error && <p className="cb-lobby-error" role="alert">{roomLink.error}</p>}
      {roomNotice && <p className="cb-lobby-note" role="alert" aria-live="assertive">{roomNotice} You can join another room if you have an invitation.</p>}
      {connection.status === 'error' && !roomNotice && <p className="cb-lobby-error" role="alert">{connection.message}</p>}
      {connection.status !== 'error' && <p className="cb-lobby-note">Creating a room opens the full-screen room manager. The host shares the invitation, chooses the game mode, reviews the roster, and starts the match when everyone is ready.</p>}
    </section>
  );
};
