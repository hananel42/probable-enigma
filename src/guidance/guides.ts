import type { GuidanceDefinition } from './types';

/**
 * Application guides are data, not screen-specific component logic. New guides
 * can reuse the same provider, overlay, anchors, keyboard controls, and progress store.
 */
export const APP_GUIDES: readonly GuidanceDefinition[] = [
  {
    id: 'first-visit',
    version: '1',
    title: 'First-visit briefing',
    autoStart: true,
    steps: [
      {
        id: 'overview',
        title: 'Welcome to Craftbound',
        body: 'Build an outpost, automate resource collection, and defend your Core. This short briefing points out the main ways to enter the game.',
        target: 'home-title',
        placement: 'bottom'
      },
      {
        id: 'callsign',
        title: 'Choose a callsign',
        body: 'Enter a name for your Commander, or leave this blank to receive a generated robot callsign.',
        target: 'home-callsign',
        placement: 'bottom'
      },
      {
        id: 'single-player',
        title: 'Play solo',
        body: 'Start a local single-player world here. You can return to the main menu when you want to leave that run.',
        target: 'home-single-player',
        placement: 'bottom'
      },
      {
        id: 'multiplayer',
        title: 'Play with others',
        body: 'Create a room or join with a room code. Creating or joining a room only connects players; the host starts the world when everyone is ready.',
        target: 'home-multiplayer',
        placement: 'top'
      }
    ]
  }
];
