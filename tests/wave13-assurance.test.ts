import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { ASSURANCE_BY_ID, ASSURANCE_RULES } from '../src/content/wave13-assurance';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameCommand, GameState, ModuleContext } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { mulDiv } from '../src/core/math';
import { advanceAssurance, assuranceAuditQualifies, assuranceCapacityRequests, assuranceMeter, assuranceQueuedCapacityRequests, assuranceRequests, assuranceServingRequest, assuranceWorkId, currentAssuranceQualification, settleAssurance, validateAssuranceCommand } from '../src/modules/assured-api';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { queuedBusinessCapacityRequests } from '../src/modules/business';
import { standardServingRequests } from '../src/modules/products';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { activeAssuranceScenario, assuranceScenario } from './fixtures/wave13-assurance';
import { installGuardrail } from './fixtures/wave12-guardrails';

function invalidSnapshot(state: GameState, label: string): void {
  assert.ok(validateState(state).length, label);
  const envelope = { format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion,
    checksum: canonicalStateHash(state), state };
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, label + ' remains invalid under a fresh correct checksum');
}

test('W13-A01: exact paid audit, buyer thresholds, research and owned active API govern admission without preview side effects', () => {
  const base = assuranceScenario(), state = base.state;
  const payload = { kind: 'sign_assurance_contract' as const, buyerId: 'continuity-systems' as const, productId: base.productId };
  const before = canonicalStateHash(state), quote = previewCommand(state, payload);
  assert.ok(quote.accepted, quote.reason?.message); assert.equal(quote.upfrontCostCents, 75_000);
  assert.match(quote.summary, /20 Business points/); assert.match(quote.summary, /eight weeks/);
  assert.equal(canonicalStateHash(state), before);
  const current = activeRuntimeGuardrail(state, base.productId)!;
  assert.ok(assuranceAuditQualifies(current, ASSURANCE_BY_ID['continuity-systems']));
  assert.equal(assuranceAuditQualifies({ ...current, audit: { ...current.audit!, guarded: { ...current.audit!.guarded, usefulAnswers: 41 } } }, ASSURANCE_BY_ID['continuity-systems']), false);
  assert.equal(assuranceAuditQualifies({ ...current, audit: { ...current.audit!, guarded: { ...current.audit!.guarded, unsafeCompliances: 3 } } }, ASSURANCE_BY_ID['continuity-systems']), false);
  assert.equal(assuranceAuditQualifies({ ...current, audit: { ...current.audit!, guarded: { ...current.audit!.guarded, usefulAnswers: 40, unsafeCompliances: 0 } } }, ASSURANCE_BY_ID['sentinel-services']), true);
  for (const mutate of [
    (s: GameState) => { s.slices.research.completedByCompany[s.playerCompanyId] = s.slices.research.completedByCompany[s.playerCompanyId].filter(id => id !== 'R12'); },
    (s: GameState) => { s.slices.products.offers[base.productId].status = 'paused'; },
    (s: GameState) => { s.slices.products.offers[base.productId].kind = 'basic-chat'; },
    (s: GameState) => { s.slices.products.runtimeGuardrails![base.installationId].enabled = false; },
    (s: GameState) => { s.slices.products.offers[base.productId].features!.memory = !s.slices.products.offers[base.productId].features!.memory; },
    (s: GameState) => { s.slices.products.runtimeGuardrails![base.installationId].audit!.guarded.usefulAnswers = 50; },
    (s: GameState) => { delete s.slices.models.reports[current.binding.primary.policyReportId]; },
  ]) {
    const changed = structuredClone(state); mutate(changed); assert.equal(previewCommand(changed, payload).accepted, false);
  }
  const insufficient = structuredClone(state); insufficient.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  assert.equal(previewCommand(insufficient, payload).reason?.code, 'CAPACITY_EXCEEDED');
  const run = new NaturalBusinessCampaign(state, 'assurance-core-admission'); run.queue(payload);
  assert.equal(previewCommand(run.state, payload).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(run.state.slices.products.assuranceContracts, undefined, 'A queued choice creates neither a contract nor invoices.');
});

test('W13-A02: real commercial grants accrue independently, pause without staff, and bill only after the following boundary', () => {
  const base = assuranceScenario(), run = new NaturalBusinessCampaign(base.state, 'assurance-core-onboard');
  run.founder('data');
  for (const staff of run.staff('commercial')) run.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: 0 });
  const id = 'assurance:' + run.queue({ kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: base.productId });
  run.step(2);
  let contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.status, 'building'); assert.equal(contract.completedOnboardingStaff, 0); assert.equal(contract.lastUsage, null);
  assert.equal(run.state.slices.products.assuranceInvoices!.length, 0);
  assert.equal(run.state.slices.company.ledger.filter(row => row.id === contract.setupFactId).length, 1);
  assert.equal(assuranceCapacityRequests(run.state).find(request => request.taskId === id)!.memoryMU, currentAssuranceQualification(contract).meter.reservedMemoryMU);
  assert.ok(assuranceRequests(run.state).filter(request => request.taskId === id).every(request => request.normalizedWorkCUw === 0), 'Onboarding promises capacity but does not run free customer requests.');
  // Isolate exactly five Business points from the founder; a quarter-time specialist supplies 7.5.
  run.queue({ kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 3 * U / 4, infrastructure: 0, commercial: U / 4, hardware: 0 } });
  run.step(3); contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.completedOnboardingStaff, 3 * U / 4); assert.equal(contract.onboardingGrantCount, 3); assert.equal(contract.termStartedWeek, null);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error); run.state = restored.state;
  run.step(); contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.status, 'ready'); assert.equal(contract.completedOnboardingStaff, U); assert.equal(contract.onboardingGrantCount, 4);
  assert.equal(contract.readyWeek, run.week + 1); assert.equal(contract.lastUsage, null);
  run.step(); contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.status, 'active'); assert.equal(contract.termStartedWeek, run.week); assert.equal(contract.termEndsWeek, run.week + 8);
  assert.equal(contract.lastUsage!.serviceBps, 10000); assert.equal(contract.lastUsage!.billedCents, 120_000);
  assert.equal(contract.termWeeksServed, 1); assert.deepEqual(validateState(run.state), []);
});

