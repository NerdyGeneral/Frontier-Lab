import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputePools, getInfrastructureBaseCost, getSiteEnvelope } from '../src/modules/compute-pools';
import { getComputeCostView } from '../src/modules/compute-costs';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { paidScaleCompany } from './fixtures/wave8-scale';

test('W8-N01: an earned company funds physical expansion, moves its existing rack and reconciles a lower cloud bill', () => {
  const initial = paidScaleCompany(), run = new NaturalBusinessCampaign(initial.state, 'wave8-natural');
  const owner = run.state.playerCompanyId, { siteId, movingRackId } = initial;
  run.queue({ kind: 'start_system_rollout', method: 'cost-accounting' });
  run.until(state => !!getComputeCostView(state).latest, 10, 'paid operating cost meter');
  const baseline = structuredClone(getComputeCostView(run.state).latest!);
  const beforeExtensions = serializeState(run.state);
  const baselinePool = getComputePools(run.state).find(pool => pool.location === siteId)!;
  run.mark('Settled costs recorded before site extensions');

  const powerId = 'facility-retrofit-' + run.queue({ kind: 'start_facility_retrofit', facilityId: siteId, retrofitKind: 'power-feed' });
  run.until(state => state.slices.compute.facilityRetrofits?.[powerId]?.status === 'active', 12, 'power feed extension');
  const powerOnly = getComputePools(run.state).find(pool => pool.location === siteId)!;
  assert.equal(powerOnly.capacityCU, baselinePool.capacityCU);
  assert.match(powerOnly.bottleneck, /cooling/i);
  const coolingId = 'facility-retrofit-' + run.queue({ kind: 'start_facility_retrofit', facilityId: siteId, retrofitKind: 'cooling-loop' });
  run.until(state => state.slices.compute.facilityRetrofits?.[coolingId]?.status === 'active', 12, 'cooling loop expansion');
  const both = getComputePools(run.state).find(pool => pool.location === siteId)!;
  assert.equal(both.nominalCU, 56 * U); assert.equal(both.capacityCU, 56 * U);
  assert.equal(getSiteEnvelope(run.state, siteId).powerLimit, 112 * U);
  assert.equal(getSiteEnvelope(run.state, siteId).coolingLimit, 112 * U);
  run.mark('Both site envelopes commissioned; existing racks fully usable');

  const originalRack = structuredClone(run.state.slices.compute.racks[movingRackId]);
  const fixedBeforeMove = getInfrastructureBaseCost(run.state);
  const beforeRelocation = serializeState(run.state);
  const precedingReport = structuredClone(getComputeCostView(run.state).latest!);
  const relocationId = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId: movingRackId, destination: siteId });
  run.step();
  const offline = getComputePools(run.state).find(pool => pool.location === 'colocation')!;
  assert.equal(offline.capacityCU, 0); assert.equal(offline.memoryMU, 0);
  run.until(state => state.slices.compute.rackRelocations?.[relocationId]?.status === 'complete', 12, 'paid relocation');
  const moved = run.state.slices.compute.racks[movingRackId];
  assert.equal(moved.location, siteId); assert.equal(moved.purchaseCents, originalRack.purchaseCents);
  assert.equal(moved.installedWeek, originalRack.installedWeek); assert.equal(moved.purchaseLocation, 'colocation');
  assert.equal(getInfrastructureBaseCost(run.state), fixedBeforeMove - 12_000);
  const retainedReport = getComputeCostView(run.state).reports.find(report => report.week === precedingReport.week)!;
  assert.equal(canonicalStateHash(retainedReport), canonicalStateHash(precedingReport), 'Moving hardware must not rewrite settled tariffs or placement.');
  const finalPool = getComputePools(run.state).find(pool => pool.location === siteId)!;
  assert.equal(finalPool.capacityCU, 64 * U); assert.equal(finalPool.memoryMU, 128 * U);
  run.mark('Existing colocation rack commissioned in the owned facility');

  run.founder('commercial');
  run.queue({ kind: 'allocate_compute', serving: 100 * U, development: 6 * U, research: 6 * U }); run.step();
  run.queue({ kind: 'set_cloud_capacity', cu: 56 * U }); run.step(3);
  const finalReport = getComputeCostView(run.state).latest!, totals = finalReport.totals;
  assert.equal(totals.cloudRentCents, 1_120_000);
  assert.ok(totals.cloudRentCents < baseline.totals.cloudRentCents);
  assert.ok(totals.ownedVariableCents > 0, 'Owned hardware still incurs a real physical-work charge.');
  assert.equal(totals.attributedComputeCents + totals.sharedComputeCents, totals.totalComputeCents);
  assert.equal(totals.totalComputeCents + totals.otherOperatingCents, totals.companyOperatingCents);
  assert.equal(totals.companyOperatingCents, run.company.lastWeek.operatingExpenseCents);
  assert.equal(totals.companyRevenueCents, run.company.lastWeek.revenueCents);
  assert.ok(totals.operatingSurplusCents > 0);
  assert.ok(finalReport.targets.some(target => target.kind === 'weight-license'));
  const licenseTargets = new Set(finalReport.targets.filter(target => target.kind === 'weight-license').map(target => target.id));
  assert.ok(finalReport.workloads.filter(workload => licenseTargets.has(workload.targetId)).every(workload => workload.physicalWorkCUw === 0), 'Customer-hosted runtime is not billed as company inference.');
  const service = Object.values(run.state.slices.products.lastUsage).filter(usage => run.state.slices.products.offers[usage.productId]?.companyId === owner)
    .map(usage => ({ productId: usage.productId, fulfillmentBps: usage.fulfillmentBps, paidAccounts: usage.paidAccounts, billedCents: usage.billedCents }));
  assert.ok(service.length >= 2); assert.ok(service.every(usage => usage.fulfillmentBps === 10000), JSON.stringify(service));
  assert.deepEqual(validateState(run.state, CONTENT), []);
  const snapshot = serializeState(run.state), loaded = deserializeState(snapshot); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.ok(Buffer.byteLength(snapshot) < 2_000_000);
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(run.state));
  run.mark('Cloud reservation reduced; actual owned work and all expenses reconciled');

  const evidence = {
    sourceCommit: '8fb429ad34c58da2ff323edd030220143a336982', originalWeek: initial.originalWeek, originalChecksum: initial.originalChecksum,
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(snapshot),
    cashCents: run.cash, minimumCashCents: Math.min(initial.minimumCashCents, run.minimumCashCents),
    commands: [...initial.commands, ...run.commands], milestones: [...initial.milestones, ...run.milestones],
    siteId, movingRackId, powerId, coolingId, relocationId,
    capacity: { beforeSiteCU: baselinePool.capacityCU / U, afterPowerCU: powerOnly.capacityCU / U, afterBothCU: both.capacityCU / U,
      finalSiteCU: finalPool.capacityCU / U, finalSiteMU: finalPool.memoryMU / U, finalSlotsCU: 64, finalEnvelope: getSiteEnvelope(run.state, siteId) },
    relocation: { originalRack, movedRack: moved, receipt: run.state.slices.compute.rackRelocations![relocationId], fixedBeforeCents: fixedBeforeMove, fixedAfterCents: getInfrastructureBaseCost(run.state) },
    costs: { baseline, final: finalReport }, service,
    assertions: ['No granted cash, staff, research, data, models or physical assets', 'All player commands admitted and committed; no arrears',
      'Power and cooling act independently on purchased hardware', 'Relocation preserves purchase and installation evidence while taking the rack offline',
      'Historical cost receipts stay immutable after relocation', 'Whole-cent assigned and shared costs reconcile to settled expenses',
      'Customer-hosted inference stays on buyer compute', 'Paid public products remain fully served after cloud reduction'],
  };
  if (process.env.FRONTIER_WAVE8_OUTPUT) {
    const dir = process.env.FRONTIER_WAVE8_OUTPUT; mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'frontier-lab-wave8-before-extensions.json'), beforeExtensions + '\n');
    writeFileSync(join(dir, 'frontier-lab-wave8-before-relocation.json'), beforeRelocation + '\n');
    writeFileSync(join(dir, 'frontier-lab-wave8-complete.json'), snapshot + '\n');
    writeFileSync(join(dir, 'wave8-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
