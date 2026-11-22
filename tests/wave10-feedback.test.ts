import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { FEEDBACK_RULES as RULES } from '../src/content/wave10-feedback';
import type { GameCommand, GameState, WeeklyUsage } from '../src/contracts/types';
import type { FeedbackPaidUsage, FeedbackStudy } from '../src/contracts/wave10-feedback';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { mulDiv } from '../src/core/math';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave10Feedback } from '../src/core/wave10-feedback-validation';
import { feedbackPaidUsage, feedbackProductReason, feedbackRowCounts, feedbackStudyFingerprint, feedbackStudySourceIds,
  getReviewableFeedbackStudy, validateFeedbackCommand } from '../src/modules/feedback';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const CHAT = 'product:natural-business-command-8';
const API = 'product:natural-business-command-67';
const BUSINESS = 'product:natural-business-command-163';
const CANDIDATE = 'model-wave7-natural-command-9';
let baseline: GameState | undefined;
function campaign(prefix = 'wave10-feedback') {
  if (!baseline) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave8-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error); baseline = imported.state;
  }
  return new NaturalBusinessCampaign(structuredClone(baseline), prefix);
}
function start(run: NaturalBusinessCampaign, productId = CHAT, sampling: FeedbackStudy['sampling'] = 'representative', consent: FeedbackStudy['consent'] = 'hosted-only') {
  return 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling, consent });
}
let collected: { state: GameState; id: string } | undefined;
function closed() {
  if (!collected) {
    const run = campaign(), id = start(run); run.step(RULES.weeks);
    collected = { state: structuredClone(run.state), id };
  }
  return structuredClone(collected);
}

test('W10-C01: prospective paid serving yields four bounded receipts, no free dataset or model update, and next-boundary review', () => {
  const before = campaign().state, { state, id } = closed(), study = state.slices.data.feedbackStudies![id];
  const ownModels = (s: GameState) => Object.values(s.slices.models.versions).filter(model => model.companyId === s.playerCompanyId);
  assert.equal(study.startedWeek, before.week + 1); assert.equal(study.endsWeek, before.week + 4);
  assert.equal(study.weeks.length, 4); assert.equal(study.totalCases, 100); assert.equal(study.status, 'closed');
  assert.equal(study.reviewableWeek, state.week + 1); assert.equal(getReviewableFeedbackStudy(state, state.playerCompanyId, id), undefined);
  assert.deepEqual(ownModels(state), ownModels(before)); assert.deepEqual(state.slices.data.packets, before.slices.data.packets);
  assert.equal(Object.hasOwn(state.slices.data, 'feedbackReviews'), false);
  assert.equal(state.slices.company.ledger.filter(fact => fact.sourceId === id).length, 0, 'Collection adds no duplicate serving fee or training data purchase.');
  for (const row of study.weeks) {
    assert.ok(row.week > before.week); assert.equal(row.outcomes.cases, 25); assert.equal(row.reason, 'sampled');
    assert.equal(row.paidUsage.paidCompletedExchanges, mulDiv(row.paidUsage.paidExecutedWork, row.paidUsage.paidRequestedExchanges, row.paidUsage.paidRequestedWork));
    assert.ok(row.outcomes.cases <= row.consentAccounts && row.consentAccounts <= row.servedAccounts);
    assert.equal(state.slices.company.postedFacts[row.paidUsage.invoiceId!], true);
    assert.ok(row.paidUsage.paidExecutedWork > 0 && row.paidUsage.billedCents > 0);
  }
  const next = advanceWeek(state); assert.ok(next.accepted, next.reason?.message);
  assert.equal(getReviewableFeedbackStudy(next.state, state.playerCompanyId, id)?.id, id);
  assert.deepEqual(next.state.slices.data.feedbackStudies![id], study, 'A closed study and every paid source receipt stay immutable.');
  assert.deepEqual(validateState(next.state), []);
});

test('W10-C02: trial requests never enter paid evidence; paused service consumes the finite window without collecting', () => {
  const synthetic: WeeklyUsage = { week: 7, productId: CHAT, paidAccounts: 0, trialAccounts: 900,
    requestedWork: 900, executedWork: 900, paidRequestedWork: 0, paidExecutedWork: 0, trialRequestedWork: 900, trialExecutedWork: 900,
    exchanges: 9_000_000, fulfillmentBps: 10000, errorBps: 2000, trialCompletedIds: ['trial-only'], grossBillCents: 0, creditsCents: 0, billedCents: 0, segments: [] };
  const paid = feedbackPaidUsage(synthetic, CHAT, 7);
  assert.equal(paid.paidCompletedExchanges, 0); assert.equal(paid.invoiceId, null);
  assert.equal(feedbackRowCounts({ sampling: 'representative', consent: 'hosted-only' }, paid, true).outcomes.cases, 0);
  assert.equal(feedbackPaidUsage(synthetic, CHAT, 8).paidCompletedExchanges, 0, 'Older usage is never captured retrospectively.');
  const run = campaign('wave10-paused'), id = start(run);
  run.queue({ kind: 'set_product_paused', productId: CHAT, paused: true }); run.step(4);
  const study = run.state.slices.data.feedbackStudies![id];
  assert.equal(study.totalCases, 0); assert.equal(study.status, 'closed'); assert.equal(study.weeks.length, 4);
  assert.ok(study.weeks.every(row => row.reason === 'no-paid-service' && row.outcomes.cases === 0 && row.paidUsage.paidExecutedWork === 0));
  run.step(); assert.equal(getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, id), undefined);
  assert.deepEqual(validateState(run.state), []);
});

