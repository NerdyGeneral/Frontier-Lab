import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, DomainModule, GameState, RoleAllocation, StaffRole } from '../src/contracts/types';
import { advanceWeek, createInitialState, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { emptyRoleAllocation, getWorkforce, withPassiveWorkforce } from '../src/modules/workforce';
import { getStaffPointProfile } from '../src/modules/workforce-points';
import { createPlayerOnlyState } from './fixtures/player-only';

function queue(state: GameState, payload: CommandPayload, id: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}

function step(state: GameState, modules?: readonly DomainModule[]): GameState {
  const result = advanceWeek(state, CONTENT, modules);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}

function reload(state: GameState): GameState {
  const result = deserializeState(serializeState(state));
  assert.ok(result.ok, result.ok ? undefined : result.error);
  return result.state;
}

const sum = (allocation: RoleAllocation) => Object.values(allocation).reduce((total, value) => total + value, 0);

test('a new solo company can go from raw data to its first paying customer without staffing commands', () => {
  let game = createInitialState(CONTENT, 'release');
  const owner = game.playerCompanyId;
  game = queue(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'solo-data');
  game = queue(game, { kind: 'allocate_compute', development: 4 * U, research: 0, serving: 0 }, 'solo-compute');
  game = step(game);
  assert.equal(game.slices.company.lastStaff[owner].granted.data, U);
  game = step(game);
  assert.equal(game.slices.data.packets[CONTENT.starterData.id].prepared, true);

  game = queue(game, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, 'solo-training');
  const savedTrainingOrder = reload(game);
  game = step(game);
  assert.deepEqual(step(savedTrainingOrder), game, 'reloading a queued training run yields the same weekly grants and progress');
  assert.equal(game.slices.company.lastStaff[owner].granted.ml, U);
  const training = (state: GameState) => state.slices.models.trainingRuns['training-solo-training'];
  assert.equal(training(game).completedWork, 4 * U);
  for (let week = 0; week < 5 && training(game).status !== 'complete'; week++) game = step(game);
  assert.equal(training(game).status, 'complete');

  const modelId = training(game).outputModelId;
  game = step(queue(game, { kind: 'evaluate_model', modelId }, 'solo-test'));
  assert.equal(game.slices.company.lastStaff[owner].granted.research, U / 2);
  assert.ok(game.slices.models.evaluationRuns['evaluation-solo-test'].reportId);

  game = queue(game, { kind: 'deploy_product', modelId, priceCents: 1200, allowance: 100 }, 'solo-launch');
  game = queue(game, { kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 }, 'solo-serving');
  game = step(game);
  assert.equal(game.slices.company.lastStaff[owner].granted.ml, U);
  for (let week = 0; week < 6 && game.slices.company.companies[owner].earnedRevenueCents === 0; week++) game = step(game);
  assert.ok(game.slices.company.companies[owner].earnedRevenueCents > 0);
  assert.equal(game.slices.company.companies[owner].activeStaff, 0);
  assert.deepEqual(validateState(game), []);
});

test('a paid specialist regains their full profile when an old zero-output save resumes, including queued legacy changes', () => {
  let original = queue(createPlayerOnlyState(), { kind: 'hire_staff', role: 'data' }, 'legacy-hire');
  original = step(original);
  const staffId = 'staff:legacy-hire';
  original = step(queue(original, { kind: 'set_staff_allocation', staffId, fte: 0 }, 'legacy-idle'));
  assert.equal(original.slices.company.staff[staffId].assignedFte, 0);
  // A saved decision may still settle after the new rules take effect.
  original = queue(original, { kind: 'set_staff_allocation', staffId, fte: U / 4 }, 'legacy-quarter');
  const owner = original.playerCompanyId;
  const oldBytes = serializeState(original);
  let game = withPassiveWorkforce(reload(original));
  assert.equal(serializeState(original), oldBytes);
  assert.deepEqual(game.slices.company.ledger, original.slices.company.ledger);
  assert.equal(game.slices.company.companies[owner].cashCents, original.slices.company.companies[owner].cashCents);
  assert.equal(getWorkforce(game, owner).onboarding, 1);
  game = step(queue(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'legacy-data'));
  assert.equal(game.week, game.slices.company.staff[staffId].readyWeek);
  assert.equal(getWorkforce(game, owner).ready, 1);
  const capacity = game.slices.company.lastStaff[owner].capacity;
  for (const [role, amount] of Object.entries(getStaffPointProfile('data'))) {
    assert.ok(capacity[role as StaffRole] >= amount, role + ' should include the full specialist profile');
  }
  const job = game.slices.data.preparationJobs['preparation-legacy-data'];
  assert.equal(job.completedStaff, job.requiredStaff, 'the specialist and founder finish the two-unit job together');
  assert.equal(game.commandReceipts['legacy-quarter'].status, 'accepted', 'a pending legacy setting does not break the weekly transaction');
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === 'recruit:legacy-hire').length, 1);
  assert.equal(game.slices.company.ledger.filter(fact => fact.sourceId === staffId && fact.category === 'operating').length, 3);

  const dismissed = queue(game, { kind: 'dismiss_staff', staffId }, 'legacy-dismiss');
  const continuous = step(dismissed);
  assert.deepEqual(step(reload(dismissed)), continuous);
  assert.equal(getWorkforce(continuous, owner).ready, 0);
  assert.equal(continuous.slices.company.ledger.filter(fact => fact.sourceId === staffId && fact.category === 'operating').length, 3);
});

test('specialists cover their categories before the founder, and simultaneous jobs share one weekly founder budget', () => {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  game = step(step(step(queue(game, { kind: 'hire_staff', role: 'data' }, 'priority-hire'))));
  const demands: { id: string; role: StaffRole; amount: number; priority: number }[] = [
    { id: 'hardware', role: 'hardware', amount: U, priority: 1 },
    { id: 'data', role: 'data', amount: 3 * U / 2, priority: 2 },
    { id: 'business', role: 'commercial', amount: 3 * U / 4, priority: 3 },
    { id: 'research', role: 'research', amount: 2 * U, priority: 4 },
    { id: 'more-research', role: 'research', amount: 2 * U, priority: 5 },
  ];
  const grants: Record<string, number> = {};
  const observer: DomainModule = { id: 'weekly-staff-jobs', owns: [], handlers: {
    reserve: state => ({ workRequests: demands.map(({ id, role, amount, priority }) => ({
      id, taskId: id, companyId: state.playerCompanyId, category: 'development',
      normalizedWorkCUw: 0, memoryMU: 0, poolId: 'auto', priority, staffDemand: [{ role, staffWeeks: amount }],
    })) }),
    execute: (_state, context) => {
      for (const grant of context.resources.staffGrants) grants[grant.requestId] = grant.grants[0].staffWeeks;
      return {};
    },
  } };
  assert.equal(sum(game.slices.company.lastStaff[game.playerCompanyId].granted), 0, 'idle weeks do not award project progress');
  game = step(game, [createCompanyModule(CONTENT), createComputeModule(CONTENT), observer]);
  assert.deepEqual(grants, { hardware: 0, data: 3 * U / 2, business: 3 * U / 4, research: U / 2, 'more-research': 0 });
  const { capacity, granted } = game.slices.company.lastStaff[game.playerCompanyId];
  assert.deepEqual(granted, { ...emptyRoleAllocation(), data: 3 * U / 2, commercial: 3 * U / 4, research: U / 2 });
  assert.equal(sum(capacity), sum(getStaffPointProfile('data')) + U);
  for (const role of Object.keys(capacity) as StaffRole[]) assert.ok(granted[role] <= capacity[role]);
});
