import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { feedbackStudySourceIds, getReviewableFeedbackStudy } from '../src/modules/feedback';
import { feedbackReviewWorkId } from '../src/modules/feedback-review';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { getQualifiedReleaseRehearsal } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

test('W10-N01: paid API usage becomes reviewed evidence, a calibrated candidate, and an explicitly prepared release', () => {
  const raw = readFileSync(join(__dirname, 'fixtures/wave9-snapshot.json'), 'utf8'), imported = loadHistoricalSnapshot(raw);
  assert.ok(imported.ok);
  const previous = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave9-expected.json'), 'utf8')) as {
    sourceCommit: string; sourceContent: string; commands: { week: number; id: string; payload: CommandPayload }[];
  };
  // Complete the real published company's already-paid release and rollback.
  // No assets, staff, research, cases or cash are inserted into this fixture.
  let earned = imported.state;
  while (earned.week < 389) {
    for (const command of previous.commands.filter(item => item.week === earned.week)) {
      const result = submitCommand(earned, command.payload, historicalContent(earned), command.id);
      assert.ok(result.accepted, result.reason?.message); earned = result.state;
    }
    const next = advanceWeek(earned, historicalContent(earned)); assert.ok(next.accepted, next.reason?.message); earned = next.state;
  }
  assert.equal(canonicalStateHash({ ...earned, contentVersion: previous.sourceContent, buildVersion: previous.sourceContent }), '4dff9002');
  earned = upgradeHistoricalState(earned);
  const run = new NaturalBusinessCampaign(earned, 'wave10-natural'), owner = run.state.playerCompanyId;
  const product = run.offers().find(item => item.kind === 'developer-api')!, productId = product.id;
  const sourceModelId = run.state.slices.products.deployments[product.deploymentId].modelId;
  const baseModelId = 'model-natural-business-command-59';
  const sourceHash = canonicalStateHash(run.state.slices.models.versions[sourceModelId]);
  const baseHash = canonicalStateHash(run.state.slices.models.versions[baseModelId]);
  const fixedContract = { ...run.state.slices.products.contracts[product.contractId], tokenBillRemainder: 0 };
  const snapshots: Record<string, string> = { 'before-study': serializeState(run.state) };
  run.mark('Published Wave 9 company; staffed development and paid API remain active');
  const service: { week: number; modelId: string; paidAccounts: number; fulfillmentBps: number; billedCents: number; carryIn: number; carryOut: number }[] = [];
  const step = () => {
    const priorCarry = run.state.slices.products.contracts[product.contractId].tokenBillRemainder ?? 0;
    run.step();
    const current = run.state.slices.products.offers[productId], usage = run.state.slices.products.lastUsage[productId];
    assert.equal(current.status, 'active'); assert.equal(current.contractId, product.contractId);
    assert.equal(usage.fulfillmentBps, 10000, 'The funded API remains fully served while feedback and lab work compete for development capacity.');
    assert.equal(usage.tokens!.billCarryIn, priorCarry);
    assert.deepEqual({ ...run.state.slices.products.contracts[product.contractId], tokenBillRemainder: 0 }, fixedContract);
    const invoices = run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week);
    assert.equal(invoices.length, 1); assert.equal(invoices[0].amountCents, usage.billedCents);
    const costs = getComputeCostView(run.state).latest!;
    assert.equal(costs.totals.totalComputeCents + costs.totals.otherOperatingCents, run.company.lastWeek.operatingExpenseCents);
    assert.equal(costs.totals.attributedComputeCents + costs.totals.sharedComputeCents, costs.totals.totalComputeCents);
    service.push({ week: run.week, modelId: current.publicModelId!, paidAccounts: usage.paidAccounts,
      fulfillmentBps: usage.fulfillmentBps, billedCents: usage.billedCents, carryIn: usage.tokens!.billCarryIn!, carryOut: usage.tokens!.billCarryOut! });
  };
  const until = (condition: () => boolean, limit: number, label: string) => {
    const start = run.week; while (!condition() && run.week - start < limit) step();
    assert.ok(condition(), label + ' did not finish through ordinary weekly work.');
  };

  const studyId = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling: 'failure-focused', consent: 'hosted-only' });
  until(() => !!getReviewableFeedbackStudy(run.state, owner, studyId), 6, 'prospective feedback collection');
  const study = run.state.slices.data.feedbackStudies![studyId];
  assert.equal(study.totalCases, 100); assert.equal(study.weeks.length, 4);
  assert.deepEqual(study.weeks.map(row => row.outcomes.cases), [25, 25, 25, 25]);
  assert.ok(study.weeks.every(row => row.paidUsage.paidExecutedWork > 0 && row.paidUsage.billedCents > 0));
  assert.equal(study.totalNegativeCases, 100);
  assert.equal(Object.keys(run.state.slices.data.packets).length, Object.keys(earned.slices.data.packets).length, 'Collecting cases is not a training dataset.');
  assert.equal(canonicalStateHash(run.state.slices.models.versions[sourceModelId]), sourceHash);
  snapshots['after-study'] = serializeState(run.state);
  run.mark('Four paid service weeks yielded 100 opted-in failure-focused cases');

  const reviewCommand = run.queue({ kind: 'start_feedback_review', studyId, mode: 'verified' });
  const reviewId = 'feedback-review:' + reviewCommand, packetId = 'feedback-data:' + reviewCommand;
  until(() => run.state.slices.data.feedbackReviews?.[reviewId]?.status === 'ready', 6, 'paid feedback review');
  assert.equal(Object.hasOwn(run.state.slices.data.packets, packetId), false, 'Review completion waits for its availability boundary.');
  step();
  const review = run.state.slices.data.feedbackReviews![reviewId], packet = run.state.slices.data.packets[packetId];
  assert.equal(review.status, 'complete'); assert.equal(review.completedStaff, 2 * U);
  assert.equal(review.completedWork, U); assert.equal(review.memoryMU, U); assert.ok(review.physicalWork > 0);
  assert.equal(packet.readyUnits, 100); assert.equal(packet.behaviorUnits, 100); assert.equal(packet.broadUnits, 0);
  assert.equal(packet.qualityBps, 9000); assert.equal(packet.coverageBps.coding, 4500);
  assert.deepEqual(packet.rights, { hosted: true, weights: false, feedback: true });
  assert.deepEqual(packet.sourceIds, feedbackStudySourceIds(study));
  const reviewCosts = getComputeCostView(run.state).reports.flatMap(report => report.workloads.filter(workload => workload.requestId === feedbackReviewWorkId(reviewId, 'compute')));
  assert.equal(reviewCosts.reduce((total, row) => total + row.physicalWorkCUw, 0), review.physicalWork);
  assert.equal(canonicalStateHash(run.state.slices.models.versions[sourceModelId]), sourceHash);
  snapshots['after-review'] = serializeState(run.state);
  run.mark('Verified dataset delivered after two data staff-weeks and real development GPU work');

  const trainingCommand = run.queue({ kind: 'start_training', baseModelId, packetId, recipeId: 'calibration-curriculum' });
  const trainingId = 'training-' + trainingCommand, candidateModelId = 'model-' + trainingCommand;
  until(() => run.state.slices.models.trainingRuns[trainingId]?.status === 'complete', 10, 'calibration training');
  const training = run.state.slices.models.trainingRuns[trainingId], candidate = run.state.slices.models.versions[candidateModelId];
  assert.equal(training.completedWork, 16 * U); assert.ok(training.physicalWork > 0);
  assert.equal(training.plan!.corpus.behaviorUnits, 100); assert.equal(training.plan!.corpus.broadUnits, 0);
  assert.deepEqual(training.plan!.corpus.sourceIds, packet.sourceIds); assert.equal(training.evidence.feedback, undefined);
  assert.equal(candidate.behavior!.confidentErrorBps, 550); assert.equal(candidate.behavior!.falseRefusalBps, 700);
  assert.deepEqual(candidate.capabilityBps, run.state.slices.models.versions[baseModelId].capabilityBps);
  assert.equal(candidate.reliabilityBps, run.state.slices.models.versions[baseModelId].reliabilityBps);
  assert.deepEqual(inheritedModelRights(run.state, candidateModelId, CONTENT), { hosted: true, weights: false });
  assert.equal(canonicalStateHash(run.state.slices.models.versions[baseModelId]), baseHash);
  assert.equal(canonicalStateHash(run.state.slices.models.versions[sourceModelId]), sourceHash);
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  run.queue({ kind: 'evaluate_model', modelId: candidateModelId, suiteId: 'expanded-capabilities-1' });
  run.queue({ kind: 'evaluate_model', modelId: candidateModelId, suiteId: 'behavior-cases-1' });
  until(() => Object.values(run.state.slices.models.reports).filter(report => report.modelId === candidateModelId).length === 2, 6, 'separate capability and behavior evaluation');
  snapshots['after-training'] = serializeState(run.state);
  run.mark('Paid calibration changed only the new candidate; exact version passed separate held-out evaluations');

  const rehearsalId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId });
  until(() => !!getQualifiedReleaseRehearsal(run.state, productId, candidateModelId), 8, 'paid candidate comparison');
  const releaseId = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId });
  until(() => run.state.slices.products.preparedReleases?.[releaseId]?.status === 'ready'
    && run.state.slices.products.preparedReleases[releaseId].availableWeek! <= run.week, 6, 'prepared release');
  snapshots['before-promotion'] = serializeState(run.state);
  run.queue({ kind: 'promote_prepared_release', releaseId }); step();
  assert.equal(run.state.slices.products.offers[productId].publicModelId, sourceModelId);
  step();
  assert.equal(run.state.slices.products.offers[productId].publicModelId, candidateModelId);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'released');
  assert.equal(canonicalStateHash(run.state.slices.models.versions[sourceModelId]), sourceHash);
  run.mark('Explicit paid handover closed the customer-use to model-release loop');

  assert.deepEqual(validateState(run.state, CONTENT), []);
  const snapshot = serializeState(run.state), loaded = deserializeState(snapshot); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(serializeState(loaded.state), snapshot); assert.ok(Buffer.byteLength(snapshot) < 2_000_000);
  snapshots.complete = snapshot;
  const evidence = { sourceCommit: previous.sourceCommit, sourceWeek: 389, sourceChecksum: '4dff9002', originalWeek: earned.week,
    finalWeek: run.week, finalHash: canonicalStateHash(run.state), snapshotBytes: Buffer.byteLength(snapshot),
    cashCents: run.cash, minimumCashCents: run.minimumCashCents, productId, sourceModelId, baseModelId, candidateModelId,
    studyId, reviewId, trainingId, rehearsalId, releaseId, commands: run.commands, milestones: run.milestones,
    study, review, reviewCosts, packet, training, candidate, rehearsal: run.state.slices.products.releaseRehearsals![rehearsalId],
    release: run.state.slices.products.preparedReleases![releaseId], service, finalCosts: getComputeCostView(run.state).latest!, assertions: [
      'The published company and its prior release were completed with ordinary commands; no grants or arrears',
      'Only prospectively consented actual paid API service supplied four capped sample rows',
      'Collection left all data packets and model weights unchanged; paid review created one reusable dataset at the next boundary',
      'Review consumed two data staff-weeks, one effective development CUw and separately metered physical GPU work',
      'Calibration used frozen reviewed evidence for a new candidate; old models and the live API were unchanged until handover',
      'Feedback rights propagated to the trained candidate and forbid weight distribution for this hosted-only study',
      'Exact-version evaluation, a paid paired rehearsal and explicit release preparation preceded the serving cutover',
      'The API stayed fully served; one invoice and fractional token carry survived each week; costs reconciled',
      'The completed snapshot round-tripped byte-for-byte below two megabytes',
    ] };
  if (process.env.FRONTIER_WAVE10_OUTPUT) {
    const dir = process.env.FRONTIER_WAVE10_OUTPUT; mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(snapshots)) writeFileSync(join(dir, 'frontier-lab-wave10-' + name + '.json'), text + '\n');
    writeFileSync(join(dir, 'wave10-progression.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
});
