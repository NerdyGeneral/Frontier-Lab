import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { ASSURANCE_BY_ID, ASSURANCE_RULES } from '../src/content/wave13-assurance';
import { RUNTIME_GUARDRAIL_PROFILES } from '../src/content/wave12-guardrails';
import { ROUTING } from '../src/content/wave4-research';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { mulDiv } from '../src/core/math';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assuranceQualificationMatches, assuranceQueuedCapacityRequests, assuranceServingRequest, currentAssuranceQualification } from '../src/modules/assured-api';
import { commercialCapacityRequests, commercialOrganizationCount, outsideBusinessOrganizations, queuedBusinessCapacityRequests } from '../src/modules/business';
import { customerCapacityRequests } from '../src/modules/capacity-forecast';
import { getMarketView } from '../src/modules/markets';
import { activeEfficiency, cacheWarm } from '../src/modules/product-efficiency';
import { featureConfig, productRequestMeter, requestMeter, standardServingRequests } from '../src/modules/products';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { installGuardrail } from './fixtures/wave12-guardrails';
import { activeAssuranceScenario, assuranceScenario, signAssurance } from './fixtures/wave13-assurance';

const fork = (state: GameState, prefix: string) => new NaturalBusinessCampaign(structuredClone(state), prefix);
const contract = (run: NaturalBusinessCampaign, id: string) => run.state.slices.products.assuranceContracts![id];
const latestCost = (run: NaturalBusinessCampaign) => run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
const invoices = (run: NaturalBusinessCampaign, id: string) => run.state.slices.products.assuranceInvoices!.filter(row => row.contractId === id);
function assertValid(run: NaturalBusinessCampaign) { assert.deepEqual(validateState(run.state), []); }
function assertOneRetainer(run: NaturalBusinessCampaign, id: string) {
  const rows = invoices(run, id).filter(row => row.week === run.week), usage = contract(run, id).lastUsage!;
  assert.equal(rows.length, 1); assert.equal(rows[0].amountCents, usage.billedCents);
  assert.equal(rows[0].grossCents - rows[0].creditsCents, rows[0].amountCents);
  assert.deepEqual(rows[0].usage, usage);
  const facts = run.state.slices.company.ledger.filter(row => row.id === rows[0].id);
  assert.equal(facts.length, 1); assert.equal(facts[0].amountCents, rows[0].amountCents);
  assert.equal(facts[0].sourceId, id); assert.equal(facts[0].kind, 'receipt');
  assert.equal(run.state.slices.company.postedFacts[rows[0].id], true);
}