test('W10-C03: consent is account-weighted, partial service shrinks the cohort, and negative sampling cannot invent failures', () => {
  const paid: FeedbackPaidUsage = { paidAccounts: 101, paidRequestedExchanges: 1000, paidRequestedWork: 1000, paidExecutedWork: 500,
    paidCompletedExchanges: 500, errorBps: 2000, confidentErrorBps: 1000, falseRefusalBps: 500, billedCents: 5000, invoiceId: 'invoice:test:1' };
  const representative = feedbackRowCounts({ sampling: 'representative', consent: 'hosted-only' }, paid, true);
  const distribution = feedbackRowCounts({ sampling: 'representative', consent: 'distribution' }, paid, true);
  assert.equal(representative.servedAccounts, 50); assert.equal(representative.consentAccounts, 12); assert.equal(representative.outcomes.cases, 12);
  assert.equal(distribution.consentAccounts, 5); assert.equal(distribution.outcomes.cases, 5);
  assert.equal(feedbackRowCounts({ sampling: 'representative', consent: 'hosted-only' }, { ...paid, paidCompletedExchanges: 100_000 }, true).outcomes.cases, 12,
    'A heavy user cannot turn one participating account into hundreds of samples.');
  const failure = feedbackRowCounts({ sampling: 'failure-focused', consent: 'hosted-only' }, paid, true);
  assert.equal(failure.outcomes.useful, 0); assert.ok(failure.outcomes.cases <= failure.negativeCandidates);
  const perfect = feedbackRowCounts({ sampling: 'failure-focused', consent: 'hosted-only' }, { ...paid, errorBps: 0, confidentErrorBps: 0, falseRefusalBps: 0 }, true);
  assert.equal(perfect.outcomes.cases, 0); assert.equal(perfect.reason, 'no-negative-cases');
  const changed = feedbackRowCounts({ sampling: 'failure-focused', consent: 'hosted-only' }, paid, false);
  assert.equal(changed.outcomes.cases, 0); assert.equal(changed.reason, 'source-changed');
});

test('W10-C04: ending early preserves paid cases, collects no ending-week traffic, and survives exact save continuation', () => {
  const run = campaign('wave10-end'), id = start(run); run.step();
  const first = structuredClone(run.state.slices.data.feedbackStudies![id]), snapshot = deserializeState(serializeState(run.state));
  assert.ok(snapshot.ok, snapshot.ok ? '' : snapshot.error);
  assert.equal(canonicalStateHash(advanceWeek(run.state).state), canonicalStateHash(advanceWeek(snapshot.state).state));
  const command = run.queue({ kind: 'cancel_feedback_study', studyId: id }); run.step();
  const ended = run.state.slices.data.feedbackStudies![id];
  assert.equal(ended.endedEarly, true); assert.equal(ended.endCommandId, command); assert.equal(ended.closedWeek, run.week);
  assert.deepEqual(ended.weeks, first.weeks); assert.equal(ended.totalCases, first.totalCases);
  assert.equal(getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, id), undefined);
  run.step(); assert.equal(getReviewableFeedbackStudy(run.state, run.state.playerCompanyId, id)?.id, id);
  assert.deepEqual(run.state.slices.data.feedbackStudies![id], ended);
});

test('W10-C05: ordinary paid model replacement stops new captures while frozen deployment receipts preserve history', () => {
  const run = campaign('wave10-source'), id = start(run); run.step();
  const source = structuredClone(run.state.slices.data.feedbackStudies![id].sourceDeployment);
  run.queue({ kind: 'upgrade_product', productId: CHAT, modelId: CANDIDATE }); run.step(3);
  const study = run.state.slices.data.feedbackStudies![id];
  assert.equal(study.totalCases, 25); assert.equal(study.weeks.length, 4);
  assert.equal(study.weeks[1].observedDeployment.status, 'building'); assert.equal(study.weeks[1].observedDeployment.readyWeek, null);
  assert.ok(study.weeks.slice(1).every(row => row.reason === 'source-changed' && row.outcomes.cases === 0));
  assert.equal(run.state.slices.products.deployments[source.id], undefined, 'The ordinary live deployment replacement contract stays unchanged.');
  assert.deepEqual(study.sourceDeployment, source); assert.deepEqual(validateState(run.state), []);
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.deepEqual(imported.state.slices.data.feedbackStudies![id], study);
});

