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
import { getComputeCostView } from '../src/modules/compute-costs';
import { batchModelEligible, batchScheduler, batchTariffEstimateCents, getBatchView } from '../src/modules/batch-inference';
import { releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W14-N01: an earned company sells spare inference, compares compression at a fixed deadline, and trains a document specialist', () => {
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave13-snapshot.json'), 'utf8'));
  assert.ok(imported.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave13-expected.json'), 'utf8')) as {
    sourceCommit: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  let earned: GameState = imported.state;
  while (earned.week < 472) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const queued = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(queued.accepted, queued.reason?.message); earned = queued.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: '0.14.0', buildVersion: '0.14.0' }), '653fbcd2');
  assert.equal(earned.slices.products.batchJobs, undefined);
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave14-natural');
  const productId = 'product:natural-business-command-67', originalProduct = earned.slices.products.offers[productId];
  const publicModelId = earned.slices.products.deployments[originalProduct.deploymentId].modelId;
  const publicModelFingerprint = releaseModelFingerprint(earned.slices.models.versions[publicModelId]);
  const feedbackFingerprint = canonicalStateHash(earned.slices.data.feedbackStudies);
  const snapshots: Record<string, string> = { start: serializeState(earned) };
  const service: object[] = [], costs: ReturnType<typeof getComputeCostView>['reports'] = [];
  const job = (id: string) => run.state.slices.products.batchJobs![id];
  const invoice = (id: string) => run.state.slices.products.batchInvoices!.find(item => item.jobId === id)!;
  const step = () => {
    const carry = run.state.slices.products.contracts[originalProduct.contractId].tokenBillRemainder ?? 0;
    run.step();
    assert.equal(run.state.slices.products.offers[productId].deploymentId, originalProduct.deploymentId);
    assert.equal(releaseModelFingerprint(run.state.slices.models.versions[publicModelId]), publicModelFingerprint);
    assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies), feedbackFingerprint);
    const usage = run.state.slices.products.lastUsage[productId];
    assert.equal(usage.tokens!.billCarryIn, carry);
    const publicInvoices = run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week);
    assert.equal(publicInvoices.length, 1); assert.equal(publicInvoices[0].amountCents, usage.billedCents);
    const report = getComputeCostView(run.state).latest!;
    assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(report.totals.attributedComputeCents + report.totals.sharedComputeCents, report.totals.totalComputeCents);
    assert.equal(report.totals.companyRevenueCents, run.company.lastWeek.revenueCents);
    for (const bill of (run.state.slices.products.batchInvoices ?? []).filter(item => item.week === run.week)) {
      assert.equal(report.ledgerFacts.filter(fact => fact.id === bill.id).length, 1);
      assert.equal(report.targets.filter(target => target.kind === 'batch-inference' && target.sourceId === bill.jobId).length, 1);
      assert.equal(bill.amountCents + bill.creditsCents, bill.grossCents);
      assert.ok(!publicInvoices.some(item => item.id === bill.id));
    }
    costs.push(report);
    service.push({ week: run.week, publicApi: { paidAccounts: usage.paidAccounts, fulfillmentBps: usage.fulfillmentBps,
      billedCents: usage.billedCents, inputTokens: usage.tokens!.inputTokens, outputTokens: usage.tokens!.outputTokens,
      billCarryIn: usage.tokens!.billCarryIn, billCarryOut: usage.tokens!.billCarryOut },
      batch: Object.values(run.state.slices.products.batchJobs ?? {}).filter(item => item.usageHistory.at(-1)?.week === run.week)
        .map(item => ({ jobId: item.id, orderId: item.orderId, modelId: item.model.modelId, ...item.usageHistory.at(-1)! })) });
  };
  const until = (predicate: () => boolean, limit: number, label: string) => {
    const started = run.week;
    while (!predicate() && run.week - started < limit) step();
    assert.ok(predicate(), `${label} not reached after ${limit} ordinary weeks.`);
  };
  const untilWeek = (week: number) => { until(() => run.week >= week, week - run.week, `Week ${week}`); assert.equal(run.week, week); };
  const evaluate = (modelId: string, suiteId: 'expanded-capabilities-1' | 'policy-boundaries-1') => {
    run.queue({ kind: 'evaluate_model', modelId, suiteId });
    until(() => Object.values(run.state.slices.models.reports).some(report => report.modelId === modelId && report.suiteId === suiteId), 10, suiteId);
  };
  const train = (options: Omit<Extract<CommandPayload, { kind: 'start_training' }>, 'kind'>) => {
    const id = 'training-' + run.queue({ kind: 'start_training', ...options });
    until(() => run.state.slices.models.trainingRuns[id]?.status === 'complete', 30, options.recipeId!);
    return run.state.slices.models.trainingRuns[id].outputModelId;
  };

  run.queue({ kind: 'install_batch_scheduler' });
  const compressedId = 'variant:' + run.queue({ kind: 'create_model_variant', modelId: publicModelId, variant: 'compression' });
  until(() => batchScheduler(run.state)?.status === 'active' && !!run.state.slices.models.versions[compressedId], 6, 'Paid batch scheduler and compression');
  assert.equal(run.week, 475);
  const archiveId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'archive-tagging', modelId: publicModelId, weeklyWorkCapCUw: 8 * U });
  evaluate(compressedId, 'expanded-capabilities-1');
  assert.equal(batchModelEligible(run.state, compressedId, 'code-index'), false, 'A new compressed policy model needs its own paid policy holdout.');
  evaluate(compressedId, 'policy-boundaries-1');
  assert.equal(run.week, 477);
  assert.equal(batchModelEligible(run.state, compressedId, 'code-index'), true);
  assert.equal(batchModelEligible(run.state, compressedId, 'archive-tagging'), false, 'The compression score loss also makes a real eligibility tradeoff.');
  snapshots['scheduler-ready'] = serializeState(run.state);
  run.mark('Paid scheduler and exact compressed-model reports unlock a separate batch service without replacing the live API');

  const plainCodeId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'code-index', modelId: publicModelId, weeklyWorkCapCUw: 8 * U });
  const compressedCodeId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'code-index', modelId: compressedId, weeklyWorkCapCUw: 8 * U });
  step();
  assert.equal(job(plainCodeId).requiredWork, 60 * U);
  assert.equal(job(compressedCodeId).requiredWork, 48 * U);
  assert.equal(job(plainCodeId).deadlineWeek, job(compressedCodeId).deadlineWeek);
  untilWeek(job(plainCodeId).deadlineWeek);
  assert.equal(job(archiveId).status, 'completed'); assert.equal(invoice(archiveId).amountCents, 650_000);
  assert.equal(job(plainCodeId).status, 'expired'); assert.equal(job(plainCodeId).completedRequests, 48_000);
  assert.equal(invoice(plainCodeId).amountCents, 1_200_000); assert.equal(invoice(plainCodeId).creditsCents, 300_000);
  assert.equal(job(compressedCodeId).status, 'completed'); assert.equal(job(compressedCodeId).completedRequests, 60_000);
  assert.equal(invoice(compressedCodeId).amountCents, 1_500_000); assert.equal(invoice(compressedCodeId).creditsCents, 0);
  assert.equal(job(plainCodeId).completedWork, job(compressedCodeId).completedWork);
  assert.ok(job(plainCodeId).physicalWork > 0 && job(plainCodeId).physicalWork <= job(plainCodeId).completedWork);
  assert.ok(job(compressedCodeId).physicalWork > 0 && job(compressedCodeId).physicalWork <= job(compressedCodeId).completedWork);
  snapshots['compression-comparison'] = serializeState(run.state);
  run.mark('Equal weekly limits and normalized work finish all compressed requests; the original model misses 12,000 requests and credits $3,000 while actual GPU pools retain their own cost receipts');

  const cancelledId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'archive-tagging', modelId: publicModelId, weeklyWorkCapCUw: 4 * U });
  step(); const originalDeadline = job(cancelledId).deadlineWeek;
  assert.equal(job(cancelledId).completedRequests, 6153);
  run.queue({ kind: 'set_batch_job_paused', jobId: cancelledId, paused: true }); step();
  assert.equal(job(cancelledId).usageHistory.at(-1)!.executedWorkCUw, 0);
  assert.equal(job(cancelledId).usageHistory.at(-1)!.staffGranted, 0);
  assert.equal(job(cancelledId).deadlineWeek, originalDeadline);
  run.queue({ kind: 'set_batch_job_paused', jobId: cancelledId, paused: false }); step();
  assert.equal(job(cancelledId).usageHistory.at(-1)!.completedRequests, 6154, 'A partial request carries into the next working week.');
  run.queue({ kind: 'cancel_batch_job', jobId: cancelledId }); step();
  assert.equal(job(cancelledId).status, 'cancelled'); assert.equal(job(cancelledId).completedRequests, 12_307);
  assert.equal(invoice(cancelledId).amountCents, 199_988); assert.equal(invoice(cancelledId).creditsCents, 450_012);
  assert.equal(job(cancelledId).deadlineWeek, originalDeadline);
  snapshots.cancelled = serializeState(run.state);
  const cancelledInvoiceFingerprint = canonicalStateHash(invoice(cancelledId));
  run.mark('Pausing releases work and handling, the deadline stays fixed, fractional request work carries, and ending pays only completed tokens once');

  const documentPacketId = run.bestPacket('specialist-documents-1').id;
  assert.equal(run.bestPacket('specialist-documents-1').qualityBps, 9500);
  const adaptedDocumentsId = train({ recipeId: 'document-adaptation', baseModelId: publicModelId, packetId: documentPacketId, profile: 'stable' });
  const documentsId = train({ recipeId: 'behavior-reliability', baseModelId: adaptedDocumentsId, packetId: documentPacketId, profile: 'stable' });
  assert.equal(batchModelEligible(run.state, documentsId, 'longform-digest'), false);
  evaluate(documentsId, 'expanded-capabilities-1'); evaluate(documentsId, 'policy-boundaries-1');
  assert.equal(batchModelEligible(run.state, documentsId, 'longform-digest'), true);
  const documentModel = run.state.slices.models.versions[documentsId];
  assert.equal(documentModel.family, 'compact'); assert.ok(documentModel.capabilityBps.documents >= 5500); assert.ok(documentModel.reliabilityBps >= 9000);
  snapshots['document-specialist'] = serializeState(run.state);
  // Current public demand leaves too little compatible residual cloud capacity
  // for a six-week digest. Buy it through the normal boundary before promising
  // the deadline; completed lab work no longer needs a separate allocation.
  run.queue({ kind: 'set_cloud_capacity', cu: run.fleet.cloudCU + 16 * U });
  step();
  run.queue({ kind: 'allocate_compute', serving: run.fleet.cloudCU + run.fleet.ownedCU, development: 0, research: 0 });
  const digestId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'longform-digest', modelId: documentsId, weeklyWorkCapCUw: 16 * U });
  step(); untilWeek(job(digestId).deadlineWeek);
  assert.equal(job(digestId).requiredWork, 90 * U); assert.equal(job(digestId).status, 'completed', JSON.stringify({
    completed: job(digestId).completedWork, cloud: run.fleet.cloudCU, allocation: run.fleet.allocation,
    grants: job(digestId).usageHistory.map(row => ({ week: row.week, work: row.executedWorkCUw, staff: row.staffGranted, reason: row.explanation })),
  }));
  assert.equal(invoice(digestId).amountCents, 2_250_000); assert.equal(invoice(digestId).creditsCents, 0);
  assert.equal(canonicalStateHash(invoice(cancelledId)), cancelledInvoiceFingerprint);
  assert.equal(run.state.slices.products.batchInvoices!.filter(item => item.jobId === cancelledId).length, 1);
  assert.equal(getBatchView(run.state).activeJobs, 0);
  assert.equal(getBatchView(run.state).board.find(item => item.id === 'archive-tagging')!.remainingClaims, 1);
  run.mark('Existing curated document data, paid adaptation, reliability tuning and fresh reports produce a compact specialist that completes the larger digest order');

  assert.deepEqual(validateState(run.state), []);
  const final = serializeState(run.state), reopened = deserializeState(final);
  assert.ok(reopened.ok, reopened.ok ? '' : reopened.error); assert.equal(serializeState(reopened.state), final);
  snapshots.complete = final;
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 472, sourceHash: '653fbcd2',
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(final),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, productId, publicModelId, compressedId, documentsId,
    commands: run.commands, milestones: run.milestones, scheduler: batchScheduler(run.state),
    jobs: run.state.slices.products.batchJobs, invoices: run.state.slices.products.batchInvoices,
    tariffs: Object.values(run.state.slices.products.batchJobs!).map(item => ({ jobId: item.id, physicalWorkCUw: item.physicalWork, estimatedGpuCents: batchTariffEstimateCents(item) })),
    service, costs, assertions: [
      'Authentic published Wave13 company continues through ordinary paid commands without direct resource grants',
      'The scheduler needs paid implementation and next-boundary activation; accepted jobs use existing paying API customers',
      'Exact compressed-model capability and policy reports are required; the quality penalty can lose order eligibility',
      'The same normalized work and weekly cap finish a compressed code order while the original model expires with a proportional credit; physical GPU receipts retain the real pool differences',
      'Public API model and token carry remain independent, and batch jobs add no consented feedback study',
      'Pausing releases GPU and commercial effort but does not extend the deadline; fractional request effort carries',
      'Cancellation settles completed requests exactly once and preserves its receipt through later training and settlement',
      'Paid document adaptation, reliability tuning and fresh reports unlock a profitable larger batch without replacing the live API',
      'Every week reconciles compute and revenue to the company ledger; the final compact save reloads byte-for-byte',
    ] };
  if (process.env.FRONTIER_WAVE14_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE14_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE14_OUTPUT, `frontier-lab-wave14-${name}.json`), snapshot);
    writeFileSync(join(process.env.FRONTIER_WAVE14_OUTPUT, 'wave14-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ finalWeek: run.week, finalHash: evidence.finalHash, commands: run.commands.length,
    snapshotBytes: evidence.snapshotBytes, batchBilledCents: evidence.invoices!.reduce((n, item) => n + item.amountCents, 0),
    batchCreditsCents: evidence.invoices!.reduce((n, item) => n + item.creditsCents, 0), finalCashCents: run.cash, minimumCashCents: run.minimumCashCents }));
});