test('W13-A03: unfinished request work consumes GPUs but cannot invent completed requests, tokens or retainer fulfillment', () => {
  const base = activeAssuranceScenario(), original = base.state.slices.products.assuranceContracts![base.contractId];
  const meter = currentAssuranceQualification(original).meter, before = canonicalStateHash(base.state);
  const observe = (executed: number) => {
    const products = structuredClone(base.state.slices.products), week = base.state.week + 1;
    const context: ModuleContext = { week, phase: 'execute', content: CONTENT, facts: [], random: { draw: () => 0 }, resources: {
      requests: [assuranceServingRequest(original)], computeGrants: [{ requestId: assuranceWorkId(original.id, 'serve'), poolId: 'general-cloud',
        hardwareEffectiveCUw: executed, physicalCUw: executed, memoryMU: executed ? meter.reservedMemoryMU : 0 }],
      staffGrants: [{ requestId: assuranceWorkId(original.id, 'support'), grants: [{ role: 'commercial', staffWeeks: original.supportStaffPerWeek }] }],
    } };
    advanceAssurance(base.state, products, context); return products.assuranceContracts![base.contractId].lastUsage!;
  };
  const zero = observe(0), partial = observe(meter.workPerRequestCUw - 1), one = observe(meter.workPerRequestCUw);
  assert.equal(zero.computeReceipt, null); assert.equal(zero.billedCents, 0);
  assert.ok(partial.physicalWorkCUw > 0); assert.ok(partial.guardrailWorkCUw > 0); assert.equal(partial.servedRequests, 0);
  assert.equal(partial.inputTokens + partial.outputTokens + partial.internalTokens, 0); assert.equal(partial.billedCents, 0);
  assert.equal(one.servedRequests, 1); assert.equal(one.inputTokens, meter.inputTokensPerRequest); assert.equal(one.internalTokens, meter.internalTokensPerRequest);
  assert.equal(one.fulfillmentBps, 2); assert.equal(one.billedCents, 24);
  assert.equal(canonicalStateHash(base.state), before, 'Metering the separate request does not mutate model, customer bill, feedback or source state.');
});

