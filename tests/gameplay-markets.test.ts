import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { MARKET_OPPORTUNITIES, MARKET_OPPORTUNITY_RULES } from '../src/content/market-dynamics';
import type { GameContent, GameState, ModuleContext } from '../src/contracts/types';
import { createInitialState, advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getMarketOpportunityView, marketOpportunityAt } from '../src/modules/market-opportunities';
import { createRivalCampaign, planRivals, rivalOperatingBudget } from '../src/modules/rivals';
import { rivalTacticFor } from '../src/modules/rival-tactics';
import { createDefaultModules } from '../src/core/foundation-modules';

const start = (seed: string) => createInitialState({ ...CONTENT, opening: { ...CONTENT.opening, seed } }, 'release');
function step(state: GameState, content: GameContent = CONTENT) { const result = advanceWeek(state, content); assert.ok(result.accepted, result.reason?.message); return result.state; }
function reload(state: GameState, content: GameContent = CONTENT) { const result = deserializeState(serializeState(state, content), content); assert.ok(result.ok, result.ok ? undefined : result.error); return result.state; }
const context = (state: GameState): ModuleContext => ({ week: state.week, phase: 'plan', content: CONTENT, facts: [],
  resources: { requests: [], staffGrants: [], computeGrants: [] }, random: { draw: () => { throw new Error('Campaign choices must not consume random outcome streams.'); } } });

test('new seeded schedules vary, keep every market in each cycle and expose only the announced six-week notice', () => {
  const sequences = new Set<string>();
  for (let index = 0; index < 10; index++) {
    const state = start('market-cycle-' + index), before = structuredClone(state);
    assert.equal(state.slices.markets.opportunityCalendar!.sequenceVersion, 2);
    const windows = Array.from({ length: 12 }, (_, n) => marketOpportunityAt(state, n)!);
    sequences.add(windows.map(window => window.id).join(','));
    for (let cycle = 0; cycle < 3; cycle++) assert.deepEqual(windows.slice(cycle * 4, cycle * 4 + 4).map(window => window.id).sort(), MARKET_OPPORTUNITIES.map(item => item.id).sort());
    for (const window of windows) {
      assert.equal(window.startsWeek - window.announcedWeek, MARKET_OPPORTUNITY_RULES.noticeWeeks);
      assert.equal(window.endsWeek - window.startsWeek + 1, MARKET_OPPORTUNITY_RULES.activeWeeks);
      assert.equal(getMarketOpportunityView(state, window.announcedWeek).upcoming?.instanceId, window.instanceId);
      if (window.announcedWeek > 0) assert.notEqual(getMarketOpportunityView(state, window.announcedWeek - 1).upcoming?.instanceId, window.instanceId);
    }
    assert.deepEqual(state, before, 'Reading the schedule must not mutate any random stream or state.');
    const restored = reload(state);
    assert.deepEqual(windows, Array.from({ length: 12 }, (_, n) => marketOpportunityAt(restored, n)!));
  }
  assert.ok(sequences.size > 3, 'Campaign seeds must produce materially different future sequences.');
});

test('a published 0.35 calendar and in-progress rival plan survive import without adopting new tactics or shuffling', () => {
  const oldContent = { ...CONTENT, version: '0.35.0', buildVersion: '0.35.0' };
  const original = createInitialState(oldContent, 'release');
  const rival = original.slices.markets.rivals['rival-swift'];
  rival.campaign = createRivalCampaign(original, rival, oldContent);
  const calendar = structuredClone(original.slices.markets.opportunityCalendar), campaign = structuredClone(rival.campaign);
  assert.equal(calendar!.sequenceVersion, undefined); assert.equal(campaign.tactics, undefined);
  const imported = deserializeState(serializeState(original, oldContent)); assert.ok(imported.ok, imported.ok ? undefined : imported.error);
  assert.deepEqual(imported.state.slices.markets.opportunityCalendar, calendar);
  assert.deepEqual(imported.state.slices.markets.rivals['rival-swift'].campaign, campaign);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => marketOpportunityAt(imported.state, i)!.id), [...MARKET_OPPORTUNITIES, ...MARKET_OPPORTUNITIES].map(item => item.id));
  const next = step(imported.state);
  assert.equal(next.slices.markets.rivals['rival-swift'].campaign!.tactics, undefined, 'An ongoing historical plan keeps its old policy until its announced review.');
});

