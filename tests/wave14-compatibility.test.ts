import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { ComputeCostTotals, ComputeCostReport } from '../src/contracts/wave8-costs';
import type { RuntimeGuardrailInstallation } from '../src/contracts/wave12-guardrails';
import type { AssuranceContract, AssuranceInvoice } from '../src/contracts/wave13-assurance';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState, MAX_SNAPSHOT_BYTES } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { assuranceQualificationMatches, getAssuranceView } from '../src/modules/assured-api';
import { commercialOrganizationCount, outsideBusinessOrganizations } from '../src/modules/business';
import { activeRuntimeGuardrail, currentRuntimeGuardrail, pendingRuntimeGuardrail, runtimeGuardrailInputsMatch } from '../src/modules/runtime-guardrails';
import { getQualifiedReleaseRehearsal, releaseConfigurationFingerprint } from '../src/modules/release-rehearsals';

// Independently captured by the exact published Wave 13 engine at 16ebd574…
// before Wave 14 source edits. The authentic company has just earned its first
// Sentinel retainer. Original commands subsequently change qualification,
// finish both eight-week terms, and cross the established compact-save boundary.
const raw = readFileSync(join(__dirname, 'fixtures/wave13-snapshot.json'), 'utf8');
type Products = GameState['slices']['products'];
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
type Study = NonNullable<GameState['slices']['data']['feedbackStudies']>[string];
type GuardrailTotals = NonNullable<RuntimeGuardrailInstallation['audit']>['baseline'];
type InstallationReceipt = {
  id: string; hash: string; profile: RuntimeGuardrailInstallation['profile']; status: RuntimeGuardrailInstallation['status'];
  enabled: boolean; startedWeek: number; completedWeek: number | null; availableWeek: number | null;
  completedWork: number; physicalWork: number; completedStaff: number; bindingFingerprint: string; inputsMatch: boolean;
  auditHash: string | null; baseline: GuardrailTotals | null; guarded: GuardrailTotals | null;
};
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave13-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceTree: string; sourceContent: string; schemaVersion: number;
  sourceFixture: { sourceCommit: string; file: string; week: number; checksum: string; bytes: number };
  fixtureWeek: number; checksum: string; snapshotBytes: number;
  productId: string; modelId: string; candidateModelId: string; rehearsalId: string; strictContractId: string; continuityId: string;
  creationCommands: RecordedCommand[]; commands: RecordedCommand[];
  originalProduct: Products['offers'][string]; originalDeployment: Products['deployments'][string]; originalPublicContract: Products['contracts'][string];
  originalModel: GameState['slices']['models']['versions'][string]; originalAssuranceContracts: Record<string, AssuranceContract>;
  originalAssuranceInvoices: AssuranceInvoice[]; initialAssuranceInvoiceIds: string[];
  originalInstallations: InstallationReceipt[]; originalStudies: Study[]; preservedFeedbackInvoiceIds: string[];
  originalCostReport: { week: number; hash: string };
  naturalProgression: { sourceWeek: number; sourceHash: string; finalWeek: number; finalHash: string; finalBytes: number; commands: RecordedCommand[] };
  weeks: {
    week: number; hash: string; cashCents: number; arrearsCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    product: Products['offers'][string]; deployment: Products['deployments'][string]; publicContract: Products['contracts'][string];
    usage: Products['lastUsage'][string]; publicInvoice: Products['invoices'][number]; modelHash: string;
    assuranceContracts: Record<string, AssuranceContract>; assuranceInvoicesHash: string; assuranceInvoices: AssuranceInvoice[];
    assuranceInvoiceProofs: { id: string; week: number; hash: string; posted: boolean }[];
    qualificationMatches: Record<string, boolean>;
    organizations: { commercial: number; outside: number; assuranceLive: number; assuranceOutside: number;
      board: { id: string; available: boolean; unavailableReason: string; retainedTerms: number }[] };
    currentGuardrailId: string | null; activeGuardrailId: string | null; pendingGuardrailId: string | null;
    installations: InstallationReceipt[]; configurationFingerprint: string; qualifiedRehearsalId: string | null; rehearsalHash: string | null;
    feedbackHash: string; studies: { id: string; hash: string; status: Study['status']; totalCases: number; sourceModelId: string }[];
    feedbackInvoiceProofs: { id: string; posted: boolean; inOrdinaryHistory: boolean }[];
    costs: { week: number; hash: string; totals: ComputeCostTotals; historyWeeks: number[]; priorWeekRetained: boolean;
      priorReportHash: string | null; assuranceActivities: ComputeCostReport['activities'] };
    save: { prettyBytes: number; compactBytes: number; savedBytes: number; compacted: boolean };
  }[];
};
const batchFields = ['batchSchedulers', 'batchJobs', 'batchInvoices'];
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
function normalizedHash(state: GameState) { return canonicalStateHash({ ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent }); }
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function olderEnvelope(wave: number) { return JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope; }
function assertNoBatch(state: GameState) { for (const field of batchFields) assert.equal(Object.hasOwn(state.slices.products, field), false, field); }
function installationReceipts(state: GameState): InstallationReceipt[] {
  return Object.values(state.slices.products.runtimeGuardrails ?? {}).map(item => ({ id: item.id, hash: canonicalStateHash(item),
    profile: item.profile, status: item.status, enabled: item.enabled, startedWeek: item.startedWeek, completedWeek: item.completedWeek,
    availableWeek: item.availableWeek, completedWork: item.completedWork, physicalWork: item.physicalWork, completedStaff: item.completedStaff,
    bindingFingerprint: item.bindingFingerprint, inputsMatch: runtimeGuardrailInputsMatch(state, item),
    auditHash: item.audit ? canonicalStateHash(item.audit) : null, baseline: item.audit?.baseline ?? null, guarded: item.audit?.guarded ?? null }));
}

