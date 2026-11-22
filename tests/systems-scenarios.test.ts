import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { MODEL_CHALLENGES } from '../src/content/model-challenges';
import { DEFAULT_FEATURES } from '../src/content/wave2-market';
import type { AISystemSpec } from '../src/contracts/ai-systems';
import type { GameState, ModelVersion } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { assertCommandShape } from '../src/core/command-shape';
import { createInitialState, previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { selectStudioResults } from '../src/core/studio-results';
import { createAISystemReceipt, getAISystemMetrics } from '../src/modules/ai-systems';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { getModelChallengeCaseViews, getSystemsModelMeasures, modelChallengeCases, modelChallengeFingerprint, validateModelChallengeAdmission } from '../src/modules/model-challenges';
import { requestMeter } from '../src/modules/product-models';
import { activeSystemsBrief, createSystemsBriefTerms, getSystemsBriefOffers, getSystemsBriefOrders, systemsBriefPaymentId, systemsBriefProofId, systemsBriefWorkRequest } from '../src/modules/systems-briefs';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

/** A narrow test model for comparing authored workload rules, not a progression shortcut. */
function measuredModel(system?: AISystemSpec): ModelVersion {
  const model = structuredClone(CONTENT.seedModel);
  model.capabilityBps = { conversation: 7500, documents: 7500, coding: 7500, tools: 7500 };
  model.advancedCapabilities = { reasoning: 7500, longContext: 7500, multimodal: 7500 };
  model.reliabilityBps = 9500;
  if (system) {
    const receipt = createAISystemReceipt(system);
    model.modelDesign = { servingWorkBps: receipt.effects.servingWorkBps, system: receipt,
      spec: { ...DEFAULT_MODEL_DESIGN, system } } as NonNullable<ModelVersion['modelDesign']>;
    model.residentMU = Math.round(2 * U * receipt.effects.residentMemoryBps / 10000);
    if (system.kind === 'experts') model.architecture = 'sparse';
  }
  return model;
}

test('systems constraints reward different operating choices and keep old challenge identities byte-stable', () => {
  const standard = measuredModel();
  const expert = measuredModel({ version: 1, kind: 'experts', experts: 8, activeExperts: 1, routing: 'balanced', specialization: 'documents' });
  const stateful = measuredModel({ version: 1, kind: 'stateful', stateSlots: 256, memory: 'selective', repair: true });
  const adaptive = measuredModel({ version: 1, kind: 'adaptive', maxPasses: 4, search: 'branching', verifier: 'independent', stopping: 'confidence' });
  const passes = (model: ModelVersion, id: string) => modelChallengeCases(model, id).filter(row => row.passed).length;
  assert.equal(passes(expert, 'systems-cost-1'), 6);
  assert.ok(passes(adaptive, 'systems-cost-1') < 5, 'Adaptive effort cannot ignore the compute price.');
  assert.equal(passes(stateful, 'systems-retention-1'), 6);
  assert.equal(passes(standard, 'systems-retention-1'), 0, 'Ordinary context scores do not silently invent persistent memory.');
  assert.ok(passes(adaptive, 'systems-verification-1') >= 5);
  assert.equal(passes(stateful, 'systems-memory-1'), 0, 'Large persistent state is charged for every simultaneous session.');
  assert.ok(passes(standard, 'systems-memory-1') >= 5, 'A conventional compact model remains a viable constrained design.');
  for (const model of [standard, expert, stateful, adaptive]) {
    const meter = requestMeter(model, { ...DEFAULT_FEATURES }), measures = getSystemsModelMeasures(model);
    assert.equal(measures.servingCUwPer1000, meter.work * 1000);
    assert.equal(measures.sessionMemoryMU, meter.sessionMemory);
    assert.equal(measures.memoryMU, model.residentMU + 25 * meter.sessionMemory);
    assert.deepEqual(modelChallengeCases({ ...model, id: 'new-name', name: 'Another label' }, 'systems-cost-1'), modelChallengeCases(model, 'systems-cost-1'));
  }
  const previousIdentity = canonicalStateHash({ capabilityBps: standard.capabilityBps, advancedCapabilities: standard.advancedCapabilities, reliabilityBps: standard.reliabilityBps });
  assert.equal(modelChallengeFingerprint(standard, 'challenge-applied-1'), previousIdentity);
  assert.equal(modelChallengeFingerprint({ ...standard, residentMU: 30 * U }, 'challenge-applied-1'), previousIdentity);
  assert.notEqual(modelChallengeFingerprint(standard, 'systems-memory-1'), modelChallengeFingerprint({ ...standard, residentMU: 30 * U }, 'systems-memory-1'));
  assert.equal(MODEL_CHALLENGES.filter(challenge => challenge.format).length, 4);
  assert.ok(getModelChallengeCaseViews(expert, 'systems-cost-1').every(row => row.requirementText.includes('CUw') && row.measurementText.includes('CUw')));
  assert.ok(getAISystemMetrics(adaptive).latencyBps > getAISystemMetrics(standard).latencyBps);
});

test('renewable offers are stable, visible before eligibility, and reject malformed or obsolete orders', () => {
  const game = createInitialState(CONTENT, 'release');
  const offers = getSystemsBriefOffers(game);
  assert.equal(offers.length, 4);
  assert.ok(offers.every(offer => !offer.available && offer.requirements.length >= 4 && offer.acceptUntilWeek === 8 && offer.nextOpensWeek === 13));
  assert.deepEqual(getSystemsBriefOffers(game), offers);
  assert.deepEqual(createSystemsBriefTerms(game.seed, 'continuity-desk', 17), createSystemsBriefTerms(game.seed, 'continuity-desk', 17));
  assert.notEqual(createSystemsBriefTerms(game.seed, 'continuity-desk', 17).id, createSystemsBriefTerms(game.seed, 'continuity-desk', 18).id);
  assert.throws(() => assertCommandShape({ kind: 'accept_systems_brief', offerId: offers[0].id, modelId: CONTENT.seedModel.id, feeCents: 0 } as never));
  assert.equal(previewCommand(game, { kind: 'accept_systems_brief', offerId: offers[0].id, modelId: CONTENT.seedModel.id }).accepted, false);
  const old = { ...game, contentVersion: '0.36.0' };
  assert.match(validateModelChallengeAdmission(old, old.playerCompanyId, CONTENT.seedModel.id, 'systems-cost-1')!.message, /Upgrade/);
});

let paidModelState: GameState | undefined;
let paidModelId = '';
/** This setup continues an actual published business using only ordinary paid commands. */
function legalClientModel(): NaturalBusinessCampaign {
  if (!paidModelState) {
    const decoded = deserializeState(readFileSync(join(__dirname, 'fixtures', 'wave26-published.json'), 'utf8'));
    assert.ok(decoded.ok, decoded.ok ? '' : decoded.error);
    const run = new NaturalBusinessCampaign(decoded.state, 'systems-client-proof');
    run.queue({ kind: 'set_cloud_capacity', cu: 128 * U }); run.step();
    run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 32 * U, research: 0 }); run.founder('research'); run.step();
    const packetId = run.prepare('advanced-broad-1', 9500);
    paidModelId = run.train({ baseModelId: CONTENT.seedModel.id, packetId, packetIds: [packetId], recipeId: 'custom-model-foundation',
      modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN), mode: 'foundation', name: 'Lean client foundation', parameterMillions: 2000,
        computeBudgetCUw: 240 * U, dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 } } });
    run.evaluate(paidModelId, 'expanded-capabilities-1');
    run.evaluate(paidModelId, 'systems-cost-1');
    assert.equal(Object.values(run.state.slices.models.reports).find(report => report.modelId === paidModelId && report.suiteId === 'systems-cost-1')?.challenge?.passed, true,
      JSON.stringify(run.state.slices.models.versions[paidModelId]));
    assert.deepEqual(validateState(run.state), []);
    paidModelState = structuredClone(run.state);
  }
  return new NaturalBusinessCampaign(structuredClone(paidModelState), 'systems-order-' + (paidModelState.week));
}