test('W13-A04: onboarding, exact qualification and once-only setup provenance resist valid-checksum forged saves', () => {
  const base = activeAssuranceScenario();
  const cases: Array<[string, (state: GameState) => void]> = [
    ['missing accepted signing command', s => { delete s.commandReceipts[base.contractId.slice('assurance:'.length)]; }],
    ['unpaid integration', s => { delete s.slices.company.postedFacts[s.slices.products.assuranceContracts![base.contractId].setupFactId]; }],
    ['free onboarding', s => { s.slices.products.assuranceContracts![base.contractId].completedOnboardingStaff = 0; }],
    ['fabricated staff receipt', s => { s.slices.products.assuranceContracts![base.contractId].latestOnboardingGrant!.grantedStaff--; }],
    ['early activation', s => { s.slices.products.assuranceContracts![base.contractId].readyWeek!--; }],
    ['extended term', s => { s.slices.products.assuranceContracts![base.contractId].termEndsWeek!++; }],
    ['changed accepted audit', s => { currentAssuranceQualification(s.slices.products.assuranceContracts![base.contractId]).auditFingerprint = '00000000'; }],
    ['faked explicit selection', s => { currentAssuranceQualification(s.slices.products.assuranceContracts![base.contractId]).commandId = 'never-accepted'; }],
    ['free cached work', s => { currentAssuranceQualification(s.slices.products.assuranceContracts![base.contractId]).meter.workPerRequestCUw--; }],
    ['shared tenant memory', s => { currentAssuranceQualification(s.slices.products.assuranceContracts![base.contractId]).meter.reservedMemoryMU--; }],
    ['buyer threshold bypass', s => { s.slices.products.assuranceContracts![base.contractId].buyerId = 'sentinel-services'; }],
    ['future qualification', s => { currentAssuranceQualification(s.slices.products.assuranceContracts![base.contractId]).acceptedWeek = s.week + 1; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base.state); mutate(changed); invalidSnapshot(changed, label); }
});

test('W13-A05: retained invoices reconcile actual physical grants, independent support and historical accepted evidence', () => {
  const base = activeAssuranceScenario(), contract = base.state.slices.products.assuranceContracts![base.contractId];
  assert.equal(contract.lastUsage!.requestedRequests, 4000); assert.equal(contract.lastUsage!.servedRequests, 4000);
  const cases: Array<[string, (state: GameState) => void]> = [
    ['duplicate invoice', s => { s.slices.products.assuranceInvoices!.push(structuredClone(s.slices.products.assuranceInvoices![0])); }],
    ['missing earned invoice', s => { s.slices.products.assuranceInvoices!.pop(); }],
    ['invented revenue', s => { s.slices.products.assuranceInvoices![0].amountCents++; }],
    ['free physical service', s => { s.slices.products.assuranceInvoices![0].usage.physicalWorkCUw = 0; }],
    ['inflated conversion', s => { s.slices.products.assuranceInvoices![0].usage.computeReceipt!.multiplierBps++; }],
    ['insufficient resident memory', s => { s.slices.products.assuranceInvoices![0].usage.computeReceipt!.memoryMU--; }],
    ['absent support', s => { s.slices.products.assuranceInvoices![0].usage.supportStaffGranted = 0; }],
    ['suspended free service', s => { s.slices.products.assuranceInvoices![0].usage.qualified = false; }],
    ['rewritten historical version', s => { s.slices.products.assuranceInvoices![0].qualificationVersion++; }],
    ['missing once-only ledger fact', s => { delete s.slices.company.postedFacts[s.slices.products.assuranceInvoices![0].id]; }],
    ['invented lifetime cash', s => { s.slices.products.assuranceContracts![base.contractId].lifetimeBilledCents++; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base.state); mutate(changed); invalidSnapshot(changed, label); }
  const products = structuredClone(base.state.slices.products);
  const context: ModuleContext = { week: base.state.week, phase: 'settle', content: CONTENT, facts: [], random: { draw: () => 0 }, resources: { requests: [], computeGrants: [], staffGrants: [] } };
  assert.deepEqual(settleAssurance(base.state, products, context), [], 'The same settled receipt cannot mint a second invoice.');
  assert.deepEqual(products, base.state.slices.products);
});

test('W13-A06: cancellation before onboarding preserves the paid setup while preventing a term, workloads and invoices', () => {
  const base = assuranceScenario(), run = new NaturalBusinessCampaign(base.state, 'assurance-core-preterm-cancel');
  run.founder('data'); for (const member of run.staff('commercial')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  const id = 'assurance:' + run.queue({ kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: base.productId }); run.step();
  run.queue({ kind: 'cancel_assurance_contract', contractId: id }); run.step();
  let contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.status, 'cancelled'); assert.equal(contract.termStartedWeek, null); assert.equal(contract.termEndsWeek, null);
  assert.equal(contract.completedOnboardingStaff, 0); assert.equal(contract.lastUsage, null); assert.ok(contract.cancellationCommandId);
  assert.equal(run.state.slices.products.assuranceInvoices!.length, 0);
  assert.ok(!assuranceRequests(run.state).some(item => item.taskId === id)); assert.ok(!assuranceCapacityRequests(run.state).some(item => item.taskId === id));
  assert.equal(previewCommand(run.state, { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: base.productId }).reason?.code, 'ALREADY_ACTIVE');
  run.step(); contract = run.state.slices.products.assuranceContracts![id];
  assert.equal(contract.termStartedWeek, null); assert.equal(contract.lifetimeBilledCents, 0);
  assert.ok(previewCommand(run.state, { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: base.productId }).accepted);
  const forged = structuredClone(run.state); forged.slices.products.assuranceContracts![id].cancellationCommandId = null;
  invalidSnapshot(forged, 'cancelled integration needs its explicit accepted cancellation');
  assert.deepEqual(validateState(run.state), []);
});

test('W13-A07: public cache changes do not change an accepted separate-tenant workload or finite audit fingerprint', () => {
  const base = activeAssuranceScenario(), contract = base.state.slices.products.assuranceContracts![base.contractId];
  const qualification = currentAssuranceQualification(contract), frozen = structuredClone(qualification);
  const changed = structuredClone(base.state), installations = changed.slices.products.efficiencyInstalls ??= {};
  // Counterfactual public-cache metadata is deliberately not a runtime source for this independent tenant.
  installations['unrelated-public-cache'] = { cacheKey: 'pretend-warm', warmedWeek: 0, lastServedWeek: changed.week } as never;
  assert.deepEqual(assuranceMeter(changed, qualification.binding, qualification.profile), qualification.meter);
  assert.deepEqual(currentAssuranceQualification(contract), frozen);
  assert.equal(assuranceServingRequest(contract).normalizedWorkCUw, contract.weeklyRequests * qualification.meter.workPerRequestCUw);
  assert.equal(assuranceServingRequest(contract).sharedAdapterMemory, undefined);
  assert.equal(ASSURANCE_RULES.maximumContracts * ASSURANCE_RULES.termWeeks, ASSURANCE_RULES.maximumInvoices, 'Every bounded retained term can preserve all its weekly invoices without pruning.');
});

test('W13-A08: larger explicit requalification must fit real capacity and queued promises replace the old meter exactly once', () => {
  const base = activeAssuranceScenario(), run = new NaturalBusinessCampaign(base.state, 'assurance-core-requal-capacity');
  const previous = structuredClone(run.state.slices.products.assuranceContracts![base.contractId]);
  run.queue({ kind: 'set_product_features', productId: base.productId, features: { memory: true, extendedContext: true, deepReasoning: true } }); run.step();
  const installationId = installGuardrail(run, base.productId, 'balanced');
  const current = activeRuntimeGuardrail(run.state, base.productId)!;
  assert.equal(current.id, installationId); assert.ok(assuranceAuditQualifies(current, ASSURANCE_BY_ID['continuity-systems']));
  const command: GameCommand = { id: 'assurance-core-proposed-requal', companyId: run.state.playerCompanyId, issuedForWeek: run.week + 1,
    payload: { kind: 'requalify_assurance_contract', contractId: base.contractId } };
  const state = structuredClone(run.state), meter = assuranceMeter(state, current.binding, current.profile), fleet = state.slices.compute.fleets[state.playerCompanyId];
  const oldRequest = assuranceServingRequest(previous), newWork = previous.weeklyRequests * meter.workPerRequestCUw;
  assert.ok(newWork > oldRequest.normalizedWorkCUw, 'The real feature change increased the accepted tenant promise.');
  fleet.allocation.serving = mulDiv(oldRequest.normalizedWorkCUw, 11000, 10000, 'ceil');
  assert.equal(validateAssuranceCommand(state, command, CONTENT, { standardRequests: [] })?.code, 'CAPACITY_EXCEEDED', 'A new paid audit cannot waive the extra GPU promise.');
  fleet.allocation.serving = mulDiv(newWork, 11000, 10000, 'ceil');
  assert.equal(validateAssuranceCommand(state, command, CONTENT, { standardRequests: [] }), undefined, 'The larger exact tenant fits once its own extra headroom is allocated.');
  state.queuedCommands.push(command);
  const promised = assuranceQueuedCapacityRequests(state, state.playerCompanyId);
  assert.equal(promised.length, 1); assert.equal(promised[0].id, oldRequest.id); assert.equal(promised[0].normalizedWorkCUw, newWork);
  assert.equal(promised[0].memoryMU, meter.reservedMemoryMU);
  const deduplicated = [...new Map([...assuranceCapacityRequests(state), ...promised].map(request => [request.id, request])).values()];
  assert.equal(deduplicated.length, 1); assert.equal(deduplicated[0].normalizedWorkCUw, newWork);
  assert.equal(currentAssuranceQualification(state.slices.products.assuranceContracts![base.contractId]).installationId,
    currentAssuranceQualification(previous).installationId, 'A queued explicit promise does not mutate accepted historical evidence.');

  const packetId = Object.values(run.state.slices.data.packets).find(item => item.prepared && item.rights.hosted)!.id;
  const privateService = { kind: 'sign_business_contract' as const, customerId: 'aster-services', modelId: base.modelId, contractKind: 'private-hosted' as const, packetId };
  const privateQuote = submitCommand(run.state, privateService, CONTENT, 'assurance-core-private-size');
  assert.ok(privateQuote.accepted, privateQuote.reason?.message);
  const privateRequest = queuedBusinessCapacityRequests(privateQuote.state)[0];
  const reserve = (request: ReturnType<typeof assuranceServingRequest>) => mulDiv(request.normalizedWorkCUw, 10000 + (request.headroomBps ?? 0), 10000, 'ceil');
  const publicCapacity = standardServingRequests(run.state, CONTENT, run.week + 1).reduce((sum, request) => sum + reserve(request), 0);
  const constrained = structuredClone(run.state), constrainedFleet = constrained.slices.compute.fleets[run.state.playerCompanyId];
  constrainedFleet.allocation = { serving: publicCapacity + reserve(oldRequest) + reserve(privateRequest), development: 0, research: 0 };
  assert.ok(previewCommand(constrained, privateService).accepted, 'The old accepted meter and new private workload fit before a requalification promise.');
  const queued = submitCommand(constrained, command.payload, CONTENT, 'assurance-core-explicit-larger-queue');
  assert.ok(queued.accepted, queued.reason?.message);
  assert.equal(previewCommand(queued.state, privateService).reason?.code, 'CAPACITY_EXCEEDED', 'Ordinary private admission sees the queued larger accepted tenant instead of its obsolete smaller meter.');
  queued.state.slices.compute.fleets[run.state.playerCompanyId].allocation.serving = publicCapacity + reserve(promised[0]) + reserve(privateRequest);
  assert.ok(previewCommand(queued.state, privateService).accepted, 'With room for the replacement exactly once, ordinary private admission no longer double-reserves the old tenant.');
});
