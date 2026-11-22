import { historicalContent, loadHistoricalSnapshot } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getAdapterBankView } from '../src/modules/adapter-bank';

// Generated with the exact published Wave 7 engine, including its paid recovery
// command. The twelve expected hashes were never calculated with this build.
const raw = readFileSync(join(__dirname, 'fixtures/wave7-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
const envelope = () => JSON.parse(raw) as Envelope;
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave7-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string;
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    agent: { rootJobId: string; childId: string; parentStatus: string; status: string; stage: string; spentWork: number;
      physicalWork: number; steps: number; billedCents: number; receiptId: string; invoiceId: string | null; invoiceCount: number };
    adapters: { baseModelId: string; activeProducts: number; independentMemoryMU: number; sharedMemoryMU: number };
    contracts: { id: string; termIndex: number; termWeeksServed: number; lifetimeBilledCents: number }[];
  }[];
};
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }
const loadHistorical = () => loadHistoricalSnapshot(raw);
function step(state: GameState) {
  const result = advanceWeek(state, historicalContent(state)); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function olderEnvelope(wave: number) { return JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope; }

test('W8-S01: published Wave 7 import preserves all paid features and a queued recovery without initializing new operations', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, '8fb429ad34c58da2ff323edd030220143a336982');
  assert.equal(previous.checksum, 'a3923526'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.8.0');
  assert.equal(current.migratedFrom, 8); assert.equal(current.state.week, 326);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []);
  for (const field of ['facilityRetrofits', 'rackRelocations', 'costReports']) assert.equal(Object.hasOwn(current.state.slices.compute, field), false);
  assert.equal(current.state.queuedCommands[0].payload.kind, 'recover_agent_job');
  const parent = current.state.slices.agents.jobs[oracle.weeks[0].agent.rootJobId];
  assert.equal(parent.status, 'paused'); assert.equal(parent.stage, 'audit'); assert.equal(parent.actionApplied, true); assert.equal(parent.invoiceId, null);
  assert.equal(current.state.slices.models.versions['model-wave7-natural-command-9'].planner?.currentRepeatBps, 8100);
  assert.ok(Object.values(current.state.slices.models.reports).some(report => report.holdout));
  const bank = getAdapterBankView(current.state).groups.find(group => group.baseModelId === CONTENT.seedModel.id)!;
  assert.equal(bank.activeProducts, 2); assert.equal(bank.sharedMemoryMU, 2.5 * U);
});

