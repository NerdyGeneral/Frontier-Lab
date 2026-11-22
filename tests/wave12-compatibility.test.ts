import { historicalContent, loadHistoricalSnapshot } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, EvaluationReport, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ComputeCostTotals } from '../src/contracts/wave8-costs';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { inheritedModelRights } from '../src/modules/model-runtime';

// Captured with the exact published Wave 11 engine before Wave 12 production
// edits. The original natural campaign reproduces Week 432 hash 473327f1 and its
// 1,741,312-byte export. This fixture starts earlier, after one paid week of
// policy training; the twenty-five future hashes are independently frozen.
const raw = readFileSync(join(__dirname, 'fixtures/wave11-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
type Study = NonNullable<GameState['slices']['data']['feedbackStudies']>[string];
type Training = GameState['slices']['models']['trainingRuns'][string];
type Model = GameState['slices']['models']['versions'][string];
type Rehearsal = NonNullable<GameState['slices']['products']['releaseRehearsals']>[string];
type Release = NonNullable<GameState['slices']['products']['preparedReleases']>[string];
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave11-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string; fixtureWeek: number; snapshotBytes: number;
  productId: string; sourceModelId: string; boundaryId: string; conservativeId: string; packetId: string;
  rehearsalId: string; releaseId: string; studyId: string; trainingIds: string[];
  commands: RecordedCommand[]; creationCommands: RecordedCommand[];
  originalPolicyData: GameState['slices']['data']['packets'][string];
  originalSourceModel: Model; originalTrainings: Training[]; originalPolicyReport: EvaluationReport;
  originalContract: GameState['slices']['products']['contracts'][string];
  originalStudy: Study; preservedInvoiceId: string;
  originalCostReport: { week: number; hash: string };
  naturalProgression: { completedCampaignWeek: number; completedCampaignChecksum: string; completedCampaignBytes: number; commands: RecordedCommand[] };
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    product: GameState['slices']['products']['offers'][string];
    deployment: GameState['slices']['products']['deployments'][string];
    contract: GameState['slices']['products']['contracts'][string];
    usage: GameState['slices']['products']['lastUsage'][string];
    invoice: GameState['slices']['products']['invoices'][number];
    trainings: { id: string; status: Training['status']; completedWork: number; physicalWork: number;
      checkpointWork: number; checkpointModelId: string | null; hash: string }[];
    models: { id: string; hash: string | null; status: Model['status'] | null;
      policy: Model['policy'] | null; behavior: Model['behavior'] | null; rights: { hosted: boolean; weights: boolean } | null }[];
    reports: { id: string; modelId: string; suiteId: string; week: number; hash: string;
      policyTotals: NonNullable<EvaluationReport['policy']>['totals'] | null }[];
    rehearsal: Rehearsal | null; release: Release | null;
    originalStudyHash: string; settledInvoiceProofRetained: boolean; preservedInvoiceInOrdinaryHistory: boolean;
    newStudy: { hash: string; status: Study['status']; totalCases: number; sourceModelId: string; sourceModelFingerprint: string } | null;
    costs: { week: number; hash: string; totals: ComputeCostTotals; historyWeeks: number[];
      priorWeekRetained: boolean; priorReportHash: string | null };
    commercialContracts: { id: string; termIndex: number; termWeeksServed: number; lifetimeBilledCents: number }[];
  }[];
};

const envelope = () => JSON.parse(raw) as Envelope;
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }
const loadHistorical = () => loadHistoricalSnapshot(raw);
function queueScheduled(state: GameState) {
  for (const command of oracle.commands.filter(command => command.week === state.week)) {
    const next = submitCommand(state, command.payload, historicalContent(state), command.id);
    assert.ok(next.accepted, next.reason?.message); state = next.state;
  }
  return state;
}
function step(state: GameState) {
  const queued = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
  const next = advanceWeek(state, historicalContent(state)); assert.ok(next.accepted, next.reason?.message);
  for (const command of queued) assert.equal(next.state.commandReceipts[command.id]?.status, 'accepted');
  return next.state;
}
function normalizedHash(state: GameState) {
  return canonicalStateHash({ ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent });
}
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function olderEnvelope(wave: number) { return JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope; }
function assertNoGuardrails(state: GameState) {
  assert.equal(Object.hasOwn(state.slices.products, 'runtimeGuardrails'), false);
  for (const usage of Object.values(state.slices.products.lastUsage)) assert.equal(Object.hasOwn(usage, 'guardrail'), false);
  for (const rehearsal of Object.values(state.slices.products.releaseRehearsals ?? {})) {
    assert.equal(Object.hasOwn(rehearsal.configuration, 'guardrail'), false);
  }
  for (const study of Object.values(state.slices.data.feedbackStudies ?? {})) {
    for (const row of study.weeks) assert.equal(Object.hasOwn(row.paidUsage, 'guardrail'), false);
  }
}

