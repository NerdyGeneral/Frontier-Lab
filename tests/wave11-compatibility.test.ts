import { historicalContent, loadHistoricalSnapshot } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ComputeCostTotals } from '../src/contracts/wave8-costs';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { inheritedModelRights } from '../src/modules/model-runtime';

// Generated before Wave 11 edits with the exact published Wave 10 engine at
// 63dac0612733705f3ffdfef9d847c16996ba7378. Its entire natural receipt reproduces
// docs/evidence/wave10-progression.json, including Week 408 hash and export bytes.
// The fixture adds the original review command to the authentic Week 394 save,
// then advances once: GPU work is paid, data staff work is only halfway complete.
const raw = readFileSync(join(__dirname, 'fixtures/wave10-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
type Study = NonNullable<GameState['slices']['data']['feedbackStudies']>[string];
type Review = NonNullable<GameState['slices']['data']['feedbackReviews']>[string];
type Training = GameState['slices']['models']['trainingRuns'][string];
type Model = GameState['slices']['models']['versions'][string];
type Rehearsal = NonNullable<GameState['slices']['products']['releaseRehearsals']>[string];
type Release = NonNullable<GameState['slices']['products']['preparedReleases']>[string];
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave10-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string; fixtureWeek: number;
  productId: string; sourceModelId: string; baseModelId: string; candidateModelId: string;
  studyId: string; reviewId: string; packetId: string; trainingId: string; rehearsalId: string; releaseId: string;
  commands: RecordedCommand[]; reviewCommand: RecordedCommand;
  originalStudy: Study; originalReview: Review; originalSourceModel: Model; originalBaseModel: Model;
  originalContract: GameState['slices']['products']['contracts'][string];
  producedPacket: GameState['slices']['data']['packets'][string];
  originalCostReport: { week: number; hash: string };
  naturalProgression: { completedCampaignWeek: number; completedCampaignChecksum: string; completedCampaignBytes: number; commands: RecordedCommand[] };
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    product: GameState['slices']['products']['offers'][string];
    deployment: GameState['slices']['products']['deployments'][string];
    originalSourceDeploymentStillLive: boolean; studyHash: string; review: Review; packetHash: string | null;
    training: Training | null; candidateStatus: Model['status'] | null; candidateHash: string | null;
    candidateRights: { hosted: boolean; weights: boolean } | null;
    evaluations: { id: string; week: number; suiteId?: string; hash: string }[];
    rehearsal: Rehearsal | null; release: Release | null;
    contract: GameState['slices']['products']['contracts'][string];
    usage: GameState['slices']['products']['lastUsage'][string];
    invoice: GameState['slices']['products']['invoices'][number];
    costs: { week: number; reportHash: string; historyWeeks: number[]; priorWeekRetained: boolean;
      priorReportHash: string | null; totals: ComputeCostTotals };
    commercialContracts: { id: string; termIndex: number; termWeeksServed: number; lifetimeBilledCents: number }[];
  }[];
};
const envelope = () => JSON.parse(raw) as Envelope;
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }
const loadHistorical = () => loadHistoricalSnapshot(raw);
function queueScheduled(state: GameState) {
  for (const command of oracle.commands.filter(command => command.week === state.week)) {
    const result = submitCommand(state, command.payload, historicalContent(state), command.id);
    assert.ok(result.accepted, result.reason?.message); state = result.state;
  }
  return state;
}
function step(state: GameState) {
  const pending = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
  const result = advanceWeek(state, historicalContent(state)); assert.ok(result.accepted, result.reason?.message);
  for (const command of pending) assert.equal(result.state.commandReceipts[command.id]?.status, 'accepted');
  return result.state;
}
function normalizedHash(state: GameState) {
  return canonicalStateHash({ ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent });
}
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function olderEnvelope(wave: number) { return JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope; }
function assertNoPolicy(state: GameState) {
  for (const model of Object.values(state.slices.models.versions)) assert.equal(Object.hasOwn(model, 'policy'), false);
  for (const packet of Object.values(state.slices.data.packets)) assert.equal(Object.hasOwn(packet, 'policy'), false);
  for (const run of Object.values(state.slices.models.trainingRuns)) {
    assert.equal(Object.hasOwn(run.evidence, 'policy'), false);
    if (run.plan) {
      assert.equal(Object.hasOwn(run.plan, 'policy'), false);
      assert.equal(Object.hasOwn(run.plan, 'inheritedPolicy'), false);
    }
  }
  for (const run of Object.values(state.slices.models.evaluationRuns)) assert.equal(Object.hasOwn(run, 'policy'), false);
  for (const report of Object.values(state.slices.models.reports)) {
    assert.equal(Object.hasOwn(report, 'policy'), false);
    for (const item of report.cases) assert.equal(Object.hasOwn(item, 'policy'), false);
  }
}

