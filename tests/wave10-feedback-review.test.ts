import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { FEEDBACK_REVIEW_RULES as RULES } from '../src/content/wave10-feedback-review';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState, ModuleContext } from '../src/contracts/types';
import type { FeedbackStudy } from '../src/contracts/wave10-feedback';
import type { FeedbackReviewMode } from '../src/contracts/wave10-feedback-review';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave10FeedbackReviews } from '../src/core/wave10-feedback-review-validation';
import { getReviewableFeedbackStudy } from '../src/modules/feedback';
import { advanceFeedbackReviews, feedbackDataPacket, feedbackDataRights, feedbackReviewRequests, feedbackReviewTerms } from '../src/modules/feedback-review';
import { corpusFromPackets } from '../src/modules/lab-planner';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const CHAT = 'product:natural-business-command-8', API = 'product:natural-business-command-67';
const TRAINING_BASE = 'model-natural-business-command-59';
const closedCache = new Map<string, { state: GameState; studyId: string }>();
function closedStudy(productId = CHAT, sampling: FeedbackStudy['sampling'] = 'failure-focused', consent: FeedbackStudy['consent'] = 'hosted-only') {
  const key = `${productId}:${sampling}:${consent}`;
  if (!closedCache.has(key)) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave9-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const run = new NaturalBusinessCampaign(imported.state, 'wave10-review-collection');
    const studyId = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling, consent });
    run.until(state => state.slices.data.feedbackStudies?.[studyId]?.status === 'closed', 6, 'finite feedback study');
    assert.equal(getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, studyId), undefined);
    run.step();
    assert.ok(getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, studyId));
    closedCache.set(key, { state: structuredClone(run.state), studyId });
  }
  return structuredClone(closedCache.get(key)!);
}
function startReview(run: NaturalBusinessCampaign, studyId: string, mode: FeedbackReviewMode = 'verified'): string {
  return 'feedback-review:' + run.queue({ kind: 'start_feedback_review', studyId, mode });
}
const reviewedCache = new Map<FeedbackReviewMode, { state: GameState; reviewId: string }>();
function completedReview(mode: FeedbackReviewMode = 'verified') {
  if (!reviewedCache.has(mode)) {
    const source = closedStudy(), run = new NaturalBusinessCampaign(source.state, 'wave10-' + mode + '-review');
    const reviewId = startReview(run, source.studyId, mode);
    run.until(state => state.slices.data.feedbackReviews?.[reviewId]?.status === 'complete', 8, 'paid feedback review');
    reviewedCache.set(mode, { state: structuredClone(run.state), reviewId });
  }
  return structuredClone(reviewedCache.get(mode)!);
}
function playerModels(state: GameState) {
  return Object.values(state.slices.models.versions).filter(model => model.companyId === state.playerCompanyId);
}

test('W10-R01: finite paid review uses independent GPU and capped data work, then publishes reusable data at the next boundary', () => {
  const source = closedStudy(), run = new NaturalBusinessCampaign(source.state, 'wave10-review-paid');
  assert.equal(run.state.slices.data.feedbackStudies![source.studyId].totalCases, 100);
  assert.equal(Object.values(run.state.slices.data.packets).some(packet => packet.feedback), false);
  assert.equal(previewCommand(run.state, { kind: 'prepare_data', packetId: source.studyId }).accepted, false);
  const modelsBefore = canonicalStateHash(playerModels(run.state)), deploymentBefore = run.state.slices.products.offers[CHAT].deploymentId;
  const quote = previewCommand(run.state, { kind: 'start_feedback_review', studyId: source.studyId, mode: 'verified' });
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0);
  const id = startReview(run, source.studyId), duplicate = submitCommand(run.state, { kind: 'start_feedback_review', studyId: source.studyId, mode: 'quick' });
  assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE');
  run.step();
  let review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.requiredStaff, 2 * U); assert.equal(review.completedStaff, U); assert.equal(review.requiredWork, U);
  assert.equal(review.completedWork, U); assert.equal(review.memoryMU, U); assert.equal(review.status, 'running');
  assert.equal(run.state.slices.data.packets[review.outputPacketId], undefined);
  assert.ok(Object.values(review.workReceipts).some(receipt => receipt.ownership === 'owned' && receipt.physicalCUw < receipt.effectiveCUw));
  assert.equal(feedbackReviewRequests(run.state).filter(request => request.taskId === id).length, 1, 'Finished GPU work is not reserved again while human review continues.');
  run.step(); review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.status, 'ready'); assert.equal(review.staffGrantCount, 2); assert.equal(review.completedStaff, 2 * U);
  assert.equal(review.availableWeek, run.week + 1); assert.equal(run.state.slices.data.packets[review.outputPacketId], undefined);
  assert.equal(canonicalStateHash(playerModels(run.state)), modelsBefore, 'Collecting and reviewing customer data never modifies an existing model.');
  assert.equal(run.state.slices.products.offers[CHAT].deploymentId, deploymentBefore);
  assert.ok(run.state.slices.products.invoices.some(invoice => invoice.productId === CHAT && invoice.week === run.week && invoice.amountCents > 0));
  assert.equal(run.state.slices.company.ledger.filter(entry => entry.sourceId === id).length, 0, 'Normal payroll and compute settlement charge the work, without a duplicate fee.');
  const cost = run.state.slices.compute.costReports![run.state.playerCompanyId].find(report => report.week === review.latestGrant!.week)!;
  assert.ok(cost.workloads.some(workload => workload.requestId === `feedback-review:${id}:compute` && workload.targetId === 'internal:development' && workload.physicalWorkCUw > 0));
  run.step(); review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.status, 'complete');
  const packet = run.state.slices.data.packets[review.outputPacketId];
  assert.equal(packet.prepared, true); assert.equal(packet.readyUnits, 100); assert.equal(packet.qualityBps, 9000);
  assert.equal(packet.behaviorUnits, 100); assert.equal(packet.broadUnits, 0); assert.equal(packet.coverageBps.conversation, 4500);
  assert.deepEqual(packet.rights, { hosted: true, weights: false, feedback: true });
  assert.deepEqual(validateState(run.state), []);
});