test('W13-I01: a separate assured tenant consumes owned GPUs and earns one retainer without duplicating public token billing', () => {
  const initial = activeAssuranceScenario('continuity-systems', { owned: true });
  const on = fork(initial.state, 'w13-owned-on'), off = fork(initial.state, 'w13-owned-off');
  const frozenModels = canonicalStateHash(on.state.slices.models);
  off.queue({ kind: 'cancel_assurance_contract', contractId: initial.contractId });
  const studies = [on, off].map(run => 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId: initial.productId, sampling: 'representative', consent: 'hosted-only' }));
  on.step(); off.step();
  const accepted = contract(on, initial.contractId), service = accepted.lastUsage!, meter = currentAssuranceQualification(accepted).meter;
  assert.equal(service.servedRequests, 4000); assert.equal(service.serviceBps, 10000); assert.equal(service.billedCents, 120_000);
  assert.equal(service.executedWorkCUw, 4000 * meter.workPerRequestCUw);
  assert.equal(service.guardrailWorkCUw, 4000 * 20_000);
  assert.equal(service.inputTokens, 4000 * meter.inputTokensPerRequest);
  assert.ok(service.computeReceipt!.poolId.startsWith('owned:')); assert.equal(service.computeReceipt!.ownership, 'owned');
  assert.ok(service.physicalWorkCUw > 0 && service.physicalWorkCUw < service.executedWorkCUw);
  const publicOn = on.state.slices.products.lastUsage[initial.productId], publicOff = off.state.slices.products.lastUsage[initial.productId];
  assert.equal(publicOn.paidAccounts, publicOff.paidAccounts); assert.equal(publicOn.fulfillmentBps, 10000); assert.equal(publicOff.fulfillmentBps, 10000);
  for (const field of ['inputTokens', 'outputTokens', 'internalTokens', 'billCarryIn', 'billCarryOut'] as const) assert.equal(publicOn.tokens![field], publicOff.tokens![field]);
  assert.equal(publicOn.billedCents, publicOff.billedCents);
  assert.equal(on.state.slices.products.invoices.filter(row => row.productId === initial.productId && row.week === on.week).length, 1);
  assert.equal(off.state.slices.products.assuranceInvoices!.some(row => row.contractId === initial.contractId && row.week === off.week), false);
  const metered = latestCost(on), workload = metered.workloads.filter(row => row.requestId === 'assurance-serve:' + initial.contractId);
  assert.equal(workload.length, 1); assert.equal(workload[0].physicalWorkCUw, service.physicalWorkCUw);
  assert.equal(workload[0].effectiveWorkCUw, service.executedWorkCUw); assert.ok(workload[0].ownedVariableCents > 0);
  assert.ok(metered.totals.ownedVariableCents > latestCost(off).totals.ownedVariableCents);
  const target = metered.targets.find(row => row.sourceId === initial.contractId)!;
  assert.equal(target.kind, 'assured-api'); assert.ok(target.requestIds.includes('assurance-serve:' + initial.contractId));
  assert.ok(target.requestIds.includes('assurance-support:' + initial.contractId));
  assert.equal(metered.activities.find(row => row.targetId === target.id)!.revenueCents, 120_000);
  assert.equal(metered.activities.reduce((sum, row) => sum + row.revenueCents, 0), metered.totals.companyRevenueCents);
  assert.equal(metered.totals.attributedComputeCents + metered.totals.sharedComputeCents, metered.totals.totalComputeCents);
  assert.equal(on.state.slices.compute.servingHistory[on.state.playerCompanyId].at(-1)!.privatePhysicalCUw, service.physicalWorkCUw);
  const feedbackOn = on.state.slices.data.feedbackStudies![studies[0]], feedbackOff = off.state.slices.data.feedbackStudies![studies[1]];
  assert.equal(feedbackOn.weeks.length, 1); assert.deepEqual(feedbackOn.weeks[0].paidUsage, feedbackOff.weeks[0].paidUsage);
  assert.equal(feedbackOn.weeks[0].paidUsage.paidAccounts, publicOn.paidAccounts);
  assertOneRetainer(on, initial.contractId);
  assert.equal(canonicalStateHash(on.state.slices.models), frozenModels); assert.equal(canonicalStateHash(off.state.slices.models), frozenModels);
  assertValid(on); assertValid(off);
});

test('W13-I02: routed assurance retains both models, all checker work and its own tenant memory without using the public prefix cache', () => {
  const initial = activeAssuranceScenario('continuity-systems', { routed: true }), run = fork(initial.state, 'w13-route-cache');
  const accepted = contract(run, initial.contractId), qualification = currentAssuranceQualification(accepted), meter = qualification.meter;
  const offer = run.state.slices.products.offers[initial.productId], primary = run.state.slices.models.versions[initial.modelId], secondary = run.state.slices.models.versions[initial.secondaryModelId!];
  const primaryMeter = requestMeter(primary, featureConfig(offer)), secondaryMeter = requestMeter(secondary, featureConfig(offer));
  assert.ok(activeEfficiency(run.state, initial.productId, 'routing')); assert.ok(cacheWarm(run.state, offer));
  assert.equal(qualification.binding.secondary!.modelId, secondary.id);
  assert.equal(meter.workPerRequestCUw, mulDiv(primaryMeter.work, 4000, 10000) + mulDiv(secondaryMeter.work, 6000, 10000) + ROUTING.overheadPerRequest + 20_000);
  assert.equal(meter.reservedMemoryMU, primary.residentMU + secondary.residentMU + primaryMeter.sessionMemory + RUNTIME_GUARDRAIL_PROFILES.balanced.memoryMU);
  assert.ok(productRequestMeter(run.state, offer, primary).work < meter.workPerRequestCUw);
  const off = fork(run.state, 'w13-public-cache-off');
  off.queue({ kind: 'set_product_efficiency_enabled', productId: initial.productId, method: 'prefix-cache', enabled: false });
  run.step(); off.step();
  const a = contract(run, initial.contractId).lastUsage!, b = contract(off, initial.contractId).lastUsage!;
  assert.equal(a.qualified, true); assert.equal(b.qualified, true); assert.equal(a.installationId, b.installationId);
  assert.equal(a.executedWorkCUw, b.executedWorkCUw); assert.equal(a.guardrailWorkCUw, 4000 * 20_000);
  assert.equal(a.inputTokens, b.inputTokens); assert.equal(a.billedCents, b.billedCents);
  assert.equal(latestCost(run).resources.requests.find(row => row.id === 'assurance-serve:' + initial.contractId)!.memoryMU, meter.reservedMemoryMU);
  assert.deepEqual(currentAssuranceQualification(contract(off, initial.contractId)), qualification);
  assertOneRetainer(run, initial.contractId); assertOneRetainer(off, initial.contractId); assertValid(run); assertValid(off);
});