test('W14-S01: published Wave 13 import preserves an active paid assurance term, first invoice and exact qualification without batch adoption', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, '16ebd574c5feff6bf5cd422c3b474d7fb5606182');
  assert.equal(oracle.sourceTree, '4a126cc2f6b26e34643d5a097090b422b8193f37');
  assert.equal(previous.checksum, '4062e51d'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(Buffer.byteLength(raw.trimEnd()), 1_928_687); assert.equal(oracle.snapshotBytes, 1_928_687);
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.14.0');
  assert.equal(current.migratedFrom, 14); assert.equal(current.state.week, 451);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoBatch(current.state);
  assert.deepEqual(current.state.slices.products.assuranceContracts, oracle.originalAssuranceContracts);
  assert.deepEqual(current.state.slices.products.assuranceInvoices, oracle.originalAssuranceInvoices);
  const contract = current.state.slices.products.assuranceContracts![oracle.strictContractId];
  assert.equal(contract.status, 'active'); assert.equal(contract.completedOnboardingStaff, U); assert.equal(contract.onboardingGrantCount, 1);
  assert.equal(contract.termStartedWeek, 451); assert.equal(contract.termEndsWeek, 459); assert.equal(contract.termWeeksServed, 1);
  assert.equal(contract.qualifications.length, 1); assert.equal(contract.qualifications[0].acceptedWeek, 450);
  assert.equal(contract.lastUsage!.servedRequests, 8000); assert.equal(contract.lifetimeBilledCents, 220_000);
  assert.equal(assuranceQualificationMatches(current.state, contract), true);
  assert.equal(activeRuntimeGuardrail(current.state, oracle.productId)?.id, contract.qualifications[0].installationId);
  assert.deepEqual(installationReceipts(current.state), oracle.originalInstallations);
  assert.deepEqual(current.state.slices.products.offers[oracle.productId], oracle.originalProduct);
  assert.deepEqual(current.state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
  assert.deepEqual(current.state.slices.models.versions[oracle.modelId], oracle.originalModel);
  assert.deepEqual(Object.values(current.state.slices.data.feedbackStudies!), oracle.originalStudies);
  for (const id of [...oracle.initialAssuranceInvoiceIds, ...oracle.preservedFeedbackInvoiceIds]) assert.equal(current.state.slices.company.postedFacts[id], true);
  assert.equal(oracle.naturalProgression.finalWeek, 472); assert.equal(oracle.naturalProgression.finalHash, '653fbcd2');
  assert.equal(oracle.naturalProgression.finalBytes, 1_172_854);
});

