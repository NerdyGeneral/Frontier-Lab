import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { RACK_RELOCATION_RULES as RULES } from '../src/content/wave8-relocation';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { canonicalStateHash } from '../src/core/canonical';
import { assertWave8RackRelocations } from '../src/core/wave8-relocation-validation';
import { getComputePools, getInfrastructureBaseCost } from '../src/modules/compute-pools';
import { activeRackRelocation, committedRackSlots } from '../src/modules/rack-relocation';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { paidScaleCompany } from './fixtures/wave8-scale';

function setup(prefix: string) {
  const prepared = paidScaleCompany(), run = new NaturalBusinessCampaign(prepared.state, prefix);
  return { ...prepared, run, owner: run.state.playerCompanyId };
}

test('W8-R01: paid disconnect, transport and reinstallation preserve the asset and commission at a later boundary', () => {
  const { run, siteId, movingRackId, owner } = setup('w8-r01');
  const original = structuredClone(run.state.slices.compute.racks[movingRackId]), startWeek = run.week;
  const fixed = getInfrastructureBaseCost(run.state), nominal = run.fleet.ownedCU;
  const quote = previewCommand(run.state, { kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  assert.equal(quote.accepted, true); assert.equal(quote.upfrontCostCents, RULES.feeCents);
  assert.equal(quote.weeklyCostDeltaCents, -12_000);
  const id = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.step();
  assert.equal(run.state.slices.compute.racks[movingRackId].status, 'parked');
  assert.equal(run.fleet.ownedCU, nominal, 'The purchased nominal asset remains while its usable capacity is offline.');
  const oldPool = getComputePools(run.state).find(pool => pool.location === 'colocation')!;
  assert.equal(oldPool.capacityCU, 0); assert.equal(oldPool.memoryMU, 0);
  assert.equal(getInfrastructureBaseCost(run.state), fixed);
  assert.equal(committedRackSlots(run.state, owner, siteId), 8);
  assert.equal(run.state.slices.company.ledger.filter(entry => entry.id === run.state.slices.compute.rackRelocations![id].paymentId).length, 1);
  run.until(state => state.slices.compute.rackRelocations![id].status === 'ready', 12, 'paid relocation stages');
  const project = run.state.slices.compute.rackRelocations![id];
  assert.equal(run.week, startWeek + 4); assert.equal(project.readyWeek, startWeek + 5);
  assert.equal(project.stages.reduce((n, stage) => n + stage.completedStaff, 0), U);
  assert.equal(run.state.slices.compute.racks[movingRackId].location, 'colocation');
  run.step();
  const moved = run.state.slices.compute.racks[movingRackId];
  assert.equal(moved.location, siteId); assert.equal(moved.status, 'installed'); assert.equal(moved.purchaseLocation, 'colocation');
  for (const key of ['hardwareId', 'purchaseCents', 'orderedWeek', 'arrivalWeek', 'installationStartedWeek', 'completedInstallStaff', 'installedWeek', 'readyWeek', 'usableCU', 'chipDesignId', 'chipBatchId'] as const) assert.equal(moved[key], original[key], key);
  assert.equal(getInfrastructureBaseCost(run.state), fixed - 12_000);
  assert.equal(getComputePools(run.state).find(pool => pool.location === siteId)!.nominalCU, 64 * U);
  assert.deepEqual(validateState(run.state), []);
});

test('W8-R02: destination reservations include queued purchase orders and incoming moves', () => {
  const { run, siteId, movingRackId } = setup('w8-r02');
  run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  assert.equal(submitCommand(run.state, { kind: 'order_rack', hardwareId: 'general', location: siteId }).reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(submitCommand(run.state, { kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId }).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(submitCommand(run.state, { kind: 'set_rack_parked', rackId: movingRackId, parked: true }).reason?.code, 'NOT_READY');
  run.step();
  assert.equal(submitCommand(run.state, { kind: 'order_rack', hardwareId: 'memory-rich', location: siteId }).reason?.code, 'CAPACITY_EXCEEDED');
  assert.equal(submitCommand(run.state, { kind: 'set_rack_parked', rackId: movingRackId, parked: false }).reason?.code, 'NOT_READY');
  const second = setup('w8-r02-order-first');
  second.run.queue({ kind: 'order_rack', hardwareId: 'general', location: second.siteId });
  assert.equal(submitCommand(second.run.state, { kind: 'start_rack_relocation', rackId: second.movingRackId, destination: second.siteId }).reason?.code, 'CAPACITY_EXCEEDED');
});

test('W8-R03: pause stops both meters and a saved partial transport resumes identically', () => {
  const { run, siteId, movingRackId } = setup('w8-r03');
  const id = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.step(2);
  run.queue({ kind: 'set_rack_relocation_paused', relocationId: id, paused: true }); run.step();
  const work = structuredClone(run.state.slices.compute.rackRelocations![id].stages), paid = getInfrastructureBaseCost(run.state);
  run.step(2);
  assert.deepEqual(run.state.slices.compute.rackRelocations![id].stages, work);
  assert.equal(getInfrastructureBaseCost(run.state), paid);
  const loaded = deserializeState(serializeState(run.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  const replay = new NaturalBusinessCampaign(loaded.state, 'w8-r03-resume');
  const original = new NaturalBusinessCampaign(structuredClone(run.state), 'w8-r03-resume');
  for (const continuation of [original, replay]) {
    continuation.queue({ kind: 'set_rack_relocation_paused', relocationId: id, paused: false });
    continuation.until(state => state.slices.compute.rackRelocations![id].status === 'complete', 12, 'resumed relocation');
  }
  assert.equal(canonicalStateHash(replay.state), canonicalStateHash(original.state));
});

test('W8-R04: elapsed transport cannot replace paid reconnect work and parked hardware returns parked', () => {
  const { run, siteId, movingRackId, owner } = setup('w8-r04');
  run.queue({ kind: 'set_rack_parked', rackId: movingRackId, parked: true }); run.step();
  const id = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId }); run.step();
  run.founder('commercial');
  for (const staff of run.staff('infrastructure')) run.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: 0 });
  run.step(4);
  assert.equal(run.state.slices.compute.rackRelocations![id].status, 'moving');
  assert.equal(run.state.slices.compute.rackRelocations![id].stages[2].completedStaff, 0);
  assert.equal(getComputePools(run.state).filter(pool => pool.ownership === 'owned').reduce((sum, pool) => sum + pool.capacityCU, 0), 0);
  for (const staff of run.staff('infrastructure')) run.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: U });
  run.until(state => state.slices.compute.rackRelocations![id].status === 'complete', 12, 'reconnect work');
  assert.equal(run.state.slices.compute.racks[movingRackId].status, 'parked');
  assert.equal(committedRackSlots(run.state, owner, siteId), 8);
});

