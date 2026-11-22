import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { MARKET_OPPORTUNITY_RULES, RIVAL_CAMPAIGN_RULES } from '../src/content/market-dynamics';
import { MARKET_SEGMENTS } from '../src/content/wave2-market';
import type { GameState, ModuleContext } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState } from '../src/core/engine';
import { createDefaultModules } from '../src/core/foundation-modules';
import { assertMarketDynamicsState } from '../src/core/market-dynamics-validation';
import { serializeState, deserializeState } from '../src/core/snapshot';
import { createMarketsModule } from '../src/modules/markets';
import { getMarketOpportunityView, initializeMarketOpportunities, marketOpportunityAt, marketOpportunityDemandMultiplierBps } from '../src/modules/market-opportunities';
import { createRivalCampaign, planRivals, rivalOperatingBudget } from '../src/modules/rivals';

function context(state: GameState, phase: ModuleContext['phase'] = 'plan'): ModuleContext {
  return { week: state.week, phase, content: CONTENT, facts: [], resources: { requests: [], staffGrants: [], computeGrants: [] },
    random: { draw: () => { throw new Error('Market calendars and rival plans must not reroll.'); } } };
}
function step(state: GameState): GameState {
  const result = advanceWeek(state); assert.ok(result.accepted, result.reason?.message); return result.state;
}

test('retained legacy market windows give six weeks notice, affect only their named segments and expire at a fixed boundary', () => {
  const state = createInitialState(); state.slices.markets.opportunityCalendar = { startedWeek: 0 }; initializeMarketOpportunities(state);
  const before = structuredClone(state), first = getMarketOpportunityView(state).upcoming!;
  assert.equal(first.announcedWeek, state.week); assert.equal(first.startsWeek, state.week + 6); assert.equal(first.endsWeek, state.week + 9);
  assert.equal(getMarketOpportunityView(state).active, null);
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'regular', first.startsWeek - 1), 10000);
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'regular', first.startsWeek), 16000);
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'developers', first.startsWeek), 10000);
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'regular', first.endsWeek), 16000);
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'regular', first.endsWeek + 1), 10000);
  const gap = getMarketOpportunityView(state, first.endsWeek + 1);
  assert.equal(gap.upcoming, null); assert.equal(gap.active, null); assert.equal(gap.nextAnnouncementWeek, 12);
  const second = getMarketOpportunityView(state, 12).upcoming!;
  assert.equal(second.id, 'developer-showcase'); assert.equal(second.startsWeek, 18);
  assert.deepEqual(state, before, 'Calendar and demand reads must be pure.');
});

test('an older save starts its own announced calendar without retroactive demand and keeps that epoch', () => {
  const state = createInitialState(); delete state.slices.markets.opportunityCalendar; state.week = 203;
  assert.equal(marketOpportunityDemandMultiplierBps(state, 'casual'), 10000);
  assert.deepEqual(getMarketOpportunityView(state), { active: null, upcoming: null, nextAnnouncementWeek: null });
  initializeMarketOpportunities(state);
  assert.equal(getMarketOpportunityView(state).upcoming?.startsWeek, 209);
  state.week = 207; initializeMarketOpportunities(state);
  assert.equal(state.slices.markets.opportunityCalendar!.startedWeek, 203);
  const first = marketOpportunityAt(state, 0)!;
  assert.equal(marketOpportunityDemandMultiplierBps(state, first.segmentIds[0]), 10000);
  assert.equal(marketOpportunityDemandMultiplierBps(state, first.segmentIds[0], 209), first.demandMultiplierBps);
});