test('W14-S02: twenty-one full states match published Wave 13 through exact requalification, tenant costs, finite invoices, both expiries and compact saves', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 21);
  assert.deepEqual(oracle.commands.map(command => command.week), [451, 452, 453, 454, 457, 459, 462, 464, 465]);
  for (const expected of oracle.weeks) {
    const carryIn = state.slices.products.contracts[oracle.originalPublicContract.id].tokenBillRemainder;
    state = step(queueScheduled(state));
    assert.equal(normalizedHash(state), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoBatch(state);
    const products = state.slices.products, company = state.slices.company.companies[state.playerCompanyId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents); assert.equal(company.arrearsCents, expected.arrearsCents); assert.equal(company.arrearsCents, 0);
    assert.equal(state.slices.markets.companyTrustBps[state.playerCompanyId], expected.trustBps);
    assert.deepEqual(products.offers[oracle.productId], expected.product); assert.deepEqual(products.deployments[oracle.originalProduct.deploymentId], expected.deployment);
    assert.deepEqual(state.slices.models.versions[oracle.modelId], oracle.originalModel); assert.equal(canonicalStateHash(state.slices.models.versions[oracle.modelId]), expected.modelHash);
    assert.deepEqual(products.contracts[oracle.originalPublicContract.id], expected.publicContract);
    assert.deepEqual(products.lastUsage[oracle.productId], expected.usage); assert.equal(products.lastUsage[oracle.productId].tokens!.billCarryIn, carryIn);
    const publicInvoices = products.invoices.filter(invoice => invoice.productId === oracle.productId && invoice.week === state.week);
    assert.equal(publicInvoices.length, 1); assert.deepEqual(publicInvoices[0], expected.publicInvoice);
    assert.deepEqual(products.assuranceContracts, expected.assuranceContracts);
    assert.equal(canonicalStateHash(products.assuranceInvoices), expected.assuranceInvoicesHash);
    assert.deepEqual(products.assuranceInvoices!.filter(invoice => invoice.week === state.week), expected.assuranceInvoices);
    assert.deepEqual(products.assuranceInvoices!.map(invoice => ({ id: invoice.id, week: invoice.week,
      hash: canonicalStateHash(invoice), posted: state.slices.company.postedFacts[invoice.id] === true })), expected.assuranceInvoiceProofs);
    assert.deepEqual(Object.fromEntries(Object.values(products.assuranceContracts!).map(contract => [contract.id, assuranceQualificationMatches(state, contract)])), expected.qualificationMatches);
    for (const original of oracle.originalAssuranceInvoices) assert.deepEqual(products.assuranceInvoices!.find(invoice => invoice.id === original.id), original);
    assert.deepEqual(products.assuranceContracts![oracle.strictContractId].qualifications[0], oracle.originalAssuranceContracts[oracle.strictContractId].qualifications[0]);
    const assurance = getAssuranceView(state);
    assert.deepEqual({ commercial: commercialOrganizationCount(state), outside: outsideBusinessOrganizations(state),
      assuranceLive: assurance.committedOrganizations, assuranceOutside: assurance.outsideOrganizations,
      board: assurance.board.map(item => ({ id: item.id, available: item.available, unavailableReason: item.unavailableReason, retainedTerms: item.retainedTerms })) }, expected.organizations);
    assert.equal(currentRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.currentGuardrailId);
    assert.equal(activeRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.activeGuardrailId);
    assert.equal(pendingRuntimeGuardrail(state, oracle.productId)?.id ?? null, expected.pendingGuardrailId);
    assert.deepEqual(installationReceipts(state), expected.installations);
    assert.equal(releaseConfigurationFingerprint(state, oracle.productId), expected.configurationFingerprint);
    assert.equal(getQualifiedReleaseRehearsal(state, oracle.productId, oracle.candidateModelId)?.id ?? null, expected.qualifiedRehearsalId);
    const rehearsal = products.releaseRehearsals?.[oracle.rehearsalId]; assert.equal(rehearsal ? canonicalStateHash(rehearsal) : null, expected.rehearsalHash);
    assert.equal(canonicalStateHash(state.slices.data.feedbackStudies), expected.feedbackHash);
    assert.deepEqual(Object.values(state.slices.data.feedbackStudies!), oracle.originalStudies);
    assert.deepEqual(Object.values(state.slices.data.feedbackStudies!).map(study => ({ id: study.id, hash: canonicalStateHash(study),
      status: study.status, totalCases: study.totalCases, sourceModelId: study.sourceModelId })), expected.studies);
    assert.deepEqual(oracle.preservedFeedbackInvoiceIds.map(id => ({ id, posted: state.slices.company.postedFacts[id] === true,
      inOrdinaryHistory: products.invoices.some(invoice => invoice.id === id) })), expected.feedbackInvoiceProofs);
    const costs = getComputeCostView(state), latest = costs.latest!, prior = costs.reports.find(report => report.week === oracle.originalCostReport.week);
    assert.equal(canonicalStateHash(latest), expected.costs.hash); assert.deepEqual(latest.totals, expected.costs.totals);
    assert.deepEqual(costs.reports.map(report => report.week), expected.costs.historyWeeks); assert.equal(costs.reports.length, 8);
    assert.equal(Boolean(prior), expected.costs.priorWeekRetained); assert.equal(prior ? canonicalStateHash(prior) : null, expected.costs.priorReportHash);
    if (prior) assert.equal(canonicalStateHash(prior), oracle.originalCostReport.hash);
    const assuredTargetIds = new Set(latest.targets.filter(target => target.kind === 'assured-api').map(target => target.id));
    assert.deepEqual(latest.activities.filter(activity => assuredTargetIds.has(activity.targetId)), expected.costs.assuranceActivities);
    assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
    assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
    assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
    const saved = serializeState(state, historicalContent(state)), exported = JSON.parse(saved), pretty = JSON.stringify(exported, null, 2), compact = JSON.stringify(exported);
    assert.deepEqual({ prettyBytes: Buffer.byteLength(pretty), compactBytes: Buffer.byteLength(compact), savedBytes: Buffer.byteLength(saved), compacted: saved === compact }, expected.save);
    assert.ok(Buffer.byteLength(saved) <= MAX_SNAPSHOT_BYTES);
  }
  assert.equal(oracle.weeks.find(week => week.save.compacted)!.week, 457);
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 459);
  const contracts = Object.values(state.slices.products.assuranceContracts!);
  assert.equal(contracts.length, 2); assert.equal(state.slices.products.assuranceInvoices!.length, 16);
  assert.ok(contracts.every(contract => contract.status === 'expired' && contract.termWeeksServed === 8));
  assert.equal(contracts.reduce((sum, contract) => sum + contract.lifetimeBilledCents, 0), 1_500_000);
  assert.equal(contracts.reduce((sum, contract) => sum + contract.lifetimeCreditsCents, 0), 1_220_000);
  assert.equal(normalizedHash(state), '653fbcd2'); assert.equal(Buffer.byteLength(serializeState(state, historicalContent(state))), 1_172_854);
});

