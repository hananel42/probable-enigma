import type { GameEngineState } from '../engine/model';
import {
  createPersistableSnapshot,
  validatePersistedWorldState,
  WORLD_SAVE_SCHEMA_VERSION,
  type PersistedWorldState,
  type WorldExportDocument
} from './worldSaveCodec';

const DATABASE_NAME = 'craftbound-survival-outpost-local-worlds';
const DATABASE_VERSION = 1;
const WORLD_METADATA_STORE = 'worldMetadata';
const WORLD_STATE_STORE = 'worldStates';

export interface WorldMetadata {
  id: string;
  name: string;
  worldSeed: number;
  createdAtMs: number;
  updatedAtMs: number;
  lastPlayedAtMs: number | null;
}

export interface StoredWorldState extends PersistedWorldState {
  worldId: string;
}

export interface LoadedWorld {
  metadata: WorldMetadata;
  state: StoredWorldState | null;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function newWorldId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('This browser does not provide a cryptographically secure random source; a local world ID cannot be generated.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateWorldName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 48) throw new TypeError('World name must contain 1–48 characters.');
  return trimmed;
}

/**
 * Browser-local durable world repository. World metadata and large snapshots use
 * separate object stores so the world picker never loads every map into memory.
 * IndexedDB errors are surfaced to the caller; there is deliberately no silent
 * localStorage or in-memory fallback.
 */
export class WorldSaveStore {
  private openDatabase(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is unavailable. Local worlds require a browser with IndexedDB enabled.');
    }
    if (databasePromise) return databasePromise;

