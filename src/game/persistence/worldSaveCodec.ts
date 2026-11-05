import type { GameEngineState } from '../engine/model';

/** Current development schema. Old schemas are rejected; migrations are intentionally unsupported. */
export const WORLD_SAVE_SCHEMA_VERSION = 3;
export const WORLD_SAVE_FORMAT = 'craftbound-survival-outpost-world';
export const MAX_WORLD_IMPORT_BYTES = 32 * 1024 * 1024;

export interface PersistedWorldState {
  schemaVersion: typeof WORLD_SAVE_SCHEMA_VERSION;
  worldSeed: number;
  savedAtMs: number;
  activeChunkKeys: string[];
  snapshot: GameEngineState;
}

export interface WorldExportDocument {
  format: typeof WORLD_SAVE_FORMAT;
  schemaVersion: typeof WORLD_SAVE_SCHEMA_VERSION;
  exportedAtMs: number;
  worldName: string;
  worldSeed: number;
  state: PersistedWorldState;
}

export interface ExportWorldInput {
  worldName: string;
  worldSeed: number;
  state: PersistedWorldState;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function expectArray(value: unknown, label: string, maximumLength = 500_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) {
    throw new TypeError(`${label} must be an array with at most ${maximumLength} entries.`);
  }
  return value;
}

function expectIdRecords(value: unknown, label: string, requiredNumbers: readonly string[], maximumLength = 500_000): UnknownRecord[] {
  const entries = expectArray(value, label, maximumLength);
  const ids = new Set<string>();
  return entries.map((entry, index) => {
    if (!isRecord(entry) || !nonEmptyString(entry.id)) throw new TypeError(`${label}[${index}] must have a non-empty id.`);
    if (ids.has(entry.id)) throw new TypeError(`${label} contains duplicate id '${entry.id}'.`);
    ids.add(entry.id);
    for (const key of requiredNumbers) {
      if (!finiteNumber(entry[key])) throw new TypeError(`${label}[${index}].${key} must be a finite number.`);
    }
    return entry;
  });
}

function validateResources(value: unknown, label: string): void {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  for (const key of ['wood', 'stone']) {
    const amount = value[key];
    if (!finiteNumber(amount) || amount < 0) throw new TypeError(`${label}.${key} must be a finite non-negative number.`);
  }
  if (!finiteNumber(value.diamonds) || value.diamonds < 0) {
    throw new TypeError(`${label}.diamonds must be a finite non-negative number.`);
  }
}

