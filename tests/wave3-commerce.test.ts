import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { BUSINESS_CUSTOMERS, COMMERCE_RULES as RULES } from '../src/content/wave3-commerce';
import type { CommandPayload, GameState, ModuleContext, ProductKind } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createProductsModule, productDemand } from '../src/modules/products';
import { createMarketsModule, getMarketView } from '../src/modules/markets';
import { createLabModule } from '../src/modules/lab';
import { businessSettle, commercialOrganizationCount, getBusinessView, getModelCommerceRights, outsideBusinessOrganizations } from '../src/modules/business';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createProductsModule(CONTENT)];
const company = (state: GameState) => state.slices.company.companies[state.playerCompanyId];
const fleet = (state: GameState) => state.slices.compute.fleets[state.playerCompanyId];
const agreement = (state: GameState, customerId = 'aster-services') => state.slices.products.commercialContracts['business:' + customerId];
function initial(): GameState {
  let state = createPlayerOnlyState(); for (let week = 0; week < 10; week++) state = step(state);
  const companyId = state.playerCompanyId; company(state).cashCents = 100_000_000;
  state.slices.company.founderAssignments[companyId] = { ...emptyRoleAllocation(), ml: U };
  for (const role of ['data', 'commercial', 'infrastructure'] as const) state.slices.company.staff[role] = { id: role, companyId, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  company(state).activeStaff = 3;
  state.slices.research.completed = ['R1', 'R2', 'R3', 'R6', 'R9', 'R10', 'R12'];
  state.slices.research.completedByCompany[companyId] = [...state.slices.research.completed];
  for (const researchId of state.slices.research.completed) {
    const definition = CONTENT.research.find(item => item.id === researchId)!, id = 'commercial-fixture-' + researchId;
    state.slices.research.projects[id] = { id, companyId, researchId, startedWeek: 0, completedWeek: 1, availableWeek: 2,
      requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
      role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.capabilityBps = { conversation: 5200, documents: 7000, coding: 6000, tools: 5500 }; model.reliabilityBps = 9600; model.status = 'evaluated';
  const reportId = 'commercial-evaluation'; model.evaluationReportId = reportId;
  state.slices.models.reports[reportId] = { id: reportId, companyId, modelId: model.id, week: 9, heldOut: true, scenarioStart: true,
    capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, basicChatEligible: true,
    cases: Array.from({ length: 20 }, (_, i) => ({ id: 'commercial-case-' + i, domain: 'conversation', difficultyBps: 0, passed: true })), passedCases: 20 };
  const packet = state.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  fleet(state).cloudCU = 8 * U; fleet(state).memoryMU = 16 * U; fleet(state).allocation = { serving: 8 * U, development: 0, research: 0 };
  state.slices.markets.waitlistRemaining = 0;
  assert.deepEqual(validateState(state, CONTENT), []);
  return state;
}
function queue(state: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(state, payload, CONTENT, id); assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function step(state: GameState, withMarkets = false): GameState {
  const result = advanceWeek(state, CONTENT, withMarkets ? [...modules, createMarketsModule(CONTENT)] : modules);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function sign(state: GameState, contractKind: 'private-hosted' | 'customer-hosted' = 'private-hosted', customerId = 'aster-services'): GameState {
  return queue(state, { kind: 'sign_business_contract', contractKind, customerId, modelId: CONTENT.seedModel.id, ...(contractKind === 'private-hosted' ? { packetId: CONTENT.starterData.id } : {}) });
}
function delivered(state: GameState, contractKind: 'private-hosted' | 'customer-hosted' = 'private-hosted', customerId = 'aster-services'): GameState {
  state = sign(state, contractKind, customerId);
  for (let i = 0; i < 8 && agreement(state, customerId)?.status !== 'active'; i++) state = step(state);
  assert.equal(agreement(state, customerId).status, 'active'); return state;
}
function product(state: GameState, accounts = 2, kind: ProductKind = 'business-docs'): GameState {
  const companyId = state.playerCompanyId, model = state.slices.models.versions[CONTENT.seedModel.id]; model.status = 'released';
  state.slices.products.offers.docs = { id: 'docs', companyId, name: 'Documents', kind, features: { memory: false, extendedContext: false, deepReasoning: false },
    deploymentId: 'docs-deployment', contractId: 'docs-contract', publicModelId: model.id, status: 'active', createdWeek: 8 };
  state.slices.products.deployments['docs-deployment'] = { id: 'docs-deployment', companyId, productId: 'docs', modelId: model.id,
    status: 'active', startedWeek: 8, requiredStaff: U, completedStaff: U, readyWeek: 9, lastBottleneck: '' };
  state.slices.products.contracts['docs-contract'] = { id: 'docs-contract', companyId, productId: 'docs', weeklyPriceCents: 30000, allowance: 3000, creditBps: 10000, effectiveWeek: 9 };
  state.slices.products.activeIds = ['docs'];
  if (accounts) state.slices.markets.cohorts = [{ id: 'business-users', companyId, productId: 'docs', contractId: 'docs-contract', segmentId: 'business', count: accounts, activeWeek: 9, renewalWeek: 21, breachWeeks: 0 }];
  return state;
}

test('W3-C01: retrieval needs real rollout, own prepared evidence, and per-organization upkeep; it changes product cost and quality without changing weights', () => {
  let state = product(initial());
  const model = state.slices.models.versions[CONTENT.seedModel.id]; model.capabilityBps.documents = 5500;
  state.slices.models.reports[model.evaluationReportId!].capabilityBps.documents = 5500;
  const frozenModel = canonicalStateHash(model), base = productDemand(state, state.slices.products.offers.docs, CONTENT, state.week);
  const command: CommandPayload = { kind: 'install_retrieval', productId: 'docs', packetId: CONTENT.starterData.id };
  const unprepared = structuredClone(state); unprepared.slices.data.packets[CONTENT.starterData.id].prepared = false; unprepared.slices.data.packets[CONTENT.starterData.id].readyUnits = 0;
  assert.equal(previewCommand(unprepared, command, CONTENT).accepted, false);
  const noResearch = structuredClone(state); noResearch.slices.research.completedByCompany[state.playerCompanyId] = [];
  assert.equal(previewCommand(noResearch, command, CONTENT).accepted, false);
  state = step(queue(state, command)); assert.equal(state.slices.products.retrievalInstalls.docs.completedStaff, U);
  assert.equal(state.slices.products.retrievalInstalls.docs.status, 'building');
  assert.equal(productDemand(state, state.slices.products.offers.docs, CONTENT, state.week).meter.work, base.meter.work);
  state = step(state); assert.equal(state.slices.products.retrievalInstalls.docs.status, 'ready');
  state = step(state); const installation = state.slices.products.retrievalInstalls.docs, demand = productDemand(state, state.slices.products.offers.docs, CONTENT, state.week);
  assert.equal(installation.status, 'active'); assert.equal(installation.lastUpkeepRequired, 2 * RULES.retrievalDataStaffPerOrganization);
  assert.equal(installation.lastUpkeepGranted, installation.lastUpkeepRequired); assert.equal(installation.lastFreshnessBps, 10000);
  assert.equal(demand.meter.inputTokens - base.meter.inputTokens, 500); assert.equal(demand.meter.work - base.meter.work, 120000);
  assert.equal(demand.memory - base.memory, U); assert.ok(demand.documentBonusBps > 0); assert.ok(demand.segments[0].errorBps < base.segments[0].errorBps);
  assert.equal(canonicalStateHash(state.slices.models.versions[model.id]), frozenModel);
  for (const member of staffContributors(state, 'data')) state = queue(state, { kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  state = step(state);
  assert.equal(state.slices.products.retrievalInstalls.docs.lastFreshnessBps, 0);
  assert.equal(productDemand(state, state.slices.products.offers.docs, CONTENT, state.week).documentBonusBps, 0);
  assert.equal(state.slices.products.lastUsage.docs.requestedWork, demand.paidWork, 'Stale evidence does not make executed token and lookup work free.');
  assert.equal(state.slices.products.lastUsage.docs.errorBps, base.segments[0].errorBps);
});

test('W3-C02: private contract admission includes paid service, connected memory, headroom and overlapping queued commitments', () => {
  let state = initial(); fleet(state).allocation.serving = U;
  state = sign(state); assert.equal(previewCommand(state, { kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  const another: CommandPayload = { kind: 'sign_business_contract', customerId: 'northline-operations', contractKind: 'private-hosted', modelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id };
  assert.equal(previewCommand(state, another, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  state = step(state); assert.equal(agreement(state).status, 'building');
  assert.equal(previewCommand(state, another, CONTENT).reason?.code, 'CAPACITY_EXCEEDED', 'Installing commitments must still reserve admission capacity.');
  const paid = product(initial(), 3); fleet(paid).allocation.serving = 2 * U;
  assert.equal(previewCommand(paid, { kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  const memory = initial(); fleet(memory).cloudCU = U; fleet(memory).memoryMU = 2 * U; fleet(memory).allocation.serving = U;
  assert.equal(previewCommand(memory, { kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id }, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
});

test('W3-C03: four real ML staff-weeks precede private billing; shortages produce credits and two breaches terminate service', () => {
  let state = sign(initial()); const previousRevenue = company(state).earnedRevenueCents;
  for (let i = 1; i <= 4; i++) {
    state = step(state); assert.equal(agreement(state).completedDeliveryStaff, i * U); assert.equal(company(state).earnedRevenueCents, previousRevenue);
    assert.equal(state.slices.products.commercialInvoices.length, 0);
  }
  assert.equal(agreement(state).status, 'ready'); state = step(state);
  const live = agreement(state); assert.equal(live.status, 'active'); assert.equal(live.lastUsage!.executedWorkCUw, live.reservedWorkCUw);
  assert.equal(live.lastUsage!.dataStaffGranted, RULES.retrievalDataStaffPerOrganization); assert.equal(live.lastUsage!.supportStaffGranted, RULES.supportStaffPerOrganization);
  assert.equal(live.lastUsage!.serviceBps, 10000); assert.equal(live.lastUsage!.billedCents, 60000);
  assert.equal(fleet(state).lastWork.serving, live.reservedWorkCUw); assert.equal(company(state).earnedRevenueCents, previousRevenue + 60000);
  state = step(queue(state, { kind: 'allocate_compute', serving: 0, development: 0, research: 0 }));
  assert.equal(agreement(state).breachWeeks, 1); assert.equal(agreement(state).lastUsage!.billedCents, 0); assert.equal(agreement(state).lastUsage!.creditsCents, 60000);
  assert.equal(agreement(state).lastUsage!.inputTokens, 0); assert.equal(agreement(state).lastUsage!.physicalWorkCUw, 0);
  state = step(state); assert.equal(agreement(state).status, 'terminated'); assert.equal(agreement(state).breachWeeks, 2);
  assert.equal(commercialOrganizationCount(state), 1, 'Terminated customer cannot re-enter the outside market in the same week.');
  assert.equal(previewCommand(state, { kind: 'sign_business_contract', customerId: 'aster-services', modelId: CONTENT.seedModel.id, contractKind: 'customer-hosted' }, CONTENT).accepted, false);
  state = step(state); assert.equal(commercialOrganizationCount(state), 0);
});

test('W3-C04: customer-hosted licensing needs distribution rights, paid delivery and support; buyer runtime never charges company GPUs', () => {
  let state = initial(); fleet(state).cloudCU = 0; fleet(state).memoryMU = 0; fleet(state).allocation.serving = 0;
  const model = state.slices.models.versions[CONTENT.seedModel.id], forbidden = structuredClone(model);
  forbidden.id = 'unproven-weights'; forbidden.evaluationReportId = 'unproven-report'; forbidden.scenarioStart = true;
  state.slices.models.versions[forbidden.id] = forbidden;
  state.slices.models.reports['unproven-report'] = { ...structuredClone(state.slices.models.reports[model.evaluationReportId!]), id: 'unproven-report', modelId: forbidden.id };
  assert.deepEqual(getModelCommerceRights(state, forbidden.id, CONTENT), { hosted: false, weights: false });
  assert.equal(previewCommand(state, { kind: 'sign_business_contract', customerId: 'vector-studio', modelId: forbidden.id, contractKind: 'customer-hosted' }, CONTENT).accepted, false);
  state = sign(state, 'customer-hosted', 'vector-studio'); state = step(state);
  assert.equal(agreement(state, 'vector-studio').completedDeliveryStaff, U); assert.equal(company(state).earnedRevenueCents, 0);
  state = step(state); assert.equal(agreement(state, 'vector-studio').status, 'ready'); state = step(state);
  const license = agreement(state, 'vector-studio'); assert.equal(license.status, 'active'); assert.equal(license.lastUsage!.billedCents, 25000);
  assert.equal(license.reservedWorkCUw, 0); assert.equal(license.reservedMemoryMU, 0); assert.equal(license.lastUsage!.inputTokens, 0); assert.equal(license.lastUsage!.technicalErrorBps, null);
  assert.equal(fleet(state).lastWork.serving, 0); assert.equal(fleet(state).lastWork.development, 0);
  assert.equal(state.slices.company.ledger.some(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work' && entry.amountCents > 0), false);
  state.slices.company.staff.commercial.assignedFte = 0; state = step(state);
  assert.equal(agreement(state, 'vector-studio').lastUsage!.serviceBps, 0); assert.equal(agreement(state, 'vector-studio').lastUsage!.billedCents, 0);
  state = step(state); assert.equal(agreement(state, 'vector-studio').status, 'terminated');
});

test('W3-C05: twelve-week terms expire or renew once at the boundary; fixed board blocks contract spam and upfront cash loops', () => {
  let state = delivered(initial(), 'customer-hosted'); const started = agreement(state).termStartedWeek!, end = agreement(state).termEndsWeek!;
  while (state.week < end) state = step(state);
  assert.equal(agreement(state).status, 'expired'); assert.equal(agreement(state).termWeeksServed, 12);
  assert.equal(agreement(state).lifetimeBilledCents, 12 * 22000);
  assert.deepEqual(state.slices.products.commercialInvoices.map(invoice => invoice.week), Array.from({ length: 12 }, (_, i) => started + i));
  const after = agreement(state).lifetimeBilledCents; state = step(state); assert.equal(agreement(state).lifetimeBilledCents, after);
  let renewed = step(sign(initial(), 'customer-hosted')); renewed = queue(renewed, { kind: 'set_business_renewal', contractId: 'business:aster-services', renew: true });
  while (agreement(renewed).status !== 'active') renewed = step(renewed);
  const boundary = agreement(renewed).termEndsWeek!; while (renewed.week < boundary) renewed = step(renewed);
  assert.equal(agreement(renewed).termIndex, 2); assert.equal(agreement(renewed).generation, 1); assert.equal(agreement(renewed).termWeeksServed, 1);
  assert.equal(agreement(renewed).lifetimeBilledCents, 13 * 22000);
  assert.equal(renewed.slices.company.ledger.filter(entry => entry.id.startsWith('business-setup:')).length, 1);
  assert.equal(getBusinessView(renewed, CONTENT).board.find(customer => customer.id === 'aster-services')!.available, false);
});

test('W3-C06: finite organization claims include Harbor-style cohorts, trials, returns and commercial commitments', () => {
  let state = product(initial(), 79);
  assert.equal(outsideBusinessOrganizations(state), 1); state = sign(state, 'customer-hosted');
  const another: CommandPayload = { kind: 'sign_business_contract', customerId: 'vector-studio', modelId: CONTENT.seedModel.id, contractKind: 'customer-hosted' };
  assert.equal(previewCommand(state, another, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  state = step(state); assert.equal(outsideBusinessOrganizations(state), 0);
  const business = getMarketView(state, CONTENT).segments.find(segment => segment.id === 'business')!;
  assert.equal(business.paying + business.trials + business.returning + business.committed + business.outside, 80);
  assert.equal(Object.keys(state.slices.products.commercialContracts).length, 1);
  const invalid = structuredClone(state); invalid.slices.markets.cohorts[0].count++;
  assert.ok(validateState(invalid, CONTENT).length > 0);
});

test('W3-C07: real staffed owned hardware can admit private capacity, while lost operating staff and memory cannot', () => {
  let state = initial(); fleet(state).cloudCU = 0; fleet(state).memoryMU = 0; fleet(state).allocation.serving = 0;
  state = step(queue(state, { kind: 'order_rack', hardwareId: 'general', location: 'colocation' }, 'commercial-rack'));
  while (state.slices.compute.racks['rack-commercial-rack'].status === 'ordered') state = step(state);
  state = step(queue(state, { kind: 'install_rack', rackId: 'rack-commercial-rack' })); state = step(state);
  state = step(queue(state, { kind: 'allocate_compute', serving: 8 * U, development: 0, research: 0 }));
  const payload: CommandPayload = { kind: 'sign_business_contract', customerId: 'aster-services', modelId: CONTENT.seedModel.id, contractKind: 'private-hosted', packetId: CONTENT.starterData.id };
  assert.equal(previewCommand(state, payload, CONTENT).accepted, true);
  const unstaffed = structuredClone(state); unstaffed.slices.company.staff.infrastructure.assignedFte = 0;
  assert.equal(previewCommand(unstaffed, payload, CONTENT).reason?.code, 'CAPACITY_EXCEEDED');
  state = delivered(state); assert.ok(agreement(state).lastUsage!.physicalWorkCUw > 0);
  assert.ok(state.slices.company.ledger.some(entry => entry.week === state.week && entry.sourceId === 'owned-gpu-work' && entry.amountCents > 0));
});

test('W3-C08: save replay preserves commercial obligations and exact receipts; hostile promises, evidence, dates and bills reject', () => {
  const state = delivered(initial()), restored = deserializeState(serializeState(state, CONTENT), CONTENT);
  assert.equal(restored.ok, true); if (!restored.ok) return;
  const a = step(state), b = step(restored.state); assert.equal(canonicalStateHash(a), canonicalStateHash(b));
  const ctx: ModuleContext = { week: a.week, phase: 'settle', content: CONTENT, facts: [], resources: { requests: [], computeGrants: [], staffGrants: [] }, random: { draw: () => 0 } };
  assert.equal(businessSettle(a, ctx).facts!.length, 0, 'Replaying settlement cannot duplicate an invoice receipt.');
  const corruptions: Array<(copy: GameState) => void> = [
    copy => { agreement(copy).reservedWorkCUw = 0; },
    copy => { agreement(copy).reservedMemoryMU = 0; },
    copy => { agreement(copy).requiredDeliveryStaff = U; },
    copy => { agreement(copy).evidence!.documentBonusBps += 100; },
    copy => { agreement(copy).rights.weights = false; },
    copy => { agreement(copy).termEndsWeek! += 1; },
    copy => { agreement(copy).lastUsage!.executedWorkCUw += U; },
    copy => { agreement(copy).lastUsage!.billedCents += 1; },
    copy => { copy.slices.products.commercialInvoices.push(structuredClone(copy.slices.products.commercialInvoices[0])); },
    copy => { delete copy.slices.company.postedFacts[copy.slices.products.commercialInvoices[0].id]; },
    copy => { agreement(copy).contractKind = 'customer-hosted'; },
  ];
  for (const corrupt of corruptions) { const copy = structuredClone(a); corrupt(copy); assert.ok(validateState(copy, CONTENT).length > 0, corrupt.toString()); }
  assert.equal(getBusinessView(state, CONTENT).board.length, BUSINESS_CUSTOMERS.length);
});

test('W3-C09: reservation priority and market forecasts preserve promised private work while new public demand waits', () => {
  let state = delivered(initial()); state = product(state, 0);
  const publicModel = state.slices.models.versions[CONTENT.seedModel.id]; publicModel.status = 'released';
  const needed = agreement(state).reservedWorkCUw;
  fleet(state).allocation.serving = Math.ceil(needed * 1.1);
  state = step(state, true);
  assert.equal(agreement(state).lastUsage!.executedWorkCUw, needed);
  assert.equal(agreement(state).lastUsage!.serviceBps, 10000);
  assert.equal(state.slices.markets.trials.filter(trial => trial.productId === 'docs').length, 0, 'Acquisition cannot spend capacity promised to private service.');
});

test('W3-C10: real training preserves inherited weight restrictions after a second adaptation with permissive data', () => {
  let state = initial(); const id = state.playerCompanyId, base = state.slices.models.versions[CONTENT.seedModel.id];
  base.capabilityBps = { ...CONTENT.seedModel.capabilityBps }; base.reliabilityBps = 9000;
  const report = state.slices.models.reports[base.evaluationReportId!]; report.capabilityBps = { ...base.capabilityBps }; report.reliabilityBps = base.reliabilityBps; report.basicChatEligible = false;
  // Historical licensed evidence fixtures exercise rights that the default authored public packs do not restrict.
  for (const [packetId, domain, weights] of [['licensed-documents', 'documents', false], ['permissive-code', 'coding', true]] as const) {
    state.slices.data.packets[packetId] = { ...structuredClone(CONTENT.starterData), id: packetId, name: packetId, companyId: id, catalogId: 'historic-' + packetId,
      sourceIds: ['historic-source-' + packetId], prepared: true, rawUnits: 140, readyUnits: 140, qualityBps: 9000,
      coverageBps: { conversation: 2000, documents: 2000, coding: 2000, tools: 2000, [domain]: 10000 }, rights: { hosted: true, weights, feedback: false } };
  }
  fleet(state).allocation = { serving: 0, development: 8 * U, research: 0 };
  const laboratoryModules = [...modules, createLabModule(CONTENT)];
  const labStep = () => { const next = advanceWeek(state, CONTENT, laboratoryModules); assert.equal(next.accepted, true, next.reason?.message); state = next.state; };
  const train = (baseModelId: string, packetId: string, recipeId: string, commandId: string) => {
    state.slices.company.founderAssignments[id] = { ...emptyRoleAllocation(), ml: U };
    state = queue(state, { kind: 'start_training', baseModelId, packetId, recipeId }, commandId);
    for (let i = 0; i < 40 && state.slices.models.trainingRuns['training-' + commandId]?.status !== 'complete'; i++) labStep();
    assert.equal(state.slices.models.trainingRuns['training-' + commandId].status, 'complete');
    const modelId = 'model-' + commandId;
    state.slices.company.founderAssignments[id] = { ...emptyRoleAllocation(), research: U };
    state = queue(state, { kind: 'evaluate_model', modelId });
    for (let i = 0; i < 10 && state.slices.models.versions[modelId].status === 'checkpoint'; i++) labStep();
    assert.equal(state.slices.models.versions[modelId].status, 'evaluated'); return modelId;
  };
  const documentModel = train(CONTENT.seedModel.id, 'licensed-documents', 'document-adaptation', 'restricted-docs');
  assert.deepEqual(getModelCommerceRights(state, documentModel, CONTENT), { hosted: true, weights: false });
  const documentLicense = previewCommand(state, { kind: 'sign_business_contract', customerId: 'aster-services', modelId: documentModel, contractKind: 'customer-hosted' }, CONTENT);
  assert.match(documentLicense.reason!.message, /distribution rights/);
  const codeModel = train(documentModel, 'permissive-code', 'coding-tools-adaptation', 'permissive-remix');
  assert.deepEqual(getModelCommerceRights(state, codeModel, CONTENT), { hosted: true, weights: false });
  assert.match(previewCommand(state, { kind: 'sign_business_contract', customerId: 'vector-studio', modelId: codeModel, contractKind: 'customer-hosted' }, CONTENT).reason!.message, /distribution rights/);
  assert.deepEqual(validateState(state, CONTENT), []);
});

test('W3-C11: long renewed terms keep bounded invoice proofs; re-signing after cooldown increments generation without upfront income', () => {
  let state = initial();
  for (const customer of BUSINESS_CUSTOMERS) state = sign(state, 'customer-hosted', customer.id);
  state = step(state);
  for (const customer of BUSINESS_CUSTOMERS) state = queue(state, { kind: 'set_business_renewal', contractId: 'business:' + customer.id, renew: true });
  for (let i = 0; i < 60; i++) state = step(state);
  assert.equal(Object.keys(state.slices.products.commercialContracts).length, 4);
  assert.ok(Object.values(state.slices.products.commercialContracts).every(contract => contract.status === 'active' && contract.termIndex > 3 && contract.generation === 1));
  assert.equal(state.slices.products.commercialInvoices.length, RULES.invoiceHistoryLimit);
  assert.equal(Object.keys(state.slices.company.postedFacts).filter(id => id.startsWith('business-invoice:')).length, RULES.invoiceHistoryLimit);
  assert.equal(Object.keys(state.slices.company.postedFacts).filter(id => id.startsWith('business-setup:')).length, 4);
  assert.deepEqual(validateState(state, CONTENT), []);
  const restored = deserializeState(serializeState(state, CONTENT), CONTENT); assert.equal(restored.ok, true);
  let returned = delivered(initial(), 'customer-hosted');
  const end = agreement(returned).termEndsWeek!;
  while (returned.week < end + RULES.reofferDelayWeeks) returned = step(returned);
  const revenue = company(returned).earnedRevenueCents, lifetime = agreement(returned).lifetimeBilledCents;
  returned = step(sign(returned, 'customer-hosted'));
  assert.equal(agreement(returned).generation, 2); assert.equal(agreement(returned).status, 'building');
  assert.equal(agreement(returned).lifetimeBilledCents, lifetime); assert.equal(company(returned).earnedRevenueCents, revenue);
  assert.equal(Object.keys(returned.slices.products.commercialContracts).length, 1);
  assert.equal(returned.slices.products.commercialInvoices.length, 12);
});

test('W3-C12: a renewal choice queued in the final service week applies before the term boundary', () => {
  let state = delivered(initial(), 'customer-hosted');
  let boundary = agreement(state).termEndsWeek!;
  while (state.week < boundary - 1) state = step(state);
  state = step(queue(state, { kind: 'set_business_renewal', contractId: 'business:aster-services', renew: true }, 'last-week-renew'));
  assert.equal(state.commandReceipts['last-week-renew'].status, 'accepted');
  assert.equal(agreement(state).status, 'active'); assert.equal(agreement(state).termIndex, 2); assert.equal(agreement(state).termWeeksServed, 1);
  boundary = agreement(state).termEndsWeek!;
  while (state.week < boundary - 1) state = step(state);
  state = step(queue(state, { kind: 'set_business_renewal', contractId: 'business:aster-services', renew: false }, 'last-week-stop'));
  assert.equal(state.commandReceipts['last-week-stop'].status, 'accepted');
  assert.equal(agreement(state).status, 'expired'); assert.equal(agreement(state).termIndex, 2); assert.equal(agreement(state).termWeeksServed, 12);
  assert.equal(agreement(state).lifetimeBilledCents, 24 * 22000);
});