    let wasBlocked = false;
    let trackedOpen: Promise<IDBDatabase>;
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(WORLD_METADATA_STORE)) database.createObjectStore(WORLD_METADATA_STORE, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(WORLD_STATE_STORE)) database.createObjectStore(WORLD_STATE_STORE, { keyPath: 'worldId' });
      };
      request.onsuccess = () => {
        const database = request.result;
        // `blocked` rejects the open promise immediately, but IndexedDB may
        // still complete the open request later. Close that late connection
        // rather than leaking a database handle no caller can reach.
        if (wasBlocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (databasePromise === trackedOpen) databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open the local world database.'));
      request.onblocked = () => {
        wasBlocked = true;
        reject(new Error('The local world database upgrade is blocked by another open game tab. Close the other tab and retry.'));
      };
    });
    trackedOpen = opening.catch(error => {
      if (databasePromise === trackedOpen) databasePromise = null;
      throw error;
    });
    databasePromise = trackedOpen;
    return trackedOpen;
  }

  async listWorlds(): Promise<WorldMetadata[]> {
    const database = await this.openDatabase();
    const transaction = database.transaction(WORLD_METADATA_STORE, 'readonly');
    const request = transaction.objectStore(WORLD_METADATA_STORE).getAll() as IDBRequest<WorldMetadata[]>;
    const done = transactionComplete(transaction);
    let worlds: WorldMetadata[];
    try {
      worlds = await requestResult(request);
      await done;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    return worlds.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.name.localeCompare(b.name));
  }

  async createWorld(name: string, worldSeed: number): Promise<WorldMetadata> {
    const validatedName = validateWorldName(name);
    if (!Number.isSafeInteger(worldSeed) || worldSeed < 0 || worldSeed > 0xffff_ffff) throw new RangeError('World seed must be an unsigned 32-bit integer.');
    const now = Date.now();
    const metadata: WorldMetadata = { id: newWorldId(), name: validatedName, worldSeed, createdAtMs: now, updatedAtMs: now, lastPlayedAtMs: null };
    const database = await this.openDatabase();
    const transaction = database.transaction(WORLD_METADATA_STORE, 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(WORLD_METADATA_STORE).add(metadata);
    await done;
    return metadata;
  }

  async getWorld(worldId: string): Promise<LoadedWorld> {
    const database = await this.openDatabase();
    const transaction = database.transaction([WORLD_METADATA_STORE, WORLD_STATE_STORE], 'readonly');
    const done = transactionComplete(transaction);
    let metadata: WorldMetadata | undefined;
    let state: StoredWorldState | undefined;
    try {
      [metadata, state] = await Promise.all([
        requestResult(transaction.objectStore(WORLD_METADATA_STORE).get(worldId) as IDBRequest<WorldMetadata | undefined>),
        requestResult(transaction.objectStore(WORLD_STATE_STORE).get(worldId) as IDBRequest<StoredWorldState | undefined>)
      ]);
      await done;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    if (!metadata) throw new Error(`World '${worldId}' no longer exists in local storage.`);
    if (state) {
      if (state.worldId !== worldId) throw new TypeError('Stored world state has a mismatched world ID.');
      validatePersistedWorldState(state, metadata.worldSeed);
    }
    return { metadata, state: state ?? null };
  }

  async loadWorld(worldId: string): Promise<LoadedWorld> {
    const loaded = await this.getWorld(worldId);
    const database = await this.openDatabase();
    const transaction = database.transaction(WORLD_METADATA_STORE, 'readwrite');
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(WORLD_METADATA_STORE);
    let metadata: WorldMetadata | undefined;
    try {
      metadata = await requestResult(store.get(worldId) as IDBRequest<WorldMetadata | undefined>);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    if (!metadata) {
      await done;
      throw new Error(`World '${worldId}' was deleted before it could be opened.`);
    }
    metadata.lastPlayedAtMs = Date.now();
    store.put(metadata);
    await done;
    return { metadata, state: loaded.state };
  }

  async saveSnapshot(worldId: string, worldSeed: number, snapshot: GameEngineState, activeChunkKeys: readonly string[]): Promise<number> {
    const savedAtMs = Date.now();
    const uniqueChunkKeys = [...activeChunkKeys];
    const state: StoredWorldState = {
      worldId,
      schemaVersion: WORLD_SAVE_SCHEMA_VERSION,
      worldSeed,
      savedAtMs,
      activeChunkKeys: uniqueChunkKeys,
      snapshot: createPersistableSnapshot(snapshot)
    };
    validatePersistedWorldState(state, worldSeed);

    const database = await this.openDatabase();
    const transaction = database.transaction([WORLD_METADATA_STORE, WORLD_STATE_STORE], 'readwrite');
    const done = transactionComplete(transaction);
    const metadataStore = transaction.objectStore(WORLD_METADATA_STORE);
    let metadata: WorldMetadata | undefined;
    try {
      metadata = await requestResult(metadataStore.get(worldId) as IDBRequest<WorldMetadata | undefined>);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    if (!metadata) {
      await done;
      throw new Error(`Cannot save world '${worldId}' because its metadata no longer exists.`);
    }
    metadata.updatedAtMs = savedAtMs;
    metadataStore.put(metadata);
    transaction.objectStore(WORLD_STATE_STORE).put(state);
    await done;
    return savedAtMs;
  }

  async duplicateWorld(worldId: string): Promise<WorldMetadata> {
    const source = await this.getWorld(worldId);
    const now = Date.now();
    const metadata: WorldMetadata = {
      id: newWorldId(),
      name: `${source.metadata.name.slice(0, 42)} Copy`,
      worldSeed: source.metadata.worldSeed,
      createdAtMs: now,
      updatedAtMs: now,
      lastPlayedAtMs: null
    };
    const database = await this.openDatabase();
    const transaction = database.transaction([WORLD_METADATA_STORE, WORLD_STATE_STORE], 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(WORLD_METADATA_STORE).add(metadata);
    if (source.state) transaction.objectStore(WORLD_STATE_STORE).add({ ...structuredClone(source.state), worldId: metadata.id });
    await done;
    return metadata;
  }

  async renameWorld(worldId: string, name: string): Promise<WorldMetadata> {
    const validatedName = validateWorldName(name);
    const database = await this.openDatabase();
    const transaction = database.transaction(WORLD_METADATA_STORE, 'readwrite');
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(WORLD_METADATA_STORE);
    let metadata: WorldMetadata | undefined;
    try {
      metadata = await requestResult(store.get(worldId) as IDBRequest<WorldMetadata | undefined>);
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
    if (!metadata) {
      await done;
      throw new Error(`Cannot rename missing world '${worldId}'.`);
    }
    metadata.name = validatedName;
    metadata.updatedAtMs = Date.now();
    store.put(metadata);
    await done;
    return metadata;
  }

  async deleteWorld(worldId: string): Promise<void> {
    const database = await this.openDatabase();
    const transaction = database.transaction([WORLD_METADATA_STORE, WORLD_STATE_STORE], 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(WORLD_METADATA_STORE).delete(worldId);
    transaction.objectStore(WORLD_STATE_STORE).delete(worldId);
    await done;
  }

  async importWorld(document: WorldExportDocument): Promise<WorldMetadata> {
    validatePersistedWorldState(document.state, document.worldSeed);
    const now = Date.now();
    const metadata: WorldMetadata = {
      id: newWorldId(),
      name: validateWorldName(document.worldName),
      worldSeed: document.worldSeed,
      createdAtMs: now,
      updatedAtMs: now,
      lastPlayedAtMs: null
    };
    const state: StoredWorldState = { ...structuredClone(document.state), worldId: metadata.id };
    const database = await this.openDatabase();
    const transaction = database.transaction([WORLD_METADATA_STORE, WORLD_STATE_STORE], 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore(WORLD_METADATA_STORE).add(metadata);
    transaction.objectStore(WORLD_STATE_STORE).add(state);
    await done;
    return metadata;
  }
}

export const worldSaveStore = new WorldSaveStore();
