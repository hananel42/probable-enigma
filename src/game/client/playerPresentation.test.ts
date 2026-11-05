import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../engine';
import { isGroupFriendlyToParticipant, resolvePlayerBaseNavigationTargets } from './playerPresentation';

test('TEAM navigation marks distinct participant Cores as friendly', () => {
  const engine = new GameEngine(12345);
  const guest = engine.addHumanParticipant('guest-team', 'TEAM');
  const targets = resolvePlayerBaseNavigationTargets(engine.state);

  assert.equal(targets.length, 2);
  assert.equal(targets[0].relationship, 'HOME');
  assert.equal(targets[0].label, 'YOUR BASE');
  assert.equal(targets[1].playerId, guest.playerId);
  assert.equal(targets[1].relationship, 'ALLY');
  assert.equal(targets[1].color, '#4ade80');
});

test('FREE_FOR_ALL navigation marks another participant Core as hostile', () => {
  const engine = new GameEngine(12345);
  engine.setMultiplayerMode('FREE_FOR_ALL');
  const guest = engine.addHumanParticipant('guest-ffa', 'FREE_FOR_ALL');
  const targets = resolvePlayerBaseNavigationTargets(engine.state);

  assert.equal(targets.length, 2);
  assert.equal(targets[1].playerId, guest.playerId);
  assert.equal(targets[1].relationship, 'ENEMY');
  assert.equal(targets[1].color, '#f43f5e');
});

test('COOPERATIVE participants sharing one Core receive only the home indicator', () => {
  const engine = new GameEngine(12345);
  engine.addHumanParticipant('guest-coop', 'COOPERATIVE');

  const targets = resolvePlayerBaseNavigationTargets(engine.state);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].relationship, 'HOME');
  assert.equal(targets[0].core.id, engine.state.humanPlayers[0].coreId);
});

test('a second participant sharing an already represented Core does not duplicate its marker', () => {
  const engine = new GameEngine(12345);
  const firstGuest = engine.addHumanParticipant('guest-one', 'TEAM');
  const secondGuest = engine.addHumanParticipant('guest-two', 'TEAM');
  secondGuest.coreId = firstGuest.coreId;

  const targets = resolvePlayerBaseNavigationTargets(engine.state);

  assert.equal(targets.length, 2);
  assert.equal(targets[1].playerId, firstGuest.playerId);
});

test('group friendliness uses group identity or alliance identity, not player faction', () => {
  const engine = new GameEngine(12345);
  const guest = engine.addHumanParticipant('guest-group', 'TEAM');
  const guestGroup = engine.state.groups.find(group => group.id === guest.groupId);
  const host = engine.state.humanPlayers[0];
  assert.ok(guestGroup);

  assert.equal(isGroupFriendlyToParticipant(guestGroup, host), true);
  assert.equal(isGroupFriendlyToParticipant({ ...guestGroup, allianceId: 'hostile-alliance' }, host), false);
  assert.equal(isGroupFriendlyToParticipant(undefined, host), false);
});