test('W10-R02: starvation, pause and save continuation cannot invent either kind of review progress', () => {
  const source = closedStudy(), run = new NaturalBusinessCampaign(source.state, 'wave10-review-starvation'), allocation = structuredClone(run.fleet.allocation);
  run.queue({ kind: 'allocate_compute', ...allocation, development: 0 }); run.founder('research');
  for (const employee of run.staff('data')) run.queue({ kind: 'set_staff_allocation', staffId: employee.id, fte: 0 });
  const id = startReview(run, source.studyId, 'quick'); run.step();
  let review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.completedWork + review.completedStaff, 0); assert.equal(review.physicalWork, 0);
  run.queue({ kind: 'allocate_compute', ...allocation }); run.step();
  review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.completedWork, review.requiredWork); assert.equal(review.completedStaff, 0);
  run.queue({ kind: 'set_feedback_review_paused', reviewId: id, paused: true }); run.step();
  const paused = canonicalStateHash(run.state.slices.data.feedbackReviews![id]); run.step();
  assert.equal(canonicalStateHash(run.state.slices.data.feedbackReviews![id]), paused);
  assert.equal(feedbackReviewRequests(run.state).filter(request => request.taskId === id).length, 0);
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(canonicalStateHash(advanceWeek(run.state).state), canonicalStateHash(advanceWeek(imported.state).state));
  for (const employee of run.staff('data')) run.queue({ kind: 'set_staff_allocation', staffId: employee.id, fte: U });
  run.queue({ kind: 'set_feedback_review_paused', reviewId: id, paused: false });
  run.until(state => state.slices.data.feedbackReviews![id].status === 'complete', 5, 'resumed paid data review');
  review = run.state.slices.data.feedbackReviews![id];
  assert.equal(review.requiredWork, U / 2); assert.equal(review.completedStaff, U);
  assert.equal(run.state.slices.data.packets[review.outputPacketId].qualityBps, 6500);
});

test('W10-R03: curation preserves consent and source identity; selecting both revisions counts each case once', () => {
  const saved = completedReview('quick'), run = new NaturalBusinessCampaign(saved.state, 'wave10-review-curation');
  const review = run.state.slices.data.feedbackReviews![saved.reviewId], original = structuredClone(run.state.slices.data.packets[review.outputPacketId]);
  const curatedId = 'curated-' + run.queue({ kind: 'curate_data', packetId: original.id });
  run.until(state => state.slices.data.packets[curatedId]?.prepared, 8, 'paid feedback curation');
  const curated = run.state.slices.data.packets[curatedId], corpus = corpusFromPackets([original, curated]);
  assert.equal(curated.qualityBps, 7500); assert.deepEqual(curated.feedback, original.feedback); assert.deepEqual(curated.rights, original.rights);
  assert.deepEqual(curated.sourceIds, original.sourceIds); assert.deepEqual(curated.coverageBps, original.coverageBps);
  assert.equal(curated.behaviorUnits, original.behaviorUnits); assert.equal(curated.broadUnits, 0);
  assert.equal(corpus.distinctUnits, original.readyUnits); assert.equal(corpus.behaviorUnits, original.behaviorUnits);
  assert.equal(corpus.behaviorQualityBps, curated.qualityBps); assert.equal(corpus.rights.weights, false);
  assert.deepEqual(run.state.slices.data.packets[original.id], original);
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: curated.id }).accepted, false, 'This source has no invented authored duplicate-processing discount.');
  assert.deepEqual(validateState(run.state), []);
  for (const mutate of [(state: GameState) => { delete state.slices.data.packets[curatedId].feedback; },
    (state: GameState) => { state.slices.data.packets[curatedId].rights.weights = true; },
    (state: GameState) => { state.slices.data.packets[curatedId].sourceIds = ['invented-source']; }]) {
    const copy = structuredClone(run.state); mutate(copy); assert.throws(() => assertWave10FeedbackReviews(copy, CONTENT));
  }
});

