import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import type { BatchPlacementForecastOptions } from '../src/contracts/wave16-planning';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { mulDiv } from '../src/core/math';
import { batchInvoiceAmount } from '../src/modules/batch-inference';
import { getBatchPlacementForecast } from '../src/modules/batch-planning';
import { getComputePools } from '../src/modules/compute-pools';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { acceptBatch, batchScenario } from './fixtures/wave14-batch';

function fixture() { return batchScenario({ owned: true, compressed: true }); }
function draft(base: ReturnType<typeof fixture>, overrides: Partial<BatchPlacementForecastOptions> = {}): BatchPlacementForecastOptions {
  return { productId: base.productId, orderId: 'archive-tagging', modelId: base.modelId, weeklyWorkCapCUw: 16 * U, ...overrides };
}
function send(state: GameState, payload: CommandPayload) {
  const result = submitCommand(state, payload);
  assert.equal(result.accepted, true, result.reason?.message);
  return { state: result.state, id: result.commandId! };
}
function step(state: GameState) {
  const result = advanceWeek(state);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}

test('W16-F01: a pure draft comparison matches the actual first-week allocator with live API, agent and development work', () => {
  const base = fixture(), run = new NaturalBusinessCampaign(base.state, 'w16-planning-busy');
  run.queue({ kind: 'allocate_compute', serving: 48 * U, development: U / 4, research: 0 });
  const variantId = 'variant:' + run.queue({ kind: 'create_model_variant', modelId: base.modelId, variant: 'memory-format' });
  run.queue({ kind: 'start_agent_job', orderId: 'support-replies@' + Math.floor((run.week + 1) / 4), modelId: base.modelId,
    mode: 'draft', verification: 'basic', tools: ['read_ticket', 'send_reply'], maxSteps: 24, maxRetries: 0, workBudget: 8 * U });
  run.step();
  assert.equal(run.state.slices.models.versions[variantId], undefined, 'Concurrent paid development must still be unfinished at the comparison boundary.');
  assert.ok(Object.values(run.state.slices.agents.jobs).some(job => job.status === 'running'));
  const before = canonicalStateHash(run.state), random = structuredClone(run.state.random);
  const forecast = getBatchPlacementForecast(run.state, draft(base));
  assert.equal(forecast.available, true, forecast.reason ?? undefined);
  assert.deepEqual(getBatchPlacementForecast(run.state, draft(base)), forecast);
  assert.equal(canonicalStateHash(run.state), before);
  assert.deepEqual(run.state.random, random);
  const owned = forecast.scenarios.find(item => item.poolId.startsWith('owned:'))!, row = owned.rows[0];
  const accepted = send(run.state, { kind: 'accept_batch_job', productId: base.productId, orderId: 'archive-tagging', modelId: base.modelId, weeklyWorkCapCUw: 16 * U, poolId: owned.poolId });
  assert.equal(forecast.jobId, 'batch:' + accepted.id, 'Prospective comparisons use the immediate default order identity.');
  const after = step(accepted.state), job = after.slices.products.batchJobs!['batch:' + accepted.id], usage = job.usageHistory[0];
  assert.equal(row.week, usage.week);
  assert.equal(row.effectiveWorkCUw, usage.executedWorkCUw);
  assert.equal(row.physicalWorkCUw, usage.physicalWorkCUw);
  assert.equal(row.actualPoolId, usage.poolId);
  assert.equal(row.staffGranted, usage.staffGranted);
  assert.equal(row.completedRequests, usage.completedRequests);
  assert.equal(row.memoryMU, usage.memoryMU);
  assert.ok(row.effectiveWorkCUw > 0 && row.effectiveWorkCUw < 16 * U, 'One connected owned pool, after other work, cannot lend itself the rest of the fleet.');
  const costs = after.slices.compute.costReports![after.playerCompanyId].at(-1)!;
  assert.ok(costs.resources.requests.some(request => request.taskId.startsWith('agent:')));
  assert.ok(costs.resources.requests.some(request => request.id.startsWith('model-application:') || request.taskId.includes('w16-planning-busy-command-2')));
  assert.deepEqual(validateState(after), []);
});

