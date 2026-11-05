import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { CanvasGameClient } from '../../game/client/CanvasGameClient';
import { disposeResources } from '../../game/lifecycle/disposeResources';
import { resizeCanvasToDisplaySize } from '../../game/client/canvasSizing';
import type { GameSnapshot, GameClientPort } from '../../game/server/protocol';
import { LocalGameServer } from '../../game/server/LocalGameServer';
import { HostRoomController } from '../../game/multiplayer/HostRoomController';
import { MULTIPLAYER_SNAPSHOT_INTERVAL_MS, type GameDataTransport } from '../../game/multiplayer/transport';
import { RemoteGameClientPort, type RoomRemovalNotice } from '../../game/multiplayer/RemoteGameClientPort';
import type { RoomChatMessage } from '../../game/multiplayer/chat';
import type { RoomConnectionView } from '../../game/multiplayer/roomView';
import type { GameMode } from '../../game/multiplayer/types';
import type { RoomManagementStatus } from '../../game/multiplayer/roomManagement';
import { roomPanelVisibilityForReadiness, roomPanelVisibilityForStatus } from '../../game/multiplayer/roomPanelTransitions';
import { getRoomRuntimeMessage } from './roomMessages';

interface SessionLifecycleOptions {
  canvasRef: { current: HTMLCanvasElement | null };
  transport: GameDataTransport;
  role: 'host' | 'guest';
  mode: GameMode;
  displayName: string;
  appendChatMessage: (message: RoomChatMessage) => void;
  onRoomRemoved: (notice: RoomRemovalNotice) => void;
  setRoomPanelVisible: (visible: boolean) => void;
  setSyncStatus: Dispatch<SetStateAction<string>>;
  setRoomActionError: Dispatch<SetStateAction<string | null>>;
  setConnectionDegraded: Dispatch<SetStateAction<boolean>>;
  setSessionStable: Dispatch<SetStateAction<boolean>>;
  setDefeatNotice: Dispatch<SetStateAction<boolean>>;
  setRoomStatus: Dispatch<SetStateAction<RoomManagementStatus | null>>;
  setRoomRemovalNotice: Dispatch<SetStateAction<RoomRemovalNotice | null>>;
  setGameState: Dispatch<SetStateAction<GameSnapshot | null>>;
  roomStatusLifecycleRef: { current: RoomManagementStatus | null };
  sessionReadyRef: { current: boolean };
  hostProtocolRef: { current: HostRoomController | null };
  remoteClientRef: { current: RemoteGameClientPort | null };
  clientPortRef: { current: GameClientPort | null };
  rendererRef: { current: CanvasGameClient | null };
  chatOpenRef: { current: boolean };
}

