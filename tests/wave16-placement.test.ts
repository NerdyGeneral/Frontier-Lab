import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { batchPlacementAtWeek, batchServingRequest } from '../src/modules/batch-inference';
import { getComputePools } from '../src/modules/compute-pools';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { batchScenario } from './fixtures/wave14-batch';

const cost = (run: NaturalBusinessCampaign) => run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
const ownPool = (run: NaturalBusinessCampaign) => getComputePools(run.state).find(pool => pool.ownership === 'owned')!;

test('W16-P01: explicit placement changes actual GPU use, retains old receipts, and can return to automatic dispatch', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'w16-pool-choice');
  const pool = ownPool(run);
  const id = 'batch:' + run.queue({ kind: 'accept_batch_job', productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging', weeklyWorkCapCUw: 4 * U, poolId: pool.id });
  run.step();
  let job = run.state.slices.products.batchJobs![id];
  assert.equal(job.usageHistory[0].poolId, pool.id);
  assert.ok(job.usageHistory[0].physicalWorkCUw < job.usageHistory[0].executedWorkCUw);
  const initialWeek = run.week, deadline = job.deadlineWeek, firstReceipt = structuredClone(job.usageHistory[0]);
  const frozen = { model: job.model, meter: job.meter, terms: job.terms, cap: job.weeklyWorkCapCUw };
  run.queue({ kind: 'set_batch_job_placement', jobId: id, poolId: 'general-cloud' }); run.step();
  job = run.state.slices.products.batchJobs![id];
  assert.equal(job.usageHistory[1].poolId, 'general-cloud');
  assert.equal(job.usageHistory[1].physicalWorkCUw, job.usageHistory[1].executedWorkCUw);
  assert.deepEqual(job.usageHistory[0], firstReceipt);
  assert.equal(batchServingRequest(job, initialWeek).poolId, pool.id);
  assert.equal(batchPlacementAtWeek(job), 'general-cloud');
  run.queue({ kind: 'set_batch_job_placement', jobId: id, poolId: 'auto' }); run.step();
  job = run.state.slices.products.batchJobs![id];
  assert.equal(batchPlacementAtWeek(job), 'auto');
  assert.equal(job.usageHistory[2].poolId, pool.id);
  assert.equal(job.deadlineWeek, deadline);
  assert.deepEqual({ model: job.model, meter: job.meter, terms: job.terms, cap: job.weeklyWorkCapCUw }, frozen);
  assert.equal(job.placementHistory!.length, 3);
  assert.deepEqual(validateState(run.state), []);
  const text = serializeState(run.state), imported = deserializeState(text);
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(serializeState(imported.state), text);
  const forged = structuredClone(run.state);
  forged.slices.products.batchJobs![id].placementHistory![0].poolId = 'general-cloud';
  assert.ok(validateState(forged).length, 'A changed historical pin cannot rewrite earlier physical grants.');
});

test('W16-P02: a parked pinned pool waits without borrowing cloud and automatic placement restores service', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'w16-parked');
  const id = 'batch:' + run.queue({ kind: 'accept_batch_job', productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging', weeklyWorkCapCUw: 8 * U, poolId: ownPool(run).id });
  run.step();
  const before = run.state.slices.products.batchJobs![id].completedWork;
  run.queue({ kind: 'set_rack_parked', rackId: base.rackId!, parked: true }); run.step();
  let job = run.state.slices.products.batchJobs![id];
  assert.equal(job.completedWork, before); assert.equal(job.usageHistory.at(-1)!.executedWorkCUw, 0);
  assert.ok(cost(run).poolUsage.find(pool => pool.poolId === 'general-cloud')!.unusedCapacityCU > 0);
  run.queue({ kind: 'set_batch_job_placement', jobId: id, poolId: 'auto' }); run.step();
  job = run.state.slices.products.batchJobs![id];
  assert.ok(job.completedWork > before); assert.equal(job.usageHistory.at(-1)!.poolId, 'general-cloud');
  assert.equal(job.deadlineWeek - job.acceptedWeek + 1, 4);
  assert.deepEqual(validateState(run.state), []);
});

test('W16-P03: a capacity plan applies rental and allocation atomically and bills all reserved cloud CU', () => {
  const base = batchScenario(), run = new NaturalBusinessCampaign(base.state, 'w16-capacity');
  const before = structuredClone(run.fleet), cloudCU = before.cloudCU + 8 * U, servingCU = before.allocation.serving + 8 * U;
  const command = { kind: 'set_batch_capacity' as const, cloudCU, servingCU };
  const quote = previewCommand(run.state, command);
  assert.ok(quote.accepted, quote.reason?.message);
  assert.equal(quote.weeklyCostDeltaCents, 8 * CONTENT.opening.rentCentsPerCUWeek);
  run.queue(command);
  assert.deepEqual(run.fleet, before, 'Queued plans must not change current capacity or cost.');
  assert.equal(previewCommand(run.state, { kind: 'allocate_compute', ...before.allocation }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'set_cloud_capacity', cu: cloudCU }).accepted, false);
  run.step();
  assert.equal(run.fleet.cloudCU, cloudCU); assert.equal(run.fleet.allocation.serving, servingCU);
  assert.equal(run.fleet.allocation.development, before.allocation.development);
  assert.equal(run.fleet.allocation.research, before.allocation.research);
  assert.equal(cost(run).totals.cloudRentCents, cloudCU / U * CONTENT.opening.rentCentsPerCUWeek);
  run.step();
  assert.equal(cost(run).totals.cloudRentCents, cloudCU / U * CONTENT.opening.rentCentsPerCUWeek, 'Rental continues without any batch jobs.');
  run.queue({ kind: 'set_batch_capacity', cloudCU: before.cloudCU, servingCU: before.allocation.serving }); run.step();
  assert.equal(run.fleet.cloudCU, before.cloudCU); assert.deepEqual(run.fleet.allocation, before.allocation);
  assert.deepEqual(validateState(run.state), []);
});

test('W16-P04: foreign pools, malformed choices, conflicting plans and unsupported capacity are rejected before mutation', () => {
  const base = batchScenario({ owned: true }), run = new NaturalBusinessCampaign(base.state, 'w16-admission');
  const accept = { kind: 'accept_batch_job' as const, productId: base.productId, modelId: base.modelId,
    orderId: 'archive-tagging' as const, weeklyWorkCapCUw: 4 * U };
  assert.equal(previewCommand(run.state, { ...accept, poolId: 'owned:foreign:training' }).accepted, false);
  assert.equal(submitCommand(run.state, { ...accept, poolId: '__proto__' }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'set_batch_capacity', cloudCU: run.fleet.cloudCU + U / 2, servingCU: 0 }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'set_batch_capacity', cloudCU: 0, servingCU: CONTENT.firstSale.maxCloudCU }).accepted, false);
  const id = 'batch:' + run.queue(accept); run.step();
  assert.equal(Object.hasOwn(run.state.slices.products.batchJobs![id], 'placementHistory'), false, 'Ordinary acceptance keeps the legacy save shape.');
  run.queue({ kind: 'set_batch_job_placement', jobId: id, poolId: ownPool(run).id });
  assert.equal(previewCommand(run.state, { kind: 'set_batch_job_placement', jobId: id, poolId: 'general-cloud' }).accepted, false);
  run.step();
  const damaged = structuredClone(run.state), history = damaged.slices.products.batchJobs![id].placementHistory!;
  history.push({ ...history[0] });
  assert.ok(validateState(damaged).length, 'A saved placement cannot duplicate a boundary or a command receipt.');
});
