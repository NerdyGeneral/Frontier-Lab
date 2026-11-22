import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ComputeCostTotals } from '../src/contracts/wave8-costs';
import type { RuntimeGuardrailInstallation } from '../src/contracts/wave12-guardrails';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState, MAX_SNAPSHOT_BYTES } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { activeRuntimeGuardrail, currentRuntimeGuardrail, pendingRuntimeGuardrail, runtimeGuardrailInputsMatch } from '../src/modules/runtime-guardrails';
import { getQualifiedReleaseRehearsal, releaseConfigurationFingerprint } from '../src/modules/release-rehearsals';

// Independently captured with the published Wave 12 engine at aeb403c6… before
// Wave 13 source edits. This authentic campaign has a half-paid requalification
// rollout and an older stale checker. Its continuation reproduces the published
// Week 449 campaign and the entire eight-installation save-budget branch.
const raw = readFileSync(join(__dirname, 'fixtures/wave12-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
type Study = NonNullable<GameState['slices']['data']['feedbackStudies']>[string];
type Rehearsal = NonNullable<GameState['slices']['products']['releaseRehearsals']>[string];
type GuardrailTotals = NonNullable<RuntimeGuardrailInstallation['audit']>['baseline'];
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave12-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string; fixtureWeek: number; snapshotBytes: number;
  productId: string; modelId: string; candidateModelId: string; balancedId: string; strictId: string; requalifiedId: string;
  studyId: string; rehearsalId: string; creationCommands: RecordedCommand[]; commands: RecordedCommand[];
  originalInstallations: RuntimeGuardrailInstallation[];
  originalModel: GameState['slices']['models']['versions'][string];
  originalContract: GameState['slices']['products']['contracts'][string];
  originalStudies: Study[]; preservedInvoiceIds: string[]; originalCostReport: { week: number; hash: string };
  naturalProgression: { completedCampaignWeek: number; completedCampaignChecksum: string; completedCampaignBytes: number; commands: RecordedCommand[] };
  saveBudget: { sourceWeek: number; sourceHash: string; sourceBytes: number; inputByteLimit: number; commands: RecordedCommand[];
    observations: { week: number; installations: number; hash: string; prettyBytes: number; compactBytes: number; savedBytes: number; compacted: boolean }[] };
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    product: GameState['slices']['products']['offers'][string];
    deployment: GameState['slices']['products']['deployments'][string];
    contract: GameState['slices']['products']['contracts'][string];
    usage: GameState['slices']['products']['lastUsage'][string];
    invoice: GameState['slices']['products']['invoices'][number];
    modelHash: string; currentGuardrailId: string | null; activeGuardrailId: string | null; pendingGuardrailId: string | null;
    installations: { id: string; profile: RuntimeGuardrailInstallation['profile']; status: RuntimeGuardrailInstallation['status'];
      enabled: boolean; hash: string; startedWeek: number; completedWeek: number | null; availableWeek: number | null;
      completedWork: number; physicalWork: number; completedStaff: number; bindingFingerprint: string; inputsMatch: boolean;
      auditHash: string | null; baseline: GuardrailTotals | null; guarded: GuardrailTotals | null }[];
    configurationFingerprint: string; qualifiedRehearsalId: string | null; rehearsal: Rehearsal | null;
    studies: { id: string; hash: string; status: Study['status']; totalCases: number; sourceModelId: string }[];
    feedbackInvoices: { id: string; posted: boolean; inOrdinaryHistory: boolean }[];
    costs: { week: number; hash: string; totals: ComputeCostTotals; historyWeeks: number[]; priorWeekRetained: boolean; priorReportHash: string | null };
    save: { prettyBytes: number; compactBytes: number; savedBytes: number; compacted: boolean };
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
function assertNoAssurance(state: GameState) {
  assert.equal(Object.hasOwn(state.slices.products, 'assuranceContracts'), false);
  assert.equal(Object.hasOwn(state.slices.products, 'assuranceInvoices'), false);
}

test('W13-S01: published Wave 12 import preserves a half-paid requalification, stale protection and all prior evidence without assurance adoption', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, 'aeb403c6ed2982840030076ebd2da96d4e1dc0ed');
  assert.equal(previous.checksum, '4f0d5c15'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(Buffer.byteLength(raw.trimEnd()), 1_864_282); assert.equal(oracle.snapshotBytes, 1_864_282);
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.13.0');
  assert.equal(current.migratedFrom, 13); assert.equal(current.state.week, 443);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoAssurance(current.state);
  assert.deepEqual(Object.values(current.state.slices.products.runtimeGuardrails!), oracle.originalInstallations);
  const pending = current.state.slices.products.runtimeGuardrails![oracle.requalifiedId];
  assert.equal(pending.status, 'building'); assert.equal(pending.completedWork, U); assert.equal(pending.requiredWork, 2 * U);
  assert.equal(pending.physicalWork, 555_555_556); assert.equal(pending.completedStaff, U); assert.equal(pending.requiredStaff, 2 * U);
  assert.equal(pending.audit, null); assert.equal(pending.availableWeek, null);
  assert.equal(currentRuntimeGuardrail(current.state, oracle.productId)?.id, oracle.strictId);
  assert.equal(activeRuntimeGuardrail(current.state, oracle.productId), null);
  assert.equal(pendingRuntimeGuardrail(current.state, oracle.productId)?.id, oracle.requalifiedId);
  assert.equal(current.state.slices.products.lastUsage[oracle.productId].guardrail, undefined);
  assert.deepEqual(current.state.slices.models.versions[oracle.modelId], oracle.originalModel);
  assert.deepEqual(Object.values(current.state.slices.data.feedbackStudies!), oracle.originalStudies);
  assert.equal(oracle.originalStudies.length, 3); assert.equal(oracle.preservedInvoiceIds.length, 12);
  for (const id of oracle.preservedInvoiceIds) assert.equal(current.state.slices.company.postedFacts[id], true);
  assert.equal(oracle.naturalProgression.completedCampaignWeek, 449);
  assert.equal(oracle.naturalProgression.completedCampaignChecksum, 'd2bbbbe0');
  assert.equal(oracle.naturalProgression.completedCampaignBytes, 1_915_778);
});

test('W13-S02: twenty-one full states match published Wave 12 through stale and active checkers, release evidence, billing, cost expiry and compact saves', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 21);
  assert.deepEqual(oracle.commands.map(command => command.week), [445, 447, 448, 449, 452, 455, 458, 461]);
  for (const expected of oracle.weeks) {
    const carryIn = state.slices.products.contracts[oracle.originalContract.id].tokenBillRemainder;
    state = step(queueScheduled(state));
    assert.equal(normalizedHash(state), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoAssurance(state);
    const company = state.slices.company.companies[state.playerCompanyId], product = state.slices.products.offers[oracle.productId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents); assert.equal(company.arrearsCents, 0);
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected.trustBps);
    assert.deepEqual(product, expected.product); assert.deepEqual(state.slices.products.deployments[product.deploymentId], expected.deployment);
    assert.deepEqual(state.slices.models.versions[oracle.modelId], oracle.originalModel);
    assert.equal(canonicalStateHash(state.slices.models.versions[oracle.modelId]), expected.modelHash);
    assert.equal(currentRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.currentGuardrailId);
    assert.equal(activeRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.activeGuardrailId);
    assert.equal(pendingRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.pendingGuardrailId);
    assert.equal(Object.keys(state.slices.products.runtimeGuardrails!).length, expected.installations.length);
    for (const receipt of expected.installations) {
      const actual = state.slices.products.runtimeGuardrails![receipt.id];
      assert.equal(canonicalStateHash(actual), receipt.hash); assert.equal(actual.profile, receipt.profile);
      assert.equal(actual.status, receipt.status); assert.equal(actual.enabled, receipt.enabled);
      assert.equal(actual.startedWeek, receipt.startedWeek); assert.equal(actual.completedWeek, receipt.completedWeek); assert.equal(actual.availableWeek, receipt.availableWeek);
      assert.equal(actual.completedWork, receipt.completedWork); assert.equal(actual.physicalWork, receipt.physicalWork); assert.equal(actual.completedStaff, receipt.completedStaff);
      assert.equal(actual.bindingFingerprint, receipt.bindingFingerprint); assert.equal(runtimeGuardrailInputsMatch(state, actual), receipt.inputsMatch);
      assert.equal(actual.audit ? canonicalStateHash(actual.audit) : null, receipt.auditHash);
      assert.deepEqual(actual.audit?.baseline ?? null, receipt.baseline); assert.deepEqual(actual.audit?.guarded ?? null, receipt.guarded);
    }
    assert.equal(releaseConfigurationFingerprint(state, oracle.productId), expected.configurationFingerprint);
    assert.equal(getQualifiedReleaseRehearsal(state, oracle.productId, oracle.candidateModelId)?.id ?? null, expected.qualifiedRehearsalId);
    assert.deepEqual(state.slices.products.releaseRehearsals?.[oracle.rehearsalId] ?? null, expected.rehearsal);
    const usage = state.slices.products.lastUsage[oracle.productId], contract = state.slices.products.contracts[product.contractId];
    assert.deepEqual(usage, expected.usage); assert.deepEqual(contract, expected.contract); assert.equal(usage.tokens!.billCarryIn, carryIn);
    assert.equal(product.contractId, oracle.originalContract.id);
    assert.deepEqual({ ...contract, tokenBillRemainder: 0 }, { ...oracle.originalContract, tokenBillRemainder: 0 });
    const invoices = state.slices.products.invoices.filter(invoice => invoice.productId === oracle.productId && invoice.week === state.week);
    assert.equal(invoices.length, 1); assert.deepEqual(invoices[0], expected.invoice);
    assert.deepEqual(Object.values(state.slices.data.feedbackStudies!), oracle.originalStudies);
    assert.deepEqual(Object.values(state.slices.data.feedbackStudies!).map(study => ({ id: study.id, hash: canonicalStateHash(study),
      status: study.status, totalCases: study.totalCases, sourceModelId: study.sourceModelId })), expected.studies);
    assert.deepEqual(oracle.preservedInvoiceIds.map(id => ({ id, posted: state.slices.company.postedFacts[id] === true,
      inOrdinaryHistory: state.slices.products.invoices.some(invoice => invoice.id === id) })), expected.feedbackInvoices);
    const costs = getComputeCostView(state), latest = costs.latest!, prior = costs.reports.find(report => report.week === oracle.originalCostReport.week);
    assert.equal(canonicalStateHash(latest), expected.costs.hash); assert.deepEqual(latest.totals, expected.costs.totals);
    assert.deepEqual(costs.reports.map(report => report.week), expected.costs.historyWeeks); assert.equal(costs.reports.length, 8);
    assert.equal(Boolean(prior), expected.costs.priorWeekRetained); assert.equal(prior ? canonicalStateHash(prior) : null, expected.costs.priorReportHash);
    if (prior) assert.equal(canonicalStateHash(prior), oracle.originalCostReport.hash);
    assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
    assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
    for (const contract of expected.commercialContracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
    const saved = serializeState(state, historicalContent(state)), exported = JSON.parse(saved), pretty = JSON.stringify(exported, null, 2), compact = JSON.stringify(exported);
    assert.deepEqual({ prettyBytes: Buffer.byteLength(pretty), compactBytes: Buffer.byteLength(compact), savedBytes: Buffer.byteLength(saved), compacted: saved === compact }, expected.save);
    assert.ok(Buffer.byteLength(saved) <= MAX_SNAPSHOT_BYTES);
  }
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 451);
  assert.equal(oracle.weeks.find(week => week.save.compacted)!.week, 455);
  assert.equal(Object.keys(state.slices.products.runtimeGuardrails!).length, 8);
  assert.equal(normalizedHash(state), '27816ebd'); assert.equal(Buffer.byteLength(serializeState(state, historicalContent(state))), 1_211_334);
});

