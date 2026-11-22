import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { BATCH_RULES } from '../src/content/wave14-batch';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, previewCommand, validateState } from '../src/core/engine';
import { mulDiv } from '../src/core/math';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { customerCapacityRequests } from '../src/modules/capacity-forecast';
import { getComputePools } from '../src/modules/compute-pools';
import { activeEfficiency, cacheWarm } from '../src/modules/product-efficiency';
import { standardServingRequests } from '../src/modules/products';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { acceptBatch, batchScenario } from './fixtures/wave14-batch';

const fork = (state: GameState, prefix: string) => new NaturalBusinessCampaign(structuredClone(state), prefix);
const job = (run: NaturalBusinessCampaign, id: string) => run.state.slices.products.batchJobs![id];
const latestCost = (run: NaturalBusinessCampaign) => run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
const usage = (run: NaturalBusinessCampaign, id: string) => job(run, id).usageHistory.at(-1)!;
function assertValid(run: NaturalBusinessCampaign) { assert.deepEqual(validateState(run.state), []); }
function assertOneInvoice(run: NaturalBusinessCampaign, id: string) {
  const selected = job(run, id), rows = run.state.slices.products.batchInvoices!.filter(row => row.jobId === id);
  assert.equal(rows.length, 1); const invoice = rows[0];
  assert.equal(invoice.id, selected.invoiceId); assert.equal(invoice.week, selected.terminalWeek);
  assert.equal(invoice.modelId, selected.model.modelId); assert.equal(invoice.modelFingerprint, selected.model.modelFingerprint);
  assert.equal(invoice.completedRequests, selected.completedRequests); assert.equal(invoice.inputTokens, selected.inputTokens); assert.equal(invoice.outputTokens, selected.outputTokens);
  assert.equal(invoice.grossCents, selected.quotedCents); assert.equal(invoice.grossCents - invoice.creditsCents, invoice.amountCents);
  const fact = run.state.slices.company.ledger.filter(row => row.id === invoice.id);
  assert.equal(fact.length, 1); assert.equal(fact[0].sourceId, id); assert.equal(fact[0].kind, 'receipt'); assert.equal(fact[0].amountCents, invoice.amountCents);
  assert.equal(run.state.slices.company.ledger.some(row => row.sourceId === id && row.kind === 'expense'), false,
    'Unfinished quoted work reduces earned revenue rather than posting a second expense.');
  assert.equal(run.state.slices.company.postedFacts[invoice.id], true);
  return invoice;
}

