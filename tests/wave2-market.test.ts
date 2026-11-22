import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_FEATURES, MARKET_SEGMENTS, SEGMENT_BY_ID } from '../src/content/wave2-market';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { DomainModule, DomainResult, GameState, ModuleContext, Phase, ProductFeatures, ProductKind, ResourceFrame } from '../src/contracts/types';
import { advanceWeek, createInitialState } from '../src/core/engine';
import { getGameView } from '../src/core/selectors';
import { assertWave2MarketState } from '../src/core/wave2-market-validation';
import { createPlayerOnlyState } from './fixtures/player-only';
import { behaviorMeter, createProductsModule, meteredBill, productDemand, requestMeter, taskScore } from '../src/modules/products';
import { createMarketsModule, getMarketView } from '../src/modules/markets';

const products = createProductsModule(CONTENT), markets = createMarketsModule(CONTENT);
const emptyResources = (): ResourceFrame => ({ requests: [], staffGrants: [], computeGrants: [] });
function context(state: GameState, phase: Phase, resources = emptyResources()): ModuleContext { return { week: state.week, phase, content: CONTENT, facts: [], resources, random: { draw: () => { throw new Error('Aggregate product economics must be deterministic.'); } } }; }
function update(state: GameState, result: DomainResult): GameState { const next = structuredClone(state); Object.assign(next.slices, structuredClone(result.updates ?? {})); return next; }
function run(state: GameState, module: DomainModule, phase: Phase, resources = emptyResources()): GameState { return update(state, module.handlers[phase]!(state, context(state, phase, resources))); }
function reference(kind: ProductKind = 'developer-api', accounts = 10, features: ProductFeatures = { ...DEFAULT_FEATURES }): GameState {
  const state = createPlayerOnlyState(), companyId = state.playerCompanyId; state.week = 10;
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps = { conversation: 6500, documents: 7000, coding: 6000, tools: 5500 }; model.reliabilityBps = 9600; model.status = 'released'; model.scenarioStart = true;
  const reportId = 'reference-report'; model.evaluationReportId = reportId;
  state.slices.models.reports[reportId] = { id: reportId, companyId, modelId: model.id, week: 8, heldOut: true, scenarioStart: true, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, basicChatEligible: true,
    cases: Array.from({ length: 20 }, (_, i) => ({ id: `reference-${i}`, domain: 'conversation', difficultyBps: 0, passed: true })), passedCases: 20 };
  state.slices.products.offers.service = { id: 'service', companyId, name: 'Reference service', kind, features, publicModelId: model.id, deploymentId: 'deployment', contractId: 'contract', status: 'active', createdWeek: 8 };
  state.slices.products.deployments.deployment = { id: 'deployment', companyId, productId: 'service', modelId: model.id, status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  const segmentId = kind === 'developer-api' ? 'developers' : kind === 'business-docs' ? 'business' : 'regular';
  state.slices.products.contracts.contract = { id: 'contract', companyId, productId: 'service', weeklyPriceCents: SEGMENT_BY_ID[segmentId].referencePriceCents, allowance: SEGMENT_BY_ID[segmentId].exchanges, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['service']; state.slices.markets.waitlistRemaining = 0;
  const fleet = state.slices.compute.fleets[companyId]; fleet.cloudCU = 128 * U; fleet.memoryMU = 256 * U; fleet.allocation = { serving: 128 * U, development: 0, research: 0 };
  if (accounts) state.slices.markets.cohorts = [{ id: 'accounts', companyId, productId: 'service', contractId: 'contract', segmentId, count: accounts, activeWeek: 9, ...(kind === 'business-docs' ? { renewalWeek: 21, breachWeeks: 0 } : {}) }];
  state.slices.markets.payingConsumers = kind === 'basic-chat' ? accounts : 0;
  return state;
}
function execute(state: GameState, work: number): GameState {
  const demand = productDemand(state, state.slices.products.offers.service, CONTENT, state.week);
  return run(state, products, 'execute', { requests: [], staffGrants: [], computeGrants: [{ requestId: 'serve:service', physicalCUw: work, hardwareEffectiveCUw: work, memoryMU: demand.memory, poolId: 'general-cloud' }] });
}
function demand(state: GameState) { return productDemand(state, state.slices.products.offers.service, CONTENT, state.week); }
function assertPopulation(state: GameState): void {
  for (const segment of MARKET_SEGMENTS) {
    const used = state.slices.markets.cohorts.filter(c => (c.segmentId ?? 'regular') === segment.id).reduce((sum, c) => sum + c.count, 0)
      + state.slices.markets.trials.filter(t => (t.segmentId ?? 'regular') === segment.id).reduce((sum, t) => sum + t.count, 0)
      + (state.slices.markets.returnedNextWeek[segment.id] ?? 0);
    assert.ok(used <= segment.population, segment.name + ' must remain finite.');
  }
}

test('W2-M01: input, output, internal tokens and model family scale work once', () => {
  const state = reference(), model = state.slices.models.versions[CONTENT.seedModel.id];
  assert.deepEqual(requestMeter(model, { ...DEFAULT_FEATURES }), { inputTokens: 500, outputTokens: 100, internalTokens: 0, work: 200000, sessionMemory: 20000000 });
  const configured = requestMeter(model, { memory: true, extendedContext: true, deepReasoning: true });
  assert.deepEqual(configured, { inputTokens: 1200, outputTokens: 100, internalTokens: 200, work: 540000, sessionMemory: 80000000 });
  for (const [family, scale] of [['medium', 2], ['large', 4]] as const) {
    const bigger = requestMeter({ ...model, family }, { memory: true, extendedContext: true, deepReasoning: true });
    assert.equal(bigger.work, configured.work * scale); assert.equal(bigger.inputTokens, configured.inputTokens); assert.equal(bigger.sessionMemory, configured.sessionMemory);
  }
  assert.equal(taskScore(model, SEGMENT_BY_ID.developers, { memory: true, extendedContext: true, deepReasoning: true }) - taskScore(model, SEGMENT_BY_ID.developers, { ...DEFAULT_FEATURES }), 1500);
});

test('W2-M02: API charges executed paid tokens, preserves partial requests and sub-cent carry, and excludes free trials', () => {
  let state = reference('developer-api', 1); const meter = demand(state).meter;
  state.slices.markets.trials = [{ id: 'free', companyId: state.playerCompanyId, productId: 'service', segmentId: 'developers', count: 2, createdWeek: 9, activeWeek: 10, expiresWeek: 11, workCompleted: 0, workPerAccount: 150 * meter.work, requiredWork: 300 * meter.work }];
  state = execute(state, Math.floor(meter.work * 1.5));
  const u = state.slices.products.lastUsage.service;
  assert.equal(u.tokens!.inputTokens, 750); assert.equal(u.tokens!.outputTokens, 150); assert.equal(u.tokens!.internalTokens, 0);
  assert.equal(u.billedCents, 15); assert.equal(u.creditsCents, 0); assert.equal(u.trialExecutedWork, 0);
  assert.equal(u.fulfillmentBps, 25); assertWave2MarketState(state, CONTENT);
  const bill = meteredBill(1, 0, 0, 3333, 9999, 0); assert.equal(bill.cents, 0); assert.equal(bill.remainder, 3333);
  assert.deepEqual(meteredBill(1, 0, 0, 3333, 9999, 999999), { cents: 1, remainder: 3332 });
  let free = reference('developer-api', 0); free.slices.markets.trials = structuredClone(state.slices.markets.trials);
  free = execute(free, 300 * meter.work); assert.equal(free.slices.products.lastUsage.service.billedCents, 0); assert.equal(free.slices.products.lastUsage.service.tokens!.inputTokens, 0);
  state.week++; state = execute(state, 0); assert.equal(state.slices.products.lastUsage.service.billedCents, 0); assert.equal(state.slices.products.lastUsage.service.tokens!.outputTokens, 0);
});

test('W2-M03: deep reasoning is billed as executed internal output and wrong attempts remain metered', () => {
  let state = reference('developer-api', 1, { memory: false, extendedContext: false, deepReasoning: true });
  state.slices.models.versions[CONTENT.seedModel.id].reliabilityBps = 6000;
  state = execute(state, demand(state).paidWork);
  const usage = state.slices.products.lastUsage.service;
  assert.equal(usage.tokens!.inputTokens, 300000); assert.equal(usage.tokens!.outputTokens, 60000); assert.equal(usage.tokens!.internalTokens, 120000);
  assert.equal(usage.billedCents, 12000); assert.ok(usage.errorBps > 3000);
  assertWave2MarketState(state, CONTENT);
});

test('W2-M04: feature changes reprice unfinished trials without refilling their completed fraction', () => {
  let state = reference('basic-chat', 0); const old = demand(state).meter;
  state.slices.markets.trials = [{ id: 'partial-trial', companyId: state.playerCompanyId, productId: 'service', segmentId: 'regular', count: 2, createdWeek: 9, activeWeek: 10, expiresWeek: 11, workCompleted: 10 * old.work, workPerAccount: 25 * old.work, requiredWork: 50 * old.work }];
  state.slices.products.offers.service.features = { memory: false, extendedContext: false, deepReasoning: true };
  const now = demand(state); assert.equal(now.meter.work, 2 * old.work);
  assert.equal(now.trials[0].workCompleted, 10 * now.meter.work); assert.equal(now.trialWork, 40 * now.meter.work);
  state = execute(state, 15 * now.meter.work); state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  state = run(state, markets, 'market');
  const pending = state.slices.markets.trials.find(t => t.id === 'partial-trial')!;
  assert.equal(pending.count, 1); assert.equal(pending.workCompleted, 0); assert.equal(pending.requiredWork, 25 * now.meter.work);
  assert.equal(pending.workPerAccount, 25 * now.meter.work); assertWave2MarketState(state, CONTENT);
});

test('W2-M05: calibration changes retention and trust without inventing useful service or revenue', () => {
  function measured(confident: number, refusal = 700) {
    let state = reference('basic-chat', 1000); const model = state.slices.models.versions[CONTENT.seedModel.id];
    model.capabilityBps.conversation = 4800; model.reliabilityBps = 8600; model.behavior = { confidentErrorBps: confident, falseRefusalBps: refusal };
    state = execute(state, demand(state).paidWork); state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
    return run(state, markets, 'market');
  }
  const baseline = measured(1000), calibrated = measured(600), fewerRefusals = measured(600, 200);
  assert.equal(calibrated.slices.products.lastUsage.service.errorBps, baseline.slices.products.lastUsage.service.errorBps);
  assert.equal(calibrated.slices.products.lastUsage.service.billedCents, baseline.slices.products.lastUsage.service.billedCents);
  assert.equal(baseline.slices.markets.trustBps, 5010); assert.equal(calibrated.slices.markets.trustBps, 5025);
  assert.ok(calibrated.slices.markets.churnCarry < baseline.slices.markets.churnCarry);
  assert.ok(fewerRefusals.slices.markets.churnCarry < calibrated.slices.markets.churnCarry);
  assert.deepEqual(behaviorMeter({ ...baseline.slices.models.versions[CONTENT.seedModel.id], behavior: { confidentErrorBps: 1000, falseRefusalBps: 700 } }, 500), { confidentErrorBps: 500, falseRefusalBps: 700 });
});

test('W2-M06: all six markets conserve customers, pending trials and next-week returns', () => {
  let state = reference('basic-chat', 1399); const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps.conversation = 4800; model.reliabilityBps = 8600; state.slices.markets.waitlistRemaining = 40;
  state.slices.markets.trials = [{ id: 'last-place', companyId: state.playerCompanyId, productId: 'service', segmentId: 'regular', count: 1, createdWeek: 10, activeWeek: 11, expiresWeek: 12, workCompleted: 0, workPerAccount: 5000000, requiredWork: 5000000 }];
  state = run(execute(state, demand(state).paidWork), markets, 'market');
  assert.equal(state.slices.markets.waitlistRemaining, 40, 'Departures cannot re-enter the market during the same week.');
  const returning = state.slices.markets.returnedNextWeek.regular; assert.ok(returning > 0);
  const view = getMarketView(state, CONTENT).segments.find(segment => segment.id === 'regular')!;
  assert.equal(view.outside, 0); assert.equal(view.returning, returning); assertPopulation(state); assertWave2MarketState(state, CONTENT);
  state.week++; state = run(execute(state, demand(state).paidWork + demand(state).trialWork), markets, 'market');
  assert.ok(state.slices.markets.waitlistRemaining < 40, 'Last week’s returned shoppers are available this week.'); assertPopulation(state);
});

test('W2-M07: upgrades retain public released scores, pause serving, and credit the existing subscriptions', () => {
  let state = reference('basic-chat', 10); const previous = state.slices.models.versions[CONTENT.seedModel.id];
  const modelId = 'private-candidate', reportId = 'private-report', trainingId = 'private-training';
  // The isolated upgrade fixture needs explicit ancestry and training rights,
  // just as a candidate produced by the lab has before commercial admission.
  const evidence = { ...structuredClone(CONTENT.starterData), prepared: true, readyUnits: CONTENT.starterData.rawUnits };
  state.slices.models.trainingRuns[trainingId] = { id: trainingId, companyId: state.playerCompanyId, baseModelId: previous.id, packetId: evidence.id, outputModelId: modelId,
    recipeId: CONTENT.firstTraining.id, startedWeek: 1, completedWeek: 7, requiredWork: CONTENT.firstTraining.workCUw, completedWork: CONTENT.firstTraining.workCUw,
    physicalWork: CONTENT.firstTraining.workCUw, requiredMemory: CONTENT.firstSale.trainingMemory, status: 'complete', checkpointWork: 0, checkpointModelId: null,
    anchorScores: { ...previous.capabilityBps }, anchorReliabilityBps: previous.reliabilityBps, evidence, lastProgress: 0, lastBottleneck: '' };
  state.slices.models.versions[modelId] = { ...structuredClone(previous), id: modelId, parentModelId: previous.id, trainingRunId: trainingId, name: 'Private unreleased candidate', status: 'evaluated', capabilityBps: { ...previous.capabilityBps, conversation: 6900 }, evaluationReportId: reportId };
  state.slices.models.reports[reportId] = { ...structuredClone(state.slices.models.reports['reference-report']), id: reportId, modelId, capabilityBps: { ...state.slices.models.versions[modelId].capabilityBps } };
  state.slices.campaign.milestones.push('first-deployment');
  const command = { id: 'upgrade', companyId: state.playerCompanyId, issuedForWeek: 11, payload: { kind: 'upgrade_product' as const, productId: 'service', modelId } };
  assert.equal(products.validateCommand!(state, command, CONTENT), undefined); state = update(state, products.applyCommand!(state, command, CONTENT));
  assert.equal(state.slices.products.offers.service.publicModelId, previous.id); assert.equal(state.slices.products.offers.service.status, 'deploying');
  assert.equal(getGameView(state, CONTENT).progress.deployed, true, 'An upgrade preserves the achieved deployment milestone.');
  assert.notEqual(getGameView(state, CONTENT).nextMilestone.title, 'Launch Basic Chat');
  state = execute(state, 0); assert.equal(state.slices.products.lastUsage.service.billedCents, 0); assert.equal(state.slices.products.lastUsage.service.creditsCents, 12000);
  assert.equal(state.slices.products.offers.service.contractId, 'contract');
  const rival = createInitialState(), offer = rival.slices.products.offers['rival-atlas-product'];
  const rivalModel = rival.slices.models.versions[offer.publicModelId ?? rival.slices.products.deployments[offer.deploymentId].modelId];
  rival.slices.models.versions.hidden = { ...structuredClone(rivalModel), id: 'hidden', name: 'Secret 99', status: 'evaluated', capabilityBps: { conversation: 9900, documents: 9900, coding: 9900, tools: 9900 } };
  offer.publicModelId = rivalModel.id; offer.status = 'deploying'; rival.slices.products.deployments[offer.deploymentId].modelId = 'hidden';
  const publicOffer = getMarketView(rival, CONTENT).rivals.find(item => item.companyId === 'rival-atlas')!.products[0];
  assert.equal(publicOffer.model, rivalModel.name); assert.deepEqual(publicOffer.capabilityBps, rivalModel.capabilityBps);
});

test('W2-M08: enterprise accounts renew on term boundaries and leave after two service breaches', () => {
  let state = reference('business-docs', 8); state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  state = run(execute(state, 0), markets, 'market'); assert.equal(state.slices.markets.cohorts[0].count, 8); assert.equal(state.slices.markets.cohorts[0].breachWeeks, 1);
  state.week++; state = run(execute(state, 0), markets, 'market');
  assert.equal(state.slices.markets.cohorts.length, 0); assert.equal(state.slices.markets.returnedNextWeek.business, 8); assertPopulation(state); assertWave2MarketState(state, CONTENT);
});

test('W2-M09: rivals use ordinary proposals, resource grants and ledger cash flows without private journal leaks', () => {
  let state = createInitialState(); const seenCommands = new Set<string>(); let completedProjects = 0;
  for (let week = 0; week < 40; week++) {
    const prior = state, result = advanceWeek(state); assert.ok(result.accepted, result.reason?.message); state = result.state;
    for (const [companyId, rival] of Object.entries(state.slices.markets.rivals)) {
      assert.equal(state.slices.company.companies[companyId].cashCents, prior.slices.company.companies[companyId].cashCents + state.slices.company.companies[companyId].lastWeek.cashChangeCents);
      assert.ok(rival.lastActionWeek <= state.week);
      for (const command of state.queuedCommands.filter(c => c.companyId === companyId)) { seenCommands.add(command.id); assert.equal(command.issuedForWeek, state.week + 1); }
    }
    assertPopulation(state); assertWave2MarketState(state, CONTENT);
  }
  completedProjects = Object.values(state.slices.research.projects).filter(project => project.companyId !== state.playerCompanyId && project.status === 'complete').length;
  assert.ok(seenCommands.size >= 3); assert.ok(completedProjects >= 2);
  assert.ok([...seenCommands].some(id => state.commandReceipts[id]?.status === 'accepted'));
  for (const project of Object.values(state.slices.research.projects)) assert.ok(state.slices.company.postedFacts[project.id + ':fee']);
  assert.equal(state.journal.filter(entry => entry.category === 'project').length, 0, 'Private rival lab and rollout messages do not enter the player journal.');
  assert.ok(Object.values(state.slices.models.trainingRuns).some(run => run.companyId !== state.playerCompanyId && run.completedWork > 0));
});

test('W2-M10: insolvent rivals lose service and market access instead of receiving rescue cash', () => {
  let state = createInitialState(); state.slices.company.companies['rival-atlas'].cashCents = 0;
  const first = advanceWeek(state); assert.ok(first.accepted, first.reason?.message); state = first.state;
  assert.equal(state.slices.company.companies['rival-atlas'].cashCents, 0); assert.ok(state.slices.company.companies['rival-atlas'].arrearsCents > 0);
  assert.equal(state.slices.markets.rivals['rival-atlas'].withdrawn, true);
  const second = advanceWeek(state); assert.ok(second.accepted, second.reason?.message); state = second.state;
  assert.equal(state.slices.products.lastUsage['rival-atlas-product'].executedWork, 0);
  assert.equal(state.queuedCommands.filter(command => command.companyId === 'rival-atlas').length, 0);
  assert.equal(state.slices.company.companies['rival-atlas'].cashCents, 0); assertWave2MarketState(state, CONTENT);
});

test('W2-M11: market snapshot validation rejects forged token bills, foreign carries, private releases and overpopulation', () => {
  const original = execute(reference('developer-api', 1), 1000000); assertWave2MarketState(original, CONTENT);
  for (const corrupt of [
    (s: GameState) => { s.slices.products.lastUsage.service.tokens!.inputTokens += 1; },
    (s: GameState) => { delete s.slices.products.lastUsage.service.tokens; },
    (s: GameState) => { s.slices.products.lastUsage.service.billedCents += 1; },
    (s: GameState) => { s.slices.markets.carries['foreign-company:developers'] = { conversion: 1, churn: 0, reach: 0 }; },
    (s: GameState) => { s.slices.products.offers.service.publicModelId = 'missing-model'; },
    (s: GameState) => { s.slices.markets.returnedNextWeek.developers = 400; },
    (s: GameState) => { s.slices.markets.cohorts[0].segmentId = 'business'; },
    (s: GameState) => { s.slices.products.contracts.contract.tokenBillRemainder = 1_000_000; },
  ]) { const bad = structuredClone(original); corrupt(bad); assert.throws(() => assertWave2MarketState(bad, CONTENT)); }
});

// Isolated service observations protect the Wave 5 pacing change from rewarding
// product proliferation, free trials, or one healthy product hiding another outage.
function twoPaidServices(calibrated: [boolean, boolean], secondWorkBps = 10000): GameState {
  const observed = (kind: ProductKind, improved: boolean, workBps: number) => {
    let state = reference(kind, 10);
    state.slices.models.versions[CONTENT.seedModel.id].behavior = { confidentErrorBps: improved ? 600 : 1000, falseRefusalBps: 700 };
    state = execute(state, Math.floor(demand(state).paidWork * workBps / 10000));
    return state;
  };
  const state = observed('basic-chat', calibrated[0], 10000), second = observed('developer-api', calibrated[1], secondWorkBps);
  state.slices.models.versions['api-model'] = { ...second.slices.models.versions[CONTENT.seedModel.id], id: 'api-model', evaluationReportId: 'api-report' };
  state.slices.models.reports['api-report'] = { ...second.slices.models.reports['reference-report'], id: 'api-report', modelId: 'api-model' };
  state.slices.products.offers.api = { ...second.slices.products.offers.service, id: 'api', publicModelId: 'api-model', deploymentId: 'api-deployment', contractId: 'api-contract' };
  state.slices.products.deployments['api-deployment'] = { ...second.slices.products.deployments.deployment, id: 'api-deployment', productId: 'api', modelId: 'api-model' };
  state.slices.products.contracts['api-contract'] = { ...second.slices.products.contracts.contract, id: 'api-contract', productId: 'api' };
  state.slices.products.lastUsage.api = { ...second.slices.products.lastUsage.service, productId: 'api' };
  state.slices.products.activeIds.push('api');
  state.slices.markets.cohorts.push({ ...second.slices.markets.cohorts[0], id: 'api-accounts', productId: 'api', contractId: 'api-contract' });
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  return state;
}

test('W5-T01: trust is awarded once per company and calibration requires every paid product', () => {
  for (const [calibrated, expected] of [
    [[false, false], 5010], [[true, false], 5010], [[false, true], 5010], [[true, true], 5025],
  ] as const) {
    const state = run(twoPaidServices([...calibrated]), markets, 'market');
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected);
    assert.equal(state.slices.markets.trustBps, expected);
  }
});

test('W5-T02: one underserved paid product loses trust despite a healthy calibrated product, with bounded trust', () => {
  const poor = twoPaidServices([true, true], 5000);
  assert.equal(run(poor, markets, 'market').slices.markets.trustBps, 4975);
  poor.slices.markets.companyTrustBps[poor.playerCompanyId] = 10;
  assert.equal(run(poor, markets, 'market').slices.markets.trustBps, 0);
  const excellent = twoPaidServices([true, true]);
  excellent.slices.markets.companyTrustBps[excellent.playerCompanyId] = 9995;
  assert.equal(run(excellent, markets, 'market').slices.markets.trustBps, 10000);
});

test('W5-T03: a trial-only company cannot farm trust before actually serving paid customers', () => {
  let state = reference('basic-chat', 0);
  state.slices.models.versions[CONTENT.seedModel.id].behavior = { confidentErrorBps: 600, falseRefusalBps: 700 };
  const perAccount = 25 * demand(state).meter.work;
  state.slices.markets.trials = [{ id: 'trial-only', companyId: state.playerCompanyId, productId: 'service', segmentId: 'regular', count: 10,
    createdWeek: 9, activeWeek: 10, expiresWeek: 11, workCompleted: 0, workPerAccount: perAccount, requiredWork: 10 * perAccount }];
  state = execute(state, 10 * perAccount);
  assert.equal(state.slices.products.lastUsage.service.paidAccounts, 0);
  assert.ok(state.slices.products.lastUsage.service.trialExecutedWork > 0);
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  assert.equal(run(state, markets, 'market').slices.markets.trustBps, 5000);
});
