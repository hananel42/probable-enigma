import type { GameClientPort, GameSnapshot } from '../server/protocol';
import { CanvasGameRenderer } from './CanvasGameRenderer';
import { BuildingType } from '../types';
import { measurePerformance, recordPerformanceSample } from '../performance/PerformanceDiagnostics';

const MOVEMENT_AND_HOLD_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'KeyF', 'KeyJ'
]);
const ACTION_KEYS = new Set([
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Escape',
  'KeyR', 'KeyQ', 'KeyE', 'KeyC', 'KeyX', 'Space', 'Enter'
]);

/** Browser client: converts local keyboard/pointer input into semantic commands and paints snapshots. */
export class CanvasGameClient {
  private readonly renderer: CanvasGameRenderer;
  private frameId: number | null = null;
  private mounted = false;
  private lastRenderedSnapshot: GameSnapshot | null = null;
  private lastAimDispatchMs = 0;
  private lastRenderStartedAtMs: number | null = null;
  private pendingAim: { worldX: number; worldY: number } | null = null;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;
  private inputEnabled = true;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly server: GameClientPort,
  ) {
    this.renderer = new CanvasGameRenderer(canvas);
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('focus', this.handleWindowFocus);
    window.addEventListener('resize', this.handleViewportResize);
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    // The multiplayer guest mounts only after the first authoritative frame, so
    // it must establish keyboard focus here just like the single-player client.
    this.canvas.focus({ preventScroll: true });
  }

  startRendering(): void {
    if (this.frameId !== null) return;
    const drawFrame = () => {
      this.frameId = null;
      // Fail fast: do not schedule another frame until the current frame has
      // completed successfully. Exceptions remain uncaught so DevTools shows
      // the original stack trace instead of silently continuing with a broken frame.
      const frameStartedAtMs = performance.now();
      if (this.lastRenderStartedAtMs !== null) {
        recordPerformanceSample('client.renderFrameInterval', frameStartedAtMs - this.lastRenderStartedAtMs);
      }
      this.lastRenderStartedAtMs = frameStartedAtMs;
      const renderSnapshot = measurePerformance('client.snapshotRead', () =>
        this.server.getRenderSnapshot?.() ?? this.server.getSnapshot()
      );
      this.lastRenderedSnapshot = renderSnapshot;
      measurePerformance('client.canvasDraw', () => this.renderer.draw(renderSnapshot), {
        entityCount: renderSnapshot.entities.length,
        buildingCount: renderSnapshot.buildings.length,
        resourceNodeCount: renderSnapshot.resourceNodes.length,
        projectileCount: renderSnapshot.projectiles.length,
        particleCount: renderSnapshot.particles.length
      });
      recordPerformanceSample('client.frameTotal', performance.now() - frameStartedAtMs, {
        entityCount: renderSnapshot.entities.length,
        buildingCount: renderSnapshot.buildings.length
      });
      this.frameId = requestAnimationFrame(drawFrame);
    };
    this.frameId = requestAnimationFrame(drawFrame);
  }

  stop(): void {
    // Teardown is not a gameplay event. In particular, a multiplayer world may
    // already have been cleared by the host before React disposes this renderer;
    // sending key-up/pointer-up commands then would incorrectly look like a
    // protocol violation and could tear down the persistent room connection.
    this.inputEnabled = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    if (this.mounted) {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('mouseup', this.handleMouseUp);
      this.canvas.removeEventListener('mousemove', this.handleMouseMove);
      this.canvas.removeEventListener('mousedown', this.handleMouseDown);
      this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
      window.removeEventListener('blur', this.handleWindowBlur);
      window.removeEventListener('focus', this.handleWindowFocus);
      window.removeEventListener('resize', this.handleViewportResize);
      document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
      this.mounted = false;
    }
    this.releaseHeldKeys(false);
    if (this.aimTimer) clearTimeout(this.aimTimer);
    this.aimTimer = null;
    this.pendingAim = null;
    this.lastRenderedSnapshot = null;
    this.lastRenderStartedAtMs = null;
  }

  private focusCanvas(): void {
    this.canvas.focus({ preventScroll: true });
  }

  private handleWindowFocus = () => {
    if (!this.inputEnabled) return;
    const activeElement = document.activeElement;
    // Don't steal keyboard focus from an actual HUD button, but recover focus if
    // the browser returns to body/document after entering or leaving fullscreen.
    if (activeElement === document.body || activeElement === document.documentElement || activeElement === this.canvas) {
      this.focusCanvas();
    }
  };

  private handleFullscreenChange = () => {
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && (fullscreenElement === this.canvas || fullscreenElement.contains(this.canvas))) {
      this.focusCanvas();
      return;
    }
    // Browsers' native F11 fullscreen does not necessarily emit
    // `fullscreenchange`; let the viewport path restore safe canvas focus.
    this.handleViewportResize();
  };

  private handleViewportResize = () => {
    if (!this.inputEnabled) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      const isTextEntry = activeElement.matches('input, textarea, select, [contenteditable="true"]') || activeElement.isContentEditable;
      const isOtherControl = activeElement !== this.canvas && activeElement.matches('button, a, [role="button"], [tabindex]:not([tabindex="-1"])');
      if (isTextEntry || isOtherControl) return;
    }
    if (activeElement === document.body || activeElement === document.documentElement || activeElement === this.canvas || activeElement instanceof HTMLDivElement) {
      this.focusCanvas();
    }
  };

  private pointerToWorld(event: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    // Use the camera from the last presented frame. Calling getRenderSnapshot()
    // here would advance local prediction from pointer events as well as RAF.
    const snapshot = this.lastRenderedSnapshot ?? this.server.getSnapshot();
    const camera = snapshot.camera;
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return {
      worldX: camera.x + (screenX - rect.width / 2) / Math.max(0.25, camera.zoom),
      worldY: camera.y + (screenY - rect.height / 2) / Math.max(0.25, camera.zoom)
    };
  }

  private handleMouseMove = (event: MouseEvent) => {
    if (!this.inputEnabled) return;
    this.pendingAim = this.pointerToWorld(event);
    this.server.setPredictedAimPoint?.(this.pendingAim.worldX, this.pendingAim.worldY);
    const now = performance.now();
    const elapsed = now - this.lastAimDispatchMs;
    if (elapsed >= 1000 / 30) {
      this.flushAim();
      return;
    }
    if (!this.aimTimer) {
      this.aimTimer = setTimeout(() => { this.aimTimer = null; this.flushAim(); }, Math.max(0, 1000 / 30 - elapsed));
    }
  };

  private flushAim() {
    if (!this.pendingAim || !this.mounted) return;
    const point = this.pendingAim;
    this.pendingAim = null;
    this.lastAimDispatchMs = performance.now();
    this.server.dispatch({ type: 'AIM_AT', ...point });
  }

  private handleMouseDown = (event: MouseEvent) => {
    if (!this.inputEnabled || (event.button !== 0 && event.button !== 2)) return;
    this.focusCanvas();
    event.preventDefault();
    const point = this.pointerToWorld(event);
    this.server.dispatch({ type: 'POINTER_DOWN', button: event.button, ...point });
  };

  private handleMouseUp = (event: MouseEvent) => {
    if (event.button === 0 || event.button === 2) {
      this.server.dispatch({ type: 'POINTER_UP', button: event.button });
    }
  };

  private handleContextMenu = (event: MouseEvent) => event.preventDefault();

  private handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
    const code = event.code;
    // Escape is owned by the application shell so it works even while no renderer
    // is mounted. Keep a defensive default-prevention here, but do not navigate or
    // dispatch a gameplay command from the renderer itself.
    if (code === 'Escape') {
      event.preventDefault();
      return;
    }
    if (!this.inputEnabled) return;
    if (MOVEMENT_AND_HOLD_KEYS.has(code)) {
      this.server.setPredictedInputKey?.(code, true);
      this.server.dispatch({ type: 'SET_INPUT_KEY', code, pressed: true });
      if (code.startsWith('Arrow') || code === 'Space') event.preventDefault();
    }
    if (event.repeat || !ACTION_KEYS.has(code)) return;

    const buildHotkeys: Record<string, Exclude<BuildingType, 'CORE'>> = {
      Digit1: 'WALL', Digit2: 'AUTO_TURRET', Digit3: 'HARVESTER_STATION',
      Digit4: 'DRONE_STATION', Digit5: 'FIRE_TOWER'
    };
    const building = buildHotkeys[code];
    if (building) this.server.dispatch({ type: 'SELECT_BUILDING', buildingType: building });
    else if (code === 'KeyR') this.server.dispatch({ type: 'REPAIR_NEARBY' });
    else if (code === 'KeyQ' || code === 'KeyE') this.server.dispatch({ type: 'UPGRADE_NEARBY', key: code === 'KeyQ' ? 'Q' : 'E' });
    else if (code === 'KeyC') this.server.dispatch({ type: 'TOGGLE_DRONE_MODE' });
    else if (code === 'KeyX') this.server.dispatch({ type: 'DISMANTLE_NEARBY' });
    else if ((code === 'Space' || code === 'Enter') && this.server.getSnapshot().selectedBuildingType) {
      this.server.dispatch({ type: 'PLACE_SELECTED_BUILDING' });
      event.preventDefault();
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return;
    if (MOVEMENT_AND_HOLD_KEYS.has(event.code)) {
      this.server.setPredictedInputKey?.(event.code, false);
      this.server.dispatch({ type: 'SET_INPUT_KEY', code: event.code, pressed: false });
    }
  };

  /** Enable/disable gameplay controls while keeping rendering and (in multiplayer) world sync alive. */
  public setInputEnabled(enabled: boolean): void {
    if (this.inputEnabled === enabled) return;
    this.inputEnabled = enabled;
    if (!enabled) {
      this.releaseHeldKeys();
      if (this.aimTimer) clearTimeout(this.aimTimer);
      this.aimTimer = null;
      this.pendingAim = null;
    }
  }

  /** Release persistent movement/fire inputs without changing pause state. */
  public releaseAllInput(): void {
    this.releaseHeldKeys();
  }

  private handleWindowBlur = () => this.releaseHeldKeys();

  private releaseHeldKeys = (dispatchCommands = true) => {
    // During ordinary blur/menu transitions, release held controls in the game.
    // During teardown, the renderer may outlive its world by a few milliseconds;
    // do not dispatch into a replica that the authority has already cleared.
    if (!dispatchCommands) return;
    for (const code of MOVEMENT_AND_HOLD_KEYS) {
      this.server.setPredictedInputKey?.(code, false);
      this.server.dispatch({ type: 'SET_INPUT_KEY', code, pressed: false });
    }
    this.server.dispatch({ type: 'POINTER_UP', button: 0 });
  };
}
