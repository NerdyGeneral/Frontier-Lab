import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ChipSpecification } from '../src/contracts/wave4-hardware';
import { CONTENT } from '../src/content/catalog';
import { CHIP_RULES, chipSpecificationValues } from '../src/content/wave4-hardware';
import { RACK_RELOCATION_RULES } from '../src/content/wave8-relocation';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { chipDesignId } from '../src/modules/chips';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getComputePools, getInfrastructureBaseCost, hasFastFabric, poolSupportsWorkload } from '../src/modules/compute-pools';
import { committedRackSlots } from '../src/modules/rack-relocation';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

interface PaidCustomCompany {
  state: GameState;
  siteId: string;
  movingRackId: string;
  secondRackId: string;
  designId: string;
  batchId: string;
}
let prepared: PaidCustomCompany | undefined;

/** Historical paid receipts are imported unchanged; every new asset uses ordinary commands. */
function setup(prefix: string) {
  if (!prepared) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave4-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const run = new NaturalBusinessCampaign(imported.state, 'wave8-custom-setup');
    const owner = run.state.playerCompanyId;
    const secondRackId = Object.values(run.state.slices.compute.racks).find(rack => rack.companyId === owner)!.id;
    run.step(); // Settle the published save's authentic queued commands.
    run.hire('infrastructure', 2); run.founder('infrastructure');
    const siteId = 'facility-' + run.queue({ kind: 'start_facility' });
    const spec: ChipSpecification = { architecture: 'dense', target: 'inference', memory: 'wide' };
    const designId = chipDesignId(owner, spec);
    run.queue({ kind: 'start_chip_design', name: 'Relocation memory chip', spec });
    run.step();
    for (let index = 0; index < 6; index++) run.queue({ kind: 'order_rack', hardwareId: 'general', location: siteId });
    let batchId = '', movingRackId = '';
    for (let guard = 0; guard < 65; guard++) {
      const site = run.state.slices.compute.facilities[siteId];
      const design = run.state.slices.compute.chipDesigns[designId];
      const racks = Object.values(run.state.slices.compute.racks).filter(rack => rack.companyId === owner);
      if (site.status === 'active' && batchId && racks.length === 8 && racks.every(rack => rack.status === 'installed')) break;
      if (site.status === 'building' && !site.stages[site.stageIndex].paidCents) run.queue({ kind: 'fund_facility_stage', facilityId: siteId });
      if (design.status === 'design-ready') run.queue({ kind: 'start_chip_prototype', designId, modelId: CONTENT.seedModel.id });
      if (design.status === 'validated' && !batchId) {
        const commandId = run.queue({ kind: 'order_chip_batch', designId, racks: 1, location: 'colocation' });
        batchId = 'chip-batch-' + commandId; movingRackId = 'rack-' + commandId + '-1';
      }
      for (const rack of racks) if (rack.status === 'inventory') run.queue({ kind: 'install_rack', rackId: rack.id });
      run.step();
    }
    assert.equal(run.state.slices.compute.facilities[siteId].status, 'active');
    assert.equal(Object.values(run.state.slices.compute.racks).filter(rack => rack.companyId === owner && rack.status === 'installed').length, 8);
    assert.ok(run.state.slices.compute.racks[movingRackId].usableCU! < 8 * U, 'The new wide-memory design has a measured production loss.');
    assert.equal(hasFastFabric(run.state, owner, 'colocation'), true);
    assert.equal(hasFastFabric(run.state, owner, siteId), false);
    assert.deepEqual(validateState(run.state), []);
    prepared = { state: run.state, siteId, movingRackId, secondRackId, designId, batchId };
  }
  const fixture = structuredClone(prepared);
  return { ...fixture, run: new NaturalBusinessCampaign(fixture.state, prefix), owner: fixture.state.playerCompanyId };
}