test('W12-S01: authentic Wave 11 import keeps paid policy training, exact holdouts and rights without adopting runtime guardrails', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, 'fe5ed4ce856c3bf8733cbd2ef2d3c4e07759b78b');
  assert.equal(oracle.naturalProgression.completedCampaignWeek, 432);
  assert.equal(oracle.naturalProgression.completedCampaignChecksum, '473327f1');
  assert.equal(oracle.naturalProgression.completedCampaignBytes, 1_741_312);
  assert.equal(oracle.naturalProgression.commands.length, 13);
  assert.equal(previous.checksum, 'edd7b81a'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(Buffer.byteLength(raw.trimEnd()), 1_565_342); assert.equal(oracle.snapshotBytes, 1_565_342);
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.12.0');
  assert.equal(current.migratedFrom, 12); assert.equal(current.state.week, 411);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoGuardrails(current.state);
  assert.deepEqual(current.state.slices.data.packets[oracle.packetId], oracle.originalPolicyData);
  assert.equal(oracle.originalPolicyData.policy!.pairs, 100); assert.equal(oracle.originalPolicyData.readyUnits, 200);
  assert.deepEqual(current.state.slices.models.versions[oracle.sourceModelId], oracle.originalSourceModel);
  for (const expected of oracle.originalTrainings) assert.deepEqual(current.state.slices.models.trainingRuns[expected.id], expected);
  const [boundary, conservative] = oracle.originalTrainings;
  assert.equal(boundary.status, 'running'); assert.equal(boundary.completedWork, 6_799_999_998);
  assert.equal(boundary.physicalWork, 3_777_777_777); assert.equal(boundary.requiredWork, 24 * U);
  assert.equal(conservative.status, 'running'); assert.equal(conservative.completedWork, 0); assert.equal(conservative.requiredWork, 16 * U);
  assert.deepEqual(current.state.slices.models.reports[oracle.originalPolicyReport.id], oracle.originalPolicyReport);
  assert.equal(oracle.originalPolicyReport.policy!.totals.allowedCases, 50);
  assert.equal(oracle.originalPolicyReport.policy!.totals.restrictedCases, 50);
  assert.deepEqual(current.state.slices.data.feedbackStudies![oracle.originalStudy.id], oracle.originalStudy);
  assert.equal(current.state.slices.company.postedFacts[oracle.preservedInvoiceId], true);
});

