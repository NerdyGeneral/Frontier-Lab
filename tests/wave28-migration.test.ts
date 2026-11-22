import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../src/content/wave27';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../src/content/wave29';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, createInitialState, submitCommand, validateState } from '../src/core/engine';
import { migrateWave27State } from '../src/core/migration';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL = 'frontier-lab.content027.original';
const FIXTURES = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const published = (name: 'canary' | 'appliance') => readFileSync(join(FIXTURES, `wave27-${name}-published.json`), 'utf8');
const oldContent = { ...CONTENT, version: STUDIO_RELEASE_CONTENT_VERSION, buildVersion: STUDIO_RELEASE_CONTENT_VERSION };
const envelope = (state: GameState) => JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
  contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state });

class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; failWriteKey: string | null = null;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failWriteKey) throw new Error('Quota exceeded');
    this.writes.push(key); this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser(storage: MemoryStorage, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('W28-M01: S5/S6 are paid discoveries with no free profile or successor at company creation', () => {
  assert.equal(createInitialState().contentVersion, CONTENT.version); assert.equal(createInitialState().buildVersion, CONTENT.buildVersion);
  assert.equal(CONTENT.research.length, 54);
  assert.deepEqual(CONTENT.research.filter(item => ['S5', 'S6'].includes(item.id)).map(item => ({
    id: item.id, requires: item.requires, fee: item.feeCents, role: item.role, staff: item.staffWeeks, work: item.workCUw,
  })), [
    { id: 'S5', requires: ['R12A'], fee: 1400000, role: 'infrastructure', staff: 6, work: 14000000000 },
    { id: 'S6', requires: ['R16', 'S5'], fee: 2200000, role: 'hardware', staff: 8, work: 18000000000 },
  ]);
  const state = createInitialState();
  assert.equal(state.slices.compute.facilitySpecializations, undefined);
  assert.deepEqual(state.slices.compute.chipDesigns, {});
  assert.equal(submitCommand(state, { kind: 'start_research', researchId: 'S5' }).accepted, false);
  assert.equal(submitCommand(state, { kind: 'start_research', researchId: 'S6' }).accepted, false);
  assert.deepEqual(validateState(state), []);
});

test('W28-M02: both published release paths preserve every paid receipt and queued command during migration', () => {
  for (const name of ['canary', 'appliance'] as const) {
    const original = JSON.parse(published(name)).state as GameState;
    assert.equal(original.contentVersion, STUDIO_RELEASE_CONTENT_VERSION);
    if (name === 'canary') assert.ok(Object.keys(original.slices.products.canaryReleases ?? {}).length);
    else assert.ok(Object.keys(original.slices.products.privateApplianceOrders ?? {}).length);
    const queued = submitCommand(original, { kind: 'rename_company', name: 'Campus continuity check' }, oldContent);
    assert.equal(queued.accepted, true, queued.reason?.message);
    for (const source of [original, queued.state]) {
      const before = canonicalStateHash(source), result = deserializeState(envelope(source));
      if (!result.ok) throw new Error(result.error);
      assert.equal(result.migratedFrom, 28);
      const expected = structuredClone(source); expected.contentVersion = CONTENT.version; expected.buildVersion = CONTENT.buildVersion;
      expected.slices.markets.opportunityCalendar = { startedWeek: source.week, sequenceVersion: 2 };
      assert.deepEqual(result.state, expected, 'Only content/build headers and the announced market calendar change.');
      assert.equal(canonicalStateHash(source), before);
      assert.equal(result.state.slices.compute.facilitySpecializations, undefined);
      assert.ok(Object.values(result.state.slices.compute.chipDesigns).every(design => !design.successor));
      const restored = deserializeState(serializeState(result.state)); if (!restored.ok) throw new Error(restored.error);
      assert.deepEqual(restored.state, result.state); assert.equal(restored.migratedFrom, undefined);
    }
  }
});

test('W28-M03: first browser write archives exact 0.27 bytes and aborts if recovery cannot be saved', () => {
  const original = published('appliance') + '\n';
  const storage = new MemoryStorage(); storage.values.set(PRIMARY, original);
  inBrowser(storage, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected migrated 0.27 save.');
    assert.equal(loaded.migratedFrom, 28); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY]);
    assert.deepEqual(readBrowserRecovery('content027'), { text: original, filename: 'frontier-lab-content027-original.json' });
    assert.deepEqual(browserRecoveryOptions().map(item => item.kind), ['content027']);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), original); assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY, PRIMARY]);
  });
  const blocked = new MemoryStorage(); blocked.values.set(PRIMARY, original); blocked.failWriteKey = ORIGINAL;
  inBrowser(blocked, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected migrated 0.27 save.');
    assert.equal(writeBrowserSnapshot(loaded.state).ok, false);
    assert.equal(blocked.getItem(PRIMARY), original); assert.equal(blocked.getItem(ORIGINAL), null); assert.deepEqual(blocked.writes, []);
  });
});

