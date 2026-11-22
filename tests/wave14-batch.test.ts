import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { BATCH_ORDER_BY_ID, BATCH_RULES } from '../src/content/wave14-batch';
import type { ChipDesign } from '../src/contracts/wave4-hardware';
import type { GameState, ModuleContext, ResourceFrame } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, validateState } from '../src/core/engine';
import { mulDiv } from '../src/core/math';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave8ComputeCosts } from '../src/core/wave8-costs-validation';
import { assertBatchCommand } from '../src/core/wave14-batch-validation';
import { advanceBatch, batchInvoiceAmount, batchMeter, batchModelBinding, batchRequests, batchScheduler, batchServingRequest, batchWorkId, getBatchView, settleBatch } from '../src/modules/batch-inference';
import { createComputeModule } from '../src/modules/compute';
import { infrastructureOperationsId } from '../src/modules/compute-pools';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { deployedGuardrailScenario } from './fixtures/wave12-guardrails';
import { acceptBatch, batchScenario } from './fixtures/wave14-batch';

function invalidSnapshot(state: GameState, label: string): void {
  assert.ok(validateState(state).length, label);
  const envelope = { format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion,
    checksum: canonicalStateHash(state), state };
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, label + ' remains invalid under a newly correct checksum');
}
function context(week: number, resources: ResourceFrame): ModuleContext {
  return { week, phase: 'execute', content: CONTENT, facts: [], resources, random: { draw: () => 0 } };
}

let partialSchedulerCache: GameState | undefined;
function partialScheduler(): GameState {
  if (partialSchedulerCache) return structuredClone(partialSchedulerCache);
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'batch-core-partial-scheduler');
  run.founder('data');
  for (const member of staffContributors(run.state, 'ml')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.queue({ kind: 'assign_founder', allocations: { research: 0, ml: U / 4, data: 3 * U / 4, infrastructure: 0, commercial: 0, hardware: 0 } });
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: U / 4 });
  run.queue({ kind: 'install_batch_scheduler' }); run.step();
  const scheduler = batchScheduler(run.state)!;
  assert.equal(scheduler.completedWork, U / 4); assert.equal(scheduler.completedStaff, U / 4);
  assert.equal(scheduler.staffGrantCount, 1); assert.equal(Object.values(scheduler.workReceipts)[0].grants, 1);
  assert.deepEqual(validateState(run.state), []);
  partialSchedulerCache = structuredClone(run.state); return structuredClone(run.state);
}