test('W10-R04: ordinary paid behavior and calibration training consumes reviewed sources and preserves weight restrictions', () => {
  for (const recipeId of ['behavior-reliability', 'calibration-curriculum']) {
    const saved = completedReview(), run = new NaturalBusinessCampaign(saved.state, 'wave10-train-' + recipeId);
    const packetId = run.state.slices.data.feedbackReviews![saved.reviewId].outputPacketId, before = structuredClone(run.state.slices.models.versions[TRAINING_BASE]);
    const deployment = run.state.slices.products.offers[CHAT].deploymentId;
    const options = { baseModelId: TRAINING_BASE, packetId, packetIds: [packetId, CONTENT.starterData.id], recipeId };
    const commandId = run.queue({ kind: 'start_training', ...options }), runId = 'training-' + commandId;
    run.step(); const training = run.state.slices.models.trainingRuns[runId];
    assert.equal(training.evidence.feedback, undefined, 'The aggregate corpus is not mislabeled as one feedback packet.');
    assert.ok(training.plan!.corpus.packetIds.includes(packetId)); assert.equal(training.plan!.corpus.rights.weights, false);
    assert.ok(training.requiredWork >= 16 * U); assert.ok(training.completedWork > 0);
    run.until(state => state.slices.models.trainingRuns[runId].status === 'complete', 15, 'paid tuning with reviewed customer data');
    const result = run.state.slices.models.versions[training.outputModelId];
    assert.deepEqual(result.capabilityBps, before.capabilityBps); assert.equal(result.status, 'checkpoint'); assert.equal(result.evaluationReportId, undefined);
    if (recipeId === 'behavior-reliability') assert.ok(result.reliabilityBps > before.reliabilityBps);
    else assert.ok(result.behavior!.confidentErrorBps < before.behavior!.confidentErrorBps);
    assert.deepEqual(inheritedModelRights(run.state, result.id, CONTENT), { hosted: true, weights: false });
    assert.deepEqual(run.state.slices.models.versions[TRAINING_BASE], before); assert.equal(run.state.slices.products.offers[CHAT].deploymentId, deployment);
    assert.equal(previewCommand(run.state, { kind: 'start_training', ...options }).reason?.code, 'NO_IMPROVEMENT');
    assert.deepEqual(validateState(run.state), []);
  }
});