test('W14-I01: residual batch work uses owned GPUs without changing ordinary grants, the public token bill or consented feedback', () => {
  const initial = batchScenario({ owned: true }), on = fork(initial.state, 'w14-public-control'), off = fork(initial.state, 'w14-public-control');
  const studies = [on, off].map(run => {
    const id = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId: initial.productId, sampling: 'representative', consent: 'hosted-only' });
    run.queue({ kind: 'create_model_variant', modelId: initial.modelId, variant: 'memory-format' });
    return id;
  });
  const id = acceptBatch(on, initial.productId, initial.modelId); on.step(); off.step();
  const selected = job(on, id), row = usage(on, id), cost = latestCost(on), ordinaryCost = latestCost(off);
  assert.equal(row.executedWorkCUw, 4 * U); assert.equal(row.staffGranted, U / 4); assert.equal(row.supervisedLimitCUw, 4 * U);
  assert.ok(row.poolId!.startsWith('owned:')); assert.ok(row.physicalWorkCUw > 0 && row.physicalWorkCUw < row.executedWorkCUw);
  assert.equal(row.physicalWorkCUw, mulDiv(row.executedWorkCUw, 10000, 11000, 'ceil'));
  const workload = cost.workloads.filter(item => item.requestId === 'batch-serve:' + id);
  assert.equal(workload.length, 1); assert.equal(workload[0].physicalWorkCUw, row.physicalWorkCUw); assert.equal(workload[0].headroomCUw, 0);
  assert.ok(workload[0].ownedVariableCents > 0); assert.ok(cost.totals.ownedVariableCents > ordinaryCost.totals.ownedVariableCents);
  const request = cost.resources.requests.find(item => item.id === 'batch-serve:' + id)!;
  assert.equal(request.priority, BATCH_RULES.servingPriorityBase + selected.deadlineWeek); assert.equal(request.staffPriority, 60);
  assert.deepEqual(cost.resources.computeGrants.filter(item => item.requestId !== request.id), ordinaryCost.resources.computeGrants,
    'Public service and concurrent ordinary implementation receive the same physical grants before deferred work.');
  const acquisitionStaff = (run: NaturalBusinessCampaign) => latestCost(run).resources.staffGrants.find(item => item.requestId === 'acquire-company:' + run.state.playerCompanyId)!.grants.find(item => item.role === 'commercial')!.staffWeeks;
  assert.equal(acquisitionStaff(off) - acquisitionStaff(on), U / 4, 'Batch handling uses real commercial capacity before acquisition can consume it.');
  const publicOn = on.state.slices.products.lastUsage[initial.productId], publicOff = off.state.slices.products.lastUsage[initial.productId];
  assert.equal(publicOn.paidAccounts, publicOff.paidAccounts); assert.equal(publicOn.fulfillmentBps, 10000); assert.equal(publicOff.fulfillmentBps, 10000);
  for (const field of ['inputTokens', 'outputTokens', 'internalTokens', 'billCarryIn', 'billCarryOut'] as const) assert.equal(publicOn.tokens![field], publicOff.tokens![field]);
  assert.equal(publicOn.billedCents, publicOff.billedCents);
  assert.equal(on.state.slices.products.invoices.filter(item => item.productId === initial.productId && item.week === on.week).length, 1);
  assert.deepEqual(on.state.slices.data.feedbackStudies![studies[0]].weeks[0].paidUsage, off.state.slices.data.feedbackStudies![studies[1]].weeks[0].paidUsage);
  assert.equal(canonicalStateHash(on.state.slices.data.packets), canonicalStateHash(off.state.slices.data.packets));
  assert.equal(canonicalStateHash(on.state.slices.models), canonicalStateHash(off.state.slices.models));
  const target = cost.targets.find(item => item.sourceId === id)!;
  assert.equal(target.kind, 'batch-inference'); assert.equal(cost.activities.find(item => item.targetId === target.id)!.revenueCents, 0);
  assert.equal(selected.invoiceId, null); assert.equal(on.state.slices.products.batchInvoices!.length, 0);
  assert.equal(on.state.slices.compute.servingHistory[on.state.playerCompanyId].at(-1)!.privatePhysicalCUw, row.physicalWorkCUw);
  assert.equal(cost.totals.attributedComputeCents + cost.totals.sharedComputeCents, cost.totals.totalComputeCents);
  assertValid(on); assertValid(off);
});

test('W14-I02: idle fleet does not let a backlog borrow another allocation or reserve capacity ahead of live products', () => {
  const initial = batchScenario(), on = fork(initial.state, 'w14-residual-on'), off = fork(initial.state, 'w14-residual-off');
  const live = standardServingRequests(initial.state, CONTENT, initial.state.week + 1);
  const required = live.reduce((sum, request) => sum + mulDiv(request.normalizedWorkCUw, 10000 + (request.headroomBps ?? 0), 10000, 'ceil'), 0);
  for (const run of [on, off]) run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, serving: required });
  const id = acceptBatch(on, initial.productId, initial.modelId, 'archive-tagging', 8 * U); on.step(); off.step();
  assert.equal(usage(on, id).executedWorkCUw, 0); assert.equal(usage(on, id).physicalWorkCUw, 0); assert.equal(usage(on, id).staffGranted, U / 4);
  assert.equal(job(on, id).completedRequests, 0); assert.equal(job(on, id).invoiceId, null);
  assert.ok(latestCost(on).poolUsage.reduce((sum, pool) => sum + pool.unusedCapacityCU, 0) > 16 * U);
  assert.deepEqual(latestCost(on).resources.computeGrants.filter(row => row.requestId !== 'batch-serve:' + id), latestCost(off).resources.computeGrants);
  assert.equal(on.state.slices.products.lastUsage[initial.productId].billedCents, off.state.slices.products.lastUsage[initial.productId].billedCents);
  assert.equal(customerCapacityRequests(on.state).serving.some(request => request.id === 'batch-serve:' + id), false,
    'Best-effort backlog cannot consume the admission reservations for recurring customer promises.');
  assertValid(on); assertValid(off);
});

