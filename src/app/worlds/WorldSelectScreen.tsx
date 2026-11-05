import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, FileUp, HardDrive, Pencil, Play, Plus, RefreshCw, Shield, Trash2, X } from 'lucide-react';
import { createWorldSeed } from '../../game/world';
import { createWorldExport, MAX_WORLD_IMPORT_BYTES, parseWorldExport } from '../../game/persistence/worldSaveCodec';
import { worldSaveStore, type LoadedWorld, type WorldMetadata } from '../../game/persistence/WorldSaveStore';

interface WorldSelectScreenProps {
  onEnterWorld: (world: LoadedWorld) => void;
  onBackToHome: () => void;
}

function describeDate(timestamp: number | null): string {
  if (timestamp === null) return 'NOT PLAYED YET';
  return new Date(timestamp).toLocaleString();
}

function safeFileName(name: string): string {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (!value) throw new TypeError('World name cannot be converted to an export file name.');
  return value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Local single-player world library. Metadata is loaded separately from world snapshots. */
export const WorldSelectScreen: React.FC<WorldSelectScreenProps> = ({ onEnterWorld, onBackToHome }) => {
  const [worlds, setWorlds] = useState<WorldMetadata[]>([]);
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null);
  const [newWorldName, setNewWorldName] = useState('New World');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(false);
  const selectedWorld = worlds.find(world => world.id === selectedWorldId) ?? null;

  const refreshWorlds = useCallback(async (preferredId?: string) => {
    const nextWorlds = await worldSaveStore.listWorlds();
    setWorlds(nextWorlds);
    setSelectedWorldId(current => {
      if (preferredId && nextWorlds.some(world => world.id === preferredId)) return preferredId;
      if (current && nextWorlds.some(world => world.id === current)) return current;
      return nextWorlds[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    setLoading(true);
    void worldSaveStore.listWorlds().then(nextWorlds => {
      if (!active) return;
      setWorlds(nextWorlds);
      setSelectedWorldId(current => current && nextWorlds.some(world => world.id === current) ? current : nextWorlds[0]?.id ?? null);
      setError(null);
    }).catch(reason => {
      if (active) setError(errorText(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; mountedRef.current = false; };
  }, []);

  const perform = useCallback(async (action: () => Promise<boolean | void>) => {
    if (mountedRef.current) {
      setBusy(true);
      setError(null);
      setNotice(null);
    }
    let navigatedAway = false;
    try {
      navigatedAway = (await action()) === true;
    } catch (reason) {
      const message = errorText(reason);
      if (mountedRef.current) setError(message);
      console.error('[world storage] Action failed.', reason);
    } finally {
      if (!navigatedAway && mountedRef.current) setBusy(false);
    }
  }, []);

  const createWorld = () => perform(async () => {
    const metadata = await worldSaveStore.createWorld(newWorldName, createWorldSeed());
    const loaded = await worldSaveStore.loadWorld(metadata.id);
    onEnterWorld(loaded);
    return true;
  });

  const enterSelectedWorld = () => {
    if (!selectedWorld) return;
    void perform(async () => {
      onEnterWorld(await worldSaveStore.loadWorld(selectedWorld.id));
      return true;
    });
  };

  const duplicateSelectedWorld = () => {
    if (!selectedWorld) return;
    void perform(async () => {
      const duplicate = await worldSaveStore.duplicateWorld(selectedWorld.id);
      await refreshWorlds(duplicate.id);
      setNotice(`Created '${duplicate.name}'.`);
    });
  };

  const deleteSelectedWorld = () => {
    if (!selectedWorld) return;
    if (!window.confirm(`Delete '${selectedWorld.name}' and its local save? This cannot be undone.`)) return;
    void perform(async () => {
      await worldSaveStore.deleteWorld(selectedWorld.id);
      await refreshWorlds();
      setRenaming(false);
      setNotice(`Deleted '${selectedWorld.name}'.`);
    });
  };

  const beginRename = () => {
    if (!selectedWorld) return;
    setRenameValue(selectedWorld.name);
    setRenaming(true);
    setError(null);
    setNotice(null);
  };

  const commitRename = () => {
    if (!selectedWorld) return;
    void perform(async () => {
      const renamed = await worldSaveStore.renameWorld(selectedWorld.id, renameValue);
      await refreshWorlds(renamed.id);
      setRenaming(false);
      setNotice(`Renamed world to '${renamed.name}'.`);
    });
  };

  const exportSelectedWorld = () => {
    if (!selectedWorld) return;
    void perform(async () => {
      const loaded = await worldSaveStore.getWorld(selectedWorld.id);
      if (!loaded.state) throw new Error('This world has no saved state yet. Enter it once before exporting.');
      const { worldId: _worldId, ...state } = loaded.state;
      const document = createWorldExport({ worldName: loaded.metadata.name, worldSeed: loaded.metadata.worldSeed, state });
      const exportText = JSON.stringify(document);
      const blob = new Blob([exportText], { type: 'application/json' });
      if (blob.size > MAX_WORLD_IMPORT_BYTES) throw new RangeError(`This world export is ${Math.ceil(blob.size / (1024 * 1024))} MiB, above the ${Math.round(MAX_WORLD_IMPORT_BYTES / (1024 * 1024))} MiB supported file limit.`);
      const objectUrl = URL.createObjectURL(blob);
      try {
        const anchor = window.document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `${safeFileName(loaded.metadata.name)}.craftbound-world.json`;
        anchor.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      setNotice(`Exported '${loaded.metadata.name}'.`);
      await refreshWorlds(loaded.metadata.id);
    });
  };

  const importSelectedFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    void perform(async () => {
      if (file.size > MAX_WORLD_IMPORT_BYTES) throw new RangeError(`World import exceeds the ${Math.round(MAX_WORLD_IMPORT_BYTES / (1024 * 1024))} MiB file limit.`);
      const document = parseWorldExport(await file.text());
      const imported = await worldSaveStore.importWorld(document);
      await refreshWorlds(imported.id);
      setNotice(`Imported '${imported.name}'. Select it and choose Enter World.`);
    });
  };

  return (
    <main className="cb-home min-h-[100dvh] w-screen overflow-y-auto px-4 py-8 sm:px-8" data-testid="world-select-screen">
      <div className="cb-home-scanlines" aria-hidden="true" />
      <div className="cb-home-corner cb-home-corner-tl" aria-hidden="true" />
      <div className="cb-home-corner cb-home-corner-br" aria-hidden="true" />
      <section className="relative mx-auto w-full max-w-4xl py-3 sm:py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-cyan-300/20 pb-5">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-cyan-300"><Shield size={14} /> SINGLE PLAYER / LOCAL ARCHIVE</div>
            <h1 className="text-2xl font-bold tracking-[0.1em] text-slate-100 sm:text-3xl">WORLD SELECT</h1>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-slate-400">Worlds are stored in this browser. Autosaves include the simulation state but omit short-lived visual effects and in-flight projectiles.</p>
          </div>
          <button type="button" onClick={onBackToHome} disabled={busy} className="flex min-h-10 items-center gap-2 border border-slate-700 px-3 text-[10px] font-bold tracking-[0.1em] text-slate-300 hover:border-cyan-300/50 disabled:opacity-50"><ArrowLeft size={14} /> MAIN MENU</button>
        </header>

        <section className="mb-5 grid gap-3 border border-cyan-300/20 bg-slate-950/70 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-left">
            <span className="mb-2 block font-mono text-[9px] tracking-[0.15em] text-slate-400">NEW WORLD NAME</span>
            <input value={newWorldName} onChange={event => setNewWorldName(event.target.value.slice(0, 48))} maxLength={48} className="h-10 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60" placeholder="New World" disabled={busy} />
          </label>
          <button type="button" onClick={() => void createWorld()} disabled={busy || loading || !newWorldName.trim()} className="flex min-h-10 items-center justify-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-5 font-mono text-[10px] font-bold tracking-[0.1em] text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-50"><Plus size={15} /> CREATE WORLD</button>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)]">
          <section className="min-w-0 border border-slate-700/80 bg-slate-950/55 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-mono text-[10px] font-bold tracking-[0.15em] text-slate-300">SAVED WORLDS <span className="ml-2 text-slate-500">{worlds.length}</span></h2><button type="button" onClick={() => void perform(async () => { await refreshWorlds(selectedWorldId ?? undefined); setNotice('World list refreshed.'); })} disabled={busy || loading} className="p-2 text-slate-400 hover:text-cyan-200 disabled:opacity-50" aria-label="Refresh world list" title="Refresh world list"><RefreshCw size={14} /></button></div>
            {loading ? <p className="px-3 py-8 text-center text-xs text-slate-500">Loading local world metadata…</p> : worlds.length === 0 ? <div className="px-4 py-10 text-center"><HardDrive size={26} className="mx-auto mb-3 text-slate-600" /><p className="text-sm text-slate-300">No worlds saved in this browser.</p><p className="mt-2 text-xs text-slate-500">Create a world or import a save file.</p></div> : (
              <div className="max-h-[46dvh] space-y-2 overflow-y-auto pr-1 sm:max-h-[52dvh]">
                {worlds.map(world => {
                  const selected = world.id === selectedWorldId;
                  return <button type="button" key={world.id} onClick={() => { setSelectedWorldId(world.id); setRenaming(false); setError(null); setNotice(null); }} aria-pressed={selected} className={`block w-full border p-3 text-left transition-colors ${selected ? 'border-cyan-300/60 bg-cyan-300/[0.08]' : 'border-slate-800 bg-slate-950/65 hover:border-slate-600'}`}>
                    <span className="flex items-center justify-between gap-3"><strong className={`truncate text-sm ${selected ? 'text-cyan-100' : 'text-slate-200'}`}>{world.name}</strong><span className="shrink-0 font-mono text-[8px] tracking-[0.08em] text-slate-500">{selected ? 'SELECTED' : 'LOCAL'}</span></span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-slate-500"><span>SEED {world.worldSeed}</span><span>UPDATED {describeDate(world.updatedAtMs)}</span><span>LAST PLAYED {describeDate(world.lastPlayedAtMs)}</span></span>
                  </button>;
                })}
              </div>
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-3 border border-slate-700/80 bg-slate-950/55 p-3 sm:p-4">
            <h2 className="font-mono text-[10px] font-bold tracking-[0.15em] text-slate-300">WORLD ACTIONS</h2>
            {renaming && selectedWorld ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); commitRename(); }}>
              <label className="block text-left"><span className="mb-2 block font-mono text-[9px] text-slate-500">RENAME WORLD</span><input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value.slice(0, 48))} maxLength={48} className="h-10 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-cyan-300/60" /></label>
              <div className="grid grid-cols-2 gap-2"><button type="submit" disabled={busy || !renameValue.trim()} className="min-h-9 border border-cyan-300/40 text-[10px] font-bold text-cyan-100 disabled:opacity-50">SAVE NAME</button><button type="button" onClick={() => setRenaming(false)} className="flex min-h-9 items-center justify-center gap-1 border border-slate-700 text-[10px] text-slate-300"><X size={12} /> CANCEL</button></div>
            </form> : <button type="button" onClick={enterSelectedWorld} disabled={busy || loading || !selectedWorld} className="flex min-h-11 items-center justify-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-3 font-mono text-[10px] font-bold tracking-[0.1em] text-cyan-100 hover:bg-cyan-300/20 disabled:opacity-40"><Play size={14} fill="currentColor" /> ENTER WORLD</button>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={duplicateSelectedWorld} disabled={busy || !selectedWorld} className="flex min-h-10 items-center justify-center gap-2 border border-slate-700 px-2 text-[9px] font-bold tracking-[0.06em] text-slate-300 hover:border-cyan-300/40 disabled:opacity-40"><Copy size={13} /> DUPLICATE</button>
              <button type="button" onClick={beginRename} disabled={busy || !selectedWorld || renaming} className="flex min-h-10 items-center justify-center gap-2 border border-slate-700 px-2 text-[9px] font-bold tracking-[0.06em] text-slate-300 hover:border-cyan-300/40 disabled:opacity-40"><Pencil size={13} /> RENAME</button>
              <button type="button" onClick={exportSelectedWorld} disabled={busy || !selectedWorld} className="flex min-h-10 items-center justify-center gap-2 border border-slate-700 px-2 text-[9px] font-bold tracking-[0.06em] text-slate-300 hover:border-cyan-300/40 disabled:opacity-40"><Download size={13} /> EXPORT</button>
              <button type="button" onClick={() => importInputRef.current?.click()} disabled={busy || loading} className="flex min-h-10 items-center justify-center gap-2 border border-slate-700 px-2 text-[9px] font-bold tracking-[0.06em] text-slate-300 hover:border-cyan-300/40 disabled:opacity-40"><FileUp size={13} /> IMPORT</button>
              <button type="button" onClick={deleteSelectedWorld} disabled={busy || !selectedWorld} className="col-span-2 flex min-h-10 items-center justify-center gap-2 border border-rose-400/30 bg-rose-400/[0.04] px-2 text-[9px] font-bold tracking-[0.08em] text-rose-200 hover:border-rose-300/60 hover:bg-rose-400/10 disabled:opacity-40"><Trash2 size={13} /> DELETE WORLD</button>
            </div>
            <input ref={importInputRef} type="file" accept=".json,.craftbound-world.json,application/json" onChange={importSelectedFile} className="hidden" aria-label="Import a world save file" />
            <p className="mt-auto border-t border-slate-800 pt-3 text-[10px] leading-relaxed text-slate-500">Local worlds are stored in IndexedDB. Export important worlds for backup; browser storage can be cleared by the browser or the user.</p>
          </aside>
        </div>
        {(busy || notice || error) && <div role="status" aria-live="polite" className={`mt-4 border px-3 py-2 text-xs ${error ? 'border-rose-400/40 bg-rose-400/[0.06] text-rose-200' : 'border-cyan-300/20 bg-slate-950/65 text-cyan-100'}`}>
          {busy ? <span className="inline-flex items-center gap-2"><RefreshCw size={13} className="animate-spin" /> Working with local world storage…</span> : error ?? notice}
          {error && <p className="mt-1 text-[10px] text-rose-200/70">No data was silently substituted. Resolve the storage or file error and retry.</p>}
        </div>}
        <p className="mt-5 text-center font-mono text-[8px] tracking-[0.16em] text-slate-600">LOCAL AUTHORITY · NO SERVER REQUIRED FOR SINGLE PLAYER</p>
      </section>
    </main>
  );
};
