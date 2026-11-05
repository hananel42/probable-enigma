import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { BuildingType, DroneStationMode } from '../../game/types';
import type { GameClientPort, GameCommand } from '../../game/server/protocol';
import type { HostRoomController } from '../../game/multiplayer/HostRoomController';
import type { RemoteGameClientPort } from '../../game/multiplayer/RemoteGameClientPort';
import { normalizeChatText } from '../../game/multiplayer/chat';
import type { GameMode } from '../../game/multiplayer/types';
import { getRoomActionMessage } from './roomMessages';

type RoomRole = 'host' | 'guest';

interface RoomActionsOptions {
  role: RoomRole;
  chatDraft: string;
  setChatDraft: Dispatch<SetStateAction<string>>;
  setChatNotice: Dispatch<SetStateAction<string | null>>;
  setChatVisible: (visible: boolean) => void;
  setRoomPanelVisible: (visible: boolean) => void;
  setRoomActionError: Dispatch<SetStateAction<string | null>>;
  setDefeatNotice: Dispatch<SetStateAction<boolean>>;
  hostProtocolRef: MutableRefObject<HostRoomController | null>;
  remoteClientRef: MutableRefObject<RemoteGameClientPort | null>;
  clientPortRef: MutableRefObject<GameClientPort | null>;
}

/** Centralizes multiplayer UI actions while keeping transport and host authority in their owning controllers. */
export function useRoomActions({
  role,
  chatDraft,
  setChatDraft,
  setChatNotice,
  setChatVisible,
  setRoomPanelVisible,
  setRoomActionError,
  setDefeatNotice,
  hostProtocolRef,
  remoteClientRef,
  clientPortRef
}: RoomActionsOptions) {
  const sendChat = useCallback((rawText: string) => {
    const text = normalizeChatText(rawText);
    if (role === 'host') {
      const hostProtocol = hostProtocolRef.current;
      if (!hostProtocol) throw new Error('The room host is not ready to send chat yet.');
      hostProtocol.sendHostChat(text);
    } else {
      const remoteClient = remoteClientRef.current;
      if (!remoteClient) throw new Error('The room connection is not ready to send chat yet.');
      remoteClient.sendChat(text);
    }
  }, [hostProtocolRef, remoteClientRef, role]);

  const submitChat = useCallback(() => {
    const raw = chatDraft;
    if (raw.trim()) {
      try {
        sendChat(raw);
      } catch (error) {
        console.error('[multiplayer chat] Failed to send a room message.', { error });
        setChatNotice('Message could not be sent. Check the room connection and try again.');
      }
    }
    setChatDraft('');
    setChatVisible(false);
  }, [chatDraft, sendChat, setChatDraft, setChatNotice, setChatVisible]);

  const dispatch = useCallback((command: GameCommand) => {
    clientPortRef.current?.dispatch(command);
  }, [clientPortRef]);

  const withRoomAction = useCallback((action: () => void) => {
    setRoomActionError(null);
    try {
      action();
    } catch (error) {
      console.error('[multiplayer room management] Room action failed.', { error });
      setRoomActionError(getRoomActionMessage(error));
    }
  }, [setRoomActionError]);

  const handleSetRoomMode = useCallback((nextMode: GameMode) => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can change game mode.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.setRoomMode(nextMode);
  }), [hostProtocolRef, role, withRoomAction]);

  const handleStartMatch = useCallback(() => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can start the match.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.startMatch();
    setRoomPanelVisible(false);
  }), [hostProtocolRef, role, setRoomPanelVisible, withRoomAction]);

  const handlePauseWorld = useCallback(() => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can pause the world.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.pauseMatch();
    setRoomPanelVisible(true);
  }), [hostProtocolRef, role, setRoomPanelVisible, withRoomAction]);

  const handleResumeWorld = useCallback(() => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can resume the world.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.resumeMatch();
    setRoomPanelVisible(false);
  }), [hostProtocolRef, role, setRoomPanelVisible, withRoomAction]);

  const handleReviveParticipant = useCallback((playerId: string) => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can revive a participant.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.reviveParticipant(playerId);
  }), [hostProtocolRef, role, withRoomAction]);

  const handleKickParticipant = useCallback((playerId: string) => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can remove another participant.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.kickParticipant(playerId);
  }), [hostProtocolRef, role, withRoomAction]);

  const handleNewLobby = useCallback(() => withRoomAction(() => {
    if (role !== 'host') throw new Error('Only the room host can create a new lobby.');
    const controller = hostProtocolRef.current;
    if (!controller) throw new Error('Room authority is not initialized.');
    controller.returnToLobby();
    setRoomPanelVisible(true);
    setDefeatNotice(false);
  }), [hostProtocolRef, role, setDefeatNotice, setRoomPanelVisible, withRoomAction]);

  const handleSelectBuilding = useCallback((type: BuildingType | null) => dispatch({ type: 'SELECT_BUILDING', buildingType: type }), [dispatch]);
  const handleSetDroneMode = useCallback((stationId: string, mode: DroneStationMode) => dispatch({ type: 'SET_DRONE_MODE', stationId, mode }), [dispatch]);
  const handleRepair = useCallback((buildingId: string) => dispatch({ type: 'REPAIR_NEARBY', buildingId }), [dispatch]);
  const handleDismantle = useCallback((buildingId: string) => dispatch({ type: 'DISMANTLE_NEARBY', buildingId }), [dispatch]);
  const handleRestart = useCallback(() => dispatch({ type: 'RESTART' }), [dispatch]);

  return {
    submitChat,
    handleSetRoomMode,
    handleStartMatch,
    handlePauseWorld,
    handleResumeWorld,
    handleReviveParticipant,
    handleKickParticipant,
    handleNewLobby,
    handleSelectBuilding,
    handleSetDroneMode,
    handleRepair,
    handleDismantle,
    handleRestart
  };
}