test('W13-I03: commercial review and GPUs are independent service constraints with proportional credits and no SLA fine', () => {
  const initial = activeAssuranceScenario('sentinel-services'), noSupport = fork(initial.state, 'w13-no-support');
  const halfSupport = fork(initial.state, 'w13-half-support'), scarce = fork(initial.state, 'w13-scarce');
  const member = noSupport.staff('commercial')[0], selected = contract(noSupport, initial.contractId);
  noSupport.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  halfSupport.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  halfSupport.queue({ kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 3 * U / 4, infrastructure: 0, commercial: U / 4, hardware: 0 } });
  const request = assuranceServingRequest(selected), halfWork = request.normalizedWorkCUw / 2;
  scarce.queue({ kind: 'allocate_compute', ...scarce.fleet.allocation, serving: mulDiv(halfWork, 11000, 10000, 'ceil') });
  noSupport.step(); halfSupport.step(); scarce.step();
  const none = contract(noSupport, initial.contractId).lastUsage!, half = contract(halfSupport, initial.contractId).lastUsage!, gpu = contract(scarce, initial.contractId).lastUsage!;
  assert.equal(none.servedRequests, 8000); assert.equal(none.supportStaffGranted, 0); assert.equal(none.serviceBps, 0);
  assert.ok(none.physicalWorkCUw > 0); assert.equal(none.billedCents, 0); assert.equal(none.creditsCents, 220_000);
  assert.equal(half.servedRequests, 8000); assert.equal(half.supportBps, 5000); assert.equal(half.serviceBps, 5000);
  assert.equal(half.billedCents, 110_000); assert.equal(half.creditsCents, 110_000);
  assert.equal(gpu.supportBps, 10000); assert.equal(gpu.servedRequests, 4000); assert.equal(gpu.fulfillmentBps, 5000);
  assert.equal(gpu.serviceBps, 5000); assert.equal(gpu.billedCents, 110_000); assert.equal(gpu.creditsCents, 110_000);
  assert.equal(gpu.inputTokens, 4000 * currentAssuranceQualification(contract(scarce, initial.contractId)).meter.inputTokensPerRequest);
  assert.equal(latestCost(noSupport).resources.requests.find(row => row.id === 'assurance-serve:' + initial.contractId)!.staffDemand, undefined,
    'Missing commercial review must not silently make inference consume zero GPU work.');
  for (const run of [noSupport, halfSupport, scarce]) { assertOneRetainer(run, initial.contractId); assertValid(run); }
});

test('W13-I04: disabled or paused service suspends inference while the original calendar and support obligation continue', () => {
  const initial = activeAssuranceScenario(), disabled = fork(initial.state, 'w13-disabled'), paused = fork(initial.state, 'w13-paused');
  const end = contract(disabled, initial.contractId).termEndsWeek;
  disabled.queue({ kind: 'set_runtime_guardrail_enabled', productId: initial.productId, enabled: false });
  paused.queue({ kind: 'set_product_paused', productId: initial.productId, paused: true });
  disabled.step(); paused.step();
  for (const run of [disabled, paused]) {
    const selected = contract(run, initial.contractId), use = selected.lastUsage!, requests = latestCost(run).resources.requests;
    assert.equal(use.qualificationBps, 0); assert.equal(use.servedRequests, 0); assert.equal(use.physicalWorkCUw, 0); assert.equal(use.guardrailWorkCUw, 0);
    assert.equal(use.inputTokens + use.outputTokens + use.internalTokens, 0); assert.equal(use.computeReceipt, null);
    assert.equal(use.supportStaffGranted, use.supportStaffRequired); assert.equal(use.creditsCents, use.grossCents); assert.equal(use.billedCents, 0);
    assert.equal(requests.some(row => row.id === 'assurance-serve:' + initial.contractId), false);
    assert.equal(requests.some(row => row.id === 'assurance-support:' + initial.contractId), true);
    assert.equal(commercialCapacityRequests(run.state).some(row => row.id === 'assurance-serve:' + initial.contractId), true,
      'A suspended promise remains visible to admission and capacity planning.');
    assert.equal(selected.termEndsWeek, end); assert.equal(selected.termWeeksServed, 2); assertOneRetainer(run, initial.contractId); assertValid(run);
  }
  disabled.queue({ kind: 'set_runtime_guardrail_enabled', productId: initial.productId, enabled: true });
  paused.queue({ kind: 'set_product_paused', productId: initial.productId, paused: false });
  disabled.step(); paused.step();
  for (const run of [disabled, paused]) {
    const selected = contract(run, initial.contractId); assert.equal(selected.lastUsage!.serviceBps, 10000);
    assert.equal(selected.qualifications.length, 1); assert.equal(selected.termEndsWeek, end); assertValid(run);
  }
});

