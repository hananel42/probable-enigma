import type { Building, BuildingType, Faction, GameEntity } from '../types';
import { GRID_SIZE } from './constants';
import { BASE_COMMANDER_SPEED, BASE_DRONE_TUNING, BASE_WEAPON_TUNING } from '../combatTuning';
import { behavior as droneStationBehavior } from '../buildings/droneStation/behavior';
import { getBuildingBlueprint } from './economy';

export function hashCoord(x: number, y: number, seed: number = 2026): number {
  let h = seed ^ (x * 374761393 + y * 668265263);
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export function createCommander(
  faction: Faction,
  x: number = 0,
  y: number = 75,
  id: string = `${faction}-commander`
): GameEntity {
  return {
    id,
    kind: 'COMMANDER',
    faction,
    teamId: faction,
    allianceId: faction,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: faction === 'player' ? 0 : Math.PI,
    hp: 150,
    maxHp: 150,
    speed: BASE_COMMANDER_SPEED,
    radius: 15,
    isFlying: false,
    fireCooldown: BASE_WEAPON_TUNING.fireCooldown,
    lastFireTime: 0,
    damage: BASE_WEAPON_TUNING.damage,
    range: BASE_WEAPON_TUNING.range,
    armor: 0,
    miningSpeedMultiplier: 1,
    miningYieldMultiplier: 1,
    respawnTimer: 0,
    isDead: false,
    dashCooldown: 2.0,
    dashTimer: 0,
    miningProgress: 0,
    miningTargetId: null,
    isActivelyMining: false,
    aiGoal: 'IDLE',
    aiDecisionTimer: 0
  };
}

export function createInitialPlayer(x: number = 0, y: number = 75): GameEntity {
  return createCommander('player', x, y, 'player-commander');
}

export function createBuildingInstance(
  type: BuildingType,
  faction: Faction,
  gx: number,
  gy: number,
  id: string = `bldg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
  teamId: string = faction
): Building {
  const bp = getBuildingBlueprint(type);
  const w = bp.widthInCells;
  const h = bp.heightInCells;

  // Center coordinate accounting for 1x1 or 2x2 width/height
  const centerX = gx * GRID_SIZE + (w * GRID_SIZE) / 2;
  const centerY = gy * GRID_SIZE + (h * GRID_SIZE) / 2;

  const building: Building = {
    id,
    type,
    faction,
    teamId,
    allianceId: teamId,
    gx,
    gy,
    widthInCells: w,
    heightInCells: h,
    x: centerX,
    y: centerY,
    hp: bp.hp,
    maxHp: bp.hp,
    level: 1,
    lastActionTime: 0,
    range: bp.range,
    upgradeIds: []
  };

  if (type === 'HARVESTER_STATION') {
    building.spawnTimer = 10.0;
    building.storedWood = 0;
    building.storedStone = 0;
    building.maxCapacity = 75;
    building.maxBots = 1;
    building.miningSpeedMultiplier = 1;
    building.botCargoCapacityMultiplier = 1;
    building.botProductionMultiplier = 1;
  } else if (type === 'DRONE_STATION') {
    building.spawnTimer = 8.0;
    building.droneMode = 'DEFENSE';
    building.maxDrones = 2;
    building.droneProductionMultiplier = 1;
    building.droneDamageMultiplier = 1;
    building.droneHealthMultiplier = 1;
    building.droneSpeedMultiplier = 1;
    building.droneFireRateMultiplier = 1;
  } else if (type === 'FIRE_TOWER') {
    building.fireTimer = 4.0;
    building.fireRadius = 175;
    building.damage = 24;
    building.fireCooldown = 4.0;
    building.burnDamagePerSecond = 14;
    building.effectDuration = 3.0;
    building.towerEffectIds = ['burning'];
    building.pulseDuration = 0.6;
    building.isPulsing = false;
    building.pulseProgress = 0;
    building.pulseAffectedIds = [];
  } else if (type === 'AUTO_TURRET') {
    building.barrelAngle = 0;
    // Match the base Commander weapon exactly; the turret's 280 HP exceeds the Commander's 150 HP.
    building.damage = BASE_WEAPON_TUNING.damage;
    building.shotsPerAttack = 1;
    building.fireCooldown = BASE_WEAPON_TUNING.fireCooldown;
    building.projectileSpeed = BASE_WEAPON_TUNING.projectileSpeed;
    building.projectileHomingStrength = 0;
    building.explosionRadius = 0;
    building.explosionDamageMultiplier = 0;
    building.targetEntityId = null;
  }

  return building;
}

export function createHarvesterBot(
  parentStation: Building,
  spawnPos?: { x: number; y: number },
  id: string = `hbot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
): GameEntity {
  const pos = spawnPos || { x: parentStation.x, y: parentStation.y + 45 };
  return {
    id,
    kind: 'HARVESTER_BOT',
    ownerPlayerId: parentStation.ownerPlayerId,
    faction: parentStation.faction,
    teamId: parentStation.teamId || parentStation.faction,
    allianceId: parentStation.allianceId || parentStation.teamId || parentStation.faction,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 90,
    maxHp: 90,
    speed: 135,
    radius: 11,
    isFlying: false,
    parentStationId: parentStation.id,
    harvesterState: 'IDLE',
    targetResourceId: null,
    miningTimer: 0,
    cargoType: null,
    cargoAmount: 0,
    cargoCapacity: 20 * (parentStation.botCargoCapacityMultiplier || 1)
  };
}

export function createCombatDrone(
  parentStation: Building,
  spawnPos?: { x: number; y: number },
  id: string = `drone-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
): GameEntity {
  const pos = spawnPos || { x: parentStation.x, y: parentStation.y - 45 };
  return {
    id,
    kind: 'DRONE',
    ownerPlayerId: parentStation.ownerPlayerId,
    faction: parentStation.faction,
    teamId: parentStation.teamId || parentStation.faction,
    allianceId: parentStation.allianceId || parentStation.teamId || parentStation.faction,
    x: pos.x,
    y: pos.y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: Math.round(70 * (parentStation.droneHealthMultiplier || 1)),
    maxHp: Math.round(70 * (parentStation.droneHealthMultiplier || 1)),
    speed: droneStationBehavior.baseDroneSpeed * (parentStation.droneSpeedMultiplier || 1),
    radius: 10,
    isFlying: true,
    parentStationId: parentStation.id,
    patrolAngle: Math.random() * Math.PI * 2,
    droneAIState: 'PATROL',
    fireCooldown: BASE_DRONE_TUNING.fireCooldown / (parentStation.droneFireRateMultiplier || 1),
    lastFireTime: 0,
    damage: BASE_DRONE_TUNING.damage * (parentStation.droneDamageMultiplier || 1),
    range: GRID_SIZE * BASE_DRONE_TUNING.weaponRangeInGridCells
  };
}