test('W14-S03: repeated reloads preserve accepted evidence, paid boundaries, exact credits and published compact saves', () => {
  let state = loadHistorical().state;
  for (const expected of oracle.weeks) {
    state = queueScheduled(state);
    const text = serializeState(state, historicalContent(state)), restored = deserializeState(text, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), text); state = step(restored.state);
    assert.equal(normalizedHash(state), expected.hash); assertNoBatch(state);
    const strict = state.slices.products.assuranceContracts![oracle.strictContractId];
    if (state.week === 452 || state.week === 454 || state.week === 457) {
      assert.equal(strict.lastUsage!.qualified, false); assert.equal(strict.lastUsage!.physicalWorkCUw, 0);
      assert.equal(strict.lastUsage!.creditsCents, 220_000); assert.equal(strict.qualifications.length, 1);
    }
    if (state.week === 453) { assert.equal(strict.lastUsage!.qualified, true); assert.equal(strict.lastUsage!.billedCents, 220_000); }
    if (state.week === 458) {
      assert.equal(strict.qualifications.length, 2); assert.equal(strict.qualifications[1].acceptedWeek, 458);
      assert.equal(strict.termEndsWeek, 459); assert.equal(strict.termWeeksServed, 8); assert.equal(strict.lastUsage!.billedCents, 220_000);
      assert.deepEqual(state.slices.products.assuranceInvoices![0], oracle.originalAssuranceInvoices[0]);
    }
    if (state.week === 459) { assert.equal(strict.status, 'expired'); assert.equal(strict.lifetimeBilledCents, 660_000); }
    if (state.week === 463) {
      const continuity = state.slices.products.assuranceContracts![oracle.continuityId];
      assert.equal(continuity.status, 'ready'); assert.equal(continuity.termStartedWeek, null); assert.equal(continuity.lastUsage, null);
    }
    if (state.week === 464 || state.week === 465 || state.week === 466) {
      const continuity = state.slices.products.assuranceContracts![oracle.continuityId];
      assert.equal(continuity.termStartedWeek, 464); assert.equal(continuity.termEndsWeek, 472); assert.equal(continuity.qualifications.length, 1);
      assert.equal(continuity.lastUsage!.qualified, true);
      assert.equal(continuity.lastUsage!.billedCents, state.week === 465 ? 0 : 120_000);
      assert.equal(continuity.lastUsage!.creditsCents, state.week === 465 ? 120_000 : 0);
    }
  }
  const final = serializeState(state, historicalContent(state)), restored = deserializeState(final, historicalContent(state));
  assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(serializeState(restored.state, historicalContent(restored.state)), final);
  assert.equal(Buffer.byteLength(final), 1_172_854); assert.equal(normalizedHash(restored.state), '653fbcd2');
  const oldState = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
  const oldCompact = JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: oracle.sourceContent,
    checksum: canonicalStateHash(oldState), state: oldState });
  assert.equal(Buffer.byteLength(oldCompact), 1_172_854);
  const migratedCompact = deserializeState(oldCompact); assert.ok(migratedCompact.ok, migratedCompact.ok ? '' : migratedCompact.error);
  assert.equal(migratedCompact.migratedFrom, 14); assert.deepEqual(migratedCompact.state, upgradeHistoricalState(state));
  assert.equal(serializeState(migratedCompact.state, historicalContent(migratedCompact.state)), serializeState(upgradeHistoricalState(state)));
});