test('new rival tactics remain ordinary affordable proposals and their frozen choices cannot be forged', () => {
  const seen = new Set<string>(), owners = createDefaultModules(CONTENT);
  for (let i = 0; i < 8; i++) {
    const state = start('tactic-admission-' + i); state.week = 8;
    const before = structuredClone(state), result = planRivals(state, context(state));
    for (const rival of Object.values(result.updates!.markets!.rivals)) seen.add(rival.campaign!.tactics!.focus);
    for (const proposal of result.commands ?? []) {
      const owner = owners.find(module => module.commandKinds?.includes(proposal.payload.kind))!;
      const command = { id: 'tactic-budget', companyId: proposal.companyId, issuedForWeek: 9, payload: proposal.payload };
      assert.equal(owner.validateCommand!(state, command, CONTENT), undefined);
      const quote = owner.quoteCommand!(state, command, CONTENT), budget = rivalOperatingBudget(state, proposal.companyId, CONTENT);
      assert.ok(quote.upfrontCostCents + Math.max(0, quote.weeklyCostDeltaCents) * 8 <= budget.budget);
    }
    assert.deepEqual(state, before);
  }
  assert.deepEqual([...seen].sort(), ['efficiency', 'reach', 'reliability']);
  const valid = step(start('tactic-proof'));
  for (const mutate of [
    (state: GameState) => { (state.slices.markets.opportunityCalendar as { sequenceVersion: number }).sequenceVersion = 3; },
    (state: GameState) => { const tactic = state.slices.markets.rivals['rival-swift'].campaign!.tactics!; tactic.focus = tactic.focus === 'reach' ? 'efficiency' : 'reach'; },
    (state: GameState) => { state.slices.markets.rivals['rival-swift'].campaign!.priceTargetCents = 1; },
  ]) { const forged = structuredClone(valid); mutate(forged); assert.ok(validateState(forged).length); }
});

test('a historical 0.37 efficiency rival researches, builds, tests and releases a paid compressed candidate through ordinary weeks and reload', () => {
  const seed = Array.from({ length: 300 }, (_, i) => 'paid-efficiency-' + i).find(value =>
    rivalTacticFor(value, 'rival-swift', 1, 'efficient') === 'efficiency' && rivalTacticFor(value, 'rival-swift', 17, 'efficient') === 'efficiency');
  assert.ok(seed);
  // The current rival follows the paid local-system route, covered by rival-systems.test.ts.
  // Keep the previous compression strategy replayable under its actual historical content.
  const content = { ...CONTENT, version: '0.37.0', buildVersion: '0.37.0', opening: { ...CONTENT.opening, seed } };
  let state = createInitialState(content, 'release');
  let queued = submitCommand(state, { kind: 'allocate_compute', serving: 0, development: 0, research: 0 }, content); assert.ok(queued.accepted, queued.reason?.message); state = step(queued.state, content);
  queued = submitCommand(state, { kind: 'set_cloud_capacity', cu: 0 }, content); assert.ok(queued.accepted, queued.reason?.message); state = step(queued.state, content);
  const original = structuredClone(state.slices.models.versions['rival-swift-model-1']);
  const observed: { kind: string; companyId: string }[] = [];
  let restored: GameState | null = null;
  for (let i = 0; i < 40; i++) {
    observed.push(...state.queuedCommands.filter(command => command.companyId === 'rival-swift').map(command => ({ kind: command.payload.kind, companyId: command.companyId })));
    if (state.week === 12) restored = reload(state, content);
    state = step(state, content);
    if (restored) { restored = step(restored, content); assert.equal(serializeState(restored, content), serializeState(state, content)); }
    const live = state.slices.products.offers['rival-swift-product'];
    const id = live.publicModelId ?? state.slices.products.deployments[live.deploymentId].modelId;
    if (state.slices.models.versions[id].runtimeVariant?.kind === 'compression') break;
  }
  const live = state.slices.products.offers['rival-swift-product'];
  const model = state.slices.models.versions[live.publicModelId ?? state.slices.products.deployments[live.deploymentId].modelId];
  assert.equal(model.runtimeVariant?.kind, 'compression', JSON.stringify({ week: state.week, campaign: state.slices.markets.rivals['rival-swift'].campaign, observed }));
  assert.ok(model.evaluationReportId);
  const application = state.slices.models.applicationRuns[model.runtimeVariant.applicationId];
  assert.equal(application.status, 'complete'); assert.equal(application.completedWork, application.requiredWork); assert.ok(application.physicalWork > 0);
  const research = Object.values(state.slices.research.projects).find(project => project.companyId === 'rival-swift' && project.researchId === 'R7')!;
  assert.equal(research.status, 'complete'); assert.equal(research.completedWork, research.requiredWork);
  assert.ok(state.slices.company.postedFacts[research.id + ':fee'], 'Compression research paid its ordinary setup fee.');
  for (const kind of ['start_research', 'create_model_variant', 'evaluate_model', 'upgrade_product']) assert.ok(observed.some(action => action.kind === kind), kind + ' must be a real queued command.');
  assert.deepEqual(state.slices.models.versions[original.id], original, 'The old release is not retroactively rewritten.');
  assert.equal(state.slices.company.companies['rival-swift'].arrearsCents, 0);
});