test('the opportunity changes real trial admissions at the finite outside-population boundary', () => {
  const state = createInitialState(); state.slices.markets.opportunityCalendar = { startedWeek: 0 }; initializeMarketOpportunities(state); state.week = 18;
  state.slices.markets.waitlistRemaining = 0;
  for (const product of Object.values(state.slices.products.offers)) if (product.companyId !== 'rival-swift') product.status = 'paused';
  const fleet = state.slices.compute.fleets['rival-swift'];
  fleet.cloudCU = 128 * U; fleet.memoryMU = 256 * U; fleet.allocation = { serving: 128 * U, development: 0, research: 0 };
  const ctx: ModuleContext = { ...context(state, 'market'), resources: { requests: [], computeGrants: [],
    staffGrants: [{ requestId: 'acquire-company:rival-swift', grants: [{ role: 'commercial', staffWeeks: 10 * U }] }] } };
  const neutral = structuredClone(state); delete neutral.slices.markets.opportunityCalendar;
  const markets = createMarketsModule(CONTENT), boosted = markets.handlers.market!(state, ctx).updates!.markets!, plain = markets.handlers.market!(neutral, ctx).updates!.markets!;
  const newTrials = (market: typeof boosted) => market.trials.filter(trial => trial.segmentId === 'developers').reduce((sum, trial) => sum + trial.count, 0);
  assert.equal(newTrials(plain), 7); assert.equal(newTrials(boosted), 14, 'The developer window must increase actual trial offers, not just a label.');
  assert.deepEqual(boosted.cohorts, plain.cohorts, 'A buying window does not award paid accounts.');
  for (const segment of MARKET_SEGMENTS) {
    const occupied = boosted.cohorts.filter(cohort => (cohort.segmentId ?? 'regular') === segment.id).reduce((sum, cohort) => sum + cohort.count, 0)
      + boosted.trials.filter(trial => (trial.segmentId ?? 'regular') === segment.id).reduce((sum, trial) => sum + trial.count, 0);
    assert.ok(occupied <= segment.population, segment.name + ' remains finite.');
  }
  const nearlyFull = structuredClone(state);
  nearlyFull.slices.markets.cohorts.find(cohort => cohort.companyId === 'rival-swift')!.count = 399;
  nearlyFull.slices.markets.shopperCarry.developers = 9999;
  const full = markets.handlers.market!(nearlyFull, ctx).updates!.markets!;
  assert.ok(newTrials(full) <= 1, 'The opportunity cannot admit more than the one available developer.');
});

test('rival campaigns freeze a multiweek direction and propose only affordable ordinary commands', () => {
  const state = createInitialState(); initializeMarketOpportunities(state); state.week = 8;
  const before = structuredClone(state), result = planRivals(state, context(state)), nextMarkets = result.updates!.markets!;
  const owners = createDefaultModules(CONTENT);
  for (const rival of Object.values(nextMarkets.rivals)) {
    assert.ok(rival.campaign); assert.equal(rival.campaign.reviewWeek - rival.campaign.startedWeek, RIVAL_CAMPAIGN_RULES[rival.campaign.kind].durationWeeks);
    assert.equal(rival.campaign.startedWeek, 8);
  }
  for (const proposed of result.commands ?? []) {
    const module = owners.find(owner => owner.commandKinds?.includes(proposed.payload.kind))!;
    const command = { id: 'test-rival-budget', companyId: proposed.companyId, issuedForWeek: 9, payload: proposed.payload };
    assert.equal(module.validateCommand!(state, command, CONTENT), undefined);
    const quote = module.quoteCommand!(state, command, CONTENT), budget = rivalOperatingBudget(state, proposed.companyId, CONTENT);
    assert.ok(quote.upfrontCostCents + Math.max(0, quote.weeklyCostDeltaCents) * 8 <= budget.budget);
  }
  assert.deepEqual(state, before, 'Planning cannot mutate cash, paid work or the source state.');
  const continuing = structuredClone(state); continuing.slices.markets = nextMarkets; continuing.week = 10;
  const next = planRivals(continuing, context(continuing)).updates!.markets!;
  for (const rival of Object.values(next.rivals)) assert.equal(rival.campaign!.id, nextMarkets.rivals[rival.companyId].campaign!.id);
});