test('W14-I03: a batch freezes a paid deployment variant while public routing, cache, guardrails, features and pause remain independent', () => {
  const initial = batchScenario({ protectedApi: true }), run = fork(initial.state, 'w14-frozen-model');
  assert.ok(activeRuntimeGuardrail(run.state, initial.productId)); assert.ok(activeEfficiency(run.state, initial.productId, 'routing'));
  assert.ok(cacheWarm(run.state, run.state.slices.products.offers[initial.productId]));
  const id = acceptBatch(run, initial.productId, initial.compressedModelId!, 'archive-tagging', 8 * U); run.step();
  const selected = job(run, id), source = canonicalStateHash(selected.model), meter = canonicalStateHash(selected.meter), terms = canonicalStateHash(selected.terms);
  assert.equal(selected.model.modelId, initial.compressedModelId); assert.equal(selected.model.workBps, 8000);
  assert.equal(selected.meter.workPerRequestCUw, 520_000); assert.equal(selected.requiredWork, 20_800_000_000);
  assert.equal(selected.meter.inputTokensPerRequest, 2000); assert.equal(selected.meter.outputTokensPerRequest, 250);
  assert.equal(selected.meter.memoryMU, run.state.slices.models.versions[initial.compressedModelId!].residentMU + U / 4);
  const end = selected.deadlineWeek;
  run.queue({ kind: 'set_product_features', productId: initial.productId, features: { memory: true, extendedContext: false, deepReasoning: false } });
  run.queue({ kind: 'set_product_efficiency_enabled', productId: initial.productId, method: 'routing', enabled: false });
  run.queue({ kind: 'set_product_efficiency_enabled', productId: initial.productId, method: 'prefix-cache', enabled: false });
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId: initial.productId, enabled: false }); run.step();
  assert.equal(usage(run, id).executedWorkCUw, 8 * U);
  run.queue({ kind: 'set_product_paused', productId: initial.productId, paused: true }); run.step();
  const done = job(run, id);
  assert.equal(done.status, 'completed'); assert.equal(done.completedWork, done.requiredWork); assert.equal(done.completedRequests, 40_000);
  assert.equal(done.deadlineWeek, end); assert.equal(canonicalStateHash(done.model), source); assert.equal(canonicalStateHash(done.meter), meter); assert.equal(canonicalStateHash(done.terms), terms);
  assert.equal(run.state.slices.products.lastUsage[initial.productId].billedCents, 0);
  const invoice = assertOneInvoice(run, id); assert.equal(invoice.amountCents, 650_000); assert.equal(invoice.creditsCents, 0);
  const target = latestCost(run).targets.find(item => item.sourceId === id)!;
  assert.equal(target.kind, 'batch-inference'); assert.equal(latestCost(run).activities.find(item => item.targetId === target.id)!.revenueCents, invoice.amountCents);
  assertValid(run);
});

test('W14-I04: unavailable commercial supervision prevents GPU work and can cause a fixed-deadline shortfall', () => {
  const initial = batchScenario(), staffed = fork(initial.state, 'w14-staffed'), delayed = fork(initial.state, 'w14-no-staff');
  const member = delayed.staff('commercial')[0]; delayed.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  const a = acceptBatch(staffed, initial.productId, initial.modelId, 'archive-tagging', 8 * U), b = acceptBatch(delayed, initial.productId, initial.modelId, 'archive-tagging', 8 * U);
  staffed.step(); delayed.step();
  assert.equal(usage(delayed, b).staffRequired, U / 4); assert.equal(usage(delayed, b).staffGranted, 0); assert.equal(usage(delayed, b).supervisedLimitCUw, 0);
  assert.equal(usage(delayed, b).executedWorkCUw, 0); assert.equal(usage(delayed, b).physicalWorkCUw, 0); assert.equal(job(delayed, b).completedRequests, 0);
  assert.equal(usage(staffed, a).executedWorkCUw, 8 * U);
  assert.equal(delayed.state.slices.products.lastUsage[initial.productId].billedCents, staffed.state.slices.products.lastUsage[initial.productId].billedCents);
  delayed.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: U / 4 });
  for (let week = 0; week < 3; week++) { staffed.step(); delayed.step(); }
  assert.equal(job(staffed, a).status, 'completed'); assert.equal(job(delayed, b).status, 'expired');
  assert.equal(job(delayed, b).completedWork, 24 * U); assert.equal(job(delayed, b).completedRequests, Math.floor(24 * U / 650_000));
  assert.equal(job(delayed, b).deadlineWeek, job(staffed, a).deadlineWeek);
  assert.equal(assertOneInvoice(staffed, a).amountCents, 650_000);
  const partial = assertOneInvoice(delayed, b); assert.ok(partial.amountCents > 0 && partial.amountCents < 650_000); assert.ok(partial.creditsCents > 0);
  assertValid(staffed); assertValid(delayed);
});

