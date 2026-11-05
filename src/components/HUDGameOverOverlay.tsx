import React from 'react';
import { Activity, RotateCcw } from 'lucide-react';

interface HUDGameOverOverlayProps {
  visible: boolean;
  survivalTime: number;
  destroyedBaseCount: number;
  message: string;
  allowRestart: boolean;
  onRestart: () => void;
}

export const HUDGameOverOverlay: React.FC<HUDGameOverOverlayProps> = ({
  visible, survivalTime, destroyedBaseCount, message, allowRestart, onRestart
}) => {
  if (!visible) return null;
  return (
    <div className="hud-game-over fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-auto">
      <div className="hud-game-over-console">
        <div className="hud-game-over-kicker"><Activity className="h-4 w-4" /> CRITICAL SYSTEM FAILURE</div>
        <h2>OUTPOST CORE DESTROYED</h2>
        <p>{message}</p>
        <div className="hud-game-over-data">
          <div><span>SURVIVAL TIME</span><b>{Math.floor(survivalTime)}s</b></div>
          <div><span>HOSTILE BASES CLEARED</span><b>{destroyedBaseCount}</b></div>
        </div>
        {allowRestart && <button onClick={onRestart} className="hud-restart-button"><RotateCcw className="h-4 w-4" /> REDEPLOY OUTPOST</button>}
      </div>
    </div>
  );
};