test('W14-B01: scheduler fees, independent capped GPU and ML grants, and the activation boundary are paid through ordinary commands', () => {
  const base = deployedGuardrailScenario(), run = new NaturalBusinessCampaign(base.state, 'batch-core-scheduler');
  assert.equal(run.state.slices.products.batchSchedulers, undefined);
  const before = canonicalStateHash(run.state), quote = previewCommand(run.state, { kind: 'install_batch_scheduler' });
  assert.ok(quote.accepted, quote.reason?.message); assert.equal(quote.upfrontCostCents, 150_000);
  assert.match(quote.summary, /2 development CUw and 40 Design points/); assert.equal(canonicalStateHash(run.state), before);
  const noResearch = structuredClone(run.state); noResearch.slices.research.completedByCompany[run.state.playerCompanyId] = [];
  assert.equal(previewCommand(noResearch, { kind: 'install_batch_scheduler' }).accepted, false);
  run.founder('ml'); run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 });
  const command = run.queue({ kind: 'install_batch_scheduler' });
  assert.equal(previewCommand(run.state, { kind: 'install_batch_scheduler' }).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(run.state.slices.products.batchSchedulers, undefined, 'Queueing and quoting do not install optional state.');
  run.step(2);
  let scheduler = batchScheduler(run.state)!;
  assert.equal(scheduler.id, 'batch-scheduler:' + command); assert.equal(scheduler.status, 'building');
  assert.equal(scheduler.completedWork, 0); assert.equal(scheduler.completedStaff, 2 * U); assert.equal(scheduler.staffGrantCount, 2);
  assert.equal(scheduler.availableWeek, null); assert.deepEqual(scheduler.workReceipts, {});
  const fee = run.state.slices.company.ledger.filter(row => row.id === scheduler.feeFactId);
  assert.equal(fee.length, 1); assert.equal(fee[0].amountCents, 150_000); assert.equal(fee[0].kind, 'expense');
  assert.equal(previewCommand(run.state, { kind: 'accept_batch_job', productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging', weeklyWorkCapCUw: 8 * U }).accepted, false);
  run.founder('data'); for (const member of staffContributors(run.state, 'ml')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 8 * U });
  run.step(); scheduler = batchScheduler(run.state)!;
  assert.equal(scheduler.completedWork, U); assert.equal(scheduler.completedStaff, 2 * U);
  assert.equal(scheduler.latestGrant!.requestedWork, U, 'Abundant development allocation cannot bypass the implementation cap.');
  assert.ok(!batchRequests(run.state).some(request => request.id === batchWorkId(scheduler.id, 'ml')));
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error); run.state = restored.state;
  run.step(); scheduler = batchScheduler(run.state)!;
  assert.equal(scheduler.status, 'ready'); assert.equal(scheduler.completedWork, 2 * U); assert.equal(scheduler.physicalWork, 2 * U);
  assert.equal(scheduler.availableWeek, run.week + 1); assert.equal(scheduler.completedWeek, run.week);
  assert.equal(previewCommand(run.state, { kind: 'accept_batch_job', productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging', weeklyWorkCapCUw: 8 * U }).accepted, false);
  run.step(); scheduler = batchScheduler(run.state)!;
  assert.equal(scheduler.status, 'active'); assert.equal(scheduler.availableWeek, run.week);
  assert.equal(previewCommand(run.state, { kind: 'install_batch_scheduler' }).reason?.code, 'ALREADY_ACTIVE');
  assert.deepEqual(batchRequests(run.state), []); assert.deepEqual(validateState(run.state), []);
});

test('W14-B02: admission requires prior paid API demand and the selected exact paid model; queued and cancelled claims remain finite', () => {
  const base = batchScenario(), payload = { kind: 'accept_batch_job' as const, productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging' as const, weeklyWorkCapCUw: 2 * U };
  const before = canonicalStateHash(base.state), quote = previewCommand(base.state, payload), binding = batchModelBinding(base.state, base.modelId)!;
  assert.ok(quote.accepted, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0); assert.match(quote.summary, /residual|Ordinary workloads run first/);
  assert.equal(canonicalStateHash(base.state), before);
  const cases: Array<[string, (state: GameState) => void]> = [
    ['paused API', state => { state.slices.products.offers[base.productId].status = 'paused'; }],
    ['unowned source API', state => { state.slices.products.offers[base.productId].companyId = 'other-company'; }],
    ['non-API source', state => { state.slices.products.offers[base.productId].kind = 'basic-chat'; }],
    ['no remaining paying accounts', state => { state.slices.markets.cohorts = state.slices.markets.cohorts.filter(row => row.productId !== base.productId); }],
    ['no actually executed paid service', state => { state.slices.products.lastUsage[base.productId].paidExecutedWork = 0; }],
    ['no posted paid invoice', state => { delete state.slices.company.postedFacts['invoice:' + base.productId + ':' + state.slices.products.lastUsage[base.productId].week]; }],
    ['foreign selected model', state => { state.slices.models.versions[base.modelId].companyId = 'other-company'; }],
    ['unfinished selected model', state => { state.slices.models.versions[base.modelId].status = 'checkpoint'; }],
    ['missing exact capability report', state => { delete state.slices.models.reports[binding.capabilityReportId]; }],
    ['scenario-only capability evidence', state => { state.slices.models.reports[binding.capabilityReportId].scenarioStart = true; }],
    ['unpaid capability run', state => { const evaluation = Object.values(state.slices.models.evaluationRuns).find(row => row.reportId === binding.capabilityReportId)!; evaluation.completedWork--; }],
    ['missing exact policy report', state => { delete state.slices.models.reports[binding.policyReportId!]; }],
    ['insufficient task quality', state => { state.slices.models.versions[base.modelId].capabilityBps.documents = 2999; }],
    ['insufficient reliability', state => { state.slices.models.versions[base.modelId].reliabilityBps = 7999; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base.state); mutate(changed); assert.equal(previewCommand(changed, payload).accepted, false, label); }
  assert.equal(previewCommand(base.state, { ...payload, weeklyWorkCapCUw: 3 * U }).accepted, false);
  assert.throws(() => assertBatchCommand({ ...payload, poolOverride: 'general-cloud' } as never), /unknown or missing field/,
    'Unknown placement fields remain rejected; Wave 16 validates the supported poolId field separately.');
  const run = new NaturalBusinessCampaign(base.state, 'batch-core-finite');
  const ids = Array.from({ length: 3 }, () => acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 2 * U));
  assert.equal(previewCommand(run.state, payload).reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(Object.keys(run.state.slices.products.batchJobs!).length, 0);
  run.step(); assert.deepEqual(ids.map(id => run.state.slices.products.batchJobs![id].claim), [1, 2, 3]);
  for (const jobId of ids) run.queue({ kind: 'cancel_batch_job', jobId }); run.step();
  assert.equal(previewCommand(run.state, payload).reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(getBatchView(run.state).board.find(order => order.id === 'archive-tagging')!.remainingClaims, 0);
  assert.equal(run.state.slices.products.batchInvoices!.length, 3); assert.deepEqual(validateState(run.state), []);
});

test('W14-B03: first scheduler grants cannot invent earlier GPU or ML work, even under a valid checksum and matching latest grants', () => {
  const base = partialScheduler();
  const cases: Array<[string, (state: GameState) => void]> = [
    ['unpaid scheduler fee', state => { delete state.slices.company.postedFacts[batchScheduler(state)!.feeFactId]; }],
    ['absent accepted installation', state => { delete state.commandReceipts[batchScheduler(state)!.id.slice('batch-scheduler:'.length)]; }],
    ['free earlier ML effort', state => { const scheduler = batchScheduler(state)!; scheduler.completedStaff += U / 4; scheduler.latestStaffGrant!.remainingBefore -= U / 4; }],
    ['fabricated earlier ML date', state => { batchScheduler(state)!.firstStaffWeek!--; }],
    ['free earlier GPU effort', state => {
      const scheduler = batchScheduler(state)!, receipt = Object.values(scheduler.workReceipts)[0];
      scheduler.completedWork *= 2; scheduler.physicalWork *= 2; receipt.effectiveCUw *= 2; receipt.physicalCUw *= 2; receipt.conversionRemainder *= 2;
      scheduler.latestGrant!.remainingBefore -= U / 4;
    }],
    ['changed actual ML grant', state => { batchScheduler(state)!.latestStaffGrant!.grantedStaff--; }],
    ['changed separate workspace', state => { batchScheduler(state)!.latestGrant!.memoryMU--; }],
    ['forged authored GPU tariff', state => { Object.values(batchScheduler(state)!.workReceipts)[0].rateCentsPerCUw++; }],
    ['free activation', state => { batchScheduler(state)!.status = 'active'; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base); mutate(changed); invalidSnapshot(changed, label); }
  const run = new NaturalBusinessCampaign(base, 'batch-core-retained-grants'); run.step();
  assert.equal(batchScheduler(run.state)!.completedStaff, U / 2); assert.equal(batchScheduler(run.state)!.completedWork, U / 2);
  const staff = structuredClone(run.state), work = structuredClone(run.state);
  batchScheduler(staff)!.completedStaff += U / 4; batchScheduler(staff)!.latestStaffGrant!.remainingBefore -= U / 4;
  invalidSnapshot(staff, 'fully retained multi-grant ML history');
  const scheduler = batchScheduler(work)!, receipt = Object.values(scheduler.workReceipts)[0];
  scheduler.completedWork += U / 4; scheduler.physicalWork += U / 4; receipt.effectiveCUw += U / 4; receipt.physicalCUw += U / 4; scheduler.latestGrant!.remainingBefore -= U / 4;
  invalidSnapshot(work, 'fully retained multi-grant GPU history');
});

test('W14-B04: frozen batch admission, calendar carry and physical resource provenance reject forged retained jobs', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'batch-core-job-provenance');
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 4 * U); run.step();
  const selected = (state: GameState) => state.slices.products.batchJobs![id];
  const cases: Array<[string, (state: GameState) => void]> = [
    ['missing accepted order', state => { delete state.commandReceipts[id.slice('batch:'.length)]; }],
    ['unpaid source invoice', state => { delete state.slices.company.postedFacts[selected(state).admission.publicInvoiceId]; }],
    ['invented paid accounts', state => { selected(state).admission.paidAccounts++; }],
    ['changed source fingerprint', state => { selected(state).model.modelFingerprint = '00000000'; }],
    ['removed commercial rights', state => { selected(state).model.hostedRights = false as never; }],
    ['free public cache discount', state => { selected(state).meter.workPerRequestCUw--; }],
    ['borrowed public resident memory', state => { selected(state).meter.memoryMU--; }],
    ['new quoted token rates', state => { selected(state).terms.outputPriceCentsPerMillion++; }],
    ['extended deadline', state => { selected(state).deadlineWeek++; }],
    ['unadmitted cap', state => { selected(state).weeklyWorkCapCUw = 3 * U; }],
    ['reused finite claim', state => { selected(state).claim++; }],
    ['deleted calendar receipt', state => { selected(state).usageHistory.pop(); }],
    ['invented whole request from partial work', state => { selected(state).completedRequests++; }],
    ['invented billed tokens', state => { selected(state).usageHistory[0].inputTokens++; }],
    ['free staff supervision', state => { selected(state).usageHistory[0].staffGranted = 0; }],
    ['free physical work', state => { selected(state).usageHistory[0].physicalWorkCUw--; }],
    ['invented effective conversion', state => { Object.values(selected(state).workReceipts)[0].multiplierBps++; }],
    ['lost integer conversion remainder', state => { Object.values(selected(state).workReceipts)[0].conversionRemainder++; }],
    ['cloud tariff on owned work', state => { Object.values(selected(state).workReceipts)[0].ownership = 'cloud'; }],
    ['free current allocator work', state => { state.slices.compute.fleets[state.playerCompanyId].lastGrants.find(row => row.requestId === 'batch-serve:' + id)!.grantedWork = 0; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(run.state); mutate(changed); invalidSnapshot(changed, label); }
  assert.deepEqual(validateState(run.state), []);
});

test('W14-B05: partial commercial supervision clips an owned GPU integer conversion rather than creating a free final work unit', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'batch-core-supervised-rounding');
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 2 * U); run.step();
  const original = run.state.slices.products.batchJobs![id], before = canonicalStateHash(run.state), products = structuredClone(run.state.slices.products), next = run.week + 1;
  const supplied = 123_456_788, request = batchServingRequest(original);
  // Earlier shared commercial requests may leave any integer remainder, although employees themselves are assigned in quarter FTE increments.
  const resources: ResourceFrame = { requests: [request], staffGrants: [
    { requestId: request.id, grants: [{ role: 'commercial', staffWeeks: supplied }] },
    { requestId: infrastructureOperationsId(run.state.playerCompanyId), grants: [{ role: 'infrastructure', staffWeeks: U }] },
  ], computeGrants: [] };
  const ctx = context(next, resources);
  resources.computeGrants = createComputeModule(CONTENT).grantResources!(run.state, ctx).computeGrants!;
  advanceBatch(run.state, products, ctx);
  const job = products.batchJobs![id], usage = job.usageHistory.at(-1)!, receipt = Object.values(job.workReceipts)[0];
  assert.equal(usage.staffGranted, supplied); assert.equal(usage.supervisedLimitCUw, supplied * 8);
  assert.equal(receipt.multiplierBps, 11000); assert.equal(usage.executedWorkCUw, usage.supervisedLimitCUw);
  assert.equal(mulDiv(usage.physicalWorkCUw, receipt.multiplierBps, 10000), usage.executedWorkCUw + 1,
    'Physical integer rounding crosses one normalized unit, which actual commercial supervision must still clip.');
  const addedRemainder = receipt.conversionRemainder - Object.values(original.workReceipts)[0].conversionRemainder;
  assert.equal(addedRemainder, usage.physicalWorkCUw * receipt.multiplierBps - usage.executedWorkCUw * 10000);
  assert.ok(addedRemainder > 0 && addedRemainder < receipt.multiplierBps);
  assert.equal(job.completedRequests, Math.floor((original.completedWork + usage.executedWorkCUw) / job.meter.workPerRequestCUw));
  resources.computeGrants[0].hardwareEffectiveCUw++;
  assert.throws(() => advanceBatch(run.state, structuredClone(run.state.slices.products), ctx), /supervision/);
  assert.equal(canonicalStateHash(run.state), before);
});

test('W14-B06: batch inference keeps sparse fabric and custom compiler compatibility at the physical allocator boundary', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'batch-core-compatibility');
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 2 * U); run.step();
  const state = structuredClone(run.state), job = state.slices.products.batchJobs![id];
  // These counterfactual pool fixtures isolate allocator compatibility. They are never submitted as paid game saves or model admission evidence.
  const rack = state.slices.compute.racks[base.rackId!], designId = 'isolated-batch-dense-inference-chip';
  state.slices.compute.fleets[state.playerCompanyId].cloudCU = 0;
  state.slices.compute.fleets[state.playerCompanyId].allocation = { serving: 8 * U, development: 0, research: 0 };
  rack.hardwareId = designId; rack.chipDesignId = designId;
  state.slices.compute.chipDesigns[designId] = { id: designId, companyId: state.playerCompanyId, name: 'Isolated inference compiler',
    spec: { architecture: 'dense', target: 'inference', memory: 'balanced' }, status: 'validated', paused: false,
    qualifiedYieldBps: 10000 } as ChipDesign;
  const allocate = (request: ReturnType<typeof batchServingRequest>) => {
    const frame: ResourceFrame = { requests: [request], computeGrants: [], staffGrants: [
      { requestId: request.id, grants: [{ role: 'commercial', staffWeeks: U / 4 }] },
      { requestId: infrastructureOperationsId(state.playerCompanyId), grants: [{ role: 'infrastructure', staffWeeks: U }] },
    ] };
    return createComputeModule(CONTENT).grantResources!(state, context(state.week + 1, frame)).computeGrants!.find(grant => grant.requestId === request.id)!;
  };
  const request = batchServingRequest(job), dense = allocate(request);
  assert.ok(dense.poolId.endsWith(':' + designId)); assert.equal(dense.hardwareEffectiveCUw, 2 * U); assert.equal(dense.physicalCUw, U);
  state.slices.models.versions[base.modelId].architecture = 'sparse';
  const sparseMeter = batchMeter(state, base.modelId, 'archive-tagging');
  assert.equal(sparseMeter.executionHints.requiresFastFabric, true); assert.equal(sparseMeter.executionHints.modelArchitecture, 'sparse');
  assert.equal(allocate({ ...request, ...sparseMeter.executionHints }).hardwareEffectiveCUw, 0, 'Sparse batch inference cannot use a dense compiler or cloud without fast fabric.');
  state.slices.compute.chipDesigns[designId].spec.target = 'training';
  assert.equal(allocate(request).hardwareEffectiveCUw, 0, 'A training-only custom chip cannot provide batch inference by relabeling its work as serving.');
  const badProducts = structuredClone(run.state.slices.products), goodJob = badProducts.batchJobs![id];
  const frame: ResourceFrame = { requests: [batchServingRequest(goodJob)], staffGrants: [
    { requestId: request.id, grants: [{ role: 'commercial', staffWeeks: U / 4 }] },
    { requestId: infrastructureOperationsId(state.playerCompanyId), grants: [{ role: 'infrastructure', staffWeeks: U }] },
  ], computeGrants: [{ ...dense, requestId: request.id }] };
  assert.throws(() => advanceBatch(state, badProducts, context(state.week + 1, frame)), /compatible pool/,
    'The batch module independently refuses a forged positive grant from incompatible hardware.');
});