test('W14-I05: paid fractions cross weekly boundaries but only whole requests bill at deadline or cancellation', () => {
  const initial = batchScenario(), run = fork(initial.state, 'w14-fractional');
  run.queue({ kind: 'allocate_compute', serving: 0, development: 0, research: 0 });
  const id = acceptBatch(run, initial.productId, initial.modelId, 'archive-tagging', 2 * U); run.step();
  assert.equal(job(run, id).completedWork, 0);
  const workPerRequest = job(run, id).meter.workPerRequestCUw, fraction = workPerRequest * 3 / 5;
  const end = job(run, id).deadlineWeek;
  run.queue({ kind: 'set_product_paused', productId: initial.productId, paused: true });
  run.queue({ kind: 'allocate_compute', serving: fraction, development: 0, research: 0 }); run.step();
  assert.equal(job(run, id).completedWork, fraction); assert.equal(job(run, id).completedRequests, 0);
  assert.equal(job(run, id).inputTokens + job(run, id).outputTokens, 0); assert.equal(job(run, id).invoiceId, null);
  assert.ok(job(run, id).physicalWork > 0);
  run.step();
  assert.equal(job(run, id).completedWork, 2 * fraction); assert.equal(job(run, id).completedRequests, 1);
  assert.equal(usage(run, id).completedRequests, 1); assert.equal(job(run, id).inputTokens, 2000); assert.equal(job(run, id).outputTokens, 250);
  const resumed = deserializeState(serializeState(run.state)); assert.ok(resumed.ok, resumed.ok ? '' : resumed.error);
  const cancelled = fork(run.state, 'w14-fraction-cancel'), paused = fork(run.state, 'w14-fraction-pause');
  cancelled.queue({ kind: 'cancel_batch_job', jobId: id }); paused.queue({ kind: 'set_batch_job_paused', jobId: id, paused: true });
  run.step(); cancelled.step(); paused.step();
  assert.equal(job(run, id).status, 'expired'); assert.equal(job(run, id).completedWork, 3 * fraction);
  assert.equal(job(cancelled, id).status, 'cancelled'); assert.equal(job(cancelled, id).completedWork, 2 * fraction);
  assert.equal(job(paused, id).status, 'expired'); assert.equal(job(paused, id).completedWork, 2 * fraction);
  assert.equal(usage(paused, id).paused, true); assert.equal(usage(paused, id).staffRequired, 0); assert.equal(usage(paused, id).executedWorkCUw, 0);
  for (const branch of [run, cancelled, paused]) {
    const selected = job(branch, id), invoice = assertOneInvoice(branch, id);
    assert.equal(selected.deadlineWeek, end); assert.equal(selected.completedRequests, 1); assert.equal(invoice.amountCents, 16);
    assert.equal(invoice.creditsCents, 650_000 - 16); assert.equal(selected.invoiceId, 'batch-invoice:' + id);
    assert.equal(previewCommand(branch.state, { kind: 'set_batch_job_paused', jobId: id, paused: false }).accepted, false);
    assert.equal(previewCommand(branch.state, { kind: 'cancel_batch_job', jobId: id }).accepted, false);
    const frozen = canonicalStateHash(selected); branch.step();
    assert.equal(canonicalStateHash(job(branch, id)), frozen); assertOneInvoice(branch, id); assertValid(branch);
  }
  if (resumed.ok) {
    const replay = advanceWeek(resumed.state); assert.equal(replay.accepted, true);
    assert.equal(replay.state.slices.products.batchJobs![id].completedWork, 3 * fraction);
    assert.equal(replay.state.slices.products.batchInvoices!.find(row => row.jobId === id)!.amountCents, 16);
  }
});

