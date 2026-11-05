import { Building, EnemyBase, GameEntity, GameGroup, ResourceNode, ResourceType } from './types';
import {
  createBuildingInstance,
  createCombatDrone,
  createCommander,
  findFreeAdjacentSpawnPosition,
  GRID_SIZE,
  hashCoord,
  snapToGrid
} from './rules';

export const DEFAULT_WORLD_SEED = 0x00c0ffee;

/** Generate a stable world seed once, then transmit it with the initial authoritative state. */
export function createWorldSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

export const TILES_PER_CHUNK = 12;
export const CHUNK_SIZE = GRID_SIZE * TILES_PER_CHUNK; // 48 * 12 = 576px

export interface ChunkData {
  nodes: ResourceNode[];
}

export function generateChunk(cx: number, cy: number, worldSeed = DEFAULT_WORLD_SEED): ChunkData {
  const nodes: ResourceNode[] = [];
  const chunkKey = `${cx},${cy}`;

  const isCenterChunk = cx === 0 && cy === 0;
  const startGx = cx * TILES_PER_CHUNK;
  const startGy = cy * TILES_PER_CHUNK;
  const usedTiles = new Set<string>();

  // If central spawn chunk, place guaranteed Wood and Stone nodes in perimeter rings
  if (isCenterChunk) {
    const initialDeposits: Array<{ gx: number; gy: number; type: ResourceType }> = [
      // Guaranteed Wood Trees around base
      { gx: -3, gy: -2, type: 'wood' },
      { gx: 3, gy: -2, type: 'wood' },
      { gx: -4, gy: 3, type: 'wood' },
      { gx: 4, gy: 3, type: 'wood' },
      { gx: -5, gy: 0, type: 'wood' },
      // Guaranteed Stone Rock Formations around base
      { gx: -2, gy: -4, type: 'stone' },
      { gx: 2, gy: -4, type: 'stone' },
      { gx: -3, gy: 4, type: 'stone' },
      { gx: 3, gy: 4, type: 'stone' },
      { gx: 5, gy: 0, type: 'stone' },
      { gx: 0, gy: -5, type: 'stone' }
    ];

    for (const dep of initialDeposits) {
      usedTiles.add(`${dep.gx},${dep.gy}`);
      const snapped = snapToGrid(dep.gx * GRID_SIZE, dep.gy * GRID_SIZE, GRID_SIZE);
      nodes.push({
        id: `res-center-${dep.gx}-${dep.gy}`,
        type: dep.type,
        gx: dep.gx,
        gy: dep.gy,
        x: snapped.x,
        y: snapped.y,
        amount: dep.type === 'wood' ? 120 : 150,
        maxAmount: dep.type === 'wood' ? 120 : 150,
        radius: 22,
        seed: Math.floor(hashCoord(dep.gx, dep.gy, (777 ^ worldSeed) >>> 0) * 10000),
        chunkKey
      });
    }
  }

  // Generate procedural nodes (5 to 8 nodes per chunk)
  const nodeCount = isCenterChunk ? 4 : 5 + Math.floor(hashCoord(cx, cy, (101 ^ worldSeed) >>> 0) * 4);

  for (let i = 0; i < nodeCount; i++) {
    const tileOffsetX = 1 + Math.floor(hashCoord(cx * 17 + i, cy * 31 + i, (203 ^ worldSeed) >>> 0) * (TILES_PER_CHUNK - 2));
    const tileOffsetY = 1 + Math.floor(hashCoord(cx * 43 + i, cy * 19 + i, (407 ^ worldSeed) >>> 0) * (TILES_PER_CHUNK - 2));

    const gx = startGx + tileOffsetX;
    const gy = startGy + tileOffsetY;
    const tileKey = `${gx},${gy}`;

    if (usedTiles.has(tileKey)) continue;

    // Keep center 3x3 clearance for Command Core
    if (Math.abs(gx) <= 2 && Math.abs(gy) <= 2) {
      continue;
    }

    usedTiles.add(tileKey);

    // Guaranteed 50/50 balance between Wood and Stone
    const isWood = (i % 2 === 0);
    const type: ResourceType = isWood ? 'wood' : 'stone';
    const maxAmount = type === 'wood' ? 120 : 150;

    const snapped = snapToGrid(gx * GRID_SIZE, gy * GRID_SIZE, GRID_SIZE);

    nodes.push({
      id: `res-${chunkKey}-${gx}-${gy}`,
      type,
      gx,
      gy,
      x: snapped.x,
      y: snapped.y,
      amount: maxAmount,
      maxAmount,
      radius: 22,
      seed: Math.floor(hashCoord(gx, gy, (881 ^ worldSeed) >>> 0) * 10000),
      chunkKey
    });
  }

  return { nodes };
}


/**
 * Spawns a procedural symmetrical enemy base with:
 * - An Enemy Command Core (2x2)
 * - An Enemy Commander Robot (identical to player!)
 * - Defensive walls and turrets
 * - An autonomous Harvester Station and Drone Station
 */
