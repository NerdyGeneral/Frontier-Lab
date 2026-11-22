import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, TrainingRun } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getComputeCostView } from '../src/modules/compute-costs';
import { batchModelEligible } from '../src/modules/batch-inference';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W15-N01: an earned company pays to retain coding during document adaptation, then sells both kinds of batch work', () => {
  const imported = loadHistoricalSnapshot(readFileSync(join(__dirname, 'fixtures/wave14-snapshot.json'), 'utf8'));
  assert.ok(imported.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave14-expected.json'), 'utf8')) as {
    sourceCommit: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  let earned: GameState = imported.state;
  while (earned.week < 500) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const queued = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(queued.accepted, queued.reason?.message); earned = queued.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: '0.15.0', buildVersion: '0.15.0' }), '38350449');
  assert.ok(!Object.values(earned.slices.models.trainingRuns).some(item => item.plan?.replay));
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave15-natural');
  const productId = 'product:natural-business-command-67', originalProduct = earned.slices.products.offers[productId];
  const publicModelId = earned.slices.products.deployments[originalProduct.deploymentId].modelId;
  const publicFingerprint = releaseModelFingerprint(earned.slices.models.versions[publicModelId]);
  const originalBatchIds = Object.keys(earned.slices.products.batchJobs!);
  const originalBatchFingerprint = canonicalStateHash(originalBatchIds.map(id => earned.slices.products.batchJobs![id]));
  const feedbackFingerprint = canonicalStateHash(earned.slices.data.feedbackStudies);
  const snapshots: Record<string, string> = { start: serializeState(earned) };
  const weeks: object[] = [], trainingCosts: Record<string, { physicalCUw: number; ownedVariableCents: number; cloudRentCents: number }> = {};
  const researchFacts: object[] = [];
  const step = () => {
    const carry = run.state.slices.products.contracts[originalProduct.contractId].tokenBillRemainder ?? 0;
    run.step();
    assert.equal(run.state.slices.products.offers[productId].deploymentId, originalProduct.deploymentId);
    assert.equal(releaseModelFingerprint(run.state.slices.models.versions[publicModelId]), publicFingerprint);
    assert.equal(canonicalStateHash(originalBatchIds.map(id => run.state.slices.products.batchJobs![id])), originalBatchFingerprint);
    assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies), feedbackFingerprint);
    const usage = run.state.slices.products.lastUsage[productId];
    assert.equal(usage.tokens!.billCarryIn, carry);
    const report = getComputeCostView(run.state).latest!;
    assert.equal(report.totals.totalComputeCents + report.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(report.totals.attributedComputeCents + report.totals.sharedComputeCents, report.totals.totalComputeCents);
    assert.equal(report.totals.companyRevenueCents, run.company.lastWeek.revenueCents);
    for (const workload of report.workloads.filter(item => item.requestId.startsWith('training-wave15-natural-'))) {
      const trainingId = workload.requestId.replace(/:work$/, '');
      const total = trainingCosts[trainingId] ??= { physicalCUw: 0, ownedVariableCents: 0, cloudRentCents: 0 };
      total.physicalCUw += workload.physicalWorkCUw; total.ownedVariableCents += workload.ownedVariableCents; total.cloudRentCents += workload.cloudRentCents;
    }
    researchFacts.push(...report.ledgerFacts.filter(fact => fact.label === 'Replay curricula research'));
    weeks.push({ week: run.week, cashCents: run.cash, totals: report.totals,
      publicApi: { paidAccounts: usage.paidAccounts, billedCents: usage.billedCents, billCarryIn: usage.tokens!.billCarryIn,
        billCarryOut: usage.tokens!.billCarryOut, inputTokens: usage.tokens!.inputTokens, outputTokens: usage.tokens!.outputTokens },
      training: Object.values(run.state.slices.models.trainingRuns).filter(item => item.id.startsWith('training-wave15-natural-'))
        .map(item => ({ id: item.id, status: item.status, completedWork: item.completedWork, physicalWork: item.physicalWork, lastProgress: item.lastProgress })) });
  };
  const until = (predicate: () => boolean, limit: number, label: string) => {
    const started = run.week;
    while (!predicate() && run.week - started < limit) step();
    assert.ok(predicate(), `${label} did not finish in ${limit} ordinary weeks.`);
  };
  const evaluate = (modelId: string, suiteId: 'expanded-capabilities-1' | 'policy-boundaries-1') => {
    run.queue({ kind: 'evaluate_model', modelId, suiteId });
    until(() => Object.values(run.state.slices.models.reports).some(report => report.modelId === modelId && report.suiteId === suiteId), 10, suiteId);
  };
  const train = (options: Omit<Extract<CommandPayload, { kind: 'start_training' }>, 'kind'>): TrainingRun => {
    const id = 'training-' + run.queue({ kind: 'start_training', ...options });
    until(() => run.state.slices.models.trainingRuns[id]?.status === 'complete', 30, options.recipeId!);
    return run.state.slices.models.trainingRuns[id];
  };

  const researchId = 'research-' + run.queue({ kind: 'start_research', researchId: 'R4C' });
  until(() => run.research.includes('R4C'), 10, 'Replay curricula research and following-boundary activation');
  const research = run.state.slices.research.projects[researchId];
  assert.equal(research.completedWork, 6 * U); assert.equal(research.completedStaff, 3 * U);
  assert.equal(researchFacts.length, 1); assert.equal((researchFacts[0] as { amountCents: number }).amountCents, 300_000);
  snapshots['replay-ready'] = serializeState(run.state);
  const documentPacketId = run.bestPacket('specialist-documents-1').id;
  const codingPacketId = run.bestPacket('specialist-coding-1').id;
  const choices = { baseModelId: publicModelId, packetId: documentPacketId, recipeId: 'document-adaptation', profile: 'stable' as const };
  const ordinary = getTrainingPreview(run.state, run.state.playerCompanyId, choices);
  const lightPreview = getTrainingPreview(run.state, run.state.playerCompanyId, { ...choices, replay: { domain: 'coding', shareBps: 2500, packetIds: [codingPacketId] } });
  const strongPreview = getTrainingPreview(run.state, run.state.playerCompanyId, { ...choices, replay: { domain: 'coding', shareBps: 5000, packetIds: [codingPacketId] } });
  assert.equal(ordinary.workCUw, 19.8 * U); assert.equal(lightPreview.workCUw, 26.4 * U); assert.equal(strongPreview.workCUw, 39.6 * U);
  assert.equal(lightPreview.replay!.preservationFloorBps, 2544); assert.equal(strongPreview.replay!.preservationFloorBps, 5089);
  assert.equal(ordinary.capabilityRange.minimum.documents, strongPreview.capabilityRange.minimum.documents);
  assert.equal(ordinary.capabilityRange.maximum.documents, strongPreview.capabilityRange.maximum.documents);
  const lightRun = train({ ...choices, replay: { domain: 'coding', shareBps: 2500, packetIds: [codingPacketId] } });
  const lightModel = run.state.slices.models.versions[lightRun.outputModelId];
  assert.equal(lightModel.capabilityBps.coding, 2544); assert.equal(lightModel.capabilityBps.documents, 5566);
  evaluate(lightModel.id, 'expanded-capabilities-1');
  assert.equal(batchModelEligible(run.state, lightModel.id, 'code-index'), false);
  snapshots['light-candidate'] = serializeState(run.state);
  run.mark('The paid 25% replay retains some coding but remains below the code-order threshold');

  const strongRunId = 'training-' + run.queue({ kind: 'start_training', ...choices, replay: { domain: 'coding', shareBps: 5000, packetIds: [codingPacketId] } });
  step();
  run.queue({ kind: 'set_job_paused', jobId: strongRunId, paused: true }); step();
  const paused = run.state.slices.models.trainingRuns[strongRunId], pausedWork = paused.completedWork, pausedPhysical = paused.physicalWork;
  assert.equal(paused.status, 'paused'); assert.ok(pausedWork > 0 && pausedWork < paused.requiredWork);
  snapshots['paused-replay'] = serializeState(run.state);
  const reopenedPause = deserializeState(snapshots['paused-replay']); assert.ok(reopenedPause.ok, reopenedPause.ok ? '' : reopenedPause.error);
  assert.equal(serializeState(reopenedPause.state), snapshots['paused-replay']); run.state = reopenedPause.state;
  step(); assert.equal(run.state.slices.models.trainingRuns[strongRunId].completedWork, pausedWork);
  assert.equal(run.state.slices.models.trainingRuns[strongRunId].physicalWork, pausedPhysical);
  run.queue({ kind: 'set_job_paused', jobId: strongRunId, paused: false });
  until(() => run.state.slices.models.trainingRuns[strongRunId].status === 'complete', 20, 'Paid 50% replay');
  const strongRun = run.state.slices.models.trainingRuns[strongRunId], strongModel = run.state.slices.models.versions[strongRun.outputModelId];
  assert.deepEqual(strongRun.plan!.savedAdjustments, lightRun.plan!.savedAdjustments);
  assert.equal(strongRun.plan!.replay!.ordinaryIdentity, lightRun.plan!.replay!.ordinaryIdentity);
  assert.notEqual(strongRun.plan!.identity, lightRun.plan!.identity);
  assert.equal(strongModel.capabilityBps.coding, 5089); assert.equal(strongModel.capabilityBps.documents, 5566);
  assert.deepEqual(strongModel.policy, earned.slices.models.versions[publicModelId].policy);
  assert.equal(batchModelEligible(run.state, strongModel.id, 'code-index'), false);
  evaluate(strongModel.id, 'expanded-capabilities-1');
  assert.equal(batchModelEligible(run.state, strongModel.id, 'code-index'), false, 'Inherited policy needs its own paid report.');
  evaluate(strongModel.id, 'policy-boundaries-1');
  assert.equal(batchModelEligible(run.state, strongModel.id, 'code-index'), true);
  assert.equal(batchModelEligible(run.state, strongModel.id, 'longform-digest'), false, 'Replay does not provide reliability training.');
  snapshots['strong-candidate'] = serializeState(run.state);
  assert.ok(trainingCosts[strongRunId].physicalCUw > trainingCosts[lightRun.id].physicalCUw);
  assert.ok(trainingCosts[strongRunId].ownedVariableCents > trainingCosts[lightRun.id].ownedVariableCents);
  assert.equal(trainingCosts[strongRunId].physicalCUw, strongRun.physicalWork);
  run.mark('50% replay preserves coding eligibility after exact capability and policy reports, at a higher measured GPU cost');

  const reliableRun = train({ baseModelId: strongModel.id, recipeId: 'behavior-reliability', packetId: documentPacketId,
    packetIds: [documentPacketId, codingPacketId], profile: 'stable' });
  const reliableModel = run.state.slices.models.versions[reliableRun.outputModelId];
  assert.deepEqual(reliableModel.capabilityBps, strongModel.capabilityBps); assert.ok(reliableModel.reliabilityBps >= 9000);
  evaluate(reliableModel.id, 'expanded-capabilities-1'); evaluate(reliableModel.id, 'policy-boundaries-1');
  assert.equal(batchModelEligible(run.state, reliableModel.id, 'code-index'), true);
  assert.equal(batchModelEligible(run.state, reliableModel.id, 'longform-digest'), true);
  assert.deepEqual(inheritedModelRights(run.state, reliableModel.id, CONTENT), inheritedModelRights(earned, publicModelId, CONTENT));
  assert.deepEqual(inheritedModelRights(run.state, reliableModel.id, CONTENT), { hosted: true, weights: false });
  snapshots['dual-qualified'] = serializeState(run.state);
  if (process.env.FRONTIER_WAVE15_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE15_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE15_OUTPUT, `frontier-lab-wave15-${name}.json`), snapshot);
  }
  run.queue({ kind: 'allocate_compute', serving: run.fleet.cloudCU + run.fleet.ownedCU, development: 0, research: 0 });
  const codeId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'code-index', modelId: reliableModel.id, weeklyWorkCapCUw: 16 * U });
  const digestId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'longform-digest', modelId: reliableModel.id, weeklyWorkCapCUw: 16 * U });
  step();
  until(() => [codeId, digestId].every(id => !!run.state.slices.products.batchJobs![id].invoiceId), 6, 'Both finite batch orders');
  const jobs = [codeId, digestId].map(id => run.state.slices.products.batchJobs![id]);
  const invoices = jobs.map(job => run.state.slices.products.batchInvoices!.find(invoice => invoice.jobId === job.id)!);
  assert.equal(jobs[0].status, 'completed'); assert.equal(jobs[0].completedRequests, 60_000);
  assert.equal(invoices[0].amountCents, 1_500_000); assert.equal(invoices[0].creditsCents, 0);
  assert.equal(jobs[1].status, 'expired'); assert.ok(jobs[1].completedRequests > 0 && jobs[1].completedRequests < 60_000);
  assert.ok(invoices[1].creditsCents > 0); assert.equal(invoices[1].amountCents + invoices[1].creditsCents, 2_250_000);
  snapshots['capacity-limited'] = serializeState(run.state);
  run.mark('The hybrid completes code work, but fragmented spare capacity cannot finish the simultaneous digest before its fixed deadline');

  run.queue({ kind: 'set_cloud_capacity', cu: 96 * U });
  run.queue({ kind: 'allocate_compute', serving: run.fleet.cloudCU + run.fleet.ownedCU, development: 0, research: 0 });
  step();
  run.queue({ kind: 'allocate_compute', serving: run.fleet.cloudCU + run.fleet.ownedCU, development: 0, research: 0 });
  const repairedDigestId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId, orderId: 'longform-digest', modelId: reliableModel.id, weeklyWorkCapCUw: 16 * U });
  step();
  until(() => !!run.state.slices.products.batchJobs![repairedDigestId].invoiceId, 6, 'Digest after renting one larger connected cloud pool');
  const repairedDigest = run.state.slices.products.batchJobs![repairedDigestId];
  const repairedInvoice = run.state.slices.products.batchInvoices!.find(invoice => invoice.jobId === repairedDigestId)!;
  assert.equal(repairedDigest.status, 'completed', JSON.stringify(repairedDigest.usageHistory));
  assert.equal(repairedDigest.completedRequests, 60_000); assert.equal(repairedInvoice.amountCents, 2_250_000); assert.equal(repairedInvoice.creditsCents, 0);
  jobs.push(repairedDigest); invoices.push(repairedInvoice);
  run.mark('Renting and allocating a larger connected cloud pool lets the same candidate finish the remaining digest for its full invoice');

  assert.deepEqual(validateState(run.state), []);
  const final = serializeState(run.state), reopened = deserializeState(final);
  assert.ok(reopened.ok, reopened.ok ? '' : reopened.error); assert.equal(serializeState(reopened.state), final);
  snapshots.complete = final;
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 500, sourceHash: '38350449',
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(final),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, productId, publicModelId,
    documentPacketId, codingPacketId, research, researchFacts, commands: run.commands, milestones: run.milestones,
    previews: { ordinary, light: lightPreview, strong: strongPreview },
    candidates: { light: lightModel, strong: strongModel, reliable: reliableModel },
    training: [lightRun, strongRun, reliableRun], trainingCosts, jobs, invoices, weeks,
    assertions: [
      'Authentic published Week500 company continues through ordinary paid commands with no resource grants',
      'R4C consumes its entry fee, research GPU work, research staff and normal activation boundary',
      'The 25% and 50% curricula preserve the same primary variance and separate replay evidence',
      'Additional replay updates consume recorded owned GPU work and cost without duplicate billing',
      'Pause and JSON reload preserve exact progress, targets and paid receipts',
      'Fresh candidate capability and policy reports are required; replay alone does not grant reliability',
      'A distinct combined corpus permits ordinary reliability tuning without weakening anti-repeat identities',
      'The original hosted-only lineage stays ineligible for weight distribution after replay and reliability training',
      'Finished research and development allocations are reassigned to serving before scheduling the two deliveries',
      'The same resulting candidate completes code work; a simultaneous digest exposes connected-pool capacity limits and receives proportional credit',
      'Renting and allocating 16 additional cloud CU enables the remaining digest to finish for its full $22500 invoice',
      'Existing live model, ordinary token carry, terminal orders and feedback history stay independent',
      'Every new week reconciles costs and revenue to the company ledger; final save reloads byte-for-byte',
    ] };
  if (process.env.FRONTIER_WAVE15_OUTPUT) {
    mkdirSync(process.env.FRONTIER_WAVE15_OUTPUT, { recursive: true });
    for (const [name, snapshot] of Object.entries(snapshots)) writeFileSync(join(process.env.FRONTIER_WAVE15_OUTPUT, `frontier-lab-wave15-${name}.json`), snapshot);
    writeFileSync(join(process.env.FRONTIER_WAVE15_OUTPUT, 'wave15-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  console.log(JSON.stringify({ finalWeek: run.week, finalHash: evidence.finalHash, commands: run.commands.length,
    snapshotBytes: evidence.snapshotBytes, trainingCosts, invoices: invoices.map(invoice => ({ order: invoice.orderId, cents: invoice.amountCents })),
    finalCashCents: run.cash, minimumCashCents: run.minimumCashCents }));
});