test('W16-F02: projected rent separates the full added reservation from already-included cloud attribution', () => {
  const base = fixture(), fleet = base.state.slices.compute.fleets[base.state.playerCompanyId];
  const forecast = getBatchPlacementForecast(base.state, draft(base, {
    modelId: base.compressedModelId!, cloudCU: fleet.cloudCU + 16 * U, servingCU: fleet.allocation.serving + 16 * U,
  }));
  assert.equal(forecast.available, true);
  assert.equal(forecast.horizonWeeks, 4);
  const cloud = forecast.scenarios.find(item => item.poolId === 'general-cloud')!;
  assert.equal(cloud.completionWeek, base.state.week + 2);
  assert.equal(cloud.rows.length, 4);
  assert.ok(cloud.rows.slice(2).every(row => row.requestedWorkCUw === 0 && row.physicalWorkCUw === 0 && row.staffGranted === 0));
  assert.equal(cloud.additionalCloudReservationCents, 16 * 4 * CONTENT.opening.rentCentsPerCUWeek,
    'An earlier completion does not silently cancel the company cloud reservation.');
  assert.equal(cloud.ownedVariableCents, 0);
  assert.equal(cloud.cloudWorkRentCents, mulDiv(cloud.physicalWorkCUw, CONTENT.opening.rentCentsPerCUWeek, U));
  assert.ok(cloud.cloudWorkRentCents > 0 && cloud.cloudWorkRentCents < cloud.additionalCloudReservationCents);
  assert.equal(cloud.projectedInvoiceCents, forecast.quotedCents);
  assert.equal(cloud.projectedCreditsCents, 0);
  const owned = forecast.scenarios.find(item => item.poolId.startsWith('owned:'))!;
  assert.ok(owned.ownedVariableCents > 0);
  assert.equal(owned.cloudWorkRentCents, 0);
  assert.ok(owned.physicalWorkCUw < owned.effectiveWorkCUw);
  assert.equal(owned.additionalCloudReservationCents, cloud.additionalCloudReservationCents,
    'Extra rent belongs to the whole proposed reservation, even when this particular job chooses owned hardware.');
  assert.ok(forecast.assumptions.some(item => /weekly bills remain funded/i.test(item)));
  assert.ok(forecast.assumptions.some(item => /not.*additional usage bill/i.test(item)));
});

test('W16-F03: a paused order retains earned request carry and its fixed-deadline invoice without forecasting a resume', () => {
  const base = fixture(), run = new NaturalBusinessCampaign(base.state, 'w16-planning-paused');
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 2 * U); run.step();
  const worked = run.state.slices.products.batchJobs![id];
  assert.ok(worked.completedRequests > 0 && worked.completedWork % worked.meter.workPerRequestCUw > 0);
  run.queue({ kind: 'set_batch_job_paused', jobId: id, paused: true }); run.step();
  const source = canonicalStateHash(run.state), job = run.state.slices.products.batchJobs![id];
  const forecast = getBatchPlacementForecast(run.state, { jobId: id });
  assert.equal(forecast.paused, true);
  assert.equal(forecast.startWeek, run.week + 1);
  assert.equal(forecast.horizonWeeks, job.deadlineWeek - run.week);
  const expected = batchInvoiceAmount(job.terms, job.completedRequests);
  for (const scenario of forecast.scenarios) {
    assert.equal(scenario.completionWeek, null);
    assert.equal(scenario.completedRequests, job.completedRequests);
    assert.equal(scenario.projectedInvoiceCents, expected);
    assert.equal(scenario.projectedCreditsCents, job.quotedCents - expected);
    assert.ok(scenario.rows.every(row => row.paused && row.requestedWorkCUw === 0 && row.staffGranted === 0 && row.physicalWorkCUw === 0));
    assert.equal(scenario.rows.at(-1)!.week, job.deadlineWeek);
  }
  assert.equal(canonicalStateHash(run.state), source);
  run.step(forecast.horizonWeeks);
  const invoice = run.state.slices.products.batchInvoices!.find(item => item.jobId === id)!;
  assert.equal(invoice.reason, 'deadline');
  assert.equal(invoice.amountCents, expected);
  assert.equal(invoice.week, job.deadlineWeek);
});

