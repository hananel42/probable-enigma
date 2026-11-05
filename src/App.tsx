import React, { useCallback, useState } from 'react';
import { GuidanceProvider } from './guidance/GuidanceProvider';
import { createRandomRobotName, resolveDisplayName } from './game/multiplayer/displayName';
import { HomePage } from './app/home/HomePage';
import { SinglePlayerGame } from './app/singleplayer/SinglePlayerGame';
import { WorldSelectScreen } from './app/worlds/WorldSelectScreen';
import type { LoadedWorld } from './game/persistence/WorldSaveStore';

type AppScreen = 'HOME' | 'WORLD_SELECT' | 'SINGLE_PLAYER';

const AppContent: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>('HOME');
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [activeDisplayName, setActiveDisplayName] = useState('');
  const [activeWorld, setActiveWorld] = useState<LoadedWorld | null>(null);
  const resolveAndStoreName = useCallback(() => {
    const resolved = resolveDisplayName(displayNameInput);
    setDisplayNameInput(resolved);
    setActiveDisplayName(resolved);
    return resolved;
  }, [displayNameInput]);
  const startSinglePlayer = useCallback(() => {
    resolveAndStoreName();
    setScreen('WORLD_SELECT');
  }, [resolveAndStoreName]);
  const enterWorld = useCallback((world: LoadedWorld) => {
    setActiveWorld(world);
    setScreen('SINGLE_PLAYER');
  }, []);

  return (
    <>
      {screen === 'HOME' && <HomePage
        onStartSinglePlayer={startSinglePlayer}
        displayName={displayNameInput}
        onDisplayNameChange={setDisplayNameInput}
        onRandomizeName={() => setDisplayNameInput(createRandomRobotName())}
        onResolveDisplayName={resolveAndStoreName}
      />}
      {screen === 'WORLD_SELECT' && <WorldSelectScreen onEnterWorld={enterWorld} onBackToHome={() => setScreen('HOME')} />}
      {screen === 'SINGLE_PLAYER' && activeWorld && <SinglePlayerGame
        key={activeWorld.metadata.id}
        world={activeWorld}
        displayName={activeDisplayName || resolveDisplayName(displayNameInput)}
        onExitToMenu={() => setScreen('WORLD_SELECT')}
      />}
    </>
  );
};

export const App: React.FC = () => (
  <GuidanceProvider>
    <AppContent />
  </GuidanceProvider>
);

export default App;
