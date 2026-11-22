import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getBatchPlacementForecast } from '../src/modules/batch-planning';
import { batchInvoiceAmount, batchPlacementAtWeek } from '../src/modules/batch-inference';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getComputePools } from '../src/modules/compute-pools';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

type RecordedCommand = { week: number; id: string; payload: CommandPayload };
const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave15-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; commands: RecordedCommand[]; weeks: { week: number; hash: string }[];
};
function earnedCompany(): GameState {
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave15-snapshot.json'), 'utf8'));
  assert.ok(imported.ok); let state = imported.state;
  while (state.week < 522) {
    for (const command of previous.commands.filter(item => item.week === state.week)) {
      const queued = submitCommand(state, command.payload, historicalContent(state), command.id);
      assert.ok(queued.accepted, queued.reason?.message); state = queued.state;
    }
    const due = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
    const next = advanceWeek(state, historicalContent(state)); assert.ok(next.accepted, next.reason?.message); state = next.state;
    for (const command of due) assert.equal(state.commandReceipts[command.id]?.status, 'accepted', command.id);
  }
  assert.equal(canonicalStateHash({ ...state, contentVersion: previous.sourceContent, buildVersion: previous.sourceContent }), '3c90ef74');
  return upgradeHistoricalState(state);
}

test('W16-R01: moving a paid rack removes a pinned batch pool without fallback, and an explicit return to auto uses available capacity under the old deadline', () => {
  const earned = earnedCompany(), run = new NaturalBusinessCampaign(earned, 'wave16-relocation');
  const owner = earned.playerCompanyId, productId = 'product:natural-business-command-67', modelId = 'model-wave15-natural-command-9';
  const rackId = 'rack-wave8-scale-command-11', destination = 'facility-wave8-scale-command-3', poolId = 'owned:colocation:training';
  const originalRack = structuredClone(earned.slices.compute.racks[rackId]);
  assert.equal(originalRack.status, 'installed'); assert.equal(originalRack.location, 'colocation');
  assert.equal(earned.slices.compute.facilities[destination].status, 'active');
  assert.equal(getComputePools(earned, owner).find(pool => pool.id === poolId)!.rackCount, 1);
  const originalBatchIds = Object.keys(earned.slices.products.batchJobs!);
  const originalBatchHash = canonicalStateHash(originalBatchIds.map(id => earned.slices.products.batchJobs![id]));
  // Operating coverage leaves insufficient reconnect effort in the existing
  // team. Pay for a real hire early enough to finish onboarding before that stage.
  const infrastructureHireId = 'staff:' + run.queue({ kind: 'hire_staff', role: 'infrastructure' });
  run.queue({ kind: 'allocate_compute', serving: 144 * U, development: 0, research: 0 });
  const jobId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'longform-digest', modelId,
    weeklyWorkCapCUw: 16 * U, poolId });
  const requestId = `batch-serve:${jobId}`;
  const snapshots: Record<string, string> = { start: serializeState(earned) };

  function observe(at: GameState) {
    const company = at.slices.company.companies[owner], job = at.slices.products.batchJobs![jobId];
    const report = getComputeCostView(at).latest!, usage = job.usageHistory.find(row => row.week === at.week)!;
    const grant = report.resources.computeGrants.find(row => row.requestId === requestId)!;
    assert.ok(usage); assert.ok(grant);
    assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
    assert.equal(report.totals.attributedComputeCents + report.totals.sharedComputeCents, report.totals.totalComputeCents);
    assert.equal(report.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(company.arrearsCents, 0);
    assert.equal(canonicalStateHash(originalBatchIds.map(id => at.slices.products.batchJobs![id])), originalBatchHash);
    const publicService = Object.values(at.slices.products.offers).filter(product => product.companyId === owner && product.status === 'active')
      .map(product => {
        const publicUsage = at.slices.products.lastUsage[product.id];
        assert.equal(publicUsage.fulfillmentBps, 10000); assert.equal(publicUsage.creditsCents, 0);
        return { productId: product.id, fulfillmentBps: publicUsage.fulfillmentBps, billedCents: publicUsage.billedCents };
      });
    return { week: at.week, hash: canonicalStateHash(at), rack: structuredClone(at.slices.compute.racks[rackId]),
      pools: report.pools.map(pool => ({ id: pool.id, capacityCU: pool.capacityCU, memoryMU: pool.memoryMU })),
      job: { status: job.status, completedWork: job.completedWork, physicalWork: job.physicalWork,
        completedRequests: job.completedRequests, deadlineWeek: job.deadlineWeek, placement: batchPlacementAtWeek(job) },
      usage: structuredClone(usage), request: structuredClone(report.resources.requests.find(row => row.id === requestId)),
      grant: structuredClone(grant), workload: structuredClone(report.workloads.find(row => row.requestId === requestId)),
      totals: structuredClone(report.totals), publicService };
  }
  const weeks: ReturnType<typeof observe>[] = [];
  run.step(); weeks.push(observe(run.state));
  const firstJob = run.state.slices.products.batchJobs![jobId];
  const paidWork = firstJob.completedWork, physicalWork = firstJob.physicalWork, originalDeadline = firstJob.deadlineWeek;
  assert.equal(run.week, 523); assert.equal(originalDeadline, 528);
  assert.ok(paidWork > 0); assert.equal(firstJob.latestGrant!.poolId, poolId);
  snapshots['pinned-active'] = serializeState(run.state);
  const moveQuote = previewCommand(run.state, { kind: 'start_rack_relocation', rackId, destination });
  assert.ok(moveQuote.accepted, moveQuote.reason?.message); assert.equal(moveQuote.upfrontCostCents, 150_000);
  const relocationId = 'rack-relocation:' + run.queue({ kind: 'start_rack_relocation', rackId, destination });
  while (run.week < 527) {
    run.step(); const row = observe(run.state); weeks.push(row);
    assert.equal(row.grant.hardwareEffectiveCUw, 0); assert.equal(row.grant.physicalCUw, 0); assert.equal(row.grant.memoryMU, 0);
    assert.equal(row.grant.poolId, poolId); assert.equal(row.usage.poolId, null);
    assert.equal(row.job.completedWork, paidWork); assert.equal(row.job.physicalWork, physicalWork);
    assert.equal(row.job.deadlineWeek, originalDeadline); assert.equal(row.rack.status, 'parked');
  }
  const ready = run.state.slices.compute.rackRelocations![relocationId];
  assert.equal(ready.status, 'ready'); assert.equal(ready.startedWeek, 524); assert.equal(ready.readyWeek, 528);
  assert.equal(run.state.slices.company.staff[infrastructureHireId].readyWeek, 525);
  assert.equal(ready.stages.reduce((sum, stage) => sum + stage.completedStaff, 0), U);
  assert.equal(ready.paidCents, 150_000);
  assert.equal(run.state.slices.company.ledger.filter(fact => fact.id === ready.paymentId).length, 1);
  assert.equal(run.state.slices.company.postedFacts[ready.paymentId], true);
  snapshots['before-commissioning'] = serializeState(run.state);
  const reloaded = deserializeState(snapshots['before-commissioning']); assert.ok(reloaded.ok, reloaded.ok ? '' : reloaded.error);
  assert.equal(serializeState(reloaded.state), snapshots['before-commissioning']);
  const previewHash = canonicalStateHash(run.state), forecast = getBatchPlacementForecast(run.state, { jobId });
  assert.equal(canonicalStateHash(run.state), previewHash);
  assert.equal(forecast.scenarios.find(row => row.poolId === poolId)!.effectiveWorkCUw, 0);
  assert.equal(forecast.deadlineWeek, 528);

  // The first branch makes no new choice. Commissioning removes the original
  // connected pool before the last service allocation and terminal settlement.
  run.step(); const pinned = observe(run.state); weeks.push(pinned);
  const moved = run.state.slices.compute.racks[rackId], relocation = run.state.slices.compute.rackRelocations![relocationId];
  const pinnedJob = run.state.slices.products.batchJobs![jobId];
  assert.equal(moved.location, destination); assert.equal(moved.status, 'installed'); assert.equal(relocation.status, 'complete');
  assert.equal(relocation.completedWeek, originalDeadline);
  assert.equal(moved.purchaseCents, originalRack.purchaseCents); assert.equal(moved.installedWeek, originalRack.installedWeek);
  assert.equal(pinned.pools.some(pool => pool.id === poolId), false);
  assert.equal(pinned.grant.poolId, poolId); assert.equal(pinned.grant.hardwareEffectiveCUw, 0); assert.equal(pinned.grant.physicalCUw, 0);
  assert.equal(pinned.workload!.effectiveWorkCUw, 0); assert.equal(pinned.workload!.attributedComputeCents, 0);
  assert.equal(pinnedJob.completedWork, paidWork); assert.equal(pinnedJob.physicalWork, physicalWork);
  assert.equal(pinnedJob.status, 'expired'); assert.equal(pinnedJob.terminalWeek, originalDeadline);
  assert.match(pinned.usage.explanation, /selected batch pool.*no longer available/i);
  const pinnedInvoice = run.state.slices.products.batchInvoices!.find(invoice => invoice.jobId === jobId)!;
  assert.equal(pinnedInvoice.amountCents, batchInvoiceAmount(pinnedJob.terms, pinnedJob.completedRequests));
  assert.equal(pinnedInvoice.amountCents + pinnedInvoice.creditsCents, pinnedJob.quotedCents);
  assert.deepEqual(validateState(run.state), []);
  snapshots['pinned-expired'] = serializeState(run.state);
  const pinnedReload = deserializeState(snapshots['pinned-expired']); assert.ok(pinnedReload.ok, pinnedReload.ok ? '' : pinnedReload.error);
  assert.equal(serializeState(pinnedReload.state), snapshots['pinned-expired']);

  // The second branch starts from the exact same earned pre-commissioning
  // bytes. One real command restores automatic selection for the final week.
  const recovery = new NaturalBusinessCampaign(reloaded.state, 'wave16-relocation-recovery');
  const changeId = recovery.queue({ kind: 'set_batch_job_placement', jobId, poolId: 'auto' });
  recovery.step(); const restored = observe(recovery.state), recoveredJob = recovery.state.slices.products.batchJobs![jobId];
  assert.equal(restored.grant.hardwareEffectiveCUw, 16 * U);
  assert.equal(restored.grant.poolId, 'general-cloud');
  assert.ok(getComputePools(recovery.state, owner).some(pool => pool.id === restored.grant.poolId));
  assert.equal(recoveredJob.completedWork, paidWork + 16 * U);
  assert.equal(recoveredJob.deadlineWeek, originalDeadline); assert.equal(recoveredJob.terminalWeek, originalDeadline);
  assert.equal(recoveredJob.status, 'expired'); assert.equal(recoveredJob.placementHistory!.length, 2);
  assert.equal(recoveredJob.placementHistory![1].commandId, changeId); assert.equal(batchPlacementAtWeek(recoveredJob), 'auto');
  const recoveredInvoice = recovery.state.slices.products.batchInvoices!.find(invoice => invoice.jobId === jobId)!;
  assert.ok(recoveredInvoice.amountCents > pinnedInvoice.amountCents);
  assert.equal(recoveredInvoice.amountCents, batchInvoiceAmount(recoveredJob.terms, recoveredJob.completedRequests));
  assert.equal(recoveredInvoice.amountCents + recoveredInvoice.creditsCents, recoveredJob.quotedCents);
  assert.deepEqual(validateState(recovery.state), []);
  snapshots['automatic-recovery'] = serializeState(recovery.state);
  const restoredSave = deserializeState(snapshots['automatic-recovery']); assert.ok(restoredSave.ok, restoredSave.ok ? '' : restoredSave.error);
  assert.equal(serializeState(restoredSave.state), snapshots['automatic-recovery']);

  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 522, sourceHash: '3c90ef74', rackId, destination, poolId, jobId,
    infrastructureHire: structuredClone(run.state.slices.company.staff[infrastructureHireId]),
    originalDeadline, commonCommands: run.commands, recoveryCommands: recovery.commands,
    relocation, moveQuote, forecastBeforeCommissioning: forecast, weeks, pinned, recovered: restored,
    pinnedInvoice, recoveredInvoice, pinnedHash: canonicalStateHash(run.state), recoveredHash: canonicalStateHash(recovery.state),
    assertions: [
      'Exact earned Week522 continuation uses original Wave15 paid training and evaluation commands',
      'An ordinary infrastructure hire finishes onboarding before reconnect work while normal payroll and operating coverage continue',
      'The selected pool executes one paid service week before ordinary rack relocation starts',
      'Four elapsed move stages consume one infrastructure staff-week and a once-only capital fee',
      'The batch receives zero work while the selected source rack is offline and does not fall back',
      'Commissioning removes the original pool before the final service allocation; a zero grant retains its selected pool identity and valid cost evidence',
      'The retained usage explains that the selected batch pool is unavailable',
      'An explicit return to automatic placement selects available connected capacity and earns additional completed-request revenue',
      'Neither branch changes the frozen model, backlog, weekly limit, original deadline, prior paid work, or previously terminal orders',
      'Both branches retain full public service, real cost reconciliation, no arrears, once-only invoices and exact reloads',
    ] };
  if (process.env.FRONTIER_WAVE16_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE16_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE16_OUTPUT, `frontier-lab-wave16-relocation-${name}.json`), snapshot);
    writeFileSync(join(process.env.FRONTIER_WAVE16_OUTPUT, 'wave16-relocation.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ sourceWeek: 522, finalWeek: run.week, moveStarted: ready.startedWeek, moveCommissioned: relocation.completedWeek,
    originalDeadline, originalPaidWork: paidWork, pinnedRequests: pinnedJob.completedRequests, recoveredRequests: recoveredJob.completedRequests,
    pinnedInvoiceCents: pinnedInvoice.amountCents, recoveredInvoiceCents: recoveredInvoice.amountCents,
    pinnedHash: evidence.pinnedHash, recoveredHash: evidence.recoveredHash }));
});
