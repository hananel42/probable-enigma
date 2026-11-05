import type { BuildingType } from '../types';
import { createBuildingInstance, createInitialPlayer, createInitialResources } from '../rules';
import { DEFAULT_WORLD_SEED } from '../world';
import type { GameEngineState } from './model';

import { EngineContract } from './EngineContract';

export abstract class EngineState extends EngineContract {

  public state: GameEngineState;

  protected activeChunks: Set<string> = new Set();

  protected harvesterChunkLocations = new Map<string, string>();

  protected uiSyncTimer = 0;

  protected nextParticleSerial = 1;

  /** Prevents duplicate diamond payouts if multiple damage paths observe the same lethal Core. */
  protected rewardedCoreIds = new Set<string>();


  protected keys: Record<string, boolean> = {};

  protected isPointerDown: boolean = false;

  protected readonly playerControls = new Map<string, { keys: Record<string, boolean>; pointerDown: boolean; aim: GameEngineState['mouseWorld']; selectedBuildingType: BuildingType | null; selectedStationId: string | null; aiming: boolean }>();

  protected activePlayerId = 'player-host';

  protected lastContextBuildingId: string | null = null;

  protected scopedCommandDepth = 0;

  protected updatingHumanPlayers = false;

  protected pendingStateChange = false;

  protected onStateChangeCallback?: (state: GameEngineState) => void;


  public readonly worldSeed: number;



  /** Create an authoritative simulation with a stable seed for all procedural world generation. */
  constructor(worldSeed = DEFAULT_WORLD_SEED) {
    super();
    if (!Number.isSafeInteger(worldSeed) || worldSeed < 0 || worldSeed > 0xffff_ffff) {
      throw new RangeError(`World seed must be an unsigned 32-bit integer; received ${worldSeed}.`);
    }
    this.worldSeed = worldSeed;
    this.state = this.createInitialState();
    this.playerControls.set('player-host', { keys: {}, pointerDown: false, aim: { x: 0, y: 0, gx: 0, gy: 0 }, selectedBuildingType: null, selectedStationId: null, aiming: false });
    this.initWorld();
  }





  /** Return the complete set of generated chunk keys for a durable local-world save. */
  public getLoadedChunkKeys(): string[] {
    return [...this.activeChunks].sort();
  }

  /**
   * Restore a validated single-player snapshot and rebuild non-serialized runtime state.
   * Runtime controls, effects, callbacks, and derived caches are deliberately not restored.
   */
  public restoreSinglePlayerState(snapshot: GameEngineState, activeChunkKeys: readonly string[]): void {
    if (snapshot.multiplayerMode !== 'TEAM' || snapshot.humanPlayers.length !== 1 || snapshot.humanPlayers[0]?.playerId !== 'player-host') {
      throw new TypeError('A local single-player save must contain exactly one TEAM-mode host participant.');
    }
    const chunkKeys = new Set<string>();
    for (const key of activeChunkKeys) {
      if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) {
        throw new TypeError(`Invalid loaded world chunk key '${String(key)}'.`);
      }
      if (chunkKeys.has(key)) throw new TypeError(`Duplicate loaded world chunk key '${key}'.`);
      chunkKeys.add(key);
    }

    const restored = structuredClone(snapshot);
    // JSON export/import cannot preserve object identity. Rebind the primary
    // player to the canonical entity instance when that entity still exists.
    const livePlayer = restored.entities.find(entity => entity.id === restored.player.id);
    if (livePlayer) restored.player = livePlayer;

    restored.projectiles = [];
    restored.particles = [];
    restored.floatingTexts = [];
    restored.selectedBuildingType = null;
    restored.selectedStationId = null;
    restored.isMouseAiming = false;
    restored.humanPlayers[0].connected = true;
    restored.humanPlayers[0].selectedBuildingType = null;
    restored.humanPlayers[0].selectedStationId = null;
    restored.humanPlayers[0].isAiming = false;
    restored.resources = { ...restored.humanPlayers[0].resources };
    restored.mouseWorld = { ...restored.humanPlayers[0].aim };

    this.state = restored;
    this.activeChunks.clear();
    for (const key of chunkKeys) this.activeChunks.add(key);
    this.harvesterChunkLocations.clear();
    this.uiSyncTimer = 0;
    this.nextParticleSerial = 1;
    this.rewardedCoreIds.clear();
    this.keys = {};
    this.isPointerDown = false;
    this.playerControls.clear();
    for (const participant of restored.humanPlayers) {
      this.playerControls.set(participant.playerId, {
        keys: {},
        pointerDown: false,
        aim: { ...participant.aim },
        selectedBuildingType: null,
        selectedStationId: null,
        aiming: false
      });
    }
    this.activePlayerId = 'player-host';
    this.lastContextBuildingId = null;
    this.scopedCommandDepth = 0;
    this.updatingHumanPlayers = false;
    this.pendingStateChange = false;
    this.triggerStateChange();
  }


  protected override createInitialState(): GameEngineState {
    const player = createInitialPlayer(0, 75);
    player.id = 'player-commander';
    player.ownerPlayerId = 'player-host';
    player.teamId = 'group-host';
    player.allianceId = 'alliance-humans';
    // Command core is a 2x2 structure at (0, 0)
    const playerCore = createBuildingInstance('CORE', 'player', -1, -1, 'player-core');
    playerCore.id = 'player-core';
    playerCore.ownerPlayerId = 'player-host';
    playerCore.coreId = playerCore.id;
    playerCore.teamId = 'group-host';
    playerCore.allianceId = 'alliance-humans';

    return {
      player,
      humanPlayers: [{ playerId: 'player-host', commanderId: player.id, coreId: playerCore.id, groupId: 'group-host', allianceId: 'alliance-humans', displayName: 'Host', defeatedAtGameTime: null, color: '#38bdf8', resources: createInitialResources(), connected: true, selectedBuildingType: null, selectedStationId: null, aim: { x: 0, y: 0, gx: 0, gy: 0 }, isAiming: false }],
      multiplayerMode: 'TEAM',
      groups: [{
        id: 'group-host',
        name: 'Pioneer Collective',
        commanderName: 'PILOT-01',
        faction: 'player',
        allianceId: 'alliance-humans',
        color: '#38bdf8'
      }],
      entities: [player],
      buildings: [playerCore],
      resources: createInitialResources(),
      resourceNodes: [],
      enemyBases: [],
      projectiles: [],
      particles: [],
      floatingTexts: [],
      selectedBuildingType: null,
      selectedStationId: null,
      camera: { x: 0, y: 0, zoom: 1.0 },
      mouseWorld: { x: 0, y: 0, gx: 0, gy: 0 },
      isMouseAiming: false,
      isGameOver: false,
      gameTime: 0,
      difficultyLevel: 1
    };
  }
}
