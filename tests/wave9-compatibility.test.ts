import { historicalContent, loadHistoricalSnapshot } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, ComputePool, GameState } from '../src/contracts/types';
import type { ComputeCostTotals } from '../src/contracts/wave8-costs';
import type { RackRelocation } from '../src/contracts/wave8-relocation';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { getComputePools, getInfrastructureBaseCost } from '../src/modules/compute-pools';

// Generated with the exact published Wave 8 source, before Wave 9 edits. Its
// natural campaign and paid outbound move use ordinary commands only. The twelve
// future hashes include commissioning, changed tariffs, report expiry and renewal.
const raw = readFileSync(join(__dirname, 'fixtures/wave8-snapshot.json'), 'utf8');
type Envelope = { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
const envelope = () => JSON.parse(raw) as Envelope;
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave8-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceContent: string; checksum: string; fixtureWeek: number;
  movingRackId: string; relocationId: string; siteId: string;
  originalRack: GameState['slices']['compute']['racks'][string];
  originalCostReport: { week: number; hash: string };
  naturalProgression: { completedCampaignChecksum: string };
  weeks: {
    week: number; hash: string; cashCents: number; revenueCents: number; expenseCents: number; trustBps: number;
    relocation: Pick<RackRelocation, 'id' | 'status' | 'stageIndex' | 'readyWeek' | 'completedWeek' | 'stages'> & {
      rackId: string; rackStatus: string; location: string; purchaseLocation: string; purchaseCents: number;
      installedWeek: number; usableCU?: number; fixedInfrastructureCents: number;
    };
    pools: Pick<ComputePool, 'id' | 'ownership' | 'location' | 'nominalCU' | 'capacityCU' | 'memoryMU' | 'variableCentsPerCUw'>[];
    costs: { week: number; reportHash: string; historyWeeks: number[]; priorWeekRetained: boolean;
      priorReportHash: string | null; totals: ComputeCostTotals };
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
function assertNoReleases(state: GameState) {
  for (const field of ['releaseRehearsals', 'preparedReleases']) assert.equal(Object.hasOwn(state.slices.products, field), false);
}

test('W9-S01: published Wave 8 import preserves its paid moving rack, retrofits and cost history without adopting releases', () => {
  const previous = envelope(), current = load();
  assert.equal(oracle.sourceCommit, 'd55f5e167eb20ad635d2be3663f7fac5c96b1b64');
  assert.equal(oracle.naturalProgression.completedCampaignChecksum, 'b70a084d');
  assert.equal(previous.checksum, 'd4ca620e'); assert.equal(previous.checksum, oracle.checksum);
  assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.9.0');
  assert.equal(current.migratedFrom, 9); assert.equal(current.state.week, 371);
  assert.deepEqual(current.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(current.state, CONTENT), []); assertNoReleases(current.state);
  const move = current.state.slices.compute.rackRelocations![oracle.relocationId];
  assert.equal(move.status, 'moving'); assert.equal(move.stageIndex, 1); assert.equal(move.paidCents, 150_000);
  assert.equal(current.state.slices.compute.racks[oracle.movingRackId].status, 'parked');
  assert.equal(Object.values(current.state.slices.compute.facilityRetrofits!).filter(item => item.status === 'active').length, 2);
  assert.equal(getComputeCostView(current.state).reports.length, 8);
});

test('W9-S02: twelve full states match published Wave 8 through commissioning, historical cost expiry and license renewal', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 12);
  for (const expected of oracle.weeks) {
    state = step(state);
    const normalized = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
    assert.equal(canonicalStateHash(normalized), expected.hash, 'Published outcome changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoReleases(state);
    const company = state.slices.company.companies[state.playerCompanyId];
    assert.equal(company.cashCents, expected.cashCents); assert.equal(company.lastWeek.revenueCents, expected.revenueCents);
    assert.equal(company.lastWeek.operatingExpenseCents, expected.expenseCents); assert.equal(state.slices.markets.trustBps, expected.trustBps);
    const move = state.slices.compute.rackRelocations![oracle.relocationId], rack = state.slices.compute.racks[oracle.movingRackId];
    for (const key of ['status', 'stageIndex', 'readyWeek', 'completedWeek', 'stages'] as const) assert.deepEqual(move[key], expected.relocation[key]);
    assert.equal(rack.status, expected.relocation.rackStatus); assert.equal(rack.location, expected.relocation.location);
    assert.equal(rack.purchaseCents, oracle.originalRack.purchaseCents); assert.equal(rack.installedWeek, oracle.originalRack.installedWeek);
    assert.equal(rack.usableCU, oracle.originalRack.usableCU); assert.equal(rack.purchaseLocation, oracle.originalRack.purchaseLocation);
    assert.equal(getInfrastructureBaseCost(state), expected.relocation.fixedInfrastructureCents);
    assert.deepEqual(getComputePools(state).map(({ id, ownership, location, nominalCU, capacityCU, memoryMU, variableCentsPerCUw }) =>
      ({ id, ownership, location, nominalCU, capacityCU, memoryMU, variableCentsPerCUw })), expected.pools);
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
    for (const contract of expected.contracts) {
      const actual = state.slices.products.commercialContracts[contract.id];
      assert.equal(actual.termIndex, contract.termIndex); assert.equal(actual.termWeeksServed, contract.termWeeksServed);
      assert.equal(actual.lifetimeBilledCents, contract.lifetimeBilledCents);
    }
  }
  assert.equal(oracle.weeks.at(-1)!.hash, '8353b885');
  assert.equal(oracle.weeks.find(week => week.relocation.status === 'complete')!.week, 376);
  assert.equal(oracle.weeks.find(week => !week.costs.priorWeekRetained)!.week, 378);
  assert.equal(oracle.weeks.at(-1)!.contracts[0].termIndex, oracle.weeks[0].contracts[0].termIndex + 1);
});

test('W9-S03: save/reload throughout a paid relocation preserves the ready boundary, asset history and once-only commissioning', () => {
  let uninterrupted = loadHistorical().state, reloaded = loadHistorical().state;
  for (let index = 0; index < 6; index++) {
    const restored = deserializeState(serializeState(reloaded, historicalContent(reloaded)), historicalContent(reloaded)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.equal(restored.migratedFrom, undefined);
    uninterrupted = step(uninterrupted); reloaded = step(restored.state);
    assert.equal(canonicalStateHash(reloaded), canonicalStateHash(uninterrupted));
    const move = reloaded.slices.compute.rackRelocations![oracle.relocationId];
    if (reloaded.week === 375) { assert.equal(move.status, 'ready'); assert.equal(reloaded.slices.compute.racks[oracle.movingRackId].location, oracle.siteId); }
    if (reloaded.week >= 376) { assert.equal(move.status, 'complete'); assert.equal(move.completedWeek, 376); }
  }
  const rack = reloaded.slices.compute.racks[oracle.movingRackId];
  assert.equal(rack.location, 'colocation'); assert.equal(rack.status, 'installed');
  assert.equal(rack.purchaseCents, oracle.originalRack.purchaseCents); assert.equal(rack.installedWeek, oracle.originalRack.installedWeek);
  assert.equal(getInfrastructureBaseCost(reloaded), 78_000);
});

test('W9-S04: a corrupted published checksum is rejected before migration changes its representation', () => {
  const corrupt = envelope(); corrupt.state.slices.company.companies[corrupt.state.playerCompanyId].cashCents++;
  const text = JSON.stringify(corrupt), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(corrupt), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W9-S05: rehearsal and prepared-release records cannot hide beneath any Wave 0–8 header, including empty records', () => {
  for (let wave = 0; wave <= 8; wave++) {
    for (const field of ['releaseRehearsals', 'preparedReleases']) {
      const forged = olderEnvelope(wave); Object.assign(forged.state.slices.products, { [field]: {} });
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${field}.`);
    }
  }
});

test('W9-S06: every release command is rejected beneath all older headers, including false pause options', () => {
  const payloads = [
    { kind: 'start_release_rehearsal', productId: 'saved-product', candidateModelId: 'saved-model' },
    { kind: 'set_release_rehearsal_paused', rehearsalId: 'saved-rehearsal', paused: false },
    { kind: 'start_prepared_release', productId: 'saved-product', candidateModelId: 'saved-model' },
    { kind: 'set_prepared_release_paused', releaseId: 'saved-release', paused: false },
    { kind: 'discard_prepared_release', releaseId: 'saved-release' },
    { kind: 'promote_prepared_release', releaseId: 'saved-release' },
    { kind: 'start_release_rollback', releaseId: 'saved-release' },
  ];
  for (let wave = 0; wave <= 8; wave++) {
    for (const payload of payloads) {
      const forged = olderEnvelope(wave);
      forged.state.queuedCommands = [{ id: 'old-header-new-release', companyId: forged.state.playerCompanyId,
        issuedForWeek: forged.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
      const result = deserializeState(encoded(forged));
      assert.equal(result.ok, false, `Wave ${wave} incorrectly accepted ${payload.kind}.`);
    }
  }
});

test('W9-S07: authentic Wave 8 adoption records remain unavailable beneath a relabeled Wave 7 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.8.0'; forged.state.contentVersion = '0.8.0'; forged.state.buildVersion = '0.8.0';
  const result = deserializeState(encoded(forged));
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /unavailable in that build/);
});