function openOffer(run: NaturalBusinessCampaign) {
  run.until(() => getSystemsBriefOffers(run.state).find(offer => offer.briefId === 'efficient-experts')!.available, 20, 'next commission window');
  return getSystemsBriefOffers(run.state).find(offer => offer.briefId === 'efficient-experts')!;
}

test('a paid systems commission consumes real capacity, pays once, preserves terms and renews in another window', () => {
  const run = legalClientModel(), offer = openOffer(run);
  const unpaid = structuredClone(run.state);
  const evaluation = Object.values(unpaid.slices.models.evaluationRuns).find(item => item.modelId === paidModelId && item.suiteId === 'systems-cost-1')!;
  evaluation.completedWork--;
  assert.equal(previewCommand(unpaid, { kind: 'accept_systems_brief', offerId: offer.id, modelId: paidModelId }).accepted, false,
    'A displayed passing result cannot replace fully performed evaluation work.');
  run.queue({ kind: 'accept_systems_brief', offerId: offer.id, modelId: paidModelId }); run.step();
  const first = activeSystemsBrief(run.state)!;
  assert.equal(first.qualifyingWeeks, 1);
  const missingActive = structuredClone(run.state); delete missingActive.slices.campaign.systemsBriefs![first.id];
  assert.ok(validateState(missingActive).length, 'An active signed order cannot disappear before it is paid.');
  const request = systemsBriefWorkRequest(run.state, first)!;
  assert.equal(request.normalizedWorkCUw, requestMeter(run.state.slices.models.versions[paidModelId], { ...DEFAULT_FEATURES }).work * first.terms.requestsPerWeek);
  assert.equal(previewCommand(run.state, { kind: 'accept_customer_brief', briefId: 'research-sprint' }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'accept_systems_brief', offerId: offer.id, modelId: paidModelId }).accepted, false);
  const loaded = deserializeState(serializeState(run.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); run.state = loaded.state;
  run.step();
  const complete = getSystemsBriefOrders(run.state)[0];
  assert.equal(complete.status, 'completed'); assert.deepEqual(complete.terms, offer.terms);
  const paymentId = systemsBriefPaymentId(run.state.playerCompanyId, complete.id);
  assert.equal(run.state.slices.company.ledger.filter(fact => fact.id === paymentId).length, 1);
  assert.equal(run.state.slices.company.ledger.find(fact => fact.id === paymentId)?.amountCents, offer.feeCents);
  assert.equal(selectStudioResults(run.state).find(result => result.sourceId === complete.id)?.kind, 'brief');
  for (const mutate of [
    (game: GameState) => { game.slices.campaign.systemsBriefs![complete.id].terms.feeCents++; },
    (game: GameState) => { game.slices.campaign.systemsBriefs![complete.id].terms.maxServingCUwPer1000!++; },
    (game: GameState) => { game.slices.campaign.systemsBriefs![complete.id].reportId = 'unpaid-report'; },
    (game: GameState) => { delete game.commandReceipts[complete.commandId]; },
    (game: GameState) => { delete game.slices.company.postedFacts[paymentId]; },
    (game: GameState) => { delete game.slices.company.postedFacts[systemsBriefProofId(game, complete, complete.finishedWeek!)]; },
    (game: GameState) => { delete game.slices.campaign.systemsBriefs![complete.id]; },
  ]) { const corrupt = structuredClone(run.state); mutate(corrupt); assert.ok(validateState(corrupt).length); }
  run.step(2);
  assert.equal(run.state.slices.company.ledger.filter(fact => fact.id === paymentId).length, 1);
  const next = openOffer(run); assert.notEqual(next.id, offer.id);
  assert.equal(previewCommand(run.state, { kind: 'accept_systems_brief', offerId: offer.id, modelId: paidModelId }).accepted, false);
  assert.equal(next.relationship?.tier, 'repeat'); assert.equal(next.qualifyingWeeks, 3);
  run.queue({ kind: 'accept_systems_brief', offerId: next.id, modelId: paidModelId }); run.step(next.qualifyingWeeks);
  assert.equal(getSystemsBriefOrders(run.state).filter(order => order.status === 'completed').length, 2);
  assert.deepEqual(validateState(run.state), []);
});

