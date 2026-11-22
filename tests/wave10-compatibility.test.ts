import { historicalContent, loadHistoricalSnapshot } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ComputeCostTotals } from '../src/contracts/wave8-costs';
import type { PreparedRelease } from '../src/contracts/wave9-releases';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';

// Captured with the exact published Wave 9 engine before Wave 10 edits. The
// natural company has a completed rehearsal and partly paid forward preparation.
// Ordinary commands below reproduce its promotion, paid rollback and restoration.
const raw = readFileSync(join(__dirname, 'fixtures/wave9-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
const envelope = () => JSON.parse(raw) as Envelope;
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave9-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string; fixtureWeek: number;
  productId: string; sourceModelId: string; candidateModelId: string; rehearsalId: string; releaseId: string;
  commands: RecordedCommand[];
  originalRehearsal: NonNullable<GameState['slices']['products']['releaseRehearsals']>[string];
  originalModel: GameState['slices']['models']['versions'][string];
  originalContract: GameState['slices']['products']['contracts'][string];
  originalCostReport: { week: number; hash: string };
  naturalProgression: { completedCampaignChecksum: string; commands: RecordedCommand[] };
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    product: GameState['slices']['products']['offers'][string];
    deployment: GameState['slices']['products']['deployments'][string];
    candidateStatus: GameState['slices']['models']['versions'][string]['status'];
    rehearsalHash: string; release: PreparedRelease;
    contract: GameState['slices']['products']['contracts'][string];
    usage: GameState['slices']['products']['lastUsage'][string];
    invoice: GameState['slices']['products']['invoices'][number];
    costs: { week: number; reportHash: string; historyWeeks: number[]; priorWeekRetained: boolean;
      priorReportHash: string | null; totals: ComputeCostTotals };
    commercialContracts: { id: string; termIndex: number; termWeeksServed: number; lifetimeBilledCents: number }[];
  }[];
};
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
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function olderEnvelope(wave: number) { return JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope; }
function assertNoFeedback(state: GameState) {
  for (const field of ['feedbackStudies', 'feedbackReviews']) assert.equal(Object.hasOwn(state.slices.data, field), false);
  assert.ok(Object.values(state.slices.data.packets).every(packet => !Object.hasOwn(packet, 'feedback')));
  assert.ok(Object.values(state.slices.models.trainingRuns).every(run => !Object.hasOwn(run.evidence, 'feedback')));
}

test('W10-S01: published Wave 9 import preserves paid preparation, completed rehearsal and cost history without adopting feedback', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, 'de0cb0a0c4b2b3ca8fb1cc9534b528f86fd85b6e');
  assert.equal(oracle.naturalProgression.completedCampaignChecksum, '4dff9002');
  assert.equal(oracle.naturalProgression.commands.length, 9);
  assert.equal(previous.checksum, '843ffe68'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.10.0');
  assert.equal(current.migratedFrom, 10); assert.equal(current.state.week, 381);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoFeedback(current.state);
  const release = current.state.slices.products.preparedReleases![oracle.releaseId];
  assert.equal(release.status, 'preparing'); assert.equal(release.completedWork, U);
  assert.equal(release.completedStaff, U); assert.equal(release.physicalWork, 555_555_556);
  assert.equal(release.requiredWork, 2 * U); assert.equal(release.availableWeek, null);
  assert.deepEqual(current.state.slices.products.releaseRehearsals![oracle.rehearsalId], oracle.originalRehearsal);
  assert.equal(current.state.slices.products.offers[oracle.productId].publicModelId, oracle.sourceModelId);
  assert.equal(current.state.slices.models.versions[oracle.candidateModelId].status, 'evaluated');
  assert.equal(getComputeCostView(current.state).reports.length, 8);
});

test('W10-S02: twelve full states match published Wave 9 through promotion, paid rollback, token billing and cost expiry', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 12); assert.deepEqual(oracle.commands.map(command => command.week), [383, 385, 387]);
  for (const expected of oracle.weeks) {
    const priorCarry = state.slices.products.contracts[oracle.originalContract.id].tokenBillRemainder;
    state = step(queueScheduled(state));
    const normalized = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
    assert.equal(canonicalStateHash(normalized), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoFeedback(state);
    const company = state.slices.company.companies[state.playerCompanyId], product = state.slices.products.offers[oracle.productId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents);
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected.trustBps);
    assert.deepEqual(product, expected.product); assert.deepEqual(state.slices.products.deployments[product.deploymentId], expected.deployment);
    assert.deepEqual(state.slices.products.preparedReleases![oracle.releaseId], expected.release);
    assert.equal(state.slices.models.versions[oracle.candidateModelId].status, expected.candidateStatus);
    assert.deepEqual(state.slices.models.versions[oracle.sourceModelId], oracle.originalModel);
    assert.deepEqual(state.slices.products.releaseRehearsals![oracle.rehearsalId], oracle.originalRehearsal);
    const usage = state.slices.products.lastUsage[oracle.productId], contract = state.slices.products.contracts[product.contractId];
    assert.deepEqual(usage, expected.usage); assert.deepEqual(contract, expected.contract);
    assert.equal(usage.fulfillmentBps, 10_000); assert.equal(usage.tokens!.billCarryIn, priorCarry);
    assert.equal(product.contractId, oracle.originalContract.id);
    assert.deepEqual({ ...contract, tokenBillRemainder: 0 }, { ...oracle.originalContract, tokenBillRemainder: 0 });
    const invoices = state.slices.products.invoices.filter(item => item.productId === oracle.productId && item.week === state.week);
    assert.equal(invoices.length, 1); assert.deepEqual(invoices[0], expected.invoice);
    const view = getComputeCostView(state), latest = view.latest!;
    assert.equal(canonicalStateHash(latest), expected.costs.reportHash); assert.deepEqual(latest.totals, expected.costs.totals);
    assert.deepEqual(view.reports.map(report => report.week), expected.costs.historyWeeks);
    const historical = view.reports.find(report => report.week === oracle.originalCostReport.week);
    assert.equal(Boolean(historical), expected.costs.priorWeekRetained);
    assert.equal(historical ? canonicalStateHash(historical) : null, expected.costs.priorReportHash);
    if (historical) assert.equal(canonicalStateHash(historical), oracle.originalCostReport.hash);
    assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
    assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(latest.totals.companyOperatingCents, company.lastWeek.operatingExpenseCents);
    for (const contract of expected.commercialContracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
  }
  assert.equal(oracle.weeks.find(week => week.release.status === 'released')!.week, 385);
  assert.equal(oracle.weeks.find(week => week.release.rollback?.status === 'complete')!.week, 389);
  assert.equal(oracle.weeks.find(week => week.week === 389)!.hash, '4dff9002');
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 387);
  assert.equal(oracle.weeks.at(-1)!.release.rollbackExpiresWeek, 391);
  assert.equal(oracle.weeks.at(-1)!.hash, '014efbcf');
});