/** Validate the fields needed by the running engine before any imported object is trusted. */
export function validateSinglePlayerSnapshot(value: unknown): asserts value is GameEngineState {
  if (!isRecord(value)) throw new TypeError('World snapshot must be an object.');
  if (value.multiplayerMode !== 'TEAM') throw new TypeError('Only single-player TEAM-mode worlds can be imported.');
  if (!isRecord(value.player) || !nonEmptyString(value.player.id) || !finiteNumber(value.player.x) || !finiteNumber(value.player.y) || value.player.kind !== 'COMMANDER' || value.player.faction !== 'player') {
    throw new TypeError('World snapshot has an invalid primary player.');
  }
  const primaryPlayerId = value.player.id;
  if (!Array.isArray(value.humanPlayers) || value.humanPlayers.length !== 1) {
    throw new TypeError('A single-player world must contain exactly one human participant.');
  }
  const host = value.humanPlayers[0];
  if (!isRecord(host) || host.playerId !== 'player-host' || !nonEmptyString(host.commanderId) || host.commanderId !== value.player.id || !nonEmptyString(host.coreId) || !isRecord(host.aim)) {
    throw new TypeError('World snapshot has an invalid host participant.');
  }
  for (const key of ['x', 'y', 'gx', 'gy']) if (!finiteNumber(host.aim[key])) throw new TypeError(`World snapshot host aim.${key} must be a finite number.`);
  validateResources(host.resources, 'World snapshot host resources');
  validateResources(value.resources, 'World snapshot resources');

  const entities = expectIdRecords(value.entities, 'World entities', ['x', 'y', 'vx', 'vy', 'hp', 'maxHp']);
  const buildings = expectIdRecords(value.buildings, 'World buildings', ['gx', 'gy', 'x', 'y', 'hp', 'maxHp', 'widthInCells', 'heightInCells']);
  const resourceNodes = expectIdRecords(value.resourceNodes, 'Resource nodes', ['gx', 'gy', 'x', 'y', 'amount', 'maxAmount', 'radius', 'seed']);
  const enemyBases = expectIdRecords(value.enemyBases, 'Enemy bases', ['gx', 'gy', 'x', 'y', 'level', 'raidTimer', 'raidInterval']);
  for (const [index, base] of enemyBases.entries()) {
    if (!nonEmptyString(base.coreId) || !nonEmptyString(base.commanderId) || typeof base.isDestroyed !== 'boolean') throw new TypeError(`Enemy bases[${index}] has invalid Core, Commander, or destruction state.`);
    validateResources(base.resources, `Enemy bases[${index}] resources`);
  }
  expectIdRecords(value.groups, 'World groups', []);
  expectArray(value.projectiles, 'Projectiles', 250_000);
  expectArray(value.particles, 'Particles', 250_000);
  expectArray(value.floatingTexts, 'Floating texts', 250_000);

  for (const [index, entity] of entities.entries()) {
    if (!['COMMANDER', 'DRONE', 'HARVESTER_BOT'].includes(String(entity.kind)) || !['player', 'enemy'].includes(String(entity.faction)) || !finiteNumber(entity.maxHp) || !finiteNumber(entity.hp) || entity.maxHp <= 0 || entity.hp < 0 || entity.hp > entity.maxHp) {
      throw new TypeError(`World entities[${index}] has invalid kind, faction, or HP values.`);
    }
  }
  for (const [index, building] of buildings.entries()) {
    if (!['CORE', 'WALL', 'AUTO_TURRET', 'HARVESTER_STATION', 'DRONE_STATION', 'FIRE_TOWER'].includes(String(building.type)) || !['player', 'enemy'].includes(String(building.faction)) || !finiteNumber(building.maxHp) || !finiteNumber(building.hp) || !finiteNumber(building.widthInCells) || !finiteNumber(building.heightInCells) || building.maxHp <= 0 || building.hp < 0 || building.hp > building.maxHp || !Number.isSafeInteger(building.widthInCells) || !Number.isSafeInteger(building.heightInCells) || building.widthInCells < 1 || building.heightInCells < 1 || !Array.isArray(building.upgradeIds) || building.upgradeIds.some(id => !nonEmptyString(id))) {
      throw new TypeError(`World buildings[${index}] has invalid type, faction, footprint, HP, or upgrade-history values.`);
    }
    if (building.type === 'FIRE_TOWER') {
      const numericFields = ['fireTimer', 'fireRadius', 'damage', 'fireCooldown', 'burnDamagePerSecond', 'effectDuration', 'pulseDuration', 'pulseProgress'];
      if (numericFields.some(field => !finiteNumber(building[field])) ||
          (building.fireRadius as number) <= 0 || (building.damage as number) < 0 ||
          (building.fireCooldown as number) <= 0 || (building.burnDamagePerSecond as number) < 0 ||
          (building.effectDuration as number) <= 0 || (building.pulseDuration as number) <= 0 ||
          (building.pulseProgress as number) < 0 || (building.pulseProgress as number) > 1 ||
          typeof building.isPulsing !== 'boolean' || !Array.isArray(building.pulseAffectedIds) ||
          building.pulseAffectedIds.some(id => !nonEmptyString(id)) || !Array.isArray(building.towerEffectIds) ||
          building.towerEffectIds.length === 0 || building.towerEffectIds.some(id =>
            !['burning', 'slowing', 'signal-suppression', 'weakened-shots', 'radio-jamming', 'corrosion'].includes(String(id)))) {
        throw new TypeError(`World buildings[${index}] has incomplete or invalid Effect Tower runtime state.`);
      }
    }
  }
  for (const [index, node] of resourceNodes.entries()) {
    if ((node.type !== 'wood' && node.type !== 'stone') || !finiteNumber(node.amount) || !finiteNumber(node.maxAmount) || node.amount < 0 || node.maxAmount < 0 || node.amount > node.maxAmount || !Number.isSafeInteger(node.gx) || !Number.isSafeInteger(node.gy) || !nonEmptyString(node.chunkKey)) {
      throw new TypeError(`Resource nodes[${index}] has invalid type, amount, or chunk key.`);
    }
  }
  if (!Array.isArray(value.groups) || value.groups.some(group => !isRecord(group) || !nonEmptyString(group.id) || !nonEmptyString(group.name) || !nonEmptyString(group.commanderName) || !nonEmptyString(group.allianceId) || !['player', 'enemy'].includes(String(group.faction)) || typeof group.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(group.color))) {
    throw new TypeError('World snapshot has invalid group records.');
  }
  if (!isRecord(value.camera) || !finiteNumber(value.camera.x) || !finiteNumber(value.camera.y) || !finiteNumber(value.camera.zoom) || value.camera.zoom <= 0) {
    throw new TypeError('World snapshot has an invalid camera.');
  }
  const mouseWorld = value.mouseWorld;
  if (!isRecord(mouseWorld) || !['x', 'y', 'gx', 'gy'].every(key => finiteNumber(mouseWorld[key]))) {
    throw new TypeError('World snapshot has an invalid mouse-world coordinate.');
  }
  if (!finiteNumber(value.gameTime) || value.gameTime < 0 || !finiteNumber(value.difficultyLevel) || !Number.isSafeInteger(value.difficultyLevel) || value.difficultyLevel < 1 || typeof value.isGameOver !== 'boolean') {
    throw new TypeError('World snapshot has invalid game time, difficulty, or game-over state.');
  }
  if (entities.length > 0 && !entities.some(entity => entity.id === primaryPlayerId) && value.isGameOver !== true) {
    throw new TypeError('A live world must contain its primary player in the entity list.');
  }
}