test('W14-B07: the terminal invoice is immutable, bills whole completed requests once, and retains its exact paid source', () => {
  const base = batchScenario(), run = new NaturalBusinessCampaign(base.state, 'batch-core-terminal');
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 16 * U); run.step(2);
  const job = run.state.slices.products.batchJobs![id], invoice = run.state.slices.products.batchInvoices![0];
  assert.equal(job.status, 'completed'); assert.equal(job.completedRequests, 40_000); assert.equal(job.usageHistory.length, 2);
  assert.equal(invoice.amountCents, 650_000); assert.equal(invoice.creditsCents, 0);
  assert.equal(batchInvoiceAmount(BATCH_ORDER_BY_ID['archive-tagging'], 0), 0);
  assert.equal(batchInvoiceAmount(BATCH_ORDER_BY_ID['archive-tagging'], 1), 16);
  assert.equal(batchInvoiceAmount(BATCH_ORDER_BY_ID['archive-tagging'], 2), 32);
  const products = structuredClone(run.state.slices.products);
  assert.deepEqual(settleBatch(run.state, products, context(run.week, { requests: [], computeGrants: [], staffGrants: [] })), []);
  assert.deepEqual(products, run.state.slices.products);
  const cases: Array<[string, (state: GameState) => void]> = [
    ['missing terminal invoice', state => { state.slices.products.batchInvoices = []; }],
    ['duplicate terminal invoice', state => { state.slices.products.batchInvoices!.push(structuredClone(invoice)); }],
    ['unposted terminal payment', state => { delete state.slices.company.postedFacts[invoice.id]; }],
    ['invented earned cent', state => { state.slices.products.batchInvoices![0].amountCents++; }],
    ['additional penalty', state => { state.slices.products.batchInvoices![0].creditsCents++; }],
    ['changed frozen model', state => { state.slices.products.batchInvoices![0].modelFingerprint = '00000000'; }],
    ['changed terminal reason', state => { state.slices.products.batchInvoices![0].reason = 'deadline'; }],
    ['invented request completion', state => { state.slices.products.batchInvoices![0].completedRequests--; }],
    ['removed terminal boundary', state => { state.slices.products.batchJobs![id].terminalWeek = null; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(run.state); mutate(changed); invalidSnapshot(changed, label); }
  const premature = structuredClone(run.state); premature.slices.products.batchJobs![id].acceptedWeek++;
  assert.throws(() => assertWave8ComputeCosts(premature, CONTENT), /outside its accepted service window/,
    'Historical accounting cannot attribute GPU work to a batch before acceptance.');
  const afterTerminal = structuredClone(run.state); afterTerminal.slices.products.batchJobs![id].terminalWeek!--;
  assert.throws(() => assertWave8ComputeCosts(afterTerminal, CONTENT), /outside its accepted service window/,
    'Historical accounting cannot attribute GPU work or revenue after the batch settled.');
  assert.equal(BATCH_RULES.maximumJobsPerCompany, 9); assert.equal(BATCH_RULES.maximumJobs, 36);
  assert.deepEqual(validateState(run.state), []);
});