test('W13-S03: repeated reloads preserve partial rollout, exact audit availability, operating toggles and published compact fallback', () => {
  let state = loadHistorical().state;
  for (const expected of oracle.weeks) {
    state = queueScheduled(state);
    const text = serializeState(state, historicalContent(state)), restored = deserializeState(text, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), text); state = step(restored.state);
    assert.equal(normalizedHash(state), expected.hash); assertNoAssurance(state);
    const requalification = state.slices.products.runtimeGuardrails![oracle.requalifiedId];
    if (state.week === 444) {
      assert.equal(requalification.status, 'ready'); assert.equal(requalification.availableWeek, 445); assert.equal(requalification.audit, null);
      assert.equal(activeRuntimeGuardrail(state, oracle.productId), null);
    }
    if (state.week === 445) {
      assert.equal(requalification.status, 'active'); assert.ok(requalification.audit);
      assert.equal(activeRuntimeGuardrail(state, oracle.productId)?.id, oracle.requalifiedId);
    }
    if (state.week === 448) {
      assert.equal(activeRuntimeGuardrail(state, oracle.productId), null);
      assert.equal(getQualifiedReleaseRehearsal(state, oracle.productId, oracle.candidateModelId), undefined);
    }
    if (state.week === 449) {
      assert.equal(activeRuntimeGuardrail(state, oracle.productId)?.id, oracle.requalifiedId);
      assert.equal(getQualifiedReleaseRehearsal(state, oracle.productId, oracle.candidateModelId)?.id, oracle.rehearsalId);
    }
    if (state.week === 450) {
      assert.equal(activeRuntimeGuardrail(state, oracle.productId)?.id, oracle.requalifiedId);
      assert.ok(pendingRuntimeGuardrail(state, oracle.productId));
    }
  }
  const final = serializeState(state, historicalContent(state)), restored = deserializeState(final, historicalContent(state));
  assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(serializeState(restored.state, historicalContent(restored.state)), final);
  assert.equal(Buffer.byteLength(final), 1_211_334); assert.equal(normalizedHash(restored.state), '27816ebd');
  const oldState = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
  const oldCompact = JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: oracle.sourceContent,
    checksum: canonicalStateHash(oldState), state: oldState });
  assert.equal(Buffer.byteLength(oldCompact), 1_211_334);
  const migratedCompact = deserializeState(oldCompact); assert.ok(migratedCompact.ok, migratedCompact.ok ? '' : migratedCompact.error);
  assert.equal(migratedCompact.migratedFrom, 13); assert.deepEqual(migratedCompact.state, upgradeHistoricalState(state));
  assert.equal(serializeState(migratedCompact.state, historicalContent(migratedCompact.state)), serializeState(upgradeHistoricalState(state)));
});