test('W16-F04: queued capacity and future onboarding supply no hidden resources to a frozen-load comparison', () => {
  const base = fixture(), run = new NaturalBusinessCampaign(base.state, 'w16-planning-staff');
  for (const member of run.staff('commercial')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.queue({ kind: 'hire_staff', role: 'commercial' });
  const id = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 8 * U);
  run.step();
  assert.ok(run.staff('commercial').some(member => member.readyWeek > run.week));
  const forecast = getBatchPlacementForecast(run.state, { jobId: id });
  assert.ok(forecast.available);
  assert.ok(forecast.scenarios.every(item => item.rows.every(row => row.staffGranted === 0 && row.effectiveWorkCUw === 0)));
  const fleet = run.fleet;
  run.queue({ kind: 'set_batch_capacity', cloudCU: fleet.cloudCU + 4 * U, servingCU: fleet.allocation.serving + 4 * U });
  const queuedHash = canonicalStateHash(run.state);
  const queued = getBatchPlacementForecast(run.state, { jobId: id });
  assert.equal(queued.available, true, queued.reason ?? undefined);
  assert.equal(queued.capacityPlanValid, true);
  assert.deepEqual(queued.scenarios, forecast.scenarios, 'A queued rental is excluded rather than silently supplied or treated as an invalid planning input.');
  assert.ok(queued.assumptions.some(item => /queued company changes/i.test(item)));
  assert.equal(canonicalStateHash(run.state), queuedHash);
});

test('W16-F05: accepted competing batches release their finite requests as they finish, while each week still uses one connected pool', () => {
  const base = fixture(), run = new NaturalBusinessCampaign(base.state, 'w16-planning-backlog');
  run.queue({ kind: 'allocate_compute', serving: 72 * U, development: 0, research: 0 }); run.step();
  run.queue({ kind: 'set_batch_capacity', cloudCU: 4 * U, servingCU: 12 * U }); run.step();
  const firstId = acceptBatch(run, base.productId, base.modelId, 'archive-tagging', 8 * U); run.step();
  const ownedPool = getComputePools(run.state).find(pool => pool.ownership === 'owned')!;
  const forecast = getBatchPlacementForecast(run.state, draft(base, { weeklyWorkCapCUw: 16 * U }));
  assert.equal(forecast.available, true, forecast.reason ?? undefined);
  const selected = forecast.scenarios.find(item => item.poolId === ownedPool.id)!;
  assert.ok(run.state.slices.products.batchJobs![firstId].completedWork < run.state.slices.products.batchJobs![firstId].requiredWork);
  assert.ok(selected.rows[0].effectiveWorkCUw < selected.rows.at(-1)!.effectiveWorkCUw,
    'Earlier work finishes and stops consuming the selected pool before the newer deadline.');
  for (const row of selected.rows) {
    assert.ok(row.effectiveWorkCUw < 16 * U, 'The job may not combine separate cloud and owned pools to reach its requested cap.');
    assert.ok(row.actualPoolId === ownedPool.id || row.actualPoolId === null);
    assert.ok(row.week <= forecast.deadlineWeek!);
  }
  assert.ok(selected.projectedCreditsCents > 0, 'The finite deadline and connected-pool bottleneck remain a real commercial tradeoff.');
});

test('W16-F06: incomplete drafts and physically invalid capacity plans return reasons without creating preview state', () => {
  const base = fixture(), source = canonicalStateHash(base.state);
  for (const options of [{}, draft(base, { cloudCU: U / 2 }), draft(base, { servingCU: Number.MAX_SAFE_INTEGER }),
    { jobId: 'not-an-owned-job' }, draft(base, { modelId: 'not-an-owned-model' })] satisfies BatchPlacementForecastOptions[]) {
    const forecast = getBatchPlacementForecast(base.state, options);
    assert.equal(forecast.available, false);
    assert.ok(forecast.reason);
    assert.equal(forecast.scenarios.length, 0);
  }
  assert.equal(canonicalStateHash(base.state), source);
  assert.equal(base.state.slices.products.batchJobs && Object.keys(base.state.slices.products.batchJobs).length, 0);
});