test('W8-S02: twelve full-state outcomes match published Wave 7 across recovery, audit, adapter service and license renewal', () => {
  let state = loadHistorical().state;
  for (const expected of oracle.weeks) {
    state = step(state);
    const normalized = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
    assert.equal(canonicalStateHash(normalized), expected.hash, 'Published outcome changed in Week ' + expected.week);
    const company = state.slices.company.companies[state.playerCompanyId], child = state.slices.agents.jobs[expected.agent.childId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents);
    assert.equal(child.status, expected.agent.status); assert.equal(child.spentWork, expected.agent.spentWork);
    assert.equal(child.steps, expected.agent.steps); assert.equal(child.receiptId, expected.agent.receiptId); assert.equal(child.invoiceId, expected.agent.invoiceId);
    assert.equal(state.slices.agents.jobs[expected.agent.rootJobId].status, expected.agent.parentStatus);
    assert.equal(state.slices.agents.invoices.filter(invoice => invoice.jobId === expected.agent.childId || invoice.jobId === expected.agent.rootJobId).length, expected.agent.invoiceCount);
    const bank = getAdapterBankView(state).groups.find(group => group.baseModelId === expected.adapters.baseModelId)!;
    assert.equal(bank.sharedMemoryMU, expected.adapters.sharedMemoryMU); assert.equal(bank.activeProducts, expected.adapters.activeProducts);
    for (const contract of expected.contracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
  }
  assert.equal(oracle.weeks.at(-1)!.hash, '68a67abc');
  assert.equal(oracle.weeks.at(-1)!.contracts[0].termIndex, oracle.weeks[0].contracts[0].termIndex + 1);
});

test('W8-S03: save/reload before recovery and before its final audit preserves deterministic once-only settlement', () => {
  let uninterrupted = load().state;
  const first = deserializeState(serializeState(uninterrupted, historicalContent(uninterrupted)), historicalContent(uninterrupted)); assert.ok(first.ok, first.ok ? '' : first.error);
  assert.equal(first.migratedFrom, undefined); let reloaded = first.state;
  for (let index = 0; index < 3; index++) {
    uninterrupted = step(uninterrupted); reloaded = step(reloaded);
    assert.equal(canonicalStateHash(reloaded), canonicalStateHash(uninterrupted));
    const restored = deserializeState(serializeState(reloaded, historicalContent(reloaded)), historicalContent(reloaded)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.equal(restored.migratedFrom, undefined); reloaded = restored.state;
  }
  const { rootJobId, childId } = oracle.weeks[0].agent, child = reloaded.slices.agents.jobs[childId];
  assert.equal(child.status, 'complete'); assert.equal(child.spentWork, 2.98 * U);
  assert.equal(child.history.filter(item => item.stage === 'action').length, 1);
  assert.equal(child.history.filter(item => item.stage === 'recover').length, 1);
  assert.equal(reloaded.slices.agents.invoices.filter(invoice => invoice.jobId === childId || invoice.jobId === rootJobId).length, 1);
});

test('W8-S04: a corrupted published checksum is rejected before migration can change its representation', () => {
  const corrupt = envelope(); corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W8-S05: new optional infrastructure and cost records cannot hide behind any Wave 0–7 header, even when empty', () => {
  for (let wave = 0; wave <= 7; wave++) {
    for (const field of ['facilityRetrofits', 'rackRelocations', 'costReports']) {
      const forged = olderEnvelope(wave);
      Object.assign(forged.state.slices.compute, { [field]: {} });
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${field}.`);
    }
  }
});

test('W8-S06: rack purchase-location metadata is rejected under an older content header', () => {
  for (const wave of [2, 4]) {
    const forged = olderEnvelope(wave), rack = Object.values(forged.state.slices.compute.racks)[0];
    assert.ok(rack); rack.purchaseLocation = rack.location;
    assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} incorrectly accepted a relocation receipt field.`);
  }
  // A real older rack checkpoint can be imported by the published schema-5
  // representation; attaching even an unchanged purchase location is new data.
  const previousContent = { ...CONTENT, version: '0.8.0', buildVersion: '0.8.0' };
  const carried = deserializeState(readFileSync(join(__dirname, 'fixtures/wave4-snapshot.json'), 'utf8'), previousContent);
  assert.ok(carried.ok, carried.ok ? '' : carried.error);
  const forged = JSON.parse(serializeState(carried.state, previousContent)) as Envelope;
  const rack = Object.values(forged.state.slices.compute.racks)[0]; assert.ok(rack); rack.purchaseLocation = rack.location;
  assert.equal(deserializeState(encoded(forged)).ok, false);
});

test('W8-S07: retrofit, relocation and cost-accounting commands are rejected under every older header, including false pause options', () => {
  const payloads = [
    { kind: 'start_facility_retrofit', facilityId: 'saved-facility', retrofitKind: 'power-feed' },
    { kind: 'start_facility_retrofit', facilityId: 'saved-facility', retrofitKind: 'cooling-loop' },
    { kind: 'set_facility_retrofit_paused', retrofitId: 'saved-retrofit', paused: false },
    { kind: 'start_rack_relocation', rackId: 'saved-rack', destination: 'colocation' },
    { kind: 'set_rack_relocation_paused', relocationId: 'saved-relocation', paused: false },
    { kind: 'start_system_rollout', method: 'cost-accounting' },
  ];
  for (let wave = 0; wave <= 7; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-new-operation', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${payload.kind}.`);
    }
  }
});

test('W8-S08: an ordinarily admitted cost-accounting rollout cannot be relabeled as a published Wave 7 receipt', () => {
  const state = loadHistoricalSnapshot(raw, '0.9.0').state;
  const queued = submitCommand(state, { kind: 'start_system_rollout', method: 'cost-accounting' }, historicalContent(state), 'wave8-cost-header-test');
  assert.ok(queued.accepted, queued.reason?.message);
  const current = step(queued.state);
  assert.ok(Object.values(current.slices.research.systemRollouts).some(rollout => rollout.method === 'cost-accounting'));
  assert.deepEqual(validateState(current, historicalContent(current)), []);
  const forged = JSON.parse(serializeState(current, historicalContent(current))) as Envelope;
  forged.contentVersion = '0.8.0'; forged.state.contentVersion = '0.8.0'; forged.state.buildVersion = '0.8.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /The Wave 7 save contains methods or receipts that were unavailable in that build/);
});