test('W8-RC01: reduced-yield custom hardware moves without rewriting the paid batch, and source fabric stays at its site', () => {
  const { run, owner, siteId, movingRackId, designId, batchId } = setup('w8-rc01');
  run.discover('R12A');
  run.queue({ kind: 'start_system_rollout', method: 'cost-accounting' });
  run.until(state => getComputeCostView(state).available, 12, 'ordinary operating-cost rollout');
  const historicalReport = structuredClone(getComputeCostView(run.state).latest!);
  const original = structuredClone(run.state.slices.compute.racks[movingRackId]);
  const batch = structuredClone(run.state.slices.compute.chipBatches[batchId]);
  const design = structuredClone(run.state.slices.compute.chipDesigns[designId]);
  const fabrics = structuredClone(run.state.slices.compute.fabricProjects);
  const fixed = getInfrastructureBaseCost(run.state), nominal = run.fleet.ownedCU;
  const oldPoolId = `owned:colocation:${designId}`, destinationPoolId = `owned:${siteId}:${designId}`;
  assert.equal(historicalReport.pools.find(pool => pool.id === oldPoolId)!.trainingBps, 0);
  assert.ok(historicalReport.pools.find(pool => pool.id === oldPoolId)!.servingBps > 0);
  assert.equal(historicalReport.totals.ownedFixedCents, fixed);
  const connected = { modelArchitecture: 'dense' as const, workloadKind: 'inference' as const, requiresFastFabric: true };
  assert.equal(poolSupportsWorkload(getComputePools(run.state).find(pool => pool.id === oldPoolId)!, connected), true);
  const quote = previewCommand(run.state, { kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  assert.equal(quote.accepted, true); assert.equal(quote.upfrontCostCents, RACK_RELOCATION_RULES.feeCents);
  const moveId = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.step();
  const offline = getComputePools(run.state).find(pool => pool.id === oldPoolId)!;
  assert.equal(offline.nominalCU, original.usableCU); assert.equal(offline.capacityCU, 0); assert.equal(offline.memoryMU, 0);
  assert.equal(run.fleet.ownedCU, nominal); assert.equal(getInfrastructureBaseCost(run.state), fixed);
  assert.equal(getComputeCostView(run.state).latest!.pools.find(pool => pool.id === oldPoolId)!.capacityCU, 0);
  assert.equal(getComputeCostView(run.state).latest!.totals.ownedFixedCents, fixed);
  assert.equal(committedRackSlots(run.state, owner, 'colocation'), 2);
  assert.equal(committedRackSlots(run.state, owner, siteId), 7);
  run.until(state => state.slices.compute.rackRelocations![moveId].status === 'ready', 12, 'custom rack reconnection');
  assert.equal(run.state.slices.compute.racks[movingRackId].location, 'colocation');
  assert.equal(getComputePools(run.state).some(pool => pool.id === destinationPoolId), false);
  run.step();
  const rack = run.state.slices.compute.racks[movingRackId];
  assert.equal(rack.location, siteId); assert.equal(rack.purchaseLocation, 'colocation'); assert.equal(rack.status, 'installed');
  for (const key of ['hardwareId', 'chipDesignId', 'chipBatchId', 'usableCU', 'purchaseCents', 'orderedWeek', 'arrivalWeek', 'installationStartedWeek', 'completedInstallStaff', 'installedWeek', 'readyWeek'] as const) assert.equal(rack[key], original[key], key);
  assert.deepEqual(run.state.slices.compute.chipBatches[batchId], batch);
  assert.deepEqual(run.state.slices.compute.chipDesigns[designId], design);
  assert.deepEqual(run.state.slices.compute.fabricProjects, fabrics);
  assert.equal(run.state.slices.company.ledger.filter(entry => entry.id === run.state.slices.compute.rackRelocations![moveId].paymentId).length, 1);
  const arrived = getComputePools(run.state).find(pool => pool.id === destinationPoolId)!;
  assert.equal(arrived.nominalCU, original.usableCU); assert.equal(arrived.capacityCU, original.usableCU);
  assert.equal(arrived.memoryMU, original.usableCU! * 4);
  assert.equal(arrived.servingBps, chipSpecificationValues(design.spec).servingBps);
  assert.equal(arrived.fastFabric, undefined); assert.equal(poolSupportsWorkload(arrived, connected), false);
  assert.equal(hasFastFabric(run.state, owner, 'colocation'), true);
  assert.equal(committedRackSlots(run.state, owner, 'colocation'), 1);
  assert.equal(committedRackSlots(run.state, owner, siteId), 7);
  assert.equal(getInfrastructureBaseCost(run.state), fixed + quote.weeklyCostDeltaCents);
  assert.equal(getComputeCostView(run.state).latest!.totals.ownedFixedCents, fixed + quote.weeklyCostDeltaCents);
  assert.deepEqual(getComputeCostView(run.state).reports.find(report => report.id === historicalReport.id), historicalReport);
  const loaded = deserializeState(serializeState(run.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(run.state));
  const fabricId = 'fabric-' + run.queue({ kind: 'install_fast_fabric', location: siteId });
  run.until(state => state.slices.compute.fabricProjects[fabricId]?.status === 'ready', 12, 'destination fast fabric');
  assert.equal(getComputePools(run.state).find(pool => pool.id === destinationPoolId)!.fastFabric, undefined);
  run.step();
  assert.equal(poolSupportsWorkload(getComputePools(run.state).find(pool => pool.id === destinationPoolId)!, connected), true);
  assert.equal(run.state.slices.compute.fabricProjects[fabricId].purchaseCents, CHIP_RULES.fabricCostCents);
  for (const [id, fabric] of Object.entries(fabrics)) assert.deepEqual(run.state.slices.compute.fabricProjects[id], fabric);
  assert.deepEqual(run.state.slices.compute.chipBatches[batchId], batch);
  assert.deepEqual(validateState(run.state), []);
});

test('W8-RC02: low-yield incoming moves and custom production reserve whole rack slots in either queue order', () => {
  for (const order of ['move-first', 'batch-first'] as const) {
    const { run, owner, siteId, movingRackId, secondRackId, designId } = setup('w8-rc02-' + order);
    const move = { kind: 'start_rack_relocation' as const, rackId: movingRackId, destination: siteId };
    const production = { kind: 'order_chip_batch' as const, designId, racks: 1 as const, location: siteId };
    let moveId = '';
    if (order === 'move-first') { moveId = 'rack-relocation:' + run.queue(move); run.queue(production); }
    else { run.queue(production); moveId = 'rack-relocation:' + run.queue(move); }
    assert.equal(committedRackSlots(run.state, owner, siteId), 8);
    for (const payload of [production, { kind: 'order_rack' as const, hardwareId: 'general' as const, location: siteId },
      { kind: 'start_rack_relocation' as const, rackId: secondRackId, destination: siteId }]) {
      assert.equal(submitCommand(run.state, payload).reason?.code, 'CAPACITY_EXCEEDED');
    }
    run.step();
    assert.equal(committedRackSlots(run.state, owner, siteId), 8, 'Accepted orders and a moving asset continue to reserve eight full footprints.');
    assert.equal(submitCommand(run.state, production).reason?.code, 'CAPACITY_EXCEEDED');
    assert.equal(submitCommand(run.state, { kind: 'order_rack', hardwareId: 'memory-rich', location: siteId }).reason?.code, 'CAPACITY_EXCEEDED');
    run.until(state => state.slices.compute.rackRelocations![moveId].status === 'complete', 12, 'incoming low-yield rack');
    assert.equal(committedRackSlots(run.state, owner, siteId), 8, 'Commissioning replaces the inbound reservation with the actual rack exactly once.');
    if (order === 'move-first') {
      const returning = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: 'colocation' });
      run.step();
      assert.equal(committedRackSlots(run.state, owner, siteId), 8, 'The outgoing rack retains its source footprint during transport.');
      assert.equal(submitCommand(run.state, production).reason?.code, 'CAPACITY_EXCEEDED');
      run.until(state => state.slices.compute.rackRelocations![returning].status === 'complete', 12, 'returning custom rack');
      assert.equal(committedRackSlots(run.state, owner, siteId), 7);
      assert.equal(previewCommand(run.state, production).accepted, true);
      assert.equal(run.state.slices.compute.racks[movingRackId].purchaseLocation, 'colocation');
    }
    assert.deepEqual(validateState(run.state), []);
  }
});

test('W8-RC03: original batch destination, qualified yield and movement provenance cannot be rewritten after custom relocation', () => {
  const { run, siteId, movingRackId, batchId } = setup('w8-rc03');
  const id = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.until(state => state.slices.compute.rackRelocations?.[id]?.status === 'complete', 12);
  const corruptions = [
    (s: GameState) => { s.slices.compute.chipBatches[batchId].location = siteId; },
    (s: GameState) => { delete s.slices.compute.racks[movingRackId].purchaseLocation; },
    (s: GameState) => { s.slices.compute.racks[movingRackId].usableCU! += U; },
    (s: GameState) => { s.slices.compute.chipBatches[batchId].yieldBps += 1250; },
    (s: GameState) => { s.slices.compute.rackRelocations![id].originalInstalledWeek++; },
  ];
  const envelope = JSON.parse(serializeState(run.state));
  for (const corrupt of corruptions) {
    const invalid = structuredClone(run.state); corrupt(invalid);
    assert.ok(validateState(invalid).length > 0);
    assert.throws(() => serializeState(invalid));
    assert.equal(deserializeState(JSON.stringify({ ...envelope, state: invalid, checksum: canonicalStateHash(invalid) })).ok, false);
  }
});