test('a systems commission expires without payment when no client serving capacity is allocated', () => {
  const run = legalClientModel(), offer = openOffer(run);
  run.queue({ kind: 'allocate_compute', serving: 0, development: 32 * U, research: 0 });
  run.queue({ kind: 'accept_systems_brief', offerId: offer.id, modelId: paidModelId }); run.step();
  assert.equal(activeSystemsBrief(run.state)!.qualifyingWeeks, 0);
  run.until(() => getSystemsBriefOrders(run.state)[0].status === 'expired', 6, 'commission expiry');
  const order = getSystemsBriefOrders(run.state)[0];
  assert.equal(order.finishedWeek, order.deadlineWeek);
  assert.equal(run.state.slices.company.postedFacts[systemsBriefPaymentId(run.state.playerCompanyId, order.id)], undefined);
  assert.deepEqual(validateState(run.state), []);
  const missingExpired = structuredClone(run.state); delete missingExpired.slices.campaign.systemsBriefs![order.id];
  assert.ok(validateState(missingExpired).length, 'An expired signed order cannot be erased to reopen the same offer.');
});

test('the last acceptance boundary freezes the shown quote and does not borrow next-window terms', () => {
  const run = legalClientModel();
  let offer = openOffer(run);
  run.until(() => run.week === offer.acceptUntilWeek - 1, 8, 'last acceptance boundary');
  offer = getSystemsBriefOffers(run.state).find(item => item.briefId === 'efficient-experts')!;
  assert.equal(offer.available, true);
  const payload = { kind: 'accept_systems_brief' as const, offerId: offer.id, modelId: paidModelId };
  const preview = previewCommand(run.state, payload); assert.ok(preview.accepted, preview.reason?.message);
  assert.match(preview.summary, new RegExp('Week ' + (offer.acceptUntilWeek + offer.deadlineWeeks - 1)));
  run.queue(payload);
  const saved = deserializeState(serializeState(run.state)); assert.ok(saved.ok, saved.ok ? '' : saved.error); run.state = saved.state;
  run.step();
  const order = activeSystemsBrief(run.state)!;
  assert.equal(order.startedWeek, offer.acceptUntilWeek); assert.deepEqual(order.terms, offer.terms);
  assert.equal(getSystemsBriefOffers(run.state)[0].available, false);
  run.step(); assert.equal(getSystemsBriefOrders(run.state)[0].status, 'completed');
  assert.deepEqual(validateState(run.state), []);
});