test('W10-S03: save/reload preserves queued promotions, once-only cutovers and the original rollback deadline', () => {
  let uninterrupted = loadHistorical().state, reloaded = loadHistorical().state;
  for (let index = 0; index < 12; index++) {
    uninterrupted = queueScheduled(uninterrupted); reloaded = queueScheduled(reloaded);
    const restored = deserializeState(serializeState(reloaded, historicalContent(reloaded)), historicalContent(reloaded)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.equal(restored.migratedFrom, undefined);
    uninterrupted = step(uninterrupted); reloaded = step(restored.state);
    assert.equal(canonicalStateHash(reloaded), canonicalStateHash(uninterrupted));
    const release = reloaded.slices.products.preparedReleases![oracle.releaseId];
    if (reloaded.week === 384) assert.equal(release.status, 'scheduled');
    if (reloaded.week === 388) assert.equal(release.rollback!.status, 'scheduled');
    if (reloaded.week >= 385) { assert.equal(release.releasedWeek, 385); assert.equal(release.rollbackExpiresWeek, 391); }
    if (reloaded.week >= 389) { assert.equal(release.rollback!.status, 'complete'); assert.equal(release.rollback!.restoredWeek, 389); }
  }
  assert.equal(reloaded.slices.products.offers[oracle.productId].publicModelId, oracle.sourceModelId);
  assert.deepEqual(reloaded.slices.models.versions[oracle.sourceModelId], oracle.originalModel);
});

test('W10-S04: a corrupted published checksum is rejected before migration changes its representation', () => {
  const corrupt = envelope(); corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W10-S05: feedback study and review maps cannot hide beneath any Wave 0–9 header, including empty maps', () => {
  for (let wave = 0; wave <= 9; wave++) {
    for (const field of ['feedbackStudies', 'feedbackReviews']) {
      const forged = olderEnvelope(wave); Object.assign(forged.state.slices.data, { [field]: {} });
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${field}.`);
    }
  }
});

test('W10-S06: all four feedback commands are rejected beneath every older header, including false pause options', () => {
  const payloads = [
    { kind: 'start_feedback_study', productId: 'saved-product', sampling: 'representative', consent: 'hosted-only' },
    { kind: 'cancel_feedback_study', studyId: 'saved-study' },
    { kind: 'start_feedback_review', studyId: 'saved-study', mode: 'verified' },
    { kind: 'set_feedback_review_paused', reviewId: 'saved-review', paused: false },
  ];
  for (let wave = 0; wave <= 9; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-new-feedback', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${payload.kind}.`);
    }
  }
});

test('W10-S07: feedback provenance is rejected on older packets and frozen training evidence, even without its study maps', () => {
  let trainingFixtures = 0;
  for (let wave = 0; wave <= 9; wave++) {
    const forged = olderEnvelope(wave), packet = Object.values(forged.state.slices.data.packets)[0];
    Object.assign(packet, { feedback: {} });
    assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} incorrectly accepted packet feedback.`);
    const training = olderEnvelope(wave), run = Object.values(training.state.slices.models.trainingRuns ?? {})[0];
    if (run) {
      trainingFixtures++;
      Object.assign(run.evidence, { feedback: {} });
      assert.equal(deserializeState(encoded(training)).ok, false, `Wave ${wave} incorrectly accepted training feedback.`);
    }
  }
  assert.equal(trainingFixtures, 7, 'Exercise every authentic fixture that contains a training evidence snapshot.');
});

test('W10-S08: legacy rights.feedback flags remain accepted and unchanged across all published save generations', () => {
  for (let wave = 0; wave <= 9; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1);
    for (const packet of Object.values(previous.state.slices.data.packets)) {
      assert.ok(Object.hasOwn(packet.rights, 'feedback'));
      assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    }
    assertNoFeedback(result.state);
  }
});

test('W10-S09: authentic Wave 9 release records remain unavailable beneath a relabeled Wave 8 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.9.0'; forged.state.contentVersion = '0.9.0'; forged.state.buildVersion = '0.9.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});
