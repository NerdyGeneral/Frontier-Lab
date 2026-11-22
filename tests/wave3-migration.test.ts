import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, createInitialState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateLegacyWave2State } from '../src/core/legacy-wave2-validation';
import { validateState } from '../src/core/validation';

// This fixture and its cash/work oracle were produced by the published Wave 2
// commit itself, with active research, a purchased rack and reserved commands.
const raw = readFileSync(join(__dirname, 'fixtures/wave2-snapshot.json'), 'utf8');
const oldEnvelope = () => JSON.parse(raw) as { format: string; schemaVersion: number; contentVersion: string; checksum: string; state: GameState };
function projection(s: GameState) {
  const id = s.playerCompanyId;
  return {
    week: s.week, player: s.slices.company.companies[id],
    ledger: s.slices.company.ledger.filter(entry => entry.companyId === id && entry.week === s.week),
    fleet: s.slices.compute.fleets[id],
    staff: Object.fromEntries(Object.entries(s.slices.company.staff).filter(([, member]) => member.companyId === id)),
    research: Object.fromEntries(Object.entries(s.slices.research.projects).filter(([, project]) => project.companyId === id)),
    completedResearch: s.slices.research.completedByCompany[id],
    racks: Object.fromEntries(Object.entries(s.slices.compute.racks).filter(([, rack]) => rack.companyId === id)),
    scheduled: s.scheduled.filter(item => item.companyId === id),
    queuedCommands: s.queuedCommands.filter(command => command.companyId === id),
    random: s.random,
  };
}
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave2-expected.json'), 'utf8')) as {
  sourceCommit: string; baseline: ReturnType<typeof projection>; weeks: ReturnType<typeof projection>[];
};
function migrated() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }

test('W3-S01: authentic Wave 2 save gains empty Wave 3 records, the announced market calendar and current version fields', () => {
  const old = oldEnvelope();
  assert.equal(oracle.sourceCommit, '613f0e326e3384063868139a56a13cf3cb20e397');
  assert.equal(old.schemaVersion, 3); assert.equal(old.contentVersion, '0.3.0');
  assert.equal(old.checksum, 'c1a6a75d'); assert.equal(canonicalStateHash(old.state), old.checksum);
  assert.deepEqual(validateLegacyWave2State(old.state, { ...CONTENT, version: '0.3.0', buildVersion: '0.3.0' }), []);
  const result = migrated(), s = result.state;
  assert.equal(result.migratedFrom, 3); assert.equal(s.schemaVersion, 5); assert.equal(s.contentVersion, CONTENT.version);
  for (const key of ['week','revision','nextId','seed','playerCompanyId','random','queuedCommands','commandReceipts','scheduled','journal','lastTick'] as const) assert.deepEqual(s[key], old.state[key]);
  for (const key of ['company','data'] as const) assert.deepEqual(s.slices[key], old.state.slices[key]);
  assert.deepEqual(s.slices.markets, { ...old.state.slices.markets, opportunityCalendar: { startedWeek: old.state.week, sequenceVersion: 2 as const } });
  assert.deepEqual(s.slices.compute, { ...old.state.slices.compute, chipDesigns: {}, chipBatches: {}, fabricProjects: {}, servingHistory: {} });
  assert.deepEqual(s.slices.models, { ...old.state.slices.models, applicationRuns: {} });
  assert.deepEqual(s.slices.research, { ...old.state.slices.research, systemRollouts: {}, assistantsByCompany: {} });
  assert.deepEqual(s.slices.campaign, { ...old.state.slices.campaign, history: [], endings: {} });
  assert.deepEqual(s.slices.products, { ...old.state.slices.products, retrievalInstalls: {}, commercialContracts: {}, commercialInvoices: [], efficiencyInstalls: {} });
  assert.deepEqual(s.slices.agents, { activeJobIds: [], jobs: {}, actionReceipts: {}, invoices: [], claims: {}, totalsByCompany: {} });
  assert.deepEqual(projection(s), oracle.baseline);
  assert.deepEqual(validateState(s, CONTENT), []);
});

test('W3-S02: idle Wave 3 preserves the published next-three-week cash, research, workforce, equipment and RNG oracle', () => {
  let s = migrated().state;
  for (const expected of oracle.weeks) {
    const next = advanceWeek(s); assert.ok(next.accepted, next.reason?.message); s = next.state;
    assert.deepEqual(projection(s), expected, `Published Wave 2 outcomes changed in Week ${expected.week}`);
    assert.deepEqual(s.slices.agents.activeJobIds, []);
    assert.equal(Object.keys(s.slices.products.commercialContracts).length, 0);
  }
});

test('W3-S03: migration is deterministic and round trips without re-seeding rivals or reapplying migration', () => {
  const a = migrated(), b = migrated(); assert.deepEqual(a, b);
  const loaded = deserializeState(serializeState(a.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(loaded.migratedFrom, undefined);
  let left = a.state, right = loaded.state;
  for (let i = 0; i < 6; i++) {
    const x = advanceWeek(left), y = advanceWeek(right);
    assert.ok(x.accepted, x.reason?.message); assert.ok(y.accepted, y.reason?.message);
    left = x.state; right = y.state; assert.equal(canonicalStateHash(left), canonicalStateHash(right));
    assert.equal(left.slices.markets.activeRivalIds.length, 3);
  }
});

test('W3-S04: changed checksums, fake Wave 2 headers and unsupported legacy commands fail before migration', () => {
  const corrupted = oldEnvelope(); corrupted.state.slices.company.companies[corrupted.state.playerCompanyId].cashCents++;
  const badChecksum = deserializeState(JSON.stringify(corrupted)); assert.equal(badChecksum.ok, false);
  if (!badChecksum.ok) assert.match(badChecksum.error, /checksum/);
  const fake = createInitialState(); fake.schemaVersion = 3; fake.contentVersion = '0.3.0'; fake.buildVersion = '0.3.0';
  const badShape = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: 3, contentVersion: '0.3.0', state: fake, checksum: canonicalStateHash(fake) }));
  assert.equal(badShape.ok, false); if (!badShape.ok) assert.match(badShape.error, /Specialist commissions and varied campaign schedules do not belong to this historical save version/);
  const unsupported = oldEnvelope(); unsupported.state.queuedCommands[0].payload = { kind: 'cancel_agent_job', jobId: 'forged-job' };
  unsupported.checksum = canonicalStateHash(unsupported.state);
  const badCommand = deserializeState(JSON.stringify(unsupported)); assert.equal(badCommand.ok, false);
  if (!badCommand.ok) assert.match(badCommand.error, /Unknown command/);
});
