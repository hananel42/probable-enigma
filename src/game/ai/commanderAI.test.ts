import test from 'node:test';
import assert from 'node:assert/strict';
import type { EnemyBase, ResourceNode } from '../types';
import { CommanderAI } from './commanderAI';
import { createBuildingInstance, createCommander, getRepairCost, GRID_SIZE } from '../rules';

const TEAM_ID = 'enemy-team-mining-regression';

function makeResource(id: string, type: ResourceNode['type'], gx: number, gy: number, amount = 100): ResourceNode {
  return {
    id,
    type,
    gx,
    gy,
    x: gx * GRID_SIZE + GRID_SIZE / 2,
    y: gy * GRID_SIZE + GRID_SIZE / 2,
    amount,
    maxAmount: amount,
    radius: 12,
    seed: 1
  };
}

function makeEnemyBase(core: ReturnType<typeof createBuildingInstance>, commanderId: string): EnemyBase {
  return {
    id: 'enemy-base-mining-regression',
    teamId: TEAM_ID,
    allianceId: TEAM_ID,
    x: core.x,
    y: core.y,
    gx: core.gx,
    gy: core.gy,
    coreId: core.id,
    commanderId,
    level: 1,
    raidTimer: 100,
    raidInterval: 100,
    isDestroyed: false,
    resources: { wood: 0, stone: 0, diamonds: 0 },
    buildTimer: 100,
    repairTimer: 100,
    stance: 'FORTIFYING'
  };
}

function makeDamagedCoreAndCommander() {
  const core = createBuildingInstance('CORE', 'enemy', 0, 0, 'mining-regression-core', TEAM_ID);
  core.hp = Math.max(1, core.maxHp - Math.ceil(core.maxHp * 0.35));

  const commander = createCommander('enemy', 0, 0, 'mining-regression-commander');
  commander.teamId = TEAM_ID;
  commander.allianceId = TEAM_ID;

  const repairCost = getRepairCost(core);
  const preferredType: ResourceNode['type'] = repairCost.wood >= repairCost.stone ? 'wood' : 'stone';
  const target = makeResource(`mining-target-${preferredType}`, preferredType, 3, 0);
  commander.x = target.x;
  commander.y = target.y;
  commander.aiGoal = 'MINE_RESOURCE';
  commander.aiTargetResourceId = target.id;
  commander.miningTargetId = target.id;
  commander.isActivelyMining = true;
  commander.miningProgress = 0.95;
  // Force the next update through the fast strategic decision cadence used
  // while a Core is damaged. This was resetting mining progress every ~0.16s.
  commander.aiDecisionTimer = 1;

  const otherType: ResourceNode['type'] = preferredType === 'wood' ? 'stone' : 'wood';
  const otherTarget = makeResource(`mining-target-${otherType}`, otherType, 3, 0);
  return { core, commander, target, otherTarget, preferredType };
}

test('damaged-Core replanning preserves progress when the commander keeps mining the same deposit', () => {
  const ai = new CommanderAI();
  const { core, commander, target, otherTarget } = makeDamagedCoreAndCommander();
  const base = makeEnemyBase(core, commander.id);
  const resources = [target, otherTarget];
  const wallet = base.resources;

  ai.updateCommander(commander, wallet, [core], resources, [commander], [], [base], 0.1);

  assert.ok(wallet[target.type] > 0, 'completed extraction must credit the enemy faction wallet');
  assert.ok(target.amount < target.maxAmount, 'completed extraction must deplete the resource deposit');
  assert.equal(commander.aiGoal, 'IDLE', 'a completed batch releases the mining goal for the next strategic decision');
  assert.equal(commander.aiTargetResourceId, null, 'a completed batch clears the old target');
  assert.equal(commander.miningProgress, 0, 'completed batch starts a fresh extraction cycle');
  assert.equal(commander.isActivelyMining, false, 'the mining animation must stop after a batch is collected');
});

test('retargeting a depleted deposit resets stale mining progress instead of carrying it to another node', () => {
  const ai = new CommanderAI();
  const { core, commander, target, otherTarget } = makeDamagedCoreAndCommander();
  target.amount = 0;
  commander.miningProgress = 0.72;
  const base = makeEnemyBase(core, commander.id);
  const resources = [target, otherTarget];

  ai.updateCommander(commander, base.resources, [core], resources, [commander], [], [base], 0.1);

  assert.equal(commander.aiGoal, 'MINE_RESOURCE');
  assert.equal(commander.aiTargetResourceId, otherTarget.id, 'the planner must choose the remaining resource type needed by the Core');
  assert.ok(commander.miningProgress >= 0 && commander.miningProgress < 0.1,
    'the replacement job must start at zero progress before this frame adds its small increment');
  assert.equal(commander.miningTargetId, otherTarget.id);
});