test('W10-C06: forged paid work, consent, source, count, invoice and review availability are rejected on import', () => {
  const { state, id } = closed();
  const mutations: ((copy: GameState) => void)[] = [
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].paidUsage.paidExecutedWork += 1; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[3].paidUsage.paidCompletedExchanges += 1; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].consentAccounts += 1; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].outcomes.cases += 1; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].paidUsage.invoiceId = 'invented-invoice'; },
    copy => { copy.slices.data.feedbackStudies![id].sourceModelFingerprint = '00000000'; },
    copy => { copy.slices.data.feedbackStudies![id].sourceDeployment.readyWeek = copy.week + 1; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].observedDeployment.modelId = 'seed-0'; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].sourceId = 'invented-source'; },
    copy => { copy.slices.data.feedbackStudies![id].weeks[0].week -= 1; },
    copy => { copy.slices.data.feedbackStudies![id].reviewableWeek! -= 1; },
    copy => { copy.slices.data.feedbackStudies![id].totalCases += 1; },
    copy => { copy.slices.data.feedbackStudies![id].endedEarly = true; },
    copy => { (copy.slices.data as unknown as { feedbackStudies: null }).feedbackStudies = null; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(state); mutate(copy);
    assert.throws(() => assertWave10Feedback(copy, CONTENT)); assert.ok(validateState(copy).length > 0);
    const envelope = JSON.parse(serializeState(state)) as { state: GameState; checksum: string };
    envelope.state = copy; envelope.checksum = canonicalStateHash(copy);
    assert.equal(deserializeState(JSON.stringify(envelope)).ok, false);
  }
});

test('W10-C07: research, public-product scope, duplicate admission and finite history are enforced', () => {
  const run = campaign('wave10-gates'), companyId = run.state.playerCompanyId;
  assert.equal(feedbackProductReason(run.state, companyId, CHAT), undefined);
  assert.equal(feedbackProductReason(run.state, companyId, API), undefined);
  assert.equal(feedbackProductReason(run.state, companyId, BUSINESS)?.code, 'NOT_READY');
  const noResearch = structuredClone(run.state);
  noResearch.slices.research.completedByCompany[companyId] = noResearch.slices.research.completedByCompany[companyId].filter(id => id !== 'R5');
  assert.equal(feedbackProductReason(noResearch, companyId, CHAT)?.code, 'NOT_READY');
  const quote = previewCommand(run.state, { kind: 'start_feedback_study', productId: CHAT, sampling: 'representative', consent: 'hosted-only' });
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0); assert.equal(quote.weeklyCostDeltaCents, 0);
  start(run);
  const before = canonicalStateHash(run.state), duplicate = submitCommand(run.state, { kind: 'start_feedback_study', productId: CHAT, sampling: 'failure-focused', consent: 'distribution' });
  assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE'); assert.equal(canonicalStateHash(run.state), before);
  const { state, id } = closed(), full = structuredClone(state), source = full.slices.data.feedbackStudies![id];
  full.slices.data.feedbackStudies = Object.fromEntries(Array.from({ length: RULES.maximumPerProduct }, (_, index) => ['limit-' + index, { ...source, id: 'limit-' + index }]));
  const command: GameCommand = { id: 'capacity-probe', companyId, issuedForWeek: full.week + 1,
    payload: { kind: 'start_feedback_study', productId: CHAT, sampling: 'representative', consent: 'hosted-only' } };
  assert.equal(validateFeedbackCommand(full, command)?.code, 'CAPACITY_EXCEEDED');
});

test('W10-C08: evidence sources are stable across later studies and only fresh paid weeks add distinct training lineage', () => {
  const { state, id } = closed(), first = structuredClone(state.slices.data.feedbackStudies![id]);
  const fingerprint = feedbackStudyFingerprint(first);
  assert.equal(feedbackStudyFingerprint({ ...first, lastBottleneck: 'A presentation-only explanation.' }), fingerprint);
  const run = new NaturalBusinessCampaign(state, 'wave10-fresh'), nextId = start(run); run.step();
  const second = run.state.slices.data.feedbackStudies![nextId];
  assert.equal(second.startedWeek, first.endsWeek + 1); assert.equal(second.weeks.length, 1);
  assert.ok(feedbackStudySourceIds(second).every(source => !feedbackStudySourceIds(first).includes(source)));
  assert.equal(feedbackStudyFingerprint(run.state.slices.data.feedbackStudies![id]), fingerprint);
  assert.equal(feedbackStudySourceIds(first).length, 4); assert.deepEqual(validateState(run.state), []);
});
