import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';

const raw = readFileSync(join(__dirname, 'fixtures/wave4-snapshot.json'), 'utf8');
const envelope = () => JSON.parse(raw) as { checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
function projection(state: GameState) {
  const owner = state.playerCompanyId;
  return {
    week: state.week, applicationRuns: state.slices.models.applicationRuns,
    chipDesigns: state.slices.compute.chipDesigns, chipBatches: state.slices.compute.chipBatches,
    fabricProjects: state.slices.compute.fabricProjects,
    racks: Object.fromEntries(Object.entries(state.slices.compute.racks).filter(([, rack]) => rack.companyId === owner)),
    rollouts: state.slices.research.systemRollouts, efficiencyInstalls: state.slices.products.efficiencyInstalls,
    playerReceipts: Object.fromEntries(Object.entries(state.commandReceipts).filter(([id]) => id.startsWith('published-'))),
    playerAllocation: state.slices.compute.fleets[owner].allocation,
  };
}
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave4-expected.json'), 'utf8')) as {
  sourceCommit: string; checksum: string; baseline: ReturnType<typeof projection>; weeks: ReturnType<typeof projection>[];
};
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }

test('W5-S01: authentic Wave 4 import adds the announced market calendar, without time, money or achievement grants', () => {
  const prior = envelope(), current = load();
  assert.equal(oracle.sourceCommit, '0fef8d0e2c010ca4ce351ff5215a2df757376480');
  assert.equal(prior.checksum, '326eb5c9'); assert.equal(prior.checksum, canonicalStateHash(prior.state));
  assert.equal(prior.schemaVersion, 5); assert.equal(prior.contentVersion, '0.5.0');
  assert.equal(current.migratedFrom, 5);
  assert.deepEqual(current.state, { ...prior.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...prior.state.slices, markets: { ...prior.state.slices.markets, opportunityCalendar: { startedWeek: prior.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(projection(current.state), oracle.baseline);
});

test('W5-S02: paid Wave 4 engineering, rollouts and queued commands preserve their five-week published completion schedule', () => {
  let state = load().state;
  for (const expected of oracle.weeks) {
    const next = advanceWeek(state); assert.ok(next.accepted, next.reason?.message); state = next.state;
    assert.deepEqual(projection(state), expected, 'Existing paid engineering work changed in Week ' + state.week);
  }
  assert.ok(Object.values(state.slices.compute.chipBatches).some(batch => batch.status === 'delivered'));
  assert.ok(Object.values(state.slices.compute.fabricProjects).some(fabric => fabric.status === 'active'));
  assert.equal(state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
});

test('W5-S03: upgraded late-game saves replay deterministically and keep their format on the next round trip', () => {
  let left = load().state;
  const loaded = deserializeState(serializeState(left)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(loaded.migratedFrom, undefined); let right = loaded.state;
  for (let n = 0; n < 5; n++) {
    const a = advanceWeek(left), b = advanceWeek(right); assert.ok(a.accepted, a.reason?.message); assert.ok(b.accepted, b.reason?.message);
    left = a.state; right = b.state; assert.equal(canonicalStateHash(left), canonicalStateHash(right));
  }
});

test('W5-S04: Wave 4 corruption and forged application requirements fail before content upgrade', () => {
  const changed = envelope(); changed.state.slices.company.companies[changed.state.playerCompanyId].cashCents++;
  const invalidChecksum = deserializeState(JSON.stringify(changed)); assert.equal(invalidChecksum.ok, false);
  const forged = envelope(); Object.values(forged.state.slices.models.applicationRuns)[0].requiredStaff = 1;
  forged.checksum = canonicalStateHash(forged.state);
  const invalidState = deserializeState(JSON.stringify(forged)); assert.equal(invalidState.ok, false);
});