test('W10-R05: import rejects fabricated review work, source licensing and prematurely prepared feedback packets', () => {
  const saved = completedReview(), id = saved.reviewId, packetId = saved.state.slices.data.feedbackReviews![id].outputPacketId;
  const mutations: ((copy: GameState) => void)[] = [
    copy => { copy.slices.data.feedbackReviews![id].studyFingerprint = '00000000'; },
    copy => { copy.slices.data.feedbackReviews![id].requiredWork -= 1; },
    copy => { copy.slices.data.feedbackReviews![id].completedWork -= 1; },
    copy => { copy.slices.data.feedbackReviews![id].completedStaff -= 1; },
    copy => { copy.slices.data.feedbackReviews![id].staffGrantCount = 1; },
    copy => { copy.slices.data.feedbackReviews![id].memoryMU = 0; },
    copy => { copy.slices.data.feedbackReviews![id].availableWeek! -= 1; },
    copy => { copy.slices.data.feedbackReviews![id].latestGrant!.physicalCUw += 1; },
    copy => { Object.values(copy.slices.data.feedbackReviews![id].workReceipts)[0].rateCentsPerCUw = 0; },
    copy => { copy.slices.data.packets[packetId].rights.weights = true; },
    copy => { copy.slices.data.packets[packetId].broadUnits = 100; },
    copy => { copy.slices.data.packets[packetId].coverageBps.coding = 10000; },
    copy => { copy.slices.data.packets[packetId].sourceIds = ['invented-source']; },
    copy => { delete copy.slices.data.packets[packetId].feedback; },
    copy => { delete copy.slices.data.feedbackReviews; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(saved.state); mutate(copy);
    assert.throws(() => assertWave10FeedbackReviews(copy, CONTENT)); assert.ok(validateState(copy).length > 0);
  }
  const source = closedStudy(), run = new NaturalBusinessCampaign(source.state, 'wave10-premature-data');
  const reviewId = startReview(run, source.studyId); run.step();
  const review = run.state.slices.data.feedbackReviews![reviewId];
  run.state.slices.data.packets[review.outputPacketId] = feedbackDataPacket(run.state, review);
  assert.throws(() => assertWave10FeedbackReviews(run.state, CONTENT), /before paid review/);
});

test('W10-R06: smaller consented batches retain source scope and scale both review costs from actual captured cases', () => {
  const source = closedStudy(API, 'representative', 'distribution'), study = source.state.slices.data.feedbackStudies![source.studyId];
  assert.ok(study.totalCases > 0 && study.totalCases < 100);
  const run = new NaturalBusinessCampaign(source.state, 'wave10-representative-review'), id = startReview(run, study.id, 'quick');
  run.until(state => state.slices.data.feedbackReviews?.[id]?.status === 'complete', 6, 'smaller representative batch review');
  const review = run.state.slices.data.feedbackReviews![id], packet = run.state.slices.data.packets[review.outputPacketId], terms = feedbackReviewTerms(study, 'quick');
  assert.equal(review.requiredWork, study.totalCases * U / 200); assert.equal(review.requiredStaff, study.totalCases * U / 100);
  assert.equal(terms.qualityBps, 6500); assert.equal(packet.readyUnits, study.totalCases); assert.equal(packet.behaviorUnits, Math.floor(study.totalCases / 2));
  assert.deepEqual(packet.coverageBps, { conversation: 0, documents: 0, coding: 8000, tools: 0 });
  assert.equal(packet.broadUnits, 0); assert.deepEqual(packet.rights, { hosted: true, weights: true, feedback: true });
  assert.equal(previewCommand(run.state, { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: packet.id, recipeId: 'medium-foundation' }).accepted, false);
  assert.deepEqual(validateState(run.state), []);
});

test('W10-R07: feedback cannot launder restricted primary or sampled routed model rights; zero-case routes contribute no rights', () => {
  const saved = completedReview(), run = new NaturalBusinessCampaign(saved.state, 'wave10-source-rights');
  const packetId = run.state.slices.data.feedbackReviews![saved.reviewId].outputPacketId;
  const restricted = run.train({ baseModelId: TRAINING_BASE, packetId, recipeId: 'calibration-curriculum' });
  const study = structuredClone(run.state.slices.data.feedbackStudies![run.state.slices.data.feedbackReviews![saved.reviewId].studyId]);
  study.consent = 'distribution';
  assert.equal(feedbackDataRights(run.state, study).weights, true);
  study.weeks[0].routingModelId = restricted;
  assert.equal(feedbackDataRights(run.state, study).weights, false);
  study.weeks[0].outcomes.cases = 0;
  assert.equal(feedbackDataRights(run.state, study).weights, true);
  study.sourceModelId = restricted;
  assert.equal(feedbackDataRights(run.state, study).weights, false);
});

test('W10-R08: missing workspace or excessive staff grants cannot advance feedback review', () => {
  const source = closedStudy(), run = new NaturalBusinessCampaign(source.state, 'wave10-review-grants');
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 }); run.founder('research');
  for (const employee of run.staff('data')) run.queue({ kind: 'set_staff_allocation', staffId: employee.id, fte: 0 });
  const id = startReview(run, source.studyId); run.step();
  const request = feedbackReviewRequests(run.state).find(item => item.taskId === id && item.normalizedWorkCUw > 0)!;
  assert.equal(request.memoryMU, U); assert.equal(request.workloadKind, 'general'); assert.equal(request.sharedAdapterMemory, undefined);
  const context: ModuleContext = { week: run.week + 1, phase: 'execute', content: CONTENT, facts: [], random: { draw: () => 0 },
    resources: { requests: [request], staffGrants: [], computeGrants: [{ requestId: request.id, physicalCUw: U, hardwareEffectiveCUw: U, memoryMU: 0, poolId: 'general-cloud' }] } };
  assert.throws(() => advanceFeedbackReviews(run.state, context, structuredClone(run.state.slices.data)), /workspace/);
  const excessiveStaff: ModuleContext = { ...context, resources: { requests: [request], computeGrants: [],
    staffGrants: [{ requestId: `feedback-review:${id}:data`, grants: [{ role: 'data', staffWeeks: RULES.maximumWeeklyStaff + 1 }] }] } };
  assert.throws(() => advanceFeedbackReviews(run.state, excessiveStaff, structuredClone(run.state.slices.data)), /weekly staff cap/);
  assert.equal(run.state.slices.data.feedbackReviews![id].completedWork + run.state.slices.data.feedbackReviews![id].completedStaff, 0);
});
