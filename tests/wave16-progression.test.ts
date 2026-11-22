import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getBatchPlacementForecast } from '../src/modules/batch-planning';
import { getBatchView } from '../src/modules/batch-inference';
import { getComputePools } from '../src/modules/compute-pools';
import { getComputeCostView } from '../src/modules/compute-costs';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

type RecordedCommand = { week: number; id: string; payload: CommandPayload };
const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave15-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceTree: string; sourceContent: string; commands: RecordedCommand[];
  naturalProgression: { finalWeek: number; finalHash: string };
};
function earnedCompany(): GameState {
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave15-snapshot.json'), 'utf8'));
  assert.ok(imported.ok); let state = imported.state;
  while (state.week < 535) {
    for (const command of previous.commands.filter(item => item.week === state.week)) {
      const queued = submitCommand(state, command.payload, historicalContent(state), command.id);
      assert.ok(queued.accepted, queued.reason?.message); state = queued.state;
    }
    const due = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
    const next = advanceWeek(state, historicalContent(state)); assert.ok(next.accepted, next.reason?.message); state = next.state;
    for (const command of due) assert.equal(state.commandReceipts[command.id]?.status, 'accepted', command.id);
  }
  assert.equal(canonicalStateHash({ ...state, contentVersion: previous.sourceContent, buildVersion: previous.sourceContent }), '9a5b6de8');
  return upgradeHistoricalState(state);
}

