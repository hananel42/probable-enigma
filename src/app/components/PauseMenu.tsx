import React from 'react';
import { Play, Shield, ArrowLeft } from 'lucide-react';

interface PauseMenuProps {
  onContinue: () => void;
  onExit: () => void;
  saveStatus: string;
}

/** Single-player pause menu. Multiplayer navigation is handled by room management instead. */
export const PauseMenu: React.FC<PauseMenuProps> = ({ onContinue, onExit, saveStatus }) => (
  <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm pointer-events-auto" role="dialog" aria-modal="true" aria-labelledby="pause-menu-title" data-testid="pause-menu">
    <section className="w-full max-w-sm border border-cyan-300/30 bg-slate-950/95 p-5 shadow-2xl shadow-black/50">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-cyan-300">
        <Shield size={14} /> OUTPOST COMMAND
      </div>
      <h2 id="pause-menu-title" className="text-lg font-bold tracking-[0.12em] text-slate-100">SIMULATION PAUSED</h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">Simulation time, combat, movement, and production are suspended.</p>
      <p className={`mt-3 break-words border border-slate-800 bg-slate-900/50 px-2 py-2 font-mono text-[9px] ${saveStatus.startsWith('SAVE FAILED:') ? 'text-rose-300' : 'text-slate-400'}`} role="status" aria-live="polite">WORLD SAVE · {saveStatus}</p>
      <div className="mt-5 grid grid-cols-1 gap-2">
        <button type="button" onClick={onContinue} className="flex min-h-10 items-center justify-center gap-2 border border-cyan-300/50 bg-cyan-300/10 px-3 text-xs font-bold tracking-[0.12em] text-cyan-100 hover:bg-cyan-300/20">
          <Play size={14} fill="currentColor" /> RESUME GAME
        </button>
        <button type="button" onClick={onExit} className="flex min-h-10 items-center justify-center gap-2 border border-rose-300/35 bg-rose-300/5 px-3 text-xs font-bold tracking-[0.12em] text-rose-200 hover:bg-rose-300/15">
          <ArrowLeft size={14} /> WORLD SELECT
        </button>
      </div>
      <div className="mt-4 border-t border-slate-800 pt-3 text-center text-[9px] tracking-[0.12em] text-slate-500">ESC · RESUME / CLOSE MENU</div>
    </section>
  </div>
);