test('W12-S02: twenty-five full states match published Wave 11 through policy tradeoffs, release, feedback, compute bills and expiry', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 25);
  assert.deepEqual(oracle.commands.map(command => command.week), [416, 416, 418, 418, 420, 422, 425, 427]);
  const modelIds = [oracle.sourceModelId, oracle.boundaryId, oracle.conservativeId];
  for (const expected of oracle.weeks) {
    const carryIn = state.slices.products.contracts[oracle.originalContract.id].tokenBillRemainder;
    state = step(queueScheduled(state));
    assert.equal(normalizedHash(state), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoGuardrails(state);
    const company = state.slices.company.companies[state.playerCompanyId], product = state.slices.products.offers[oracle.productId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents); assert.equal(company.arrearsCents, 0);
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected.trustBps);
    assert.deepEqual(product, expected.product); assert.deepEqual(state.slices.products.deployments[product.deploymentId], expected.deployment);
    assert.deepEqual(state.slices.models.versions[oracle.sourceModelId], oracle.originalSourceModel);
    assert.deepEqual(state.slices.data.packets[oracle.packetId], oracle.originalPolicyData);
    for (const training of expected.trainings) {
      const actual = state.slices.models.trainingRuns[training.id];
      assert.equal(canonicalStateHash(actual), training.hash); assert.equal(actual.status, training.status);
      assert.equal(actual.completedWork, training.completedWork); assert.equal(actual.physicalWork, training.physicalWork);
      assert.equal(actual.checkpointWork, training.checkpointWork); assert.equal(actual.checkpointModelId, training.checkpointModelId);
    }
    for (const model of expected.models) {
      const actual = state.slices.models.versions[model.id];
      assert.equal(actual ? canonicalStateHash(actual) : null, model.hash); assert.equal(actual?.status ?? null, model.status);
      assert.deepEqual(actual?.policy ?? null, model.policy); assert.deepEqual(actual?.behavior ?? null, model.behavior);
      assert.deepEqual(actual ? inheritedModelRights(state, actual.id, CONTENT) : null, model.rights);
    }
    assert.deepEqual(Object.values(state.slices.models.reports).filter(report => modelIds.includes(report.modelId))
      .map(report => ({ id: report.id, modelId: report.modelId, suiteId: report.suiteId, week: report.week,
        hash: canonicalStateHash(report), policyTotals: report.policy?.totals ?? null })), expected.reports);
    assert.deepEqual(state.slices.products.releaseRehearsals?.[oracle.rehearsalId] ?? null, expected.rehearsal);
    assert.deepEqual(state.slices.products.preparedReleases?.[oracle.releaseId] ?? null, expected.release);
    const usage = state.slices.products.lastUsage[oracle.productId], contract = state.slices.products.contracts[product.contractId];
    assert.deepEqual(usage, expected.usage); assert.deepEqual(contract, expected.contract);
    assert.equal(usage.fulfillmentBps, 10_000); assert.equal(usage.tokens!.billCarryIn, carryIn);
    assert.equal(product.contractId, oracle.originalContract.id);
    assert.deepEqual({ ...contract, tokenBillRemainder: 0 }, { ...oracle.originalContract, tokenBillRemainder: 0 });
    const invoices = state.slices.products.invoices.filter(invoice => invoice.productId === oracle.productId && invoice.week === state.week);
    assert.equal(invoices.length, 1); assert.deepEqual(invoices[0], expected.invoice);
    const oldStudy = state.slices.data.feedbackStudies![oracle.originalStudy.id], newStudy = state.slices.data.feedbackStudies?.[oracle.studyId];
    assert.deepEqual(oldStudy, oracle.originalStudy); assert.equal(canonicalStateHash(oldStudy), expected.originalStudyHash);
    assert.equal(state.slices.company.postedFacts[oracle.preservedInvoiceId] === true, expected.settledInvoiceProofRetained);
    assert.equal(state.slices.products.invoices.some(invoice => invoice.id === oracle.preservedInvoiceId), expected.preservedInvoiceInOrdinaryHistory);
    assert.deepEqual(newStudy ? { hash: canonicalStateHash(newStudy), status: newStudy.status, totalCases: newStudy.totalCases,
      sourceModelId: newStudy.sourceModelId, sourceModelFingerprint: newStudy.sourceModelFingerprint } : null, expected.newStudy);
    const costs = getComputeCostView(state), latest = costs.latest!, prior = costs.reports.find(report => report.week === oracle.originalCostReport.week);
    assert.equal(canonicalStateHash(latest), expected.costs.hash); assert.deepEqual(latest.totals, expected.costs.totals);
    assert.deepEqual(costs.reports.map(report => report.week), expected.costs.historyWeeks); assert.equal(costs.reports.length, 8);
    assert.equal(Boolean(prior), expected.costs.priorWeekRetained);
    assert.equal(prior ? canonicalStateHash(prior) : null, expected.costs.priorReportHash);
    if (prior) assert.equal(canonicalStateHash(prior), oracle.originalCostReport.hash);
    assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
    assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
    for (const contract of expected.commercialContracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
  }
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 419);
  assert.equal(oracle.weeks.find(week => week.product.publicModelId === oracle.boundaryId)!.week, 427);
  assert.equal(state.slices.data.feedbackStudies![oracle.studyId].totalCases, 100);
  assert.equal(state.slices.models.versions[oracle.boundaryId].policy!.currentUnsafeComplianceBps, 660);
  assert.equal(state.slices.models.versions[oracle.boundaryId].behavior!.falseRefusalBps, 385);
  assert.equal(state.slices.models.versions[oracle.conservativeId].policy!.currentUnsafeComplianceBps, 390);
  assert.equal(state.slices.models.versions[oracle.conservativeId].behavior!.falseRefusalBps, 1150);
  assert.equal(normalizedHash(state), '2ceb6fe1');
});