test('W13-I05: a changed feature binding needs another paid checker and explicit acceptance without rewriting past invoices or resetting expiry', () => {
  const initial = activeAssuranceScenario('sentinel-services'), run = fork(initial.state, 'w13-requalify');
  const original = contract(run, initial.contractId), end = original.termEndsWeek;
  const oldQualification = structuredClone(currentAssuranceQualification(original)), oldInvoice = structuredClone(invoices(run, initial.contractId)[0]);
  const frozenModels = canonicalStateHash(run.state.slices.models), oldAudit = canonicalStateHash(run.state.slices.products.runtimeGuardrails![initial.installationId].audit);
  run.queue({ kind: 'set_product_features', productId: initial.productId, features: { memory: true, extendedContext: true, deepReasoning: true } });
  run.step();
  assert.equal(activeRuntimeGuardrail(run.state, initial.productId), null);
  assert.equal(contract(run, initial.contractId).lastUsage!.qualified, false);
  assert.equal(previewCommand(run.state, { kind: 'requalify_assurance_contract', contractId: initial.contractId }).accepted, false);
  const replacementId = installGuardrail(run, initial.productId, 'strict');
  assert.notEqual(replacementId, initial.installationId);
  assert.equal(assuranceQualificationMatches(run.state, contract(run, initial.contractId)), false,
    'A newly paid qualifying audit cannot silently replace the source already accepted by a buyer.');
  assert.equal(contract(run, initial.contractId).lastUsage!.physicalWorkCUw, 0);
  const quote = previewCommand(run.state, { kind: 'requalify_assurance_contract', contractId: initial.contractId });
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0);
  const replacement = run.state.slices.products.runtimeGuardrails![replacementId], replacementHash = canonicalStateHash(replacement);
  const before = invoices(run, initial.contractId).map(row => canonicalStateHash(row));
  run.queue({ kind: 'requalify_assurance_contract', contractId: initial.contractId }); run.step();
  const changed = contract(run, initial.contractId), current = currentAssuranceQualification(changed);
  assert.equal(changed.qualifications.length, 2); assert.deepEqual(changed.qualifications[0], oldQualification);
  assert.equal(current.installationId, replacementId); assert.equal(current.version, 2); assert.equal(current.acceptedWeek, run.week);
  assert.ok(current.meter.workPerRequestCUw > oldQualification.meter.workPerRequestCUw);
  assert.equal(changed.termEndsWeek, end); assert.equal(changed.termStartedWeek, original.termStartedWeek);
  assert.equal(changed.lastUsage!.serviceBps, 10000); assert.equal(changed.lastUsage!.qualificationVersion, 2);
  assert.equal(changed.lastUsage!.installationId, replacementId);
  assert.equal(canonicalStateHash(run.state.slices.products.runtimeGuardrails![replacementId]), replacementHash);
  assert.equal(canonicalStateHash(run.state.slices.products.runtimeGuardrails![initial.installationId].audit), oldAudit);
  assert.deepEqual(invoices(run, initial.contractId).slice(0, before.length).map(row => canonicalStateHash(row)), before);
  assert.deepEqual(invoices(run, initial.contractId)[0], oldInvoice);
  assert.equal(latestCost(run).resources.requests.some(row => row.id.startsWith('assurance-onboard:') || row.id.startsWith('guardrail-work:')), false);
  assert.equal(run.state.slices.company.ledger.filter(row => row.sourceId === initial.contractId && row.kind === 'expense').length, 1);
  assert.equal(canonicalStateHash(run.state.slices.models), frozenModels); assertOneRetainer(run, initial.contractId);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error); assertValid(run);
});