test('W16-N01: an earned company compares paid cloud and owned placement, then reduces rent and fulfills its final archive claim with real GPU work', () => {
  const earned = earnedCompany(), companyId = earned.playerCompanyId;
  const productId = 'product:natural-business-command-67', modelId = 'model-wave15-natural-command-9';
  const originalProduct = earned.slices.products.offers[productId], originalDeployment = earned.slices.products.deployments[originalProduct.deploymentId];
  const publicModel = earned.slices.models.versions[originalDeployment.modelId];
  const originalBatchIds = Object.keys(earned.slices.products.batchJobs!);
  const originalBatchHash = canonicalStateHash(originalBatchIds.map(id => earned.slices.products.batchJobs![id]));
  const originalFeedbackHash = canonicalStateHash(earned.slices.data.feedbackStudies);
  const ownedPoolId = 'owned:colocation:training';
  const ownedPool = getComputePools(earned, companyId).find(pool => pool.id === ownedPoolId)!;
  assert.ok(ownedPool); assert.equal(ownedPool.nominalCU, 8 * U); assert.equal(ownedPool.servingBps, 11000);
  assert.equal(originalBatchIds.length, 8);
  assert.equal(earned.slices.compute.fleets[companyId].cloudCU, 96 * U);
  assert.equal(getBatchView(earned).board.find(order => order.id === 'archive-tagging')!.remainingClaims, 1);
  const choices = { productId, orderId: 'archive-tagging' as const, modelId, weeklyWorkCapCUw: 16 * U };
  const beforeComparison = canonicalStateHash(earned);
  const initialCloud = getBatchPlacementForecast(earned, { ...choices, cloudCU: 96 * U, servingCU: 160 * U });
  const initialOwned = getBatchPlacementForecast(earned, { ...choices, cloudCU: 80 * U, servingCU: 144 * U });
  assert.equal(canonicalStateHash(earned), beforeComparison);
  assert.ok(initialCloud.available && initialCloud.capacityPlanValid, initialCloud.reason ?? initialCloud.capacityPlanReason ?? 'cloud comparison');
  assert.ok(initialOwned.available && initialOwned.capacityPlanValid, initialOwned.reason ?? initialOwned.capacityPlanReason ?? 'owned comparison');
  assert.equal(initialCloud.scenarios.find(row => row.poolId === 'general-cloud')!.completedRequests, 40_000);
  assert.equal(initialOwned.scenarios.find(row => row.poolId === ownedPoolId)!.completedRequests, 40_000);
  assert.ok(initialOwned.scenarios.find(row => row.poolId === 'general-cloud')!.completedRequests < 40_000);

  function branch(kind: 'owned' | 'cloud') {
    const run = new NaturalBusinessCampaign(structuredClone(earned), kind === 'owned' ? 'wave16-natural' : 'wave16-cloud-comparison');
    const poolId = kind === 'owned' ? ownedPoolId : 'general-cloud';
    let jobId: string | null = null;
    const snapshots: Record<string, string> = { start: serializeState(run.state) };
    const weeks: ReturnType<typeof settle>[] = [];
    function settle() {
      const carry = run.state.slices.products.contracts[originalProduct.contractId].tokenBillRemainder;
      run.step();
      const report = getComputeCostView(run.state).latest!, usage = run.state.slices.products.lastUsage[productId];
      assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
      assert.equal(report.totals.attributedComputeCents + report.totals.sharedComputeCents, report.totals.totalComputeCents);
      assert.equal(report.totals.companyRevenueCents, run.company.lastWeek.revenueCents);
      assert.equal(usage.tokens!.billCarryIn, carry);
      assert.deepEqual(run.state.slices.products.deployments[originalProduct.deploymentId], originalDeployment);
      assert.deepEqual(run.state.slices.models.versions[originalDeployment.modelId], publicModel);
      assert.equal(canonicalStateHash(originalBatchIds.map(id => run.state.slices.products.batchJobs![id])), originalBatchHash);
      assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies), originalFeedbackHash);
      const publicService = run.offers().filter(offer => offer.status === 'active').map(offer => {
        const paid = run.state.slices.products.lastUsage[offer.id];
        assert.equal(paid.week, run.week); assert.equal(paid.fulfillmentBps, 10000, `${kind}: ${offer.name} lost service in Week ${run.week}`);
        assert.equal(paid.creditsCents, 0);
        return { productId: offer.id, paidAccounts: paid.paidAccounts, fulfillmentBps: paid.fulfillmentBps, billedCents: paid.billedCents };
      });
      const job = jobId ? run.state.slices.products.batchJobs![jobId] : null;
      const batchUsage = job?.usageHistory.find(row => row.week === run.week);
      const work = jobId ? report.workloads.find(item => item.requestId === `batch-serve:${jobId}`) : null;
      return { week: run.week, cashCents: run.cash, totals: structuredClone(report.totals), publicService,
        job: job ? { id: job.id, status: job.status, completedRequests: job.completedRequests, completedWork: job.completedWork,
          physicalWork: job.physicalWork, invoiceId: job.invoiceId } : null,
        batch: { requestedWorkCUw: batchUsage?.requestedWorkCUw ?? 0, effectiveWorkCUw: batchUsage?.executedWorkCUw ?? 0,
          physicalWorkCUw: batchUsage?.physicalWorkCUw ?? 0, actualPoolId: batchUsage?.poolId ?? null,
          staffGranted: batchUsage?.staffGranted ?? 0, memoryMU: batchUsage?.memoryMU ?? 0,
          completedRequests: batchUsage?.completedRequests ?? 0, ownedVariableCents: work?.ownedVariableCents ?? 0,
          cloudWorkRentCents: work?.cloudRentCents ?? 0 } };
    }
    if (kind === 'owned') run.queue({ kind: 'set_batch_capacity', cloudCU: 80 * U, servingCU: 144 * U });
    weeks.push(settle());
    assert.equal(run.week, 536);
    const comparisonHash = canonicalStateHash(run.state);
    const forecast = getBatchPlacementForecast(run.state, choices), selected = forecast.scenarios.find(row => row.poolId === poolId)!;
    assert.equal(canonicalStateHash(run.state), comparisonHash);
    assert.ok(forecast.available && selected.compatible, selected?.reason ?? forecast.reason ?? 'new order comparison');
    assert.equal(forecast.horizonWeeks, 4); assert.equal(selected.completedRequests, 40_000);
    assert.equal(selected.projectedInvoiceCents, 650_000); assert.equal(selected.projectedCreditsCents, 0);
    assert.equal(selected.additionalCloudReservationCents, 0);
    snapshots['capacity-ready'] = serializeState(run.state);
    jobId = 'batch:' + run.queue({ kind: 'accept_batch_job', ...choices, poolId });
    while (run.week < 540) {
      const row = settle(); weeks.push(row);
      const predicted = selected.rows.find(item => item.week === run.week)!;
      // In this earned example both plans have enough headroom to retain the
      // same grants despite normal customer changes. Other comparisons remain conditional.
      assert.equal(row.batch.effectiveWorkCUw, predicted.effectiveWorkCUw);
      assert.equal(row.batch.physicalWorkCUw, predicted.physicalWorkCUw);
      assert.equal(row.batch.actualPoolId, predicted.actualPoolId);
      assert.equal(row.batch.staffGranted, predicted.staffGranted);
      assert.equal(row.batch.memoryMU, predicted.memoryMU);
      assert.ok(Math.abs(row.batch.ownedVariableCents - predicted.ownedVariableCents) <= 1);
      if (row.week === 537) {
        snapshots['active-order'] = serializeState(run.state);
        const restored = deserializeState(snapshots['active-order']); assert.ok(restored.ok, restored.ok ? '' : restored.error);
        assert.equal(serializeState(restored.state), snapshots['active-order']); run.state = restored.state;
        const ongoing = getBatchPlacementForecast(run.state, { jobId });
        assert.equal(ongoing.currentPlacementPoolId, poolId); assert.equal(ongoing.deadlineWeek, 540);
      }
    }
    const job = run.state.slices.products.batchJobs![jobId];
    const invoice = run.state.slices.products.batchInvoices!.find(item => item.jobId === jobId)!;
    assert.equal(job.status, 'completed'); assert.equal(job.completedRequests, 40_000); assert.equal(job.requiredWork, 26 * U);
    assert.equal(job.terminalWeek, selected.completionWeek); assert.equal(job.physicalWork, selected.physicalWorkCUw);
    assert.equal(invoice.amountCents, 650_000); assert.equal(invoice.creditsCents, 0);
    assert.equal(run.state.slices.products.batchInvoices!.filter(item => item.jobId === jobId).length, 1);
    assert.equal(job.placementHistory!.length, 1); assert.equal(job.placementHistory![0].poolId, poolId);
    assert.equal(run.state.slices.company.postedFacts[invoice.id], true);
    assert.equal(getBatchView(run.state).board.find(order => order.id === 'archive-tagging')!.remainingClaims, 0);
    assert.equal(Object.keys(run.state.slices.products.batchJobs!).length, 9);
    assert.deepEqual(validateState(run.state), []);
    const final = serializeState(run.state), reopened = deserializeState(final);
    assert.ok(reopened.ok, reopened.ok ? '' : reopened.error); assert.equal(serializeState(reopened.state), final);
    snapshots.complete = final;
    const sum = (pick: (row: typeof weeks[number]) => number) => weeks.reduce((total, row) => total + pick(row), 0);
    const evidence = { kind, poolId, sourceWeek: earned.week, finalWeek: run.week, finalHash: canonicalStateHash(run.state),
      snapshotBytes: Buffer.byteLength(final), cashCents: run.cash, minimumCashCents: run.minimumCashCents, commands: run.commands,
      forecast, selected, job, invoice, weeks,
      totals: { cloudReservationCents: sum(row => row.totals.cloudRentCents), companyOperatingCents: sum(row => row.totals.companyOperatingCents),
        companyRevenueCents: sum(row => row.totals.companyRevenueCents), ownedBatchVariableCents: sum(row => row.batch.ownedVariableCents),
        cloudBatchAttributedCents: sum(row => row.batch.cloudWorkRentCents) } };
    if (process.env.FRONTIER_WAVE16_OUTPUT) {
      mkdirSync(process.env.FRONTIER_WAVE16_OUTPUT, { recursive: true });
      for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE16_OUTPUT, `frontier-lab-wave16-${kind}-${name}.json`), snapshot);
    }
    return evidence;
  }
  const cloud = branch('cloud'), selected = branch('owned');
  assert.equal(selected.commands.length, 2); assert.equal(cloud.commands.length, 1);
  assert.equal(selected.totals.cloudReservationCents, 8_000_000); assert.equal(cloud.totals.cloudReservationCents, 9_600_000);
  assert.ok(selected.totals.ownedBatchVariableCents > 0); assert.equal(cloud.totals.ownedBatchVariableCents, 0);
  assert.equal(selected.totals.cloudBatchAttributedCents, 0); assert.ok(cloud.totals.cloudBatchAttributedCents > 0);
  assert.equal(selected.totals.companyRevenueCents, cloud.totals.companyRevenueCents);
  assert.ok(selected.totals.companyOperatingCents < cloud.totals.companyOperatingCents);
  assert.ok(selected.cashCents > cloud.cashCents);
  const evidence = { sourceCommit: previous.sourceCommit, sourceTree: previous.sourceTree, sourceWeek: 535, sourceHash: '9a5b6de8',
    finalWeek: selected.finalWeek, finalHash: selected.finalHash, snapshotBytes: selected.snapshotBytes, productId, modelId,
    selectedPlan: 'owned', initialComparisons: { cloud: initialCloud, lowerReservation: initialOwned }, selected, cloudComparison: cloud,
    measuredSavingsCents: cloud.totals.companyOperatingCents - selected.totals.companyOperatingCents,
    costBoundary: 'Each branch starts from the same earned company and uses ordinary commands. The comparison covers Weeks536–540, including the capacity-change week. Cloud-work attribution is part of reservation rent and is never added again. Existing payroll, facility upkeep and public usage are included in the company totals, not called batch profit.',
    assertions: [
      'Authentic Week511 replay fixture reaches the exact published Week535 state with original ordinary commands',
      'Both alternative plans start from the same company without grants or merging counterfactual revenues',
      'Read-only comparisons preserve the entire source state and named randomness',
      'The selected atomic command reduces cloud rent and serving allocation together at the next boundary',
      'The selected archive binds an explicit connected owned pool and preserves its finite original deadline',
      'The refreshed comparison matches actual GPU, memory, commercial handling and completion in this earned scenario',
      'All three public products keep full service, exact public billing carry and their original deployments',
      'Both branches earn one correct final invoice and retain the original eight terminal orders unchanged',
      'Owned variable costs and attributed cloud work are reconciled separately from full reservation rent',
      'The selected company has lower measured operating expenses over the common horizon and no arrears',
      'Active and completed saves reload byte-for-byte',
    ] };
  if (process.env.FRONTIER_WAVE16_OUTPUT) writeFileSync(join(process.env.FRONTIER_WAVE16_OUTPUT, 'wave16-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ finalWeek: selected.finalWeek, finalHash: selected.finalHash, commands: selected.commands.length,
    selectedCompletion: selected.job.terminalWeek, cloudCompletion: cloud.job.terminalWeek, invoiceCents: selected.invoice.amountCents,
    ownedPhysicalCUw: selected.job.physicalWork, ownedVariableCents: selected.totals.ownedBatchVariableCents,
    cloudAttributedCents: cloud.totals.cloudBatchAttributedCents, selectedReservationCents: selected.totals.cloudReservationCents,
    comparisonReservationCents: cloud.totals.cloudReservationCents, measuredSavingsCents: evidence.measuredSavingsCents,
    finalCashCents: selected.cashCents, snapshotBytes: selected.snapshotBytes }));
});