export function useMultiplayerSessionLifecycle(options: SessionLifecycleOptions): void {
  const {
    canvasRef, transport, role, mode, displayName, appendChatMessage, onRoomRemoved,
    setRoomPanelVisible, setSyncStatus, setRoomActionError, setConnectionDegraded,
    setSessionStable, setDefeatNotice, setRoomStatus, setRoomRemovalNotice, setGameState,
    roomStatusLifecycleRef, sessionReadyRef, hostProtocolRef, remoteClientRef,
    clientPortRef, rendererRef, chatOpenRef
  } = options;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => resizeCanvasToDisplaySize(canvas);
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvas);
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('fullscreenchange', resizeCanvas);
    window.visualViewport?.addEventListener('resize', resizeCanvas);
    let server: LocalGameServer | null = null;
    let client: GameClientPort;
    let renderer: CanvasGameClient | null = null;
    let unsubscribeState: (() => void) | undefined;
    let stopHostProtocol: (() => void) | undefined;
    let unsubscribeHealth: (() => void) | undefined;
    let unsubscribeDefeat: (() => void) | undefined;
    let unsubscribeRoomRemoval: (() => void) | undefined;
    let unsubscribeChat: (() => void) | undefined;
    let unsubscribeReadiness: (() => void) | undefined;
    let unsubscribeRoomStatus: (() => void) | undefined;
    let hudRefreshTimer: number | null = null;
    roomStatusLifecycleRef.current = null;
    sessionReadyRef.current = role === 'host';
    setSessionStable(role === 'host');

    if (role === 'host') {
      server = new LocalGameServer();
      server.setMultiplayerMode(mode);
      server.setHumanParticipantDisplayName('player-host', displayName);
      client = server.connectClient({ clientId: 'room-host-local', role: 'controller' });
      clientPortRef.current = client;
      // The host protocol is isolated from React and PeerJS. Transport details
      // stay behind GameDataTransport and never enter authoritative command routing.
      const hostProtocol = new HostRoomController(server, transport, mode, () => {
        setSyncStatus('HOST AUTHORITY · REMOTE COMMANDER ACTIVE');
      }, displayName, appendChatMessage, (context, error) => {
        console.error('[multiplayer room] A background room operation failed.', { context, error });
        setRoomActionError(getRoomRuntimeMessage(context));
        setConnectionDegraded(true);
        setSyncStatus('ROOM NEEDS ATTENTION');
      });
      hostProtocolRef.current = hostProtocol;
      let latestFrame = server.getWorldFrame();
      let lastHudRevision = latestFrame.revision;
      let hostWorldActive = false;
      unsubscribeState = client.subscribeWorldFrames(frame => {
        // The local client only observes the host frame. The room controller owns
        // network publication, so rendering and replication never schedule each other.
        latestFrame = frame;
      });
      // Stop the controller before disconnecting its local client/server during
      // cleanup. Otherwise a stale 30 Hz timer can keep publishing a previous world.
      stopHostProtocol = () => hostProtocol.stop();
      hostProtocol.start();
      unsubscribeRoomStatus = hostProtocol.subscribeRoomStatus(status => {
        const previousStatus = roomStatusLifecycleRef.current;
        roomStatusLifecycleRef.current = status;
        setRoomStatus(status);
        const nextPanelVisibility = roomPanelVisibilityForStatus(previousStatus, status, 'host', true);
        if (nextPanelVisibility !== null) setRoomPanelVisible(nextPanelVisibility);
        if (!status.hasWorld) {
          hostWorldActive = false;
          setGameState(null);
          setSessionStable(true);
          setDefeatNotice(false);
          if (renderer) {
            const endedRenderer = renderer;
            renderer = null;
            rendererRef.current = null;
            endedRenderer.stop();
          }
          return;
        }

        hostWorldActive = true;
        const activeFrame = server!.getWorldFrame();
        latestFrame = activeFrame;
        lastHudRevision = activeFrame.revision;
        setGameState({ ...activeFrame.snapshot });
        if (!renderer) {
          renderer = new CanvasGameClient(canvas, client);
          rendererRef.current = renderer;
          renderer.mount();
          renderer.startRendering();
        }
      });
      hudRefreshTimer = window.setInterval(() => {
        if (!hostWorldActive || latestFrame.revision === lastHudRevision) return;
        setGameState({ ...latestFrame.snapshot });
        lastHudRevision = latestFrame.revision;
      }, MULTIPLAYER_SNAPSHOT_INTERVAL_MS);
      // The server may own an inert setup engine internally, but no room world is
      // published or rendered until startMatch() creates and announces one.
    } else {
      const remoteClient = new RemoteGameClientPort(transport, displayName);
      client = remoteClient;
      remoteClientRef.current = remoteClient;
      clientPortRef.current = client;
      unsubscribeChat = remoteClient.subscribeChat(appendChatMessage);
      unsubscribeRoomRemoval = remoteClient.subscribeRoomRemoval(notice => {
        setRoomRemovalNotice(notice);
        setRoomPanelVisible(false);
        onRoomRemoved(notice);
      });
      unsubscribeRoomStatus = remoteClient.subscribeRoomStatus(status => {
        const previousStatus = roomStatusLifecycleRef.current;
        roomStatusLifecycleRef.current = status;
        setRoomStatus(status);
        const ready = remoteClient.isSessionReady();
        const nextPanelVisibility = roomPanelVisibilityForStatus(previousStatus, status, 'guest', ready);
        if (nextPanelVisibility !== null) setRoomPanelVisible(nextPanelVisibility);
        if (!status.hasWorld) {
          sessionReadyRef.current = false;
          setGameState(null);
          setSessionStable(false);
          setDefeatNotice(false);
          if (renderer) {
            const endedRenderer = renderer;
            renderer = null;
            rendererRef.current = null;
            endedRenderer.stop();
          }
          return;
        }
        sessionReadyRef.current = ready;
        setSessionStable(ready);
      });
      unsubscribeReadiness = remoteClient.subscribeSessionReadiness(ready => {
        const previousReady = sessionReadyRef.current;
        sessionReadyRef.current = ready;
        setSessionStable(ready);
        // World-ended and world-handoff messages invalidate the render snapshot
        // before the following room-status packet arrives. Stop the old renderer
        // immediately so it cannot query a deliberately cleared replica in that gap.
        if (!ready && renderer) {
          const endedRenderer = renderer;
          renderer = null;
          rendererRef.current = null;
          endedRenderer.stop();
        }
        const nextPanelVisibility = roomPanelVisibilityForReadiness(previousReady, ready, remoteClient.getRoomStatus());
        if (nextPanelVisibility !== null) setRoomPanelVisible(nextPanelVisibility);
        // Do not start rendering after one frame alone: wait for the full snapshot
        // and one subsequent delta, proving the authoritative stream is progressing.
        if (ready && remoteClient.getRoomStatus()?.hasWorld && !renderer) {
          renderer = new CanvasGameClient(canvas, client);
          rendererRef.current = renderer;
          renderer.mount();
          renderer.startRendering();
        }
      });
      unsubscribeHealth = remoteClient.subscribeConnectionHealth((health, message) => {
        setConnectionDegraded(health === 'degraded');
        setSyncStatus(health === 'degraded' ? 'CONNECTION DEGRADED' : 'CONNECTED · HOST-AUTHORITATIVE');
        if (health === 'degraded' && message) console.error('[multiplayer UI] Host connection health degraded.', { message });
      });
      unsubscribeDefeat = remoteClient.subscribePlayerDefeated(() => { setDefeatNotice(true); setRoomPanelVisible(true); });
      unsubscribeState = client.subscribe(snapshot => {
        setGameState(snapshot);
        if (!snapshot.isGameOver) setDefeatNotice(false);
        setSyncStatus(current => current === 'CONNECTION DEGRADED' ? current : 'CONNECTED · HOST-AUTHORITATIVE');
      });
    }

    const reportRuntimeError = (event: Event) => {
      const error = event instanceof ErrorEvent
        ? event.error ?? new Error(event.message || 'Unknown browser runtime error.')
        : 'reason' in event ? (event as PromiseRejectionEvent).reason : event;
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // A single UI or transport exception must not automatically stop the
      // authoritative simulation and renderer. Controllers isolate their own
      // tick failures; any remaining unhandled error is surfaced loudly here.
      console.error('[multiplayer runtime] Unhandled runtime failure observed; room loops were not automatically stopped.', { event, error });
      setRoomActionError('An unexpected room issue occurred. The full diagnostic was saved to the browser console. Try again; if the problem continues, rejoin the room.');
      setConnectionDegraded(true);
      setSyncStatus('ROOM NEEDS ATTENTION');
      setRoomPanelVisible(true);
    };
    window.addEventListener('error', reportRuntimeError);
    window.addEventListener('unhandledrejection', reportRuntimeError);
    return () => {
      rendererRef.current = null;
      clientPortRef.current = null;
      hostProtocolRef.current = null;
      remoteClientRef.current = null;
      chatOpenRef.current = false;
      disposeResources('multiplayer teardown', [
        ['ResizeObserver', () => resizeObserver.disconnect()],
        ['window resize listener', () => window.removeEventListener('resize', resizeCanvas)],
        ['fullscreen listener', () => document.removeEventListener('fullscreenchange', resizeCanvas)],
        ['visual viewport listener', () => window.visualViewport?.removeEventListener('resize', resizeCanvas)],
        ['HUD refresh timer', () => { if (hudRefreshTimer !== null) window.clearInterval(hudRefreshTimer); }],
        ['runtime error listener', () => window.removeEventListener('error', reportRuntimeError)],
        ['unhandled rejection listener', () => window.removeEventListener('unhandledrejection', reportRuntimeError)],
        ['world-state subscription', () => unsubscribeState?.()],
        ['connection-health subscription', () => unsubscribeHealth?.()],
        ['defeat-notice subscription', () => unsubscribeDefeat?.()],
        ['room-removal notice subscription', () => unsubscribeRoomRemoval?.()],
        ['room-chat subscription', () => unsubscribeChat?.()],
        ['room-status subscription', () => unsubscribeRoomStatus?.()],
        ['session-readiness subscription', () => unsubscribeReadiness?.()],
        ['host room controller and publication timer', () => stopHostProtocol?.()],
        ['renderer', () => renderer?.stop()],
        ['room client', () => client.disconnect()],
        ['authoritative simulation server', () => server?.stop()]
      ]);
    };
  }, [transport, role, mode, displayName, appendChatMessage, onRoomRemoved, setRoomPanelVisible]);
}