test('W13-S04: original published checksums are checked before a migration can change either representation or paid progress', () => {
  const corrupt = envelope(); corrupt.state.slices.products.runtimeGuardrails![oracle.requalifiedId].completedWork++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W13-S05: even empty or false assurance contracts and invoice collections are rejected beneath every Wave 0–12 header', () => {
  for (let wave = 0; wave <= 12; wave++) {
    for (const field of ['assuranceContracts', 'assuranceInvoices']) {
      for (const value of [{}, [], false, { forged: { productId: oracle.productId } }]) {
        const forged = olderEnvelope(wave); Object.assign(forged.state.slices.products, { [field]: value });
        assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${field}.`);
      }
    }
    const paired = olderEnvelope(wave);
    Object.assign(paired.state.slices.products, { assuranceContracts: {}, assuranceInvoices: [] });
    assert.equal(deserializeState(encoded(paired)).ok, false, `Wave ${wave} accepted paired assurance collections.`);
  }
});

test('W13-S06: signing, requalifying and cancelling assurance contracts cannot be queued beneath an older content header', () => {
  const payloads = [
    { kind: 'sign_assurance_contract', buyerId: 'continuity-systems', productId: oracle.productId },
    { kind: 'sign_assurance_contract', buyerId: 'sentinel-services', productId: oracle.productId },
    { kind: 'requalify_assurance_contract', contractId: 'assurance-contract' },
    { kind: 'cancel_assurance_contract', contractId: 'assurance-contract' },
  ];
  for (let wave = 0; wave <= 12; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-assurance-action', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${JSON.stringify(payload)}.`);
    }
  }
});

test('W13-S07: every published generation migrates without assurance adoption and retains original rights, model policy and runtime evidence', () => {
  for (let wave = 0; wave <= 12; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1); assertNoAssurance(result.state);
    for (const packet of Object.values(previous.state.slices.data.packets)) assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    for (const model of Object.values(previous.state.slices.models.versions)) if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    assert.deepEqual(result.state.slices.products.runtimeGuardrails, previous.state.slices.products.runtimeGuardrails);
    for (const study of Object.values(previous.state.slices.data.feedbackStudies ?? {})) assert.deepEqual(result.state.slices.data.feedbackStudies![study.id], study);
  }
});

test('W13-S08: authentic Wave 12 runtime work remains unavailable beneath a relabeled Wave 11 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.12.0'; forged.state.contentVersion = '0.12.0'; forged.state.buildVersion = '0.12.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});

test('W13-S09: unknown future content is rejected without altering the original saved company', () => {
  const future = envelope();
  future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const text = encoded(future), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /not supported/);
  assert.equal(encoded(future), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});