test('W14-S04: original published checksums are checked before migration can change paid contract history', () => {
  const corrupt = envelope(); corrupt.state.slices.products.assuranceContracts![oracle.strictContractId].lifetimeBilledCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W14-S05: even empty or false batch scheduler, job and invoice collections are rejected beneath every Wave 0–13 header', () => {
  for (let wave = 0; wave <= 13; wave++) {
    for (const field of batchFields) {
      for (const value of [{}, [], false, { forged: { productId: oracle.productId } }]) {
        const forged = olderEnvelope(wave); Object.assign(forged.state.slices.products, { [field]: value });
        assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${field}.`);
      }
    }
    const paired = olderEnvelope(wave);
    Object.assign(paired.state.slices.products, { batchSchedulers: {}, batchJobs: {}, batchInvoices: [] });
    assert.equal(deserializeState(encoded(paired)).ok, false, `Wave ${wave} accepted all three empty batch collections.`);
  }
});

test('W14-S06: scheduler installation and batch accepting, pausing, resuming or cancelling cannot be queued beneath an older content header', () => {
  const payloads = [
    { kind: 'install_batch_scheduler' },
    ...['archive-tagging', 'code-index', 'longform-digest'].map(orderId => ({ kind: 'accept_batch_job', productId: oracle.productId, orderId, modelId: oracle.modelId, weeklyWorkCapCUw: 2 * U })),
    { kind: 'set_batch_job_paused', jobId: 'batch:legacy-check', paused: true },
    { kind: 'set_batch_job_paused', jobId: 'batch:legacy-check', paused: false },
    { kind: 'cancel_batch_job', jobId: 'batch:legacy-check' },
  ];
  for (let wave = 0; wave <= 13; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-batch-action', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${JSON.stringify(payload)}.`);
    }
  }
});

test('W14-S07: every published generation migrates without batch adoption and retains original rights, model policy, runtime and assurance evidence', () => {
  for (let wave = 0; wave <= 13; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1); assertNoBatch(result.state);
    for (const packet of Object.values(previous.state.slices.data.packets)) assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    for (const model of Object.values(previous.state.slices.models.versions)) if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    assert.deepEqual(result.state.slices.products.runtimeGuardrails, previous.state.slices.products.runtimeGuardrails);
    assert.deepEqual(result.state.slices.products.assuranceContracts, previous.state.slices.products.assuranceContracts);
    assert.deepEqual(result.state.slices.products.assuranceInvoices, previous.state.slices.products.assuranceInvoices);
    for (const study of Object.values(previous.state.slices.data.feedbackStudies ?? {})) assert.deepEqual(result.state.slices.data.feedbackStudies![study.id], study);
  }
});

test('W14-S08: authentic Wave 13 assurance receipts remain unavailable beneath a relabeled Wave 12 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.13.0'; forged.state.contentVersion = '0.13.0'; forged.state.buildVersion = '0.13.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});

test('W14-S09: unknown future content is rejected without altering the original saved company', () => {
  const future = envelope();
  future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const text = encoded(future), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /not supported/);
  assert.equal(encoded(future), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});
