import { createPlayerOnlyState } from './fixtures/player-only';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { DomainModule, GameContent, GameState, ModuleContext, Phase, ResourceFrame, TrialBatch } from '../src/contracts/types';
import { createMarketsModule } from '../src/modules/markets';
import { createProductsModule, productDemand } from '../src/modules/products';

// These direct module fixtures isolate consumer arithmetic. Integration tests
// separately obtain the reference model through preparation and training.
function referenceState(accounts = 0): GameState {
  const state = createPlayerOnlyState(), companyId = state.playerCompanyId;
  state.week = 10;
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps.conversation = 4800; model.reliabilityBps = 8600; model.status = 'released';
  state.slices.products.offers.chat = { id: 'chat', companyId, name: 'Basic Chat', kind: 'basic-chat', deploymentId: 'deployment', contractId: 'contract', status: 'active', createdWeek: 8 };
  state.slices.products.deployments.deployment = { id: 'deployment', companyId, productId: 'chat', modelId: model.id, status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts.contract = { id: 'contract', companyId, productId: 'chat', weeklyPriceCents: 1200, allowance: 100, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['chat'];
  state.slices.compute.fleets[companyId].allocation = { serving: 4 * U, development: 0, research: 0 };
  state.slices.markets.waitlistRemaining = 0;
  if (accounts) state.slices.markets.cohorts = [{ id: 'existing-subscribers', companyId, productId: 'chat', contractId: 'contract', count: accounts, activeWeek: 9 }];
  state.slices.markets.payingConsumers = accounts;
  return state;
}

function trial(state: GameState, count: number, changes: Partial<TrialBatch> = {}): TrialBatch {
  return { id: 'existing-trial', companyId: state.playerCompanyId, productId: 'chat', count,
    createdWeek: state.week - 1, activeWeek: state.week, expiresWeek: state.week + 1,
    workCompleted: 0, requiredWork: count * CONTENT.firstSale.trialWork, ...changes };
}

function call(state: GameState, module: DomainModule, phase: Phase, content: GameContent, resources: ResourceFrame = { requests: [], computeGrants: [], staffGrants: [] }): GameState {
  const context: ModuleContext = { week: state.week, phase, content, facts: [], resources,
    random: { draw: () => { throw new Error('The aggregate reference market must not invent an unsaved draw.'); } } };
  const result = module.handlers[phase]!(state, context), next = structuredClone(state);
  Object.assign(next.slices, result.updates);
  return next;
}

function execute(state: GameState, work: number, content = CONTENT): GameState {
  const demand = productDemand(state, state.slices.products.offers.chat, content, state.week);
  return call(state, createProductsModule(content), 'execute', content, {
    requests: [], staffGrants: [], computeGrants: [{ requestId: 'serve:chat', physicalCUw: work, hardwareEffectiveCUw: work,
      memoryMU: demand.memory, poolId: 'general-cloud' }],
  });
}
const market = (state: GameState, content = CONTENT) => call(state, createMarketsModule(content), 'market', content);

test('W1-MARKET-01: partly completed trial batches preserve work and conversion fractions across both service weeks', () => {
  let state = referenceState();
  state.slices.markets.trials = [trial(state, 3)];
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 7_700_000;
  state = market(execute(state, 7_000_000));
  assert.equal(state.slices.markets.lastGained, 0);
  assert.equal(state.slices.markets.conversionCarry, 4500);
  assert.equal(state.slices.markets.trials.length, 1);
  assert.equal(state.slices.markets.trials[0].count, 2);
  assert.equal(state.slices.markets.trials[0].requiredWork, 10_000_000);
  assert.equal(state.slices.markets.trials[0].workCompleted, 2_000_000);
  assert.equal(state.slices.markets.lastTrialCount, 0, 'unfinished trials consume the next capacity forecast');

  state.week++;
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 8_800_000;
  state = market(execute(state, 8_000_000));
  assert.equal(state.slices.markets.trials.length, 0);
  assert.equal(state.slices.markets.lastGained, 1);
  assert.equal(state.slices.markets.conversionCarry, 3500);
  assert.equal(state.slices.markets.cohorts[0].activeWeek, 12);
  assert.equal(state.slices.products.lastUsage.chat.paidAccounts, 0);
  assert.equal(state.slices.products.lastUsage.chat.trialRequestedWork, 8_000_000);
});

test('W1-MARKET-02: unfinished fractional trial work expires without creating a subscriber', () => {
  let state = referenceState();
  state.slices.markets.trials = [trial(state, 3, { createdWeek: 8, activeWeek: 9, expiresWeek: 10 })];
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 2_200_000;
  state = market(execute(state, 2_000_000));
  assert.equal(state.slices.markets.trials.length, 0);
  assert.equal(state.slices.markets.lastGained, 0);
  assert.equal(state.slices.markets.payingConsumers, 0);
  assert.equal(state.slices.markets.conversionCarry, 0);
  assert.equal(state.slices.products.lastUsage.chat.trialExecutedWork, 2_000_000);
});

test('W1-MARKET-03: acquisition forecasts paid usage, pending trials, headroom, and session memory together', () => {
  function constrained(serving: number): GameState {
    const state = referenceState(3), fleet = state.slices.compute.fleets[state.playerCompanyId];
    fleet.cloudCU = 2 * U; fleet.memoryMU = 4 * U; fleet.allocation.serving = serving;
    state.slices.models.versions[CONTENT.seedModel.id].residentMU = 3_840_000_000;
    state.slices.markets.trials = [trial(state, 2, { createdWeek: 10, activeWeek: 11, expiresWeek: 12, workCompleted: 2_000_000 })];
    return market(execute(state, 60_000_000));
  }
  const computeLimited = constrained(85_800_000); // .078 CUw: .060 paid + .008 pending + .010 new trials.
  assert.equal(computeLimited.slices.markets.lastTrialCount, 2);
  const memoryLimited = constrained(99_000_000); // .090 CUw admits four trials; memory admits three.
  assert.equal(memoryLimited.slices.markets.lastTrialCount, 3);
  assert.equal(memoryLimited.slices.markets.trials.reduce((sum, batch) => sum + batch.count, 0), 5);
  const next = structuredClone(memoryLimited); next.week++;
  const nextDemand = productDemand(next, next.slices.products.offers.chat, CONTENT, next.week);
  assert.equal(nextDemand.memory, 4 * U, 'the shared model is counted once, followed by each peak session');
  assert.equal(nextDemand.paidWork + nextDemand.trialWork, 83_000_000);
});

test('W1-MARKET-04: the finite segment counts pending trials and subscriptions before new acquisition', () => {
  let full = referenceState(1399);
  const f = full.slices.compute.fleets[full.playerCompanyId]; f.cloudCU = 128 * U; f.memoryMU = 256 * U; f.allocation.serving = 128 * U;
  full.slices.markets.waitlistRemaining = 40;
  full.slices.markets.trials = [trial(full, 1, { segmentId: 'regular', createdWeek: 10, activeWeek: 11, expiresWeek: 12 })];
  full = market(execute(full, 27_980_000_000));
  assert.equal(full.slices.markets.waitlistRemaining, 40);
  const retained = full.slices.markets.cohorts.filter(c => (c.segmentId ?? 'regular') === 'regular').reduce((n,c) => n+c.count,0);
  const pending = full.slices.markets.trials.filter(t => (t.segmentId ?? 'regular') === 'regular').reduce((n,t) => n+t.count,0);
  assert.equal(full.slices.products.lastUsage.chat.paidAccounts, 1399);
  assert.equal(full.slices.products.lastUsage.chat.fulfillmentBps, 10000);
  assert.equal(full.slices.markets.returnedNextWeek.regular, 1399 - retained, 'all departures are deferred until next week');
  assert.equal(pending, 1, 'the already-pending trial retains its place');
  assert.equal(retained + pending + full.slices.markets.returnedNextWeek.regular, 1400, 'retained, trial, and returning accounts conserve the finite segment');
  let onePlace = referenceState(1399); onePlace.slices.markets.waitlistRemaining = 40;
  const nextFleet = onePlace.slices.compute.fleets[onePlace.playerCompanyId]; nextFleet.cloudCU = 128 * U; nextFleet.memoryMU = 256 * U; nextFleet.allocation.serving = 128 * U;
  onePlace = market(execute(onePlace, 27_980_000_000));
  assert.equal(onePlace.slices.markets.waitlistRemaining, 39);
});

test('W1-MARKET-05: reference conversion is 45 percent, and price or allowance changes alter consumer fit', () => {
  function complete(price: number, allowance: number): GameState {
    const state = referenceState();
    state.slices.products.contracts.contract.weeklyPriceCents = price;
    state.slices.products.contracts.contract.allowance = allowance;
    state.slices.markets.trials = [trial(state, 20)];
    return market(execute(state, 100_000_000));
  }
  const reference = complete(1200, 100);
  assert.equal(reference.slices.markets.lastGained, 9);
  assert.equal(reference.slices.markets.conversionCarry, 0);
  const costly = complete(2400, 100), small = complete(1200, 50);
  assert.equal(costly.slices.markets.lastGained, 4); assert.equal(costly.slices.markets.conversionCarry, 5000);
  assert.equal(small.slices.markets.lastGained, 4); assert.equal(small.slices.markets.conversionCarry, 5000);
  assert.equal(complete(1200, 500).slices.markets.lastGained, 9, 'regular consumers value their typical 100 exchanges, not unused allowance');
});