export function generateProceduralEnemyBase(
  baseIndex: number,
  difficultyLevel: number,
  anchorX = 0,
  anchorY = 0,
  worldSeed = DEFAULT_WORLD_SEED,
  existingResources: ResourceNode[] = []
): {
  base: EnemyBase;
  group: GameGroup;
  buildings: Building[];
  entities: GameEntity[];
} {
  const angleVariation = hashCoord(baseIndex, difficultyLevel, (worldSeed ^ 0x51ed270b) >>> 0);
  const distanceVariation = hashCoord(baseIndex, difficultyLevel, (worldSeed ^ 0x2c1b3c6d) >>> 0);
  const angle = (baseIndex * 1.618 + angleVariation * 0.4) * Math.PI * 2;
  const dist = 1050 + baseIndex * 360 + distanceVariation * 180;

  const worldX = anchorX + Math.cos(angle) * dist;
  const worldY = anchorY + Math.sin(angle) * dist;
  const snapped = snapToGrid(worldX, worldY, GRID_SIZE);

  const coreGx = snapped.gx;
  const coreGy = snapped.gy;
  const coreId = `enemy-core-${baseIndex}`;

  // 2x2 Enemy Command Core
  const teamId = `enemy-base-${baseIndex}`;
  const groupNames = ['Crimson Foundry', 'Obsidian Circuit', 'Amber Directorate', 'Violet Engine', 'Iron Meridian', 'Jade Protocol'];
  const commanderNames = ['WARDEN', 'MANTICORE', 'VANGUARD', 'CIPHER', 'BULWARK', 'ORACLE'];
  const groupColors = ['#fb7185', '#c084fc', '#fbbf24', '#a78bfa', '#fb923c', '#2dd4bf'];
  const groupName = `${groupNames[baseIndex % groupNames.length]} ${String(baseIndex + 1).padStart(2, '0')}`;
  const commanderName = `${commanderNames[baseIndex % commanderNames.length]}-${String(baseIndex + 1).padStart(2, '0')}`;
  const groupColor = groupColors[baseIndex % groupColors.length];
  const allianceId = teamId;
  const group: GameGroup = { id: teamId, name: groupName, commanderName, faction: 'enemy', allianceId, color: groupColor };
  const core = createBuildingInstance('CORE', 'enemy', coreGx, coreGy, coreId, teamId);
  core.allianceId = allianceId;
  core.hp = 1050 + Math.max(0, difficultyLevel - 1) * 100;
  core.maxHp = core.hp;

  const buildings: Building[] = [core];
  const units: GameEntity[] = [];

  // Defensive perimeter walls
  const wallOffsets = [
    { dx: -2, dy: -2 },
    { dx: 0, dy: -2 },
    { dx: 2, dy: -2 },
    { dx: -2, dy: 3 },
    { dx: 0, dy: 3 },
    { dx: 2, dy: 3 },
    { dx: -2, dy: 0 },
    { dx: 3, dy: 0 }
  ];

  for (let i = 0; i < 5; i++) {
    const offset = wallOffsets[(i + baseIndex) % wallOffsets.length];
    const wall = createBuildingInstance(
      'WALL',
      'enemy',
      coreGx + offset.dx,
      coreGy + offset.dy,
      `enemy-wall-${baseIndex}-${i}`,
      teamId
    );
    wall.hp = 320 + difficultyLevel * 50;
    wall.maxHp = wall.hp;
    buildings.push(wall);
  }

  // Auto-Turret
  const turret = createBuildingInstance(
    'AUTO_TURRET',
    'enemy',
    coreGx + 3,
    coreGy + 1,
    `enemy-turret-${baseIndex}`,
    teamId
  );
  buildings.push(turret);

  // Harvester Station (2x2)
  const harvesterStation = createBuildingInstance(
    'HARVESTER_STATION',
    'enemy',
    coreGx - 4,
    coreGy,
    `enemy-harvester-${baseIndex}`,
    teamId
  );
  buildings.push(harvesterStation);

  // Drone Station (2x2)
  const droneStation = createBuildingInstance(
    'DRONE_STATION',
    'enemy',
    coreGx,
    coreGy - 4,
    `enemy-dronestation-${baseIndex}`,
    teamId
  );
  droneStation.droneMode = 'DEFENSE';
  buildings.push(droneStation);

  // Additional Fire Tower for higher difficulties
  if (difficultyLevel >= 2) {
    const fireTower = createBuildingInstance(
      'FIRE_TOWER',
      'enemy',
      coreGx - 3,
      coreGy + 2,
      `enemy-firetower-${baseIndex}`,
      teamId
    );
    buildings.push(fireTower);
  }

  for (const building of buildings) building.allianceId = allianceId;

  // Spawn entities only after the complete footprint is known. This avoids creating
  // commanders or drones inside the core, walls, or stations at world-generation time.
  const commanderId = `enemy-commander-${baseIndex}`;
  const commanderSpawn = findFreeAdjacentSpawnPosition(core, false, buildings, existingResources);
  const enemyCommander = createCommander('enemy', commanderSpawn.x, commanderSpawn.y, commanderId);
  enemyCommander.teamId = teamId;
  enemyCommander.allianceId = allianceId;
  units.push(enemyCommander);

  const droneSpawn = findFreeAdjacentSpawnPosition(droneStation, true, buildings, []);
  const initialDrone = createCombatDrone(droneStation, droneSpawn, `enemy-drone-${baseIndex}-1`);
  initialDrone.teamId = teamId;
  initialDrone.allianceId = allianceId;
  units.push(initialDrone);

  const base: EnemyBase = {
    id: teamId,
    teamId,
    allianceId,
    groupName,
    commanderName,
    groupColor,
    gx: coreGx,
    gy: coreGy,
    x: core.x,
    y: core.y,
    coreId,
    commanderId,
    level: difficultyLevel,
    // The opening window gives the player time to automate mining and fortify.
    raidTimer: 105.0 + hashCoord(baseIndex, difficultyLevel, (worldSeed ^ 0x68bc21eb) >>> 0) * 20.0,
    raidInterval: Math.max(70.0, 115.0 - difficultyLevel * 4.0),
    isDestroyed: false,
    resources: {
      wood: 100 + difficultyLevel * 40,
      stone: 100 + difficultyLevel * 40,
      diamonds: 0
    },
    buildTimer: 14.0,
    repairTimer: 6.0,
    stance: 'FORTIFYING',
    stanceTimer: 0
  };

  return { base, group, buildings, entities: units };
}
