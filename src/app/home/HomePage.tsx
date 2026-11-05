import React from 'react';
import { Activity, Cpu, Play, Shield, Dices, BookOpen } from 'lucide-react';
import { useGuidance } from '../../guidance/GuidanceProvider';
import { MultiplayerLobby } from '../multiplayer/MultiplayerLobby';

export const HomePage: React.FC<{ onStartSinglePlayer: () => void; displayName: string; onDisplayNameChange: (value: string) => void; onRandomizeName: () => void; onResolveDisplayName: () => string }> = ({ onStartSinglePlayer, displayName, onDisplayNameChange, onRandomizeName, onResolveDisplayName }) => {
  const { startGuide } = useGuidance();
  return (
  <main className="cb-home min-h-screen w-screen overflow-hidden">
    <div className="cb-home-scanlines" aria-hidden="true" />
    <div className="cb-home-corner cb-home-corner-tl" aria-hidden="true" />
    <div className="cb-home-corner cb-home-corner-br" aria-hidden="true" />
    <section className="cb-home-main cb-home-main-expanded">
      <div className="cb-home-mark"><Cpu size={17} /><span>TACTICAL SYSTEMS / 01</span><Activity size={15} /></div>
      <div className="cb-home-emblem" aria-hidden="true"><Shield size={42} strokeWidth={1.15} /></div>
      <p className="cb-home-kicker">AUTONOMOUS SURVIVAL PROTOCOL</p>
      <h1 data-guide-target="home-title">CRAFTBOUND<span>:</span><br />SURVIVAL OUTPOST</h1>
      <div className="cb-home-divider"><span /><i /><span /></div>
      <p className="cb-home-copy">Build. Automate. Hold the perimeter.</p>
      <div className="mx-auto mb-3 flex w-full max-w-sm items-center gap-2 border border-cyan-300/20 bg-slate-950/55 p-2">
        <label htmlFor="cb-player-name" className="shrink-0 text-[9px] font-bold tracking-[0.12em] text-cyan-300">CALLSIGN</label>
        <input id="cb-player-name" data-guide-target="home-callsign" value={displayName} onChange={event => onDisplayNameChange(event.target.value.slice(0, 24))} maxLength={24} autoComplete="nickname" placeholder="RANDOM ROBOT NAME IF BLANK" className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500" />
        <button type="button" onClick={onRandomizeName} title="Generate a random robot callsign" aria-label="Generate random robot name" className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-700 text-cyan-200 hover:border-cyan-300/50"><Dices size={15} /></button>
      </div>
      <button type="button" data-guide-target="home-single-player" className="cb-single-player-button" onClick={onStartSinglePlayer} title="Start single-player. Press Enter or Space only when this button is focused.">
        <Play size={16} fill="currentColor" /><span>SINGLE PLAYER</span><kbd>START</kbd>
      </button>
      <MultiplayerLobby displayName={displayName} onResolveDisplayName={onResolveDisplayName} />
      <p className="cb-home-build">LOCAL AUTHORITY · BUILD 1.16.56</p>
    </section>
    <footer className="cb-home-footer">
      <span>OUTPOST COMMAND NETWORK</span>
      <button type="button" onClick={() => startGuide('first-visit')} className="inline-flex items-center gap-1 text-[9px] font-bold tracking-[0.12em] text-cyan-200 hover:text-white" aria-label="Open the interactive guide">
        <BookOpen size={12} /> HELP / GUIDE
      </button>
      <span>ALL SYSTEMS NOMINAL</span>
    </footer>
  </main>
  );
};