test('W11-S01: published Wave 10 import preserves closed study identity and a partly paid review without adopting policy fields', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, '63dac0612733705f3ffdfef9d847c16996ba7378');
  assert.equal(oracle.naturalProgression.completedCampaignWeek, 408);
  assert.equal(oracle.naturalProgression.completedCampaignChecksum, '282813c5');
  assert.equal(oracle.naturalProgression.completedCampaignBytes, 1_505_616);
  assert.equal(oracle.naturalProgression.commands.length, 8);
  assert.equal(previous.checksum, '27e47e54'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(new TextEncoder().encode(raw.trimEnd()).byteLength, 1_407_555);
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.11.0');
  assert.equal(current.migratedFrom, 11); assert.equal(current.state.week, 395);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoPolicy(current.state);
  const study = current.state.slices.data.feedbackStudies![oracle.studyId];
  const review = current.state.slices.data.feedbackReviews![oracle.reviewId];
  assert.deepEqual(study, oracle.originalStudy); assert.deepEqual(review, oracle.originalReview);
  assert.equal(study.status, 'closed'); assert.equal(study.reviewableWeek, 394); assert.equal(study.totalCases, 100);
  assert.equal(canonicalStateHash(study), '82fad50e');
  assert.equal(review.status, 'running'); assert.equal(review.completedWork, U); assert.equal(review.physicalWork, 555_555_556);
  assert.equal(review.completedStaff, U); assert.equal(review.requiredStaff, 2 * U); assert.equal(review.availableWeek, null);
  assert.equal(current.state.slices.data.packets[oracle.packetId], undefined);
  assert.equal(current.state.slices.products.offers[oracle.productId].publicModelId, oracle.sourceModelId);
  assert.equal(getComputeCostView(current.state).reports.length, 8);
});

test('W11-S02: fourteen full states match published Wave 10 through reviewed evidence, calibration, release, billing carry and cost expiry', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 14);
  assert.deepEqual(oracle.commands.map(command => command.week), [397, 399, 399, 401, 403, 406]);
  for (const expected of oracle.weeks) {
    const priorCarry = state.slices.products.contracts[oracle.originalContract.id].tokenBillRemainder;
    state = step(queueScheduled(state));
    assert.equal(normalizedHash(state), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoPolicy(state);
    const company = state.slices.company.companies[state.playerCompanyId], product = state.slices.products.offers[oracle.productId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents); assert.equal(company.arrearsCents, 0);
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected.trustBps);
    assert.deepEqual(product, expected.product); assert.deepEqual(state.slices.products.deployments[product.deploymentId], expected.deployment);
    const study = state.slices.data.feedbackStudies![oracle.studyId], review = state.slices.data.feedbackReviews![oracle.reviewId];
    const packet = state.slices.data.packets[oracle.packetId], training = state.slices.models.trainingRuns[oracle.trainingId];
    const candidate = state.slices.models.versions[oracle.candidateModelId];
    assert.deepEqual(study, oracle.originalStudy); assert.equal(canonicalStateHash(study), expected.studyHash);
    assert.equal(Object.hasOwn(state.slices.products.deployments, study.sourceDeploymentId), expected.originalSourceDeploymentStillLive);
    assert.deepEqual(review, expected.review); assert.equal(packet ? canonicalStateHash(packet) : null, expected.packetHash);
    if (packet) assert.deepEqual(packet, oracle.producedPacket);
    assert.deepEqual(training ?? null, expected.training);
    if (training) {
      assert.deepEqual(training.plan!.corpus.sourceIds, oracle.producedPacket.sourceIds);
      assert.equal(training.plan!.corpus.behaviorUnits, 100); assert.equal(training.plan!.corpus.broadUnits, 0);
      assert.equal(Object.hasOwn(training.evidence, 'feedback'), false);
    }
    assert.equal(candidate?.status ?? null, expected.candidateStatus);
    assert.equal(candidate ? canonicalStateHash(candidate) : null, expected.candidateHash);
    assert.deepEqual(candidate ? inheritedModelRights(state, candidate.id, CONTENT) : null, expected.candidateRights);
    assert.deepEqual(state.slices.models.versions[oracle.sourceModelId], oracle.originalSourceModel);
    assert.deepEqual(state.slices.models.versions[oracle.baseModelId], oracle.originalBaseModel);
    assert.deepEqual(Object.values(state.slices.models.reports).filter(report => report.modelId === oracle.candidateModelId)
      .map(report => ({ id: report.id, week: report.week, suiteId: report.suiteId, hash: canonicalStateHash(report) })), expected.evaluations);
    assert.deepEqual(state.slices.products.releaseRehearsals?.[oracle.rehearsalId] ?? null, expected.rehearsal);
    assert.deepEqual(state.slices.products.preparedReleases?.[oracle.releaseId] ?? null, expected.release);
    const usage = state.slices.products.lastUsage[oracle.productId], contract = state.slices.products.contracts[product.contractId];
    assert.deepEqual(usage, expected.usage); assert.deepEqual(contract, expected.contract);
    assert.equal(usage.fulfillmentBps, 10_000); assert.equal(usage.tokens!.billCarryIn, priorCarry);
    assert.equal(product.contractId, oracle.originalContract.id);
    assert.deepEqual({ ...contract, tokenBillRemainder: 0 }, { ...oracle.originalContract, tokenBillRemainder: 0 });
    const invoices = state.slices.products.invoices.filter(item => item.productId === oracle.productId && item.week === state.week);
    assert.equal(invoices.length, 1); assert.deepEqual(invoices[0], expected.invoice);
    const view = getComputeCostView(state), latest = view.latest!;
    assert.equal(canonicalStateHash(latest), expected.costs.reportHash); assert.deepEqual(latest.totals, expected.costs.totals);
    assert.equal(view.reports.length, 8); assert.deepEqual(view.reports.map(report => report.week), expected.costs.historyWeeks);
    const historical = view.reports.find(report => report.week === oracle.originalCostReport.week);
    assert.equal(Boolean(historical), expected.costs.priorWeekRetained);
    assert.equal(historical ? canonicalStateHash(historical) : null, expected.costs.priorReportHash);
    if (historical) assert.equal(canonicalStateHash(historical), oracle.originalCostReport.hash);
    assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
    assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
    for (const contract of expected.commercialContracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
  }
  assert.equal(oracle.weeks.find(week => week.packetHash)!.week, 397);
  assert.equal(oracle.weeks.find(week => week.training?.status === 'complete')!.week, 399);
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 403);
  assert.equal(oracle.weeks.find(week => week.release?.status === 'released')!.week, 408);
  assert.equal(oracle.weeks.find(week => week.week === 408)!.hash, '282813c5');
  assert.equal(oracle.weeks.at(-1)!.release!.rollbackExpiresWeek, 414);
  assert.equal(oracle.weeks.at(-1)!.hash, '57ebbf02');
});