test('cash pressure interrupts a rival campaign without a subsidy or a speculative project', () => {
  const state = createInitialState(); initializeMarketOpportunities(state); state.week = 8;
  const companyId = 'rival-swift', rival = state.slices.markets.rivals[companyId];
  rival.campaign = createRivalCampaign(state, rival, CONTENT);
  const campaignId = rival.campaign.id; state.slices.company.companies[companyId].cashCents = 1;
  const result = planRivals(state, context(state)), next = result.updates!.markets!.rivals[companyId];
  assert.equal(next.campaign!.id, campaignId); assert.equal(next.campaign!.status, 'protecting-cash');
  assert.equal(result.updates?.company, undefined); assert.equal(result.facts, undefined);
  assert.equal((result.commands ?? []).some(command => command.companyId === companyId && ['start_research', 'start_training', 'buy_data', 'sign_business_contract'].includes(command.payload.kind)), false);
  state.slices.company.companies[companyId].arrearsCents = 10;
  const failed = planRivals(state, context(state));
  assert.equal(failed.updates!.markets!.rivals[companyId].withdrawn, true);
  assert.equal((failed.commands ?? []).some(command => command.companyId === companyId), false);
});

test('saved campaigns and announced windows replay identically through paid rival actions', () => {
  let state = createInitialState(); initializeMarketOpportunities(state);
  for (let i = 0; i < 10; i++) state = step(state);
  const ids = Object.values(state.slices.markets.rivals).map(rival => rival.campaign!.id);
  const loaded = deserializeState(serializeState(state)); assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  let restored = loaded.state;
  for (let i = 0; i < 10; i++) { state = step(state); restored = step(restored); assert.equal(serializeState(state), serializeState(restored)); }
  const accepted = Object.entries(state.commandReceipts).filter(([id, receipt]) => id.startsWith('rival-command-') && receipt.status === 'accepted');
  assert.ok(accepted.length >= 3, 'Rival intentions must become ordinary accepted actions.');
  assert.equal(state.slices.markets.rivals['rival-atlas'].campaign!.id, ids[0], 'A 24-week goal survives tactical steps and reloads.');
  assert.notEqual(state.slices.markets.rivals['rival-swift'].campaign!.id, ids[1], 'A completed review interval starts a new frozen plan.');
  const swiftOffer = state.slices.products.offers['rival-swift-product'];
  assert.equal(swiftOffer.strategy?.audience, 'value', 'The rival must actually apply its announced positioning through the command registry.');
  assert.ok(state.slices.products.contracts[swiftOffer.contractId].weeklyPriceCents < 6000, 'The affordable API campaign must take a real, funded price step.');
  assert.ok(Object.values(state.slices.research.projects).some(project => project.companyId !== state.playerCompanyId && project.completedWork > 0));
  assert.doesNotThrow(() => assertMarketDynamicsState(state));
});

test('calendar and campaign validation rejects invented timing, targets and foreign baselines', () => {
  const state = createInitialState(); initializeMarketOpportunities(state);
  const rival = state.slices.markets.rivals['rival-swift']; rival.campaign = createRivalCampaign(state, rival, CONTENT);
  assert.doesNotThrow(() => assertMarketDynamicsState(state));
  for (const mutate of [
    (game: GameState) => { game.slices.markets.opportunityCalendar!.startedWeek = game.week + 1; },
    (game: GameState) => { game.slices.markets.rivals['rival-swift'].campaign!.reviewWeek++; },
    (game: GameState) => { game.slices.markets.rivals['rival-swift'].campaign!.priceTargetCents = 1; },
    (game: GameState) => { game.slices.markets.rivals['rival-swift'].campaign!.startingModelId = CONTENT.seedModel.id; },
    (game: GameState) => { game.slices.markets.rivals['rival-swift'].campaign!.targetSegment = 'business'; },
  ]) { const forged = structuredClone(state); mutate(forged); assert.throws(() => assertMarketDynamicsState(forged)); }
  assert.equal(marketOpportunityAt(state, 0)!.startsWeek, MARKET_OPPORTUNITY_RULES.noticeWeeks);
});