test('W13-I06: eight calendar invoices end once, cancellation stops future bills, and a reoffer creates a new paid term with retained proof', () => {
  const initial = activeAssuranceScenario(), expiry = fork(initial.state, 'w13-expiry'), cancelled = fork(initial.state, 'w13-cancel');
  const id = initial.contractId, first = contract(expiry, id), end = first.termEndsWeek!;
  assert.equal(end - first.termStartedWeek!, ASSURANCE_RULES.termWeeks);
  expiry.until(state => state.week === end - 1, 8, 'final contracted service week');
  assert.equal(contract(expiry, id).status, 'active'); assert.equal(contract(expiry, id).termWeeksServed, 8);
  assert.equal(invoices(expiry, id).length, 8); assert.equal(contract(expiry, id).lifetimeBilledCents, 8 * ASSURANCE_BY_ID['continuity-systems'].weeklyPriceCents);
  const paidHistory = canonicalStateHash(invoices(expiry, id)); expiry.step();
  assert.equal(contract(expiry, id).status, 'expired'); assert.equal(contract(expiry, id).endedWeek, end);
  assert.equal(canonicalStateHash(invoices(expiry, id)), paidHistory);
  assert.equal(latestCost(expiry).resources.requests.some(row => row.taskId === id), false);
  assert.equal(commercialOrganizationCount(expiry.state), 1, 'The expired organization returns one boundary later.');
  assert.equal(previewCommand(expiry.state, { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: initial.productId }).accepted, false);
  const ended = canonicalStateHash(contract(expiry, id)); expiry.step();
  assert.equal(commercialOrganizationCount(expiry.state), 0);
  assert.equal(previewCommand(expiry.state, { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: initial.productId }).accepted, true);
  const secondId = signAssurance(expiry, initial.productId);
  assert.notEqual(secondId, id); assert.equal(contract(expiry, secondId).termWeeksServed, 1);
  assert.equal(contract(expiry, secondId).termEndsWeek! - contract(expiry, secondId).termStartedWeek!, 8);
  assert.equal(canonicalStateHash(contract(expiry, id)), ended); assert.equal(canonicalStateHash(invoices(expiry, id)), paidHistory);
  assert.equal(expiry.state.slices.company.ledger.filter(row => row.id === contract(expiry, secondId).setupFactId && row.amountCents === 75_000).length, 1);
  cancelled.queue({ kind: 'cancel_assurance_contract', contractId: id }); cancelled.step();
  const stop = contract(cancelled, id);
  assert.equal(stop.status, 'cancelled'); assert.equal(stop.termWeeksServed, 1); assert.equal(invoices(cancelled, id).length, 1);
  assert.equal(latestCost(cancelled).resources.requests.some(row => row.taskId === id), false);
  assert.equal(commercialOrganizationCount(cancelled.state), 1); assert.equal(outsideBusinessOrganizations(cancelled.state), 79);
  cancelled.step(); assert.equal(commercialOrganizationCount(cancelled.state), 0); assert.equal(outsideBusinessOrganizations(cancelled.state), 80);
  const cancelHistory = canonicalStateHash(invoices(cancelled, id)), retainedInvoiceId = invoices(cancelled, id)[0].id;
  cancelled.until(state => !state.slices.company.ledger.some(row => row.id === retainedInvoiceId), 65, 'ordinary ledger retention window');
  assert.equal(canonicalStateHash(invoices(cancelled, id)), cancelHistory);
  assert.equal(cancelled.state.slices.compute.costReports![cancelled.state.playerCompanyId].some(row => row.ledgerFacts.some(fact => fact.id === retainedInvoiceId)), false);
  assert.equal(cancelled.state.slices.company.postedFacts[retainedInvoiceId], true,
    'The retained invoice keeps its exactly-once proof after ordinary ledger and cost-report windows move on.');
  const restored = deserializeState(serializeState(cancelled.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  if (restored.ok) {
    const replay = advanceWeek(restored.state), direct = advanceWeek(cancelled.state);
    assert.equal(replay.accepted, true); assert.equal(direct.accepted, true);
    assert.equal(canonicalStateHash(replay.state), canonicalStateHash(direct.state));
  }
  assertValid(expiry); assertValid(cancelled);
});

test('W13-I07: capacity admission includes both queued private and assured tenants and planning retains the promised workload', () => {
  const initial = assuranceScenario(), roomy = initial.state;
  const packetId = Object.values(roomy.slices.data.packets).find(row => row.prepared && row.rights.hosted)!.id;
  const assurance: CommandPayload = { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: initial.productId };
  const privateService: CommandPayload = { kind: 'sign_business_contract', customerId: 'aster-services', modelId: initial.modelId, contractKind: 'private-hosted', packetId };
  const queuedAssurance = submitCommand(roomy, assurance, CONTENT, 'w13-capacity-assurance');
  const queuedPrivate = submitCommand(roomy, privateService, CONTENT, 'w13-capacity-private');
  assert.equal(queuedAssurance.accepted, true, queuedAssurance.reason?.message); assert.equal(queuedPrivate.accepted, true, queuedPrivate.reason?.message);
  const assuredWork = assuranceQueuedCapacityRequests(queuedAssurance.state)[0], privateWork = queuedBusinessCapacityRequests(queuedPrivate.state)[0];
  const reserve = (work: typeof assuredWork) => mulDiv(work.normalizedWorkCUw, 10000 + (work.headroomBps ?? 0), 10000, 'ceil');
  const publicWork = standardServingRequests(roomy, CONTENT, roomy.week + 1).reduce((sum, row) => sum + reserve(row), 0);
  const constrained = structuredClone(roomy);
  constrained.slices.compute.fleets[roomy.playerCompanyId].allocation = { serving: publicWork + Math.max(reserve(assuredWork), reserve(privateWork)), development: 0, research: 0 };
  assert.deepEqual(validateState(constrained), []);
  for (const [first, second] of [[assurance, privateService], [privateService, assurance]]) {
    const chosen = submitCommand(constrained, first, CONTENT, 'w13-one-capacity-claim');
    assert.equal(chosen.accepted, true, chosen.reason?.message);
    const rejected = previewCommand(chosen.state, second);
    assert.equal(rejected.accepted, false); assert.equal(rejected.reason?.code, 'CAPACITY_EXCEEDED');
  }
  const run = fork(roomy, 'w13-planned-commitment');
  const id = 'assurance:' + run.queue(assurance); run.step();
  assert.equal(contract(run, id).status, 'ready');
  const requests = customerCapacityRequests(run.state), promised = assuranceServingRequest(contract(run, id));
  assert.equal(requests.privateCommitments, 1);
  assert.deepEqual(requests.serving.filter(row => row.id === promised.id), [promised]);
  assert.equal(requests.staffing.filter(row => row.id === 'assurance-support:' + id).length, 1);
  assert.equal(requests.staffing.find(row => row.id === 'assurance-support:' + id)!.staffDemand![0].staffWeeks, U / 4);
  assertValid(run);
});

test('W13-I08: assurance and ordinary enterprise commands compete for the same finite outside organization in both queue orders', () => {
  const initial = assuranceScenario(), state = initial.state;
  const packetId = Object.values(state.slices.data.packets).find(row => row.prepared && row.rights.hosted)!.id;
  const assurance: CommandPayload = { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: initial.productId };
  const ordinary: CommandPayload = { kind: 'sign_business_contract', customerId: 'aster-services', modelId: initial.modelId, contractKind: 'private-hosted', packetId };
  // A bounded population edge fixture: 79 organizations are already returning next week.
  state.slices.markets.returnedNextWeek.business = 79;
  assert.equal(outsideBusinessOrganizations(state), 1); assert.deepEqual(validateState(state), []);
  for (const [first, second] of [[assurance, ordinary], [ordinary, assurance]]) {
    const queued = submitCommand(state, first, CONTENT, 'w13-final-organization');
    assert.equal(queued.accepted, true, queued.reason?.message);
    const rejected = previewCommand(queued.state, second);
    assert.equal(rejected.accepted, false); assert.equal(rejected.reason?.code, 'CAPACITY_EXCEEDED');
  }
  const active = activeAssuranceScenario(), market = getMarketView(active.state, CONTENT).segments.find(row => row.id === 'business')!;
  assert.equal(market.committed, 1); assert.equal(market.outside, 79);
  assert.equal(market.paying + market.trials + market.returning + market.committed + market.outside, 80);
  assert.equal(commercialOrganizationCount(active.state), 1);
});