test('W11-S03: reloading each command boundary preserves once-only review publication, training and release with the old full-state oracle', () => {
  let state = loadHistorical().state;
  for (const expected of oracle.weeks) {
    state = queueScheduled(state);
    const restored = deserializeState(serializeState(state, historicalContent(state)), historicalContent(state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.equal(restored.migratedFrom, undefined); state = step(restored.state);
    assert.equal(normalizedHash(state), expected.hash);
    const review = state.slices.data.feedbackReviews![oracle.reviewId];
    if (state.week === 396) { assert.equal(review.status, 'ready'); assert.equal(review.availableWeek, 397); }
    if (state.week >= 397) {
      assert.equal(review.status, 'complete'); assert.equal(review.availableWeek, 397);
      assert.equal(canonicalStateHash(state.slices.data.packets[oracle.packetId]), '63f3644a');
    }
    if (state.week >= 408) {
      const release = state.slices.products.preparedReleases![oracle.releaseId];
      assert.equal(release.releasedWeek, 408); assert.equal(release.rollbackExpiresWeek, 414);
      assert.equal(Object.hasOwn(state.slices.products.deployments, oracle.originalStudy.sourceDeploymentId), false);
      assert.deepEqual(state.slices.data.feedbackStudies![oracle.studyId], oracle.originalStudy);
    }
  }
  assert.equal(state.slices.products.offers[oracle.productId].publicModelId, oracle.candidateModelId);
});

test('W11-S04: a corrupted published checksum is rejected before migration changes the original representation', () => {
  const corrupt = envelope(); corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W11-S05: model policy and policy data provenance are rejected under every Wave 0–10 header, including empty or false fields', () => {
  for (let wave = 0; wave <= 10; wave++) {
    for (const value of [{}, false]) {
      const model = olderEnvelope(wave);
      Object.assign(Object.values(model.state.slices.models.versions)[0], { policy: value });
      assert.equal(deserializeState(encoded(model)).ok, false, `Wave ${wave} accepted model policy.`);
      const data = olderEnvelope(wave);
      Object.assign(Object.values(data.state.slices.data.packets)[0], { policy: value });
      assert.equal(deserializeState(encoded(data)).ok, false, `Wave ${wave} accepted policy data provenance.`);
    }
  }
});

test('W11-S06: dedicated policy data purchases, both recipes and policy evaluations cannot be queued beneath older headers', () => {
  const payloads = [
    { kind: 'buy_data', catalogId: 'policy-boundary-pairs-1' },
    { kind: 'start_training', baseModelId: 'saved-model', packetId: 'saved-packet', recipeId: 'policy-boundary-discrimination' },
    { kind: 'start_training', baseModelId: 'saved-model', packetId: 'saved-packet', recipeId: 'policy-conservative-refusal' },
    { kind: 'evaluate_model', modelId: 'saved-model', suiteId: 'policy-boundaries-1' },
  ];
  for (let wave = 0; wave <= 10; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-new-policy', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${JSON.stringify(payload)}.`);
    }
  }
});

test('W11-S07: frozen training evidence, plans, inherited policies and evaluation receipts cannot hide new provenance under older headers', () => {
  const counts = { evidence: 0, plan: 0, inherited: 0, evaluation: 0, report: 0, cases: 0 };
  for (let wave = 0; wave <= 10; wave++) {
    const changes: { key: keyof typeof counts; target: (state: GameState) => object | undefined; field: string }[] = [
      { key: 'evidence', target: state => Object.values(state.slices.models.trainingRuns ?? {})[0]?.evidence, field: 'policy' },
      { key: 'plan', target: state => Object.values(state.slices.models.trainingRuns ?? {}).find(run => run.plan)?.plan, field: 'policy' },
      { key: 'inherited', target: state => Object.values(state.slices.models.trainingRuns ?? {}).find(run => run.plan)?.plan, field: 'inheritedPolicy' },
      { key: 'evaluation', target: state => Object.values(state.slices.models.evaluationRuns ?? {})[0], field: 'policy' },
      { key: 'report', target: state => Object.values(state.slices.models.reports ?? {})[0], field: 'policy' },
      { key: 'cases', target: state => Object.values(state.slices.models.reports ?? {}).find(report => report.cases.length)?.cases[0], field: 'policy' },
    ];
    for (const change of changes) {
      const forged = olderEnvelope(wave), target = change.target(forged.state);
      if (!target) continue;
      counts[change.key]++; Object.assign(target, { [change.field]: {} });
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${change.key} policy provenance.`);
    }
  }
  assert.deepEqual(counts, { evidence: 8, plan: 7, inherited: 7, evaluation: 9, report: 10, cases: 10 });
});

test('W11-S08: policy catalog, recipe, plan kind and suite IDs remain unavailable under older headers even without optional provenance', () => {
  for (let wave = 0; wave <= 10; wave++) {
    const catalog = olderEnvelope(wave), packet = Object.values(catalog.state.slices.data.packets)[0];
    packet.catalogId = 'policy-boundary-pairs-1';
    assert.equal(deserializeState(encoded(catalog)).ok, false, `Wave ${wave} accepted the policy catalog.`);
    const sources = olderEnvelope(wave); Object.values(sources.state.slices.data.packets)[0].sourceIds = ['policy-boundary-pairs-1'];
    assert.equal(deserializeState(encoded(sources)).ok, false, `Wave ${wave} accepted policy source identity.`);
    for (const recipeId of ['policy-boundary-discrimination', 'policy-conservative-refusal']) {
      const training = olderEnvelope(wave), run = Object.values(training.state.slices.models.trainingRuns ?? {})[0];
      if (!run) continue;
      run.recipeId = recipeId;
      assert.equal(deserializeState(encoded(training)).ok, false, `Wave ${wave} accepted ${recipeId}.`);
    }
    const planned = olderEnvelope(wave), plan = Object.values(planned.state.slices.models.trainingRuns ?? {}).find(run => run.plan)?.plan;
    if (plan) {
      Object.assign(plan, { kind: 'policy' });
      assert.equal(deserializeState(encoded(planned)).ok, false, `Wave ${wave} accepted a policy training plan.`);
    }
    for (const collection of ['evaluationRuns', 'reports'] as const) {
      const evaluated = olderEnvelope(wave), entry = Object.values(evaluated.state.slices.models[collection] ?? {})[0];
      if (!entry) continue;
      Object.assign(entry, { suiteId: 'policy-boundaries-1' });
      assert.equal(deserializeState(encoded(evaluated)).ok, false, `Wave ${wave} accepted a policy ${collection} suite.`);
    }
  }
});

test('W11-S09: every published generation migrates with policy fields absent and preserves its older feedback rights', () => {
  for (let wave = 0; wave <= 10; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1);
    assertNoPolicy(result.state);
    for (const packet of Object.values(previous.state.slices.data.packets)) {
      assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    }
  }
});

test('W11-S10: authentic Wave 10 feedback records remain unavailable beneath a relabeled Wave 9 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.10.0'; forged.state.contentVersion = '0.10.0'; forged.state.buildVersion = '0.10.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});

test('W11-S11: unknown future content is rejected without changing a published snapshot', () => {
  const future = envelope();
  future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const text = encoded(future), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /not supported/);
  assert.equal(encoded(future), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});