test('W28-M04: historical headers cannot smuggle Campus commands, profile proof or successor targets', () => {
  const original = JSON.parse(published('appliance')).state as GameState;
  const changes: Array<[string, (state: GameState) => void]> = [
    ['profile collection', state => { state.slices.compute.facilitySpecializations = {}; }],
    ['successor target', state => { Object.values(state.slices.compute.chipDesigns)[0].successor = { generation: 2, parentDesignId: 'missing', parentFingerprint: '00000000', improvement: 'memory' }; }],
    ['profile snapshot', state => { Object.assign(state.slices.compute.fleets[state.playerCompanyId], { specialization: {} }); }],
    ['discount proof', state => { Object.assign(state.slices.compute.fleets[state.playerCompanyId], { facilityTariff: {} }); }],
    ...(['S5', 'S6', 'D1', 'D6'] as const).map(researchId => [researchId, (state: GameState) => {
      state.queuedCommands.push({ id: `future-${researchId}`, companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_research', researchId } });
    }] as [string, (state: GameState) => void]),
    ['retrofit command', state => { state.queuedCommands.push({ id: 'future-campus', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_facility_specialization', facilityId: 'missing', profile: 'serving' } }); }],
    ['successor command', state => { state.queuedCommands.push({ id: 'future-silicon', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_chip_successor', parentDesignId: 'missing', improvement: 'throughput', name: 'Future' } }); }],
  ];
  for (const [name, change] of changes) {
    const state = structuredClone(original); change(state);
    assert.equal(deserializeState(envelope(state)).ok, false, name);
    assert.equal(migrateWave27State(state, CONTENT).ok, false, `${name}: direct migration`);
  }
});

test('W28-M05: historical work is preserved and restored companies continue deterministically under current rules', () => {
  for (const name of ['canary', 'appliance'] as const) {
    const historical = JSON.parse(published(name)).state as GameState;
    const migrated = deserializeState(published(name)); if (!migrated.ok) throw new Error(migrated.error);
    let current = migrated.state;
    const expected = structuredClone(historical); expected.contentVersion = CONTENT.version; expected.buildVersion = CONTENT.buildVersion;
    expected.slices.markets.opportunityCalendar = { startedWeek: historical.week, sequenceVersion: 2 };
    assert.deepEqual(current, expected, `${name}: migration changes only the version headers and announced market calendar, preserving all paid work`);
    const restored = deserializeState(serializeState(current)); if (!restored.ok) throw new Error(restored.error);
    let replay = restored.state;
    for (let index = 0; index < 3; index++) {
      const newStep = advanceWeek(current), replayStep = advanceWeek(replay);
      assert.equal(newStep.accepted, true, newStep.reason?.message); assert.equal(replayStep.accepted, true, replayStep.reason?.message);
      assert.deepEqual(newStep, replayStep, `${name}: reload changed continuation under the current point rates`);
      current = newStep.state;
      const reloaded = deserializeState(serializeState(replayStep.state)); if (!reloaded.ok) throw new Error(reloaded.error);
      replay = reloaded.state;
      assert.deepEqual(validateState(current), []);
    }
  }
});