test('W8-R05: returning a rack retains its original purchase location and the bounded chronological movement chain', () => {
  const { run, siteId, movingRackId } = setup('w8-r05');
  const first = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.until(state => state.slices.compute.rackRelocations?.[first]?.status === 'complete', 12);
  const second = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: 'colocation' });
  run.until(state => state.slices.compute.rackRelocations?.[second]?.status === 'complete', 12);
  assert.equal(run.state.slices.compute.racks[movingRackId].purchaseLocation, 'colocation');
  assert.equal(activeRackRelocation(run.state, movingRackId), undefined);
  assert.equal(run.state.slices.compute.rackRelocations![second].sourceLocation, siteId);
  assert.equal(run.state.slices.compute.racks[movingRackId].location, 'colocation');
  assert.deepEqual(validateState(run.state), []);
});

test('W8-R06: malformed imported payment, chronology, capacity, source and live-state claims are rejected', () => {
  const { run, siteId, movingRackId } = setup('w8-r06');
  const id = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId }); run.step();
  const corruptions = [
    (s: typeof run.state) => { s.slices.compute.racks[movingRackId].status = 'installed'; },
    (s: typeof run.state) => { s.slices.compute.rackRelocations![id].paidCents--; },
    (s: typeof run.state) => { delete s.slices.company.postedFacts[s.slices.compute.rackRelocations![id].paymentId]; },
    (s: typeof run.state) => { s.slices.compute.rackRelocations![id].sourceLocation = siteId; },
    (s: typeof run.state) => { s.slices.compute.rackRelocations![id].usableCU += U; },
    (s: typeof run.state) => { s.slices.compute.racks[movingRackId].purchaseLocation = siteId; },
    (s: typeof run.state) => { s.slices.compute.rackRelocations![id].stages[1].completedWeek = s.week; },
    (s: typeof run.state) => { s.slices.compute.rackRelocations![id].startedWeek = 0; },
  ];
  for (const corrupt of corruptions) { const bad = structuredClone(run.state); corrupt(bad); assert.throws(() => assertWave8RackRelocations(bad, CONTENT)); assert.ok(validateState(bad).length); }
  assert.equal(submitCommand(run.state, { kind: 'start_rack_relocation', rackId: movingRackId, destination: '__proto__' }).accepted, false);
});

