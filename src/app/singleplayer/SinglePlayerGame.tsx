import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HUD } from '../../components/HUD';
import { CanvasGameClient } from '../../game/client/CanvasGameClient';
import { disposeResources } from '../../game/lifecycle/disposeResources';
import { resizeCanvasToDisplaySize } from '../../game/client/canvasSizing';
import type { GameSnapshot, GameCommand, GameClientPort } from '../../game/server/protocol';
import { LocalGameServer } from '../../game/server/LocalGameServer';
import { BuildingType, DroneStationMode } from '../../game/types';
import { Shield } from 'lucide-react';
import { useGuidance } from '../../guidance/GuidanceProvider';
import { isTextEntryTarget, resolveEscapeAction } from '../../game/client/escapeRouting';
import { PauseMenu } from '../components/PauseMenu';
import { worldSaveStore, type LoadedWorld } from '../../game/persistence/WorldSaveStore';

export const SinglePlayerGame: React.FC<{ onExitToMenu: () => void; displayName: string; world: LoadedWorld }> = ({ onExitToMenu, displayName, world }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const serverRef = useRef<LocalGameServer | null>(null);
  const clientSessionRef = useRef<GameClientPort | null>(null);
  const clientRef = useRef<CanvasGameClient | null>(null);
  const pauseMenuOpenRef = useRef(false);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [gameState, setGameState] = useState<GameSnapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState('Autosave ready');
  const { activeGuide } = useGuidance();

  const saveNow = useCallback((): Promise<boolean> => {
    // Serialize writes so a slower IndexedDB operation can never overwrite a newer snapshot.
    const queuedSave = saveQueueRef.current.then(async () => {
      const server = serverRef.current;
      if (!server) return false;
      setSaveStatus('Saving world…');
      const savedAt = await worldSaveStore.saveSnapshot(world.metadata.id, world.metadata.worldSeed, server.getSnapshot(), server.getLoadedChunkKeys());
      setSaveStatus(`Saved ${new Date(savedAt).toLocaleTimeString()}`);
      return true;
    }).catch(reason => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setSaveStatus(`SAVE FAILED: ${message}`);
      console.error('[world storage] Autosave failed; the previous durable save was left untouched.', reason);
      return false;
    });
    saveQueueRef.current = queuedSave;
    return queuedSave;
  }, [world.metadata.id, world.metadata.worldSeed]);

  const setPaused = useCallback((paused: boolean) => {
    pauseMenuOpenRef.current = paused;
    setPauseMenuOpen(paused);
    clientRef.current?.setInputEnabled(!paused);
    if (paused) {
      serverRef.current?.stop();
      void saveNow();
    } else serverRef.current?.start();
  }, [saveNow]);
  const handleEscape = useCallback(() => setPaused(!pauseMenuOpenRef.current), [setPaused]);
  const handleContinue = useCallback(() => setPaused(false), [setPaused]);

  // The application owns Escape, not the renderer: this remains active regardless
  // of canvas focus and while no gameplay frame is currently being rendered.
  // When a guide is open, its overlay owns Escape so it can dismiss itself first.
  useEffect(() => {
    if (activeGuide) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      const action = resolveEscapeAction({
        surface: 'single-player',
        guideOpen: false,
        textEntryFocused: isTextEntryTarget(event.target),
        chatOpen: false,
        roomOpen: pauseMenuOpenRef.current,
        hasWorld: true
      });
      if (action !== 'toggle-single-player-pause') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handleEscape();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [activeGuide, handleEscape]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const resizeCanvas = () => resizeCanvasToDisplaySize(canvas);
    resizeCanvas();
    const resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvas);
    // A fullscreen transition can change viewport and device-pixel scale while
    // the CSS box remains effectively the same. Resize all three sources.
    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('fullscreenchange', resizeCanvas);
    window.visualViewport?.addEventListener('resize', resizeCanvas);

    const restoredWorld = world.state ? { snapshot: world.state.snapshot, activeChunkKeys: world.state.activeChunkKeys } : undefined;
    const server = new LocalGameServer(world.metadata.worldSeed, restoredWorld);
    if (!restoredWorld) server.setHumanParticipantDisplayName('player-host', displayName);
    const clientSession = server.connectClient({ clientId: 'single-player-local-client', role: 'controller' });
    const client = new CanvasGameClient(canvas, clientSession);
    serverRef.current = server;
    clientSessionRef.current = clientSession;
    clientRef.current = client;
    const unsubscribe = clientSession.subscribe(snapshot => setGameState({ ...snapshot }));

    client.mount();
    client.startRendering();
    server.start();
    canvas.focus();
    // New worlds receive an initial durable checkpoint before the first autosave interval.
    void saveNow();
    const autosaveHandle = window.setInterval(() => { void saveNow(); }, 10_000);
    const saveWhenHidden = () => { if (document.visibilityState === 'hidden') void saveNow(); };
    window.addEventListener('pagehide', saveWhenHidden);
    document.addEventListener('visibilitychange', saveWhenHidden);
    const stopOnRuntimeError = (event: Event) => {
      console.error('Uncaught single-player runtime failure; stopping the simulation.', event);
      client.stop();
      server.stop();
    };
    window.addEventListener('error', stopOnRuntimeError);
    window.addEventListener('unhandledrejection', stopOnRuntimeError);

    return () => {
      clientRef.current = null;
      clientSessionRef.current = null;
      serverRef.current = null;
      disposeResources('single-player teardown', [
        ['autosave interval', () => window.clearInterval(autosaveHandle)],
        ['pagehide autosave listener', () => window.removeEventListener('pagehide', saveWhenHidden)],
        ['visibility autosave listener', () => document.removeEventListener('visibilitychange', saveWhenHidden)],
        ['ResizeObserver', () => resizeObserver.disconnect()],
        ['window resize listener', () => window.removeEventListener('resize', resizeCanvas)],
        ['fullscreen listener', () => document.removeEventListener('fullscreenchange', resizeCanvas)],
        ['visual viewport listener', () => window.visualViewport?.removeEventListener('resize', resizeCanvas)],
        ['runtime error listener', () => window.removeEventListener('error', stopOnRuntimeError)],
        ['unhandled rejection listener', () => window.removeEventListener('unhandledrejection', stopOnRuntimeError)],
        ['snapshot subscription', unsubscribe],
        ['renderer', () => client.stop()],
        ['client session', () => clientSession.disconnect()],
        ['simulation server', () => server.stop()]
      ]);
    };
  }, [displayName, saveNow, world]);

  const dispatch = useCallback((command: GameCommand) => {
    clientSessionRef.current?.dispatch(command);
    const snapshot = clientSessionRef.current?.getSnapshot();
    if (snapshot) setGameState({ ...snapshot });
  }, []);

  const handleSelectBuilding = useCallback((type: BuildingType | null) => {
    dispatch({ type: 'SELECT_BUILDING', buildingType: type });
  }, [dispatch]);
  const handleSetDroneMode = useCallback((stationId: string, mode: DroneStationMode) => {
    dispatch({ type: 'SET_DRONE_MODE', stationId, mode });
  }, [dispatch]);
  const handleRepair = useCallback((buildingId: string) => {
    dispatch({ type: 'REPAIR_NEARBY', buildingId });
  }, [dispatch]);
  const handleDismantle = useCallback((buildingId: string) => {
    dispatch({ type: 'DISMANTLE_NEARBY', buildingId });
  }, [dispatch]);
  const handleRestart = useCallback(() => dispatch({ type: 'RESTART' }), [dispatch]);
  const handleExitToWorldSelect = useCallback(async () => {
    const saved = await saveNow();
    if (!saved) {
      pauseMenuOpenRef.current = true;
      setPauseMenuOpen(true);
      clientRef.current?.setInputEnabled(false);
      serverRef.current?.stop();
      return;
    }
    onExitToMenu();
  }, [onExitToMenu, saveNow]);

  return (
    <main className="relative h-[100dvh] w-[100dvw] overflow-hidden bg-[#0a0e17] select-none" data-testid="game-container">
      <canvas ref={canvasRef} tabIndex={0} className="block h-full w-full touch-none outline-none" data-testid="game-canvas" />
      {gameState && (
        <HUD
          state={gameState}
          onSelectBuilding={handleSelectBuilding}
          onSetDroneMode={handleSetDroneMode}
          onRepair={handleRepair}
          onDismantle={handleDismantle}
          onRestart={handleRestart}
        />
      )}
      <div className="pointer-events-none fixed bottom-2 left-2 z-[80] max-w-[min(85vw,28rem)] border border-slate-700/60 bg-slate-950/75 px-2 py-1 font-mono text-[9px] text-slate-400" role="status" aria-live="polite">WORLD SAVE · {saveStatus}</div>
      {pauseMenuOpen && <PauseMenu onContinue={handleContinue} onExit={() => { void handleExitToWorldSelect(); }} saveStatus={saveStatus} />}
    </main>
  );
};
