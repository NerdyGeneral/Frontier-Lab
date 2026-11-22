import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { SEGMENT_BY_ID } from '../src/content/wave2-market';
import { POLICY_HOLDOUT_RULES } from '../src/content/wave11-policy';
import type { GameState } from '../src/contracts/types';
import type { ChapterAchievement, ProductAudience, RoutingPolicy } from '../src/contracts/strategic-variety';
import { previewCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateStrategicVarietyState } from '../src/core/strategic-variety-validation';
import { activeEfficiency, routedModel } from '../src/modules/product-efficiency';
import { productDemand } from '../src/modules/products';
import { audienceAcquisitionBps } from '../src/modules/product-strategy';
import { getMarketView } from '../src/modules/markets';
import { advanceChapters, assessChapter } from '../src/modules/chapters';
import { releaseConfiguration, releaseConfigurationFingerprint } from '../src/modules/release-rehearsals';
import { runtimeGuardrailBinding, runtimeGuardrailBindingFingerprint, runtimeGuardrailInputsMatch } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign, openNaturalBusiness } from './fixtures/wave5-business';

function published(): GameState {
  const directory = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests');
  const loaded = deserializeState(readFileSync(join(directory, 'fixtures/wave12-snapshot.json'), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); return loaded.state;
}
function ownProduct(state: GameState, kind: 'basic-chat' | 'developer-api' = 'developer-api') {
  return Object.values(state.slices.products.offers).find(product => product.companyId === state.playerCompanyId && product.kind === kind)!;
}
function saved(state: GameState): GameState {
  assert.deepEqual(validateState(state), []);
  const loaded = deserializeState(serializeState(state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(state)); return loaded.state;
}
let routedFixture: GameState | undefined;
function routed(): GameState {
  if (routedFixture) return structuredClone(routedFixture);
  const run = new NaturalBusinessCampaign(published(), 'strategy-routing');
  const productId = ownProduct(run.state).id;
  run.discover('R8');
  run.queue({ kind: 'install_product_efficiency', productId, method: 'routing', secondaryModelId: 'variant:wave9-natural-command-2' });
  run.until(state => !!activeEfficiency(state, productId, 'routing'), 12, 'paid routing installation');
  routedFixture = saved(run.state); return structuredClone(routedFixture);
}
function strategy(state: GameState, policy: RoutingPolicy, audience: ProductAudience = 'broad') {
  const run = new NaturalBusinessCampaign(state, `strategy-${policy}-${audience}`), productId = ownProduct(state).id;
  run.queue({ kind: 'set_product_strategy', productId, audience, routingPolicy: policy }); run.step();
  return run;
}

test('STR01: routing policies change paid serving work and delivered quality, survive save, and leave model versions unchanged', () => {
  const baseline = routed(), productId = ownProduct(baseline).id;
  assert.equal(activeEfficiency(baseline, productId, 'routing')!.routingProtocol, 2);
  const modelsBefore = canonicalStateHash(baseline.slices.models.versions);
  const outcomes = (['economy', 'balanced', 'quality'] as const).map(policy => {
    const run = strategy(structuredClone(baseline), policy);
    const product = ownProduct(run.state), demand = productDemand(run.state, product, CONTENT, run.week);
    assert.equal(product.strategy!.routingPolicy, policy);
    assert.equal(canonicalStateHash(run.state.slices.models.versions), modelsBefore);
    const restored = saved(run.state);
    assert.equal(productDemand(restored, ownProduct(restored), CONTENT, restored.week).meter.work, demand.meter.work);
    return { policy, work: demand.meter.work, quality: demand.model.capabilityBps.coding, usage: run.state.slices.products.lastUsage[productId] };
  });
  assert.ok(outcomes[0].work < outcomes[1].work && outcomes[1].work < outcomes[2].work);
  assert.ok(outcomes[0].quality < outcomes[1].quality && outcomes[1].quality < outcomes[2].quality);
  assert.ok(outcomes.every(row => row.usage.fulfillmentBps === 10000 && row.usage.billedCents > 0));
  assert.ok(outcomes[0].usage.requestedWork < outcomes[2].usage.requestedWork, 'Actual paid service uses the selected route, not just the preview.');
});

test('STR02: new routing mixes all three advanced skills; omitted legacy routing preserves historical behavior', () => {
  const state = routed(), product = ownProduct(state), route = activeEfficiency(state, product.id, 'routing')!;
  const main = state.slices.models.versions[route.modelId], secondary = state.slices.models.versions[route.secondaryModelId!];
  main.advancedCapabilities = { reasoning: 9000, longContext: 8000, multimodal: 7000 };
  secondary.advancedCapabilities = { reasoning: 3000, longContext: 4000, multimodal: 5000 };
  assert.deepEqual(routedModel(state, product, main).advancedCapabilities, { reasoning: 5400, longContext: 5600, multimodal: 5800 });
  delete route.routingProtocol;
  assert.deepEqual(routedModel(state, product, main).advancedCapabilities, main.advancedCapabilities);
  product.strategy = { audience: 'broad', routingPolicy: 'quality', updatedWeek: state.week, commandId: 'preview' };
  assert.deepEqual(routedModel(state, product, main).advancedCapabilities, { reasoning: 7800, longContext: 7200, multimodal: 6600 });
});

test('STR03: audience positioning rewards a promise that fits and penalizes mismatched price or service', () => {
  const state = published(), product = ownProduct(state), facts = { expectedBillCents: 6000, taskScoreBps: 8000, reliabilityBps: 9500, fulfillmentBps: 10000 };
  const positioned = (audience: ProductAudience) => ({ ...product, strategy: { audience, routingPolicy: 'balanced' as const, updatedWeek: state.week, commandId: 'preview' } });
  assert.equal(audienceAcquisitionBps(positioned('broad'), SEGMENT_BY_ID.developers, facts), 10000);
  assert.equal(audienceAcquisitionBps(positioned('value'), SEGMENT_BY_ID.developers, facts), 12500);
  assert.equal(audienceAcquisitionBps(positioned('value'), SEGMENT_BY_ID.developers, { ...facts, expectedBillCents: 100000 }), 7500);
  assert.equal(audienceAcquisitionBps(positioned('professional'), SEGMENT_BY_ID.professional, facts), 14000);
  assert.equal(audienceAcquisitionBps(positioned('professional'), SEGMENT_BY_ID.professional, { ...facts, fulfillmentBps: 9000 }), 8400);
  assert.equal(audienceAcquisitionBps(positioned('value'), SEGMENT_BY_ID.professional, { ...facts, expectedBillCents: 1000 }), 6500);
});

test('STR04: an applied audience choice changes actual conversion while preserving finite market populations and signed prices', () => {
  const base = published(), productId = ownProduct(base).id;
  const observations = (['broad', 'value', 'professional'] as const).map(audience => {
    const run = strategy(structuredClone(base), 'balanced', audience);
    const ownContracts = (state: GameState) => Object.values(state.slices.products.contracts).filter(contract => contract.companyId === state.playerCompanyId)
      .map(({ tokenBillRemainder: _carry, ...terms }) => terms);
    const contractsBefore = canonicalStateHash(ownContracts(run.state));
    const shortlist = getMarketView(run.state, CONTENT).segments.find(segment => segment.id === 'developers')!.contenders.find(item => item.companyId === run.state.playerCompanyId)!.score;
    run.step(3); saved(run.state);
    assert.equal(canonicalStateHash(ownContracts(run.state)), contractsBefore, 'Positioning does not reprice subscribers.');
    for (const segment of getMarketView(run.state, CONTENT).segments) assert.ok(segment.paying + segment.trials + segment.committed + segment.returning <= segment.population);
    return { audience, shortlist, accountCount: run.state.slices.markets.cohorts.filter(cohort => cohort.productId === productId).reduce((sum, row) => sum + row.count, 0), carry: run.state.slices.markets.carries[run.state.playerCompanyId + ':developers'].conversion };
  });
  assert.notEqual(observations[0].shortlist, observations[1].shortlist);
  assert.notDeepEqual(observations[0], { ...observations[1], audience: 'broad' }, 'Positioning must have a simulation consequence.');
  assert.ok(observations[0].accountCount !== observations[1].accountCount || observations[0].carry !== observations[1].carry, 'Actual weekly trial conversion differs.');
});

test('STR05: first chapter completes automatically from real paid training, evaluation and delivery; later choices preserve it', () => {
  const run = openNaturalBusiness();
  run.queue({ kind: 'select_chapter', chapterId: 'first-product' });
  run.until(state => !!state.slices.campaign.chapters?.completed['first-product'], 12, 'first paid chapter');
  const achievement = structuredClone(run.state.slices.campaign.chapters!.completed['first-product']);
  assert.ok(achievement!.proof[0].paidAccounts > 0 && achievement!.proof[0].billedCents > 0);
  assert.equal(achievement!.proof[0].reportIds.length, 1);
  const messages = run.state.journal.filter(event => event.message.includes('Chapter earned: Your first paying product'));
  assert.equal(messages.length, 1);
  run.state = saved(run.state); run.queue({ kind: 'select_chapter', chapterId: 'advanced-specialist' }); run.step(2);
  assert.deepEqual(run.state.slices.campaign.chapters!.completed['first-product'], achievement);
  assert.equal(run.state.slices.campaign.chapters!.active, 'advanced-specialist');
  assert.equal(run.state.slices.campaign.chapters!.streak, 0);
  assert.equal(previewCommand(run.state, { kind: 'select_chapter', chapterId: 'first-product' }).accepted, false);
  saved(run.state);
});

test('STR06: efficient portfolio requires sustained paid Economy service and surplus, then remains earned after a loss', () => {
  const run = strategy(routed(), 'economy');
  run.queue({ kind: 'select_chapter', chapterId: 'efficient-portfolio' }); run.step(2);
  assert.equal(run.state.slices.campaign.chapters!.streak, 2);
  assert.equal(run.state.slices.campaign.chapters!.completed['efficient-portfolio'], undefined);
  run.state = saved(run.state); run.step();
  const achievement = structuredClone(run.state.slices.campaign.chapters!.completed['efficient-portfolio'] as ChapterAchievement | undefined);
  assert.equal(achievement!.proof.length, 3);
  assert.ok(achievement!.proof.every(proof => proof.routingPolicy === 'economy' && proof.revenueCents > proof.operatingExpenseCents));
  run.state = saved(run.state);
  run.state.slices.company.companies[run.state.playerCompanyId].lastWeek.operatingExpenseCents = Number.MAX_SAFE_INTEGER;
  assert.equal(advanceChapters(run.state.slices.campaign, run.state).length, 0);
  assert.deepEqual(run.state.slices.campaign.chapters!.completed['efficient-portfolio'], achievement);
});

test('STR07: chapter and strategy save evidence rejects invented choices, missing receipts and broken proof', () => {
  const run = strategy(routed(), 'economy');
  run.queue({ kind: 'select_chapter', chapterId: 'efficient-portfolio' }); run.step(3); saved(run.state);
  const badPolicy = structuredClone(run.state); (ownProduct(badPolicy).strategy as unknown as { routingPolicy: string }).routingPolicy = 'free';
  assert.throws(() => validateStrategicVarietyState(badPolicy), /unknown choice/);
  const badReceipt = structuredClone(run.state); delete badReceipt.commandReceipts[ownProduct(badReceipt).strategy!.commandId];
  assert.throws(() => validateStrategicVarietyState(badReceipt), /accepted command/);
  const badProof = structuredClone(run.state); badProof.slices.campaign.chapters!.completed['efficient-portfolio']!.proof[1].week++;
  assert.throws(() => validateStrategicVarietyState(badProof), /consecutive|permanent achievement/);
  const noPaidEvaluation = structuredClone(run.state), proof = noPaidEvaluation.slices.campaign.chapters!.progress[0];
  for (const evaluation of Object.values(noPaidEvaluation.slices.models.evaluationRuns)) if (proof.reportIds.includes(evaluation.reportId ?? '')) delete noPaidEvaluation.slices.models.evaluationRuns[evaluation.id];
  assert.throws(() => validateStrategicVarietyState(noPaidEvaluation), /paid work/);
});

test('STR08: routing changes invalidate configuration evidence without rewriting captured release or runtime bindings', () => {
  const run = new NaturalBusinessCampaign(routed(), 'strategy-audit');
  const product = ownProduct(run.state), route = activeEfficiency(run.state, product.id, 'routing')!;
  run.evaluate(route.secondaryModelId!, POLICY_HOLDOUT_RULES.suiteId);
  const binding = runtimeGuardrailBinding(run.state, product.id)!; assert.ok(binding?.secondary);
  const bindingCopy = structuredClone(binding), bindingFingerprint = runtimeGuardrailBindingFingerprint(binding);
  const configuration = releaseConfiguration(run.state, product.id), configurationHash = releaseConfigurationFingerprint(run.state, product.id);
  assert.equal(binding.secondaryShareBps, 6000); assert.equal(configuration.routingPolicy, undefined);
  run.queue({ kind: 'set_product_strategy', productId: product.id, audience: 'broad', routingPolicy: 'quality' }); run.step();
  assert.equal(runtimeGuardrailBinding(run.state, product.id)!.secondaryShareBps, 2000);
  assert.notEqual(runtimeGuardrailBindingFingerprint(runtimeGuardrailBinding(run.state, product.id)!), bindingFingerprint);
  assert.notEqual(releaseConfigurationFingerprint(run.state, product.id), configurationHash);
  assert.deepEqual(binding, bindingCopy); assert.equal(configuration.routingPolicy, undefined);
  for (const installation of Object.values(run.state.slices.products.runtimeGuardrails ?? {}).filter(item => item.productId === product.id)) assert.equal(runtimeGuardrailInputsMatch(run.state, installation), false);
  saved(run.state);
  const auditId = 'guardrail:' + run.queue({ kind: 'install_runtime_guardrail', productId: product.id, profile: 'balanced' });
  run.until(state => state.slices.products.runtimeGuardrails![auditId]?.status === 'active', 10, 'paid audit for Quality routing');
  const auditBinding = structuredClone(run.state.slices.products.runtimeGuardrails![auditId].binding);
  assert.equal(auditBinding.secondaryShareBps, 2000); saved(run.state);
  run.queue({ kind: 'set_product_strategy', productId: product.id, audience: 'broad', routingPolicy: 'economy' }); run.step();
  assert.equal(runtimeGuardrailInputsMatch(run.state, run.state.slices.products.runtimeGuardrails![auditId]), false);
  assert.deepEqual(run.state.slices.products.runtimeGuardrails![auditId].binding, auditBinding);
  saved(run.state);
});

test('STR09: specialist chapter asks for an exact advanced evaluation and measured advanced capability', () => {
  const state = published(), product = ownProduct(state), model = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  assert.equal(assessChapter(state, 'advanced-specialist').proof, null);
  model.advancedCapabilities = { reasoning: 7000, longContext: 1000, multimodal: 0 };
  const source = Object.values(state.slices.models.reports).find(report => report.modelId === model.id && report.heldOut)!;
  state.slices.models.reports['chapter-advanced-test'] = { ...source, id: 'chapter-advanced-test', suiteId: 'advanced-capabilities-1' };
  assert.equal(assessChapter(state, 'advanced-specialist').proof?.modelId, model.id);
  model.advancedCapabilities.reasoning = 6999;
  assert.equal(assessChapter(state, 'advanced-specialist').proof, null);
});

test('STR10: a strategy choice cannot race a queued or active prepared release in either direction', () => {
  const run = new NaturalBusinessCampaign(routed(), 'strategy-release-lock');
  const product = ownProduct(run.state), candidateModelId = activeEfficiency(run.state, product.id, 'routing')!.secondaryModelId!;
  const rehearsalId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId: product.id, candidateModelId });
  run.until(state => state.slices.products.releaseRehearsals![rehearsalId]?.status === 'complete', 12, 'paid strategy release rehearsal');
  const payload = { kind: 'set_product_strategy' as const, productId: product.id, audience: 'value' as const, routingPolicy: 'balanced' as const };
  const reverse = new NaturalBusinessCampaign(structuredClone(run.state), 'strategy-first-lock'); reverse.queue(payload);
  assert.equal(previewCommand(reverse.state, { kind: 'start_prepared_release', productId: product.id, candidateModelId }).reason?.code, 'ALREADY_ACTIVE');
  run.queue({ kind: 'start_prepared_release', productId: product.id, candidateModelId });
  assert.match(previewCommand(run.state, payload).reason!.message, /prepared release/);
  run.step(); assert.match(previewCommand(run.state, payload).reason!.message, /prepared release/);
  saved(run.state);
});
