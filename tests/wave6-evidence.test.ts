import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { DATA_CATALOG } from '../src/content/wave2-lab';
import { EVIDENCE_LINKS } from '../src/content/wave6-evidence';
import type { CommandPayload, GameState, ModelVersion, ModuleContext } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { createMarketsModule } from '../src/modules/markets';
import { createProductsModule, behaviorMeter, productDemand, productRequestMeter } from '../src/modules/products';
import { activeEfficiency, cacheWarm } from '../src/modules/product-efficiency';
import { activeEvidenceCheck, assertEvidenceCheckUsage, evidenceGoodForTrust, evidenceInputsMatch, getEvidenceCheckView } from '../src/modules/retrieval-evidence';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const products = createProductsModule(CONTENT), markets = createMarketsModule(CONTENT);
const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createLabModule(CONTENT), products];
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
const offer = (state: GameState) => state.slices.products.offers.docs;
const checker = (state: GameState) => state.slices.products.efficiencyInstalls['docs:evidence-links'];
const usage = (state: GameState) => state.slices.products.lastUsage.docs;
const demand = (state: GameState) => productDemand(state, offer(state), CONTENT, state.week);

function queue(state: GameState, payload: CommandPayload): GameState {
  const result = submitCommand(state, payload, CONTENT); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function step(state: GameState): GameState {
  const result = advanceWeek(state, CONTENT, modules); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function until(state: GameState, done: (state: GameState) => boolean): GameState {
  for (let count = 0; count < 8 && !done(state); count++) state = step(state);
  assert.ok(done(state), 'The funded fixture should finish its paid rollout with enough assigned staff and compute.'); return state;
}
function addReport(state: GameState, model: ModelVersion): void {
  const id = 'evidence-report:' + model.id; model.evaluationReportId = id;
  state.slices.models.reports[id] = { id, companyId: model.companyId, modelId: model.id, week: 9, heldOut: true, scenarioStart: true,
    capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, basicChatEligible: true,
    cases: Array.from({ length: 20 }, (_, i) => ({ id: 'evidence-case-' + i, domain: 'conversation', difficultyBps: 0, passed: true })), passedCases: 20 };
}
/** Authored module fixture only; all retrieval/checker deployment and service below use ordinary commands. */
function initial(medium = false, accounts = 2): GameState {
  let state = createPlayerOnlyState(); for (let week = 0; week < 10; week++) state = step(state);
  const owner = state.playerCompanyId; company(state).cashCents = 100_000_000;
  state.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), ml: U };
  for (const role of ['data', 'commercial'] as const) state.slices.company.staff[role] = { id: role, companyId: owner, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  company(state).activeStaff = 2;
  const known = ['R1', 'R2', 'R3', 'R6', 'R6A', 'R7', 'R8', 'R8A', 'R9', 'R10', 'R12'].sort();
  state.slices.research.completed = known; state.slices.research.completedByCompany[owner] = [...known];
  for (const researchId of known) {
    const definition = CONTENT.research.find(item => item.id === researchId)!, id = 'evidence-research:' + researchId;
    state.slices.research.projects[id] = { id, companyId: owner, researchId, startedWeek: 0, completedWeek: 1, availableWeek: 2,
      requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
      role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  const seed = state.slices.models.versions[CONTENT.seedModel.id];
  seed.capabilityBps = { conversation: 6500, documents: 6500, coding: 6000, tools: 5500 }; seed.reliabilityBps = 9600; seed.status = 'released'; addReport(state, seed);
  let servingModel = seed;
  if (medium) {
    servingModel = { ...structuredClone(seed), id: 'evidence-medium', name: 'Document medium', family: 'medium', residentMU: 8 * U, parentModelId: seed.id, scenarioStart: true };
    state.slices.models.versions[servingModel.id] = servingModel; addReport(state, servingModel);
  }
  const starter = state.slices.data.packets[CONTENT.starterData.id]; starter.prepared = true; starter.readyUnits = starter.rawUnits;
  const source = DATA_CATALOG.find(item => item.id === 'specialist-documents-1')!;
  state.slices.data.packets['evidence-documents'] = { id: 'evidence-documents', companyId: owner, catalogId: source.id, name: source.name,
    rawUnits: source.rawUnits, readyUnits: source.rawUnits, qualityBps: source.qualityBps, coverageBps: { ...source.coverageBps }, rights: { ...source.rights },
    sourceIds: [source.id], behaviorUnits: source.behaviorUnits, broadUnits: source.broadUnits, prepared: true, purchaseFactId: 'evidence-purchase', purchasedWeek: 8 };
  state.slices.company.postedFacts['evidence-purchase'] = true;
  fleet(state).cloudCU = 16 * U; fleet(state).memoryMU = 32 * U; fleet(state).allocation = { serving: 8 * U, development: 2 * U, research: 0 };
  state.slices.markets.waitlistRemaining = 0;
  state.slices.products.offers.docs = { id: 'docs', companyId: owner, name: 'Business Documents', kind: 'business-docs', features: { memory: false, extendedContext: false, deepReasoning: false },
    deploymentId: 'docs-deployment', contractId: 'docs-contract', publicModelId: servingModel.id, status: 'active', createdWeek: 8 };
  state.slices.products.deployments['docs-deployment'] = { id: 'docs-deployment', companyId: owner, productId: 'docs', modelId: servingModel.id, status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts['docs-contract'] = { id: 'docs-contract', companyId: owner, productId: 'docs', weeklyPriceCents: 30_000, allowance: 3000, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['docs'];
  if (accounts) state.slices.markets.cohorts = [{ id: 'evidence-customers', companyId: owner, productId: 'docs', contractId: 'docs-contract', segmentId: 'business', count: accounts, activeWeek: 9, renewalWeek: 22, breachWeeks: 0 }];
  assert.deepEqual(validateState(state), []); return state;
}
function withIndex(state = initial(), packetId = 'evidence-documents'): GameState {
  return until(queue(state, { kind: 'install_retrieval', productId: 'docs', packetId }), s => s.slices.products.retrievalInstalls.docs?.status === 'active');
}
function withChecks(state = withIndex()): GameState {
  return until(queue(state, { kind: 'install_product_efficiency', productId: 'docs', method: 'evidence-links' }), s => !!activeEvidenceCheck(s, 'docs'));
}
function context(state: GameState, phase: ModuleContext['phase']): ModuleContext {
  return { week: state.week, phase, content: CONTENT, facts: [], resources: { requests: [], staffGrants: [], computeGrants: [] }, random: { draw: () => { throw new Error('Citation checking has no reroll stream.'); } } };
}
/** Isolated execution grants let this test probe sub-request resource boundaries precisely. */
function executeGrant(state: GameState, work: number): GameState {
  const ctx = context(state, 'execute'), d = demand(state), index = state.slices.products.retrievalInstalls.docs;
  ctx.resources.staffGrants.push({ requestId: 'retrieval-upkeep:' + index.id, grants: [{ role: 'data', staffWeeks: (d.accounts + d.trialAccounts) * U / 10 }] });
  ctx.resources.computeGrants.push({ requestId: 'serve:docs', physicalCUw: work, hardwareEffectiveCUw: work, memoryMU: d.memory, poolId: 'general-cloud' });
  const next = structuredClone(state); Object.assign(next.slices, products.handlers.execute!(state, ctx).updates); return next;
}
function marketObservation(state: GameState) {
  const isolated = structuredClone(state); fleet(isolated).allocation.serving = 0;
  return markets.handlers.market!(isolated, context(isolated, 'market')).updates!.markets!;
}

test('W6-E01: discovery needs an owned Business Documents index and a separate two-meter rollout', () => {
  let state = initial(); const action: CommandPayload = { kind: 'install_product_efficiency', productId: 'docs', method: 'evidence-links' };
  assert.equal(previewCommand(state, action).accepted, false, 'Research by itself creates no source checker.');
  state = withIndex(state); assert.equal(usage(state).evidence, undefined);
  const noResearch = structuredClone(state); noResearch.slices.research.completedByCompany[state.playerCompanyId] = noResearch.slices.research.completedByCompany[state.playerCompanyId].filter(id => id !== 'R6A');
  assert.equal(previewCommand(noResearch, action).accepted, false);
  const otherProduct = structuredClone(state); offer(otherProduct).kind = 'basic-chat';
  assert.equal(previewCommand(otherProduct, action).accepted, false);
  assert.equal(previewCommand(state, { ...action, secondaryModelId: CONTENT.seedModel.id }).accepted, false);
  const baseline = demand(state).meter.work, modelHash = canonicalStateHash(state.slices.models.versions[CONTENT.seedModel.id]);
  state = queue(state, { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), commercial: U } });
  const staff = staffContributors(state, 'ml');
  for (const member of staff) state = queue(state, { kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  state = step(queue(state, action));
  assert.equal(checker(state).completedWork, U); assert.equal(checker(state).completedStaff, 0); assert.equal(checker(state).status, 'building');
  assert.equal(demand(state).meter.work, baseline); assert.equal(usage(state).evidence, undefined);
  assert.equal(previewCommand(state, action).reason?.code, 'ALREADY_ACTIVE');
  for (const member of staff) state = queue(state, { kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  state = step(queue(state, { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), ml: U } }));
  assert.equal(checker(state).status, 'ready'); assert.equal(activeEvidenceCheck(state, 'docs'), null);
  state = step(state); assert.equal(checker(state).status, 'active'); assert.equal(checker(state).retrievalId, state.slices.products.retrievalInstalls.docs.id);
  assert.equal(checker(state).evidencePacketId, 'evidence-documents'); assert.equal(canonicalStateHash(state.slices.models.versions[CONTENT.seedModel.id]), modelHash);
  assert.ok(company(state).lastWeek.operatingExpenseCents > 0, 'Payroll and rented GPUs remain paid throughout implementation.');
});

test('W6-E02: evidence work is charged once, unsupported answers are withheld, and checking creates no new bill or trained capability', () => {
  const indexed = withIndex(), oldUsage = usage(indexed), oldDemand = demand(indexed), state = withChecks(indexed), actual = usage(state), meter = actual.evidence!;
  assert.equal(demand(state).meter.work - oldDemand.meter.work, EVIDENCE_LINKS.workPerRequestCUw);
  assert.equal(meter.requestedRequests, 6000); assert.equal(meter.checkedRequests, 6000); assert.equal(meter.supportBps, 9000);
  assert.equal(meter.supportedRequests, 5400); assert.equal(meter.withheldRequests, 600); assert.equal(meter.uncheckedRequests, 0);
  assert.equal(meter.checkWorkCUw, 6000 * EVIDENCE_LINKS.workPerRequestCUw);
  assert.equal(actual.executedWork - oldUsage.executedWork, meter.checkWorkCUw);
  assert.equal(actual.tokens!.physicalWork, actual.executedWork); assert.equal(actual.tokens!.inputTokens, oldUsage.tokens!.inputTokens);
  assert.equal(actual.errorBps, oldUsage.errorBps); assert.equal(actual.fulfillmentBps, 10000);
  assert.equal(actual.billedCents, oldUsage.billedCents); assert.equal(actual.grossBillCents, 60_000); assert.equal(actual.creditsCents, 0);
  assert.ok(actual.behavior!.confidentErrorBps < oldUsage.behavior!.confidentErrorBps);
  assert.equal(actual.behavior!.falseRefusalBps, oldUsage.behavior!.falseRefusalBps);
  assert.deepEqual(validateState(state), []);
});

test('W6-E03: partial work, zero capacity, and a free trial cannot manufacture completed evidence or paid tokens', () => {
  const state = withChecks(), workPerRequest = demand(state).meter.work;
  for (const work of [0, workPerRequest - 1, workPerRequest * 5 + workPerRequest / 2]) {
    const observed = executeGrant(state, work), u = usage(observed), e = u.evidence!;
    assert.equal(e.checkedRequests, Math.floor(work / workPerRequest));
    assert.equal(e.supportedRequests + e.withheldRequests, e.checkedRequests);
    assert.equal(e.checkedRequests + e.uncheckedRequests, e.requestedRequests);
    assert.equal(e.checkWorkCUw, Math.floor(work * EVIDENCE_LINKS.workPerRequestCUw / workPerRequest));
    assert.ok(e.checkWorkCUw >= e.checkedRequests * EVIDENCE_LINKS.workPerRequestCUw);
    assertEvidenceCheckUsage(observed, u, workPerRequest);
    if (!e.checkedRequests) {
      assert.equal(evidenceGoodForTrust(e), false);
      assert.deepEqual(u.behavior, behaviorMeter(demand(observed).model, u.errorBps), 'No completed check grants an invented behavior benefit.');
    }
    if (!work) { assert.equal(u.billedCents, 0); assert.equal(u.tokens!.inputTokens, 0); assert.equal(u.tokens!.physicalWork, 0); }
  }
  const free = structuredClone(state); free.slices.markets.cohorts = [];
  const perAccount = 300 * workPerRequest;
  free.slices.markets.trials = [{ id: 'evidence-trial', companyId: free.playerCompanyId, productId: 'docs', segmentId: 'business', count: 1,
    createdWeek: free.week - 1, activeWeek: free.week, expiresWeek: free.week + 1, workCompleted: 0, workPerAccount: perAccount, requiredWork: perAccount }];
  const served = executeGrant(free, demand(free).trialWork), freeUsage = usage(served);
  assert.ok(freeUsage.evidence!.checkedRequests > 0); assert.equal(freeUsage.paidAccounts, 0); assert.equal(freeUsage.billedCents, 0);
  assert.equal(freeUsage.tokens!.inputTokens, 0); assert.equal(freeUsage.tokens!.outputTokens, 0);
  const quiet = withChecks(withIndex(initial(false, 0))), quietUsage = usage(quiet);
  assert.ok(activeEvidenceCheck(quiet, 'docs')); assert.equal(offer(quiet).status, 'active');
  assert.equal(quietUsage.evidence!.requestedRequests, 0); assert.equal(quietUsage.evidence!.checkedRequests, 0);
  assert.equal(quietUsage.evidence!.checkWorkCUw, 0); assert.equal(quietUsage.billedCents, 0);
  assert.equal(evidenceGoodForTrust(quietUsage.evidence), false); assert.deepEqual(validateState(quiet), []);
});

test('W6-E04: source relevance and real upkeep gate support and weekly trust; withholding affects business renewal', () => {
  const fresh = withChecks(), freshMarket = marketObservation(fresh);
  assert.equal(freshMarket.trustBps, 5010); assert.equal(evidenceGoodForTrust(usage(fresh).evidence), true);
  const irrelevant = withChecks(withIndex(initial(), CONTENT.starterData.id)), irrelevantMarket = marketObservation(irrelevant);
  assert.equal(usage(irrelevant).evidence!.supportBps, 2800); assert.equal(irrelevantMarket.trustBps, 4975);
  const stale = step(queue(fresh, { kind: 'set_staff_allocation', staffId: 'data', fte: 0 }));
  assert.equal(usage(stale).evidence!.freshnessBps, 0); assert.equal(usage(stale).evidence!.supportedRequests, 0);
  assert.equal(usage(stale).evidence!.withheldRequests, usage(stale).evidence!.checkedRequests);
  assert.equal(marketObservation(stale).trustBps, 4975, 'A full week of GPU work producing only withheld answers cannot earn trust.');
  assert.ok(usage(stale).evidence!.checkWorkCUw > 0); assert.equal(usage(stale).fulfillmentBps, 10000);

  // Renewal has the same otherwise-qualified model and zero GPU shortage. Only
  // the optional checker and its documented withheld-answer friction differ.
  const renew = structuredClone(stale); renew.slices.markets.cohorts[0].renewalWeek = renew.week;
  const withoutCheck = structuredClone(renew); delete usage(withoutCheck).evidence;
  usage(withoutCheck).behavior = behaviorMeter(demand(withoutCheck).model, usage(withoutCheck).errorBps);
  assert.ok(marketObservation(renew).carries[renew.playerCompanyId + ':business'].churn > marketObservation(withoutCheck).carries[renew.playerCompanyId + ':business'].churn);
});

test('W6-E05: routing and a warm prefix cache cannot discount or skip the evidence check', () => {
  let state = withChecks(withIndex(initial(true)));
  state = until(queue(state, { kind: 'install_product_efficiency', productId: 'docs', method: 'prefix-cache' }), s => !!activeEfficiency(s, 'docs', 'prefix-cache'));
  state = until(queue(state, { kind: 'install_product_efficiency', productId: 'docs', method: 'routing', secondaryModelId: CONTENT.seedModel.id }), s => !!activeEfficiency(s, 'docs', 'routing'));
  state = step(state); assert.equal(cacheWarm(state, offer(state)), true);
  const enabled = productRequestMeter(state, offer(state), demand(state).primaryModel);
  const disabled = structuredClone(state); checker(disabled).enabled = false;
  const ordinary = productRequestMeter(disabled, offer(disabled), demand(disabled).primaryModel);
  assert.equal(enabled.work - ordinary.work, EVIDENCE_LINKS.workPerRequestCUw);
  assert.equal(enabled.inputTokens, ordinary.inputTokens); assert.equal(enabled.outputTokens, ordinary.outputTokens);
  assert.equal(usage(state).evidence!.checkWorkCUw, usage(state).evidence!.checkedRequests * EVIDENCE_LINKS.workPerRequestCUw);
});

test('W6-E06: model replacement invalidates captured inputs, disabled and paused products produce no phantom evidence', () => {
  let state = withChecks(); const originalUsage = structuredClone(usage(state));
  state = queue(state, { kind: 'create_model_variant', modelId: CONTENT.seedModel.id, variant: 'compression' });
  state = step(queue(state, { kind: 'set_product_efficiency_enabled', productId: 'docs', method: 'evidence-links', enabled: false }));
  assert.equal(usage(state).evidence, undefined); assert.equal(getEvidenceCheckView(state, 'docs').active, false);
  state = step(queue(state, { kind: 'set_product_efficiency_enabled', productId: 'docs', method: 'evidence-links', enabled: true }));
  assert.equal(getEvidenceCheckView(state, 'docs').active, true);
  const replacement = Object.values(state.slices.models.applicationRuns)[0]; assert.equal(replacement.status, 'complete');
  state = queue(state, { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), research: U } });
  state = queue(state, { kind: 'evaluate_model', modelId: replacement.outputModelId });
  state = step(queue(state, { kind: 'set_product_paused', productId: 'docs', paused: true }));
  assert.equal(usage(state).evidence!.checkedRequests, 0); assert.equal(usage(state).evidence!.checkWorkCUw, 0); assert.equal(usage(state).billedCents, 0);
  assert.equal(state.slices.models.versions[replacement.outputModelId].status, 'evaluated');
  state = queue(state, { kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), ml: U } });
  state = step(queue(state, { kind: 'set_product_paused', productId: 'docs', paused: false }));
  state = step(queue(state, { kind: 'upgrade_product', productId: 'docs', modelId: replacement.outputModelId })); state = step(state);
  assert.equal(offer(state).status, 'active'); assert.equal(activeEvidenceCheck(state, 'docs'), null); assert.equal(usage(state).evidence, undefined);
  assert.equal(previewCommand(state, { kind: 'install_product_efficiency', productId: 'docs', method: 'evidence-links' }).accepted, true);
  assertEvidenceCheckUsage(state, originalUsage, 123); // A historical report ignores a later request cost.
  const changedIndex = structuredClone(state), old = checker(changedIndex);
  changedIndex.slices.products.deployments[offer(changedIndex).deploymentId].modelId = old.modelId;
  changedIndex.slices.products.retrievalInstalls.docs.evidence.packetId = CONTENT.starterData.id;
  assert.equal(evidenceInputsMatch(changedIndex, old), false, 'A future index replacement also invalidates a captured source identity.');
});

test('W6-E07: a public evidence checker cannot change named license obligations or bill customer-provided GPUs', () => {
  let state = withIndex();
  state = until(queue(state, { kind: 'sign_business_contract', customerId: 'vector-studio', contractKind: 'customer-hosted', modelId: CONTENT.seedModel.id }), s => s.slices.products.commercialContracts['business:vector-studio']?.status === 'active');
  const before = state.slices.products.commercialContracts['business:vector-studio'];
  state = withChecks(state); const after = state.slices.products.commercialContracts['business:vector-studio'];
  assert.deepEqual(after.rights, before.rights); assert.equal(after.modelId, before.modelId); assert.equal(after.weeklyPriceCents, before.weeklyPriceCents);
  assert.equal(after.lastUsage!.billedCents, 25_000); assert.equal(after.lastUsage!.physicalWorkCUw, 0); assert.equal(after.lastUsage!.requestedWorkCUw, 0);
  assert.equal(after.evidence, null); assert.ok(usage(state).evidence!.checkWorkCUw > 0);
});

test('W6-E08: corrupted evidence counts, checking work, captured inputs and free rollouts are rejected on import', () => {
  const state = withChecks(), snapshot = JSON.parse(serializeState(state));
  const corruptions: Array<(s: GameState) => void> = [
    s => { usage(s).evidence!.supportedRequests++; },
    s => { usage(s).evidence!.withheldRequests = 0; },
    s => { usage(s).evidence!.uncheckedRequests++; },
    s => { usage(s).evidence!.checkWorkCUw = 0; },
    s => { usage(s).evidence!.freshnessBps = 0; },
    s => { usage(s).evidence!.requestWorkCUw -= EVIDENCE_LINKS.workPerRequestCUw; },
    s => { usage(s).evidence!.qualityBps = 10000; },
    s => { usage(s).evidence!.packetId = CONTENT.starterData.id; },
    s => { delete usage(s).evidence; },
    s => { checker(s).requiredWork = 0; checker(s).completedWork = 0; },
    s => { checker(s).retrievalId = 'retrieval:foreign'; },
  ];
  for (const corrupt of corruptions) {
    const bad = structuredClone(state); corrupt(bad);
    const loaded = deserializeState(JSON.stringify({ ...snapshot, state: bad, checksum: canonicalStateHash(bad) }));
    assert.equal(loaded.ok, false, 'A recomputed file checksum must not make forged support evidence valid.');
  }
});

test('W6-E09: a settled evidence-enabled company reloads and continues deterministically without duplicated receipts', () => {
  const state = withChecks(), loaded = deserializeState(serializeState(state));
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(state));
  const originalNext = step(state), reloadedNext = step(loaded.state);
  assert.equal(canonicalStateHash(originalNext), canonicalStateHash(reloadedNext));
  assert.equal(reloadedNext.slices.products.invoices.length, state.slices.products.invoices.length + 1);
  assert.equal(reloadedNext.slices.products.invoices.at(-1)!.amountCents, usage(reloadedNext).billedCents);
  assertEvidenceCheckUsage(reloadedNext, usage(reloadedNext), demand(reloadedNext).meter.work);
});
