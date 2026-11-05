import type { EngineHumanPlayer, GameEngineState } from './model';
import { EngineProjectileRuntime } from './EngineProjectileRuntime';

export abstract class EngineLifecycle extends EngineProjectileRuntime {


  /** The room creator may restart CO-OP after its shared Core is destroyed, or TEAM/FFA after all connected players are defeated. */
  public override canRestartGame(): boolean {
    if (this.state.multiplayerMode === 'COOPERATIVE') {
      const sharedCore = this.state.buildings.find(building => building.type === 'CORE' && building.id === 'player-core');
      // Destroyed Cores are removed from the building list during simulation
      // cleanup, so use the explicit room defeat marker to distinguish a real
      // destroyed Core from malformed/missing world state.
      if (!sharedCore) {
        const host = this.state.humanPlayers.find(participant => participant.playerId === 'player-host');
        if (!this.state.isGameOver || host?.defeatedAtGameTime == null) {
          throw new Error("CO-OP restart check failed: shared Core 'player-core' is missing without an authoritative defeat marker.");
        }
        return true;
      }
      return sharedCore.hp <= 0;
    }
    const participants = this.state.humanPlayers.filter(participant => participant.connected);
    return participants.length > 0 && participants.every(participant => this.isParticipantDefeated(participant.playerId));
  }


  /**
   * Rebuild the world for a pre-match lobby mode change. This is allowed only
   * through LocalGameServer while its simulation clock is stopped. Participant
   * identities, display names, colors and connection state survive the rebuild.
   */
  public override configureLobbyMode(mode: GameEngineState['multiplayerMode']): void {
    const participants = this.state.humanPlayers.map(participant => ({
      playerId: participant.playerId,
      connected: participant.connected,
      displayName: participant.displayName,
      color: participant.color
    }));
    const hostDisplayName = participants.find(participant => participant.playerId === 'player-host')?.displayName ?? 'Host';

    // Suppress intermediate publications while cores, groups, participant data,
    // and the initial resource chunks are rebuilt as one coherent lobby world.
    this.scopedCommandDepth += 1;
    try {
      this.state = this.createInitialState();
      this.activeChunks.clear();
      this.harvesterChunkLocations.clear();
      this.uiSyncTimer = 0;
      this.keys = {};
      this.isPointerDown = false;
      this.playerControls.clear();
      this.playerControls.set('player-host', { keys: {}, pointerDown: false, aim: { x: 0, y: 0, gx: 0, gy: 0 }, selectedBuildingType: null, selectedStationId: null, aiming: false });
      this.activePlayerId = 'player-host';
      this.setMultiplayerMode(mode);
      this.setHumanParticipantDisplayName('player-host', hostDisplayName);

      for (const previous of participants.filter(participant => participant.playerId !== 'player-host')) {
        const participant = this.addHumanParticipant(previous.playerId, mode);
        participant.connected = previous.connected;
        participant.color = previous.color;
        this.setHumanParticipantDisplayName(previous.playerId, previous.displayName);
      }
      this.initWorld();
      this.triggerStateChange();
    } finally {
      this.scopedCommandDepth -= 1;
      if (this.scopedCommandDepth === 0 && this.pendingStateChange && !this.updatingHumanPlayers) {
        this.pendingStateChange = false;
        this.triggerStateChange();
      }
    }
  }


  /** Restart the whole room without orphaning connected remote participants or changing the room's mode. */
  public override restartGame(): boolean {
    if (!this.canRestartGame()) return false;
    this.rewardedCoreIds.clear();
    const mode = this.state.multiplayerMode;
    const hostDisplayName = this.state.humanPlayers.find(participant => participant.playerId === 'player-host')?.displayName ?? 'Host';
    const guestParticipants = this.state.humanPlayers.slice(1).map(participant => ({
      playerId: participant.playerId,
      connected: participant.connected,
      displayName: participant.displayName,
      color: participant.color
    }));

    this.state = this.createInitialState();
    this.rewardedCoreIds.clear();
    this.activeChunks.clear();
    this.harvesterChunkLocations.clear();
    this.uiSyncTimer = 0;
    this.keys = {};
    this.isPointerDown = false;
    this.playerControls.clear();
    this.playerControls.set('player-host', { keys: {}, pointerDown: false, aim: { x: 0, y: 0, gx: 0, gy: 0 }, selectedBuildingType: null, selectedStationId: null, aiming: false });
    this.activePlayerId = 'player-host';
    this.setMultiplayerMode(mode);
    this.setHumanParticipantDisplayName('player-host', hostDisplayName);
    for (const previous of guestParticipants) {
      const participant = this.addHumanParticipant(previous.playerId, mode);
      participant.connected = previous.connected;
      this.setHumanParticipantDisplayName(previous.playerId, previous.displayName);
      participant.color = previous.color;
    }
    this.initWorld();
    this.triggerStateChange();
    return true;
  }
}