/** Produce a compact durable snapshot by dropping short-lived visual/combat effects. */
export function createPersistableSnapshot(snapshot: GameEngineState): GameEngineState {
  // Override transient arrays before structuredClone so a large particle/projectile
  // burst is not copied into an autosave just to be discarded moments later.
  const source: GameEngineState = {
    ...snapshot,
    projectiles: [],
    particles: [],
    floatingTexts: [],
    selectedBuildingType: null,
    selectedStationId: null,
    isMouseAiming: false,
    humanPlayers: snapshot.humanPlayers.map(participant => ({
      ...participant,
      selectedBuildingType: null,
      selectedStationId: null,
      isAiming: false
    }))
  };
  const copy = structuredClone(source);
  validateSinglePlayerSnapshot(copy);
  return copy;
}

/** Validate persisted state read from IndexedDB or an external file. */
export function validatePersistedWorldState(value: unknown, expectedSeed?: number): asserts value is PersistedWorldState {
  if (!isRecord(value) || value.schemaVersion !== WORLD_SAVE_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported world-save schema; expected version ${WORLD_SAVE_SCHEMA_VERSION}.`);
  }
  if (!Number.isSafeInteger(value.worldSeed) || (value.worldSeed as number) < 0 || (value.worldSeed as number) > 0xffff_ffff) {
    throw new TypeError('World save must contain a valid unsigned 32-bit seed.');
  }
  if (expectedSeed !== undefined && value.worldSeed !== expectedSeed) throw new TypeError('World-save seed does not match its world metadata.');
  if (!finiteNumber(value.savedAtMs) || !Array.isArray(value.activeChunkKeys) || value.activeChunkKeys.length > 100_000) {
    throw new TypeError('World save has invalid timestamp or loaded-chunk metadata.');
  }
  const chunkKeys = new Set<string>();
  for (const key of value.activeChunkKeys) {
    if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) throw new TypeError(`Invalid world chunk key '${String(key)}'.`);
    if (chunkKeys.has(key)) throw new TypeError(`Duplicate world chunk key '${key}'.`);
    chunkKeys.add(key);
  }
  validateSinglePlayerSnapshot(value.snapshot);
  const savedChunks = new Set(value.activeChunkKeys as string[]);
  for (const node of value.snapshot.resourceNodes) {
    if (!node.chunkKey || !savedChunks.has(node.chunkKey)) {
      throw new TypeError(`Resource node '${node.id}' belongs to a chunk that is not marked as loaded.`);
    }
  }
}

export function createWorldExport(input: ExportWorldInput): WorldExportDocument {
  if (!nonEmptyString(input.worldName) || input.worldName.length > 48) throw new TypeError('World name must contain 1–48 characters.');
  validatePersistedWorldState(input.state, input.worldSeed);
  return {
    format: WORLD_SAVE_FORMAT,
    schemaVersion: WORLD_SAVE_SCHEMA_VERSION,
    exportedAtMs: Date.now(),
    worldName: input.worldName,
    worldSeed: input.worldSeed,
    state: structuredClone(input.state)
  };
}

export function parseWorldExport(text: string): WorldExportDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_WORLD_IMPORT_BYTES) {
    throw new RangeError(`World import exceeds the ${Math.round(MAX_WORLD_IMPORT_BYTES / (1024 * 1024))} MiB file limit.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SyntaxError('Selected file is not valid JSON.', { cause: error });
  }
  if (!isRecord(parsed) || parsed.format !== WORLD_SAVE_FORMAT || parsed.schemaVersion !== WORLD_SAVE_SCHEMA_VERSION) {
    throw new TypeError(`File is not a supported ${WORLD_SAVE_FORMAT} save (schema ${WORLD_SAVE_SCHEMA_VERSION}).`);
  }
  if (!nonEmptyString(parsed.worldName) || parsed.worldName.length > 48) throw new TypeError('Imported world name must contain 1–48 characters.');
  if (!Number.isSafeInteger(parsed.worldSeed) || (parsed.worldSeed as number) < 0 || (parsed.worldSeed as number) > 0xffff_ffff) {
    throw new TypeError('Imported world has an invalid seed.');
  }
  if (!finiteNumber(parsed.exportedAtMs)) throw new TypeError('Imported world has an invalid export timestamp.');
  validatePersistedWorldState(parsed.state, parsed.worldSeed as number);
  return parsed as unknown as WorldExportDocument;
}
