import type { GameWorldFrame } from '../../server/protocol';
import type { GameEntity } from '../../types';
import { RemoteGameClientPortApi } from './RemoteGameClientPortApi';

/** Projects the authoritative frame into this guest's local HUD/camera view and centralizes protocol failures. */
export abstract class RemoteGameClientPortProjection extends RemoteGameClientPortApi {

protected override fail(message: string, details?: unknown): never {
    const error = new Error(message);
    // Put the actual invariant failure in the first console argument so it is
    // visible even when browser devtools leave the attached details collapsed.
    console.error(`[multiplayer guest] Protocol or state failure: ${message}`, {
      message, details, error,
      assignedPlayerId: this.playerAssigned ? this.playerId : null,
      hasAuthoritativeState: this.receivedAuthoritativeFrame,
      lastRevision: this.receivedAuthoritativeFrame ? this.revision : null
    });
    throw error;
  }

protected override projectFrame(authoritative: GameWorldFrame): GameWorldFrame {
    const source = authoritative.snapshot;
    const participant = source.humanPlayers.find(player => player.playerId === this.playerId);
    if (!participant) this.fail(`Authoritative frame ${authoritative.revision} does not contain assigned participant '${this.playerId}'.`, authoritative);

    const commanderInWorld = source.entities.find(entity => entity.id === participant.commanderId);
    const participantCore = source.buildings.find(building => building.type === 'CORE' && building.id === participant.coreId);
    const coreIsOperational = Boolean(participantCore && participantCore.hp > 0);
    if (coreIsOperational && !commanderInWorld) {
      this.fail(`Authoritative frame ${authoritative.revision} is missing commander '${participant.commanderId}' while Core '${participant.coreId}' remains operational.`, authoritative);
    }

    // Defeat removes the commander from the actual world. Keep a non-rendered
    // tombstone in snapshot.player solely for HUD/camera metadata, so a legitimate
    // eliminated-player frame is not mistaken for malformed server state.
    const previousGuestCommander = this.receivedAuthoritativeFrame && this.snapshot?.player.id === participant.commanderId
      ? this.snapshot.player
      : undefined;
    const fallbackCommander = commanderInWorld ?? previousGuestCommander ?? {
      ...source.player,
      id: participant.commanderId,
      x: participantCore?.x ?? source.camera.x,
      y: participantCore?.y ?? source.camera.y,
      ownerPlayerId: participant.playerId
    };
    const commander: GameEntity = coreIsOperational
      ? commanderInWorld!
      : { ...fallbackCommander, hp: 0, isDead: true, vx: 0, vy: 0 };
    const projectedEntities = coreIsOperational
      ? source.entities
      : source.entities.filter(entity => entity.id !== participant.commanderId);

    const snapshot = {
      ...source,
      entities: projectedEntities,
      player: commander,
      resources: participant.resources,
      camera: { ...source.camera, x: commander.x, y: commander.y },
      mouseWorld: { ...participant.aim },
      isMouseAiming: participant.isAiming,
      selectedBuildingType: participant.selectedBuildingType,
      selectedStationId: participant.selectedStationId,
      isGameOver: !coreIsOperational
    };
    return { ...authoritative, snapshot };
  }
}