test('W12-S03: reloads preserve queued policy tests, partial work, exact reports and the explicit release boundary', () => {
  let state = loadHistorical().state;
  for (const expected of oracle.weeks) {
    state = queueScheduled(state);
    const text = serializeState(state, historicalContent(state)), restored = deserializeState(text, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), text); state = step(restored.state);
    assert.equal(normalizedHash(state), expected.hash); assertNoGuardrails(state);
    if (state.week === 426) {
      assert.equal(state.slices.products.offers[oracle.productId].publicModelId, oracle.sourceModelId);
      assert.equal(state.slices.products.preparedReleases![oracle.releaseId].status, 'scheduled');
    }
    if (state.week >= 427) {
      assert.equal(state.slices.products.offers[oracle.productId].publicModelId, oracle.boundaryId);
      assert.equal(state.slices.products.preparedReleases![oracle.releaseId].releasedWeek, 427);
      assert.equal(state.slices.products.lastUsage[oracle.productId].behavior!.falseRefusalBps, 385);
    }
  }
  assert.equal(state.week, 436); assert.equal(normalizedHash(state), '2ceb6fe1');
});

test('W12-S04: corrupted published checksums are rejected before migration can change the original representation', () => {
  const corrupt = envelope(); corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W12-S05: empty, false and populated runtime guardrail records cannot hide beneath any Wave 0–11 header', () => {
  for (let wave = 0; wave <= 11; wave++) {
    for (const value of [{}, false, { 'old-header-guardrail': { profile: 'balanced', enabled: true } }]) {
      const forged = olderEnvelope(wave);
      Object.assign(forged.state.slices.products, { runtimeGuardrails: value });
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted runtimeGuardrails.`);
    }
  }
});

test('W12-S06: both runtime guardrail actions remain unavailable in every published older header', () => {
  const payloads = [
    { kind: 'install_runtime_guardrail', productId: oracle.productId, profile: 'balanced' },
    { kind: 'install_runtime_guardrail', productId: oracle.productId, profile: 'strict' },
    { kind: 'set_runtime_guardrail_enabled', productId: oracle.productId, enabled: true },
    { kind: 'set_runtime_guardrail_enabled', productId: oracle.productId, enabled: false },
  ];
  for (let wave = 0; wave <= 11; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-new-guardrail', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${JSON.stringify(payload)}.`);
    }
  }
});

test('W12-S07: serving, rehearsal and paid-feedback guardrail attribution cannot be smuggled through older headers', () => {
  const counts = { usage: 0, rehearsal: 0, feedback: 0 };
  for (let wave = 0; wave <= 11; wave++) {
    const changes: { key: keyof typeof counts; target: (state: GameState) => object | undefined }[] = [
      { key: 'usage', target: state => Object.values(state.slices.products.lastUsage ?? {})[0] },
      { key: 'rehearsal', target: state => Object.values(state.slices.products.releaseRehearsals ?? {})[0]?.configuration },
      { key: 'feedback', target: state => Object.values(state.slices.data.feedbackStudies ?? {}).find(study => study.weeks.length)?.weeks[0].paidUsage },
    ];
    for (const change of changes) {
      for (const value of [{}, false]) {
        const forged = olderEnvelope(wave), target = change.target(forged.state);
        if (!target) continue;
        counts[change.key]++; Object.assign(target, { guardrail: value });
        assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${change.key} guardrail attribution.`);
      }
    }
  }
  assert.deepEqual(counts, { usage: 20, rehearsal: 6, feedback: 4 });
});

test('W12-S08: every published generation migrates without runtime adoption while preserving existing data rights and policy evidence', () => {
  for (let wave = 0; wave <= 11; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1);
    assertNoGuardrails(result.state);
    for (const packet of Object.values(previous.state.slices.data.packets)) {
      assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
      if (packet.policy) assert.deepEqual(result.state.slices.data.packets[packet.id].policy, packet.policy);
    }
    for (const model of Object.values(previous.state.slices.models.versions)) {
      if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    }
    for (const report of Object.values(previous.state.slices.models.reports ?? {})) {
      if (report.policy) assert.deepEqual(result.state.slices.models.reports[report.id], report);
    }
  }
});

test('W12-S09: authentic Wave 11 policy work stays unavailable beneath a relabeled Wave 10 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.11.0'; forged.state.contentVersion = '0.11.0'; forged.state.buildVersion = '0.11.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});

test('W12-S10: unknown future content is rejected without altering the published policy snapshot', () => {
  const future = envelope();
  future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const text = encoded(future), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /not supported/);
  assert.equal(encoded(future), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});