test('W14-I06: a backlog needs its full resident workspace in one compatible pool even when a GPU allocation is idle', () => {
  const initial = batchScenario(), run = fork(initial.state, 'w14-workspace');
  const id = acceptBatch(run, initial.productId, initial.modelId, 'archive-tagging', 2 * U); run.step();
  assert.equal(job(run, id).meter.memoryMU, 2 * U + U / 4);
  run.queue({ kind: 'set_product_paused', productId: initial.productId, paused: true });
  run.queue({ kind: 'allocate_compute', serving: U, development: 0, research: 0 }); run.step();
  const before = job(run, id).completedWork, deadline = job(run, id).deadlineWeek;
  run.queue({ kind: 'set_cloud_capacity', cu: U }); run.step();
  assert.equal(getComputePools(run.state)[0].memoryMU, 2 * U); assert.equal(run.fleet.allocation.serving, U);
  assert.equal(usage(run, id).staffGranted, U / 4); assert.ok(usage(run, id).supervisedLimitCUw > 0);
  assert.equal(usage(run, id).executedWorkCUw, 0); assert.equal(usage(run, id).memoryMU, 0); assert.equal(job(run, id).completedWork, before);
  assert.equal(latestCost(run).poolUsage[0].unusedCapacityCU, U);
  run.queue({ kind: 'set_cloud_capacity', cu: 2 * U }); run.step();
  assert.equal(usage(run, id).executedWorkCUw, U); assert.equal(usage(run, id).memoryMU, 2 * U + U / 4);
  assert.equal(job(run, id).deadlineWeek, deadline); assert.equal(job(run, id).status, 'expired'); assertOneInvoice(run, id); assertValid(run);
});

test('W14-I07: a paid compressed model completes a code backlog that misses the same cap and deadline on its original model', () => {
  const initial = batchScenario({ compressed: true }), plain = fork(initial.state, 'w14-plain-code'), compact = fork(initial.state, 'w14-compressed-code');
  const frozenModels = canonicalStateHash(initial.state.slices.models);
  const a = acceptBatch(plain, initial.productId, initial.modelId, 'code-index', 8 * U);
  const b = acceptBatch(compact, initial.productId, initial.compressedModelId!, 'code-index', 8 * U);
  for (let week = 0; week < 6; week++) { plain.step(); compact.step(); }
  const original = job(plain, a), compressed = job(compact, b);
  assert.equal(original.requiredWork, 60 * U); assert.equal(compressed.requiredWork, 48 * U);
  assert.equal(original.completedWork, 48 * U); assert.equal(compressed.completedWork, 48 * U);
  assert.equal(original.physicalWork, compressed.physicalWork); assert.equal(original.deadlineWeek, compressed.deadlineWeek);
  assert.equal(original.status, 'expired'); assert.equal(compressed.status, 'completed');
  assert.equal(original.completedRequests, 48_000); assert.equal(compressed.completedRequests, 60_000);
  assert.equal(original.quotedCents, compressed.quotedCents);
  assert.equal(assertOneInvoice(plain, a).amountCents, 1_200_000);
  assert.equal(assertOneInvoice(compact, b).amountCents, 1_500_000);
  assert.equal(canonicalStateHash(plain.state.slices.models), frozenModels); assert.equal(canonicalStateHash(compact.state.slices.models), frozenModels);
  assertValid(plain); assertValid(compact);
});

test('W14-I08: completed jobs keep physical work and paid-admission proof after public invoice, ledger and cost retention windows pass', () => {
  const initial = batchScenario(), run = fork(initial.state, 'w14-retention');
  const id = acceptBatch(run, initial.productId, initial.modelId, 'archive-tagging', 16 * U);
  run.until(state => state.slices.products.batchJobs?.[id]?.status === 'completed', 4, 'finished archive backlog');
  const invoice = assertOneInvoice(run, id), initialHash = canonicalStateHash(job(run, id));
  const admissionId = job(run, id).admission.publicInvoiceId, hardwareReceipts = canonicalStateHash(job(run, id).workReceipts);
  run.until(state => !state.slices.products.invoices.some(row => row.id === admissionId)
    && !state.slices.company.ledger.some(row => row.id === invoice.id || row.id === admissionId), 110, 'ordinary paid-admission and ledger retention windows');
  assert.equal(run.state.slices.compute.costReports![run.state.playerCompanyId].some(report => report.ledgerFacts.some(row => row.id === invoice.id)), false);
  assert.equal(canonicalStateHash(job(run, id)), initialHash); assert.equal(canonicalStateHash(job(run, id).workReceipts), hardwareReceipts);
  assert.equal(run.state.slices.products.batchInvoices!.filter(row => row.jobId === id).length, 1);
  assert.equal(run.state.slices.company.postedFacts[invoice.id], true); assert.equal(run.state.slices.company.postedFacts[admissionId], true);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  if (restored.ok) {
    const replay = advanceWeek(restored.state), direct = advanceWeek(run.state);
    assert.equal(replay.accepted, true, replay.reason?.message); assert.equal(direct.accepted, true, direct.reason?.message);
    assert.equal(canonicalStateHash(replay.state), canonicalStateHash(direct.state));
  }
  assertValid(run);
});
