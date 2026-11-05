import type { BuildingBehavior, BuildingRuntimeContext } from '../types';
import { collectStationResources, findFreeAdjacentSpawnPosition, createHarvesterBot, STATION_INTERACTION_RADIUS } from '../../rules';
export const behavior: BuildingBehavior = { kind: 'HARVESTER_STATION', baseProductionInterval: 10, defaultCapacity: 75 };
export function update(building: import('../../types').Building, context: BuildingRuntimeContext): void {
  if (behavior.kind !== 'HARVESTER_STATION') return;
  building.spawnTimer = (building.spawnTimer ?? behavior.baseProductionInterval) - context.dt;
  if (building.spawnTimer <= 0) {
    building.spawnTimer = behavior.baseProductionInterval / Math.max(0.25, building.botProductionMultiplier || 1);
    const bots = context.state.entities.reduce((n, e) => n + (e.kind === 'HARVESTER_BOT' && e.parentStationId === building.id && e.hp > 0 ? 1 : 0), 0);
    if (bots < (building.maxBots || 1)) {
      const spawn = findFreeAdjacentSpawnPosition(building, false, context.state.buildings, context.resourceNodes);
      context.spawnEntity(createHarvesterBot(building, spawn));
      if (building.faction === 'player') context.playSound('build');
    }
  }
  if (building.faction !== 'player') return;
  if (!((building.storedWood || 0) > 0 || (building.storedStone || 0) > 0)) return;

  const participants = context.state.humanPlayers;
  const collectors = context.state.multiplayerMode === 'COOPERATIVE'
    ? participants.filter(participant => participant.connected)
    : participants.filter(participant => participant.playerId === (building.ownerPlayerId || 'player-host'));
  const eligible = collectors.flatMap(participant => {
    const commander = context.state.entities.find(entity => entity.id === participant.commanderId);
    if (!commander || commander.hp <= 0 || commander.isDead) return [];
    const range = context.distance(building.x, building.y, commander.x, commander.y);
    return range <= STATION_INTERACTION_RADIUS ? [{ participant, range }] : [];
  });
  // In CO-OP, station cargo remains unassigned until a nearby connected commander
  // physically reaches the station. The nearest commander receives it in their own
  // wallet; the room never merges participant resource ledgers.
  eligible.sort((a, b) => a.range - b.range || a.participant.playerId.localeCompare(b.participant.playerId));
  const collector = eligible[0]?.participant;
  if (!collector) return;
  const collected = collectStationResources(building, collector.resources);
  if (collected.wood || collected.stone) {
    context.playSound('mine');
    context.triggerStateChange();
  }
}
