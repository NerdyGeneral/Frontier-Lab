import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { SYNTHETIC_CONTENT_VERSION } from '../src/content/wave26-synthetic';
import { STUDIO_RELEASE_CONTENT_VERSION } from '../src/content/wave27';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../src/content/wave29';
import { canonicalStateHash } from '../src/core/canonical';
import { createInitialState, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { migrateWave26State } from '../src/core/migration';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';
import type { GameState } from '../src/contracts/types';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL = 'frontier-lab.content026.original';
const FIXTURES = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const published = () => readFileSync(join(FIXTURES, 'wave26-published.json'), 'utf8');
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

test('W27-M01: S3/S4 are ordinary paid discoveries and a new company receives no release artifacts', () => {
  assert.equal(createInitialState().contentVersion, CONTENT.version);
  assert.equal(createInitialState().buildVersion, CONTENT.buildVersion); assert.equal(CONTENT.research.length, 54);
  assert.deepEqual(CONTENT.research.filter(item => ['S3', 'S4'].includes(item.id)).map(item => ({
    id: item.id, requires: item.requires, fee: item.feeCents, role: item.role, staff: item.staffWeeks, work: item.workCUw,
  })), [
    { id: 'S3', requires: ['R1A', 'R12A'], fee: 700000, role: 'research', staff: 4, work: 8000000000 },
    { id: 'S4', requires: ['R7A', 'R12', 'S3'], fee: 1100000, role: 'infrastructure', staff: 5, work: 12000000000 },
  ]);
  const state = createInitialState();
  assert.equal(state.slices.products.canaryReleases, undefined);
  assert.equal(state.slices.products.privateApplianceOrders, undefined);
  assert.deepEqual(validateState(state), []);
});

test('W27-M02: the published synthetic campaign migrates with every existing slice, command and receipt intact', () => {
  const original = JSON.parse(published()).state as GameState;
  assert.equal(original.contentVersion, SYNTHETIC_CONTENT_VERSION);
  assert.ok(Object.keys(original.slices.data.syntheticJobs ?? {}).length > 0, 'The fixture includes paid synthetic evidence.');
  const oldContent = { ...CONTENT, version: SYNTHETIC_CONTENT_VERSION, buildVersion: SYNTHETIC_CONTENT_VERSION };
  const queued = submitCommand(original, { kind: 'rename_company', name: original.slices.company.companies[original.playerCompanyId].name }, oldContent);
  assert.equal(queued.accepted, true, queued.reason?.message); assert.equal(queued.state.queuedCommands.length, original.queuedCommands.length + 1);
  for (const source of [original, queued.state]) {
    const before = canonicalStateHash(source);
    const result = deserializeState(envelope(source)); if (!result.ok) throw new Error(result.error);
    assert.equal(result.migratedFrom, 27);
    const expected = structuredClone(source);
    expected.contentVersion = CONTENT.version; expected.buildVersion = CONTENT.buildVersion;
    expected.slices.markets.opportunityCalendar = { startedWeek: source.week, sequenceVersion: 2 };
    assert.deepEqual(result.state, expected, 'Only the content/build headers and announced market calendar change.');
    assert.equal(canonicalStateHash(source), before, 'Migration leaves its input untouched.');
    assert.equal(result.state.slices.products.canaryReleases, undefined);
    assert.equal(result.state.slices.products.privateApplianceOrders, undefined);
    const restored = deserializeState(serializeState(result.state)); if (!restored.ok) throw new Error(restored.error);
    assert.deepEqual(restored.state, result.state); assert.equal(restored.migratedFrom, undefined);
  }
});

test('W27-M03: first upgraded browser write archives exact 0.26 bytes before replacing the primary save', () => {
  const original = published() + '\n';
  const storage = new MemoryStorage(); storage.values.set(PRIMARY, original);
  inBrowser(storage, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected a migrated 0.26 company.');
    assert.equal(loaded.migratedFrom, 27); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY]);
    assert.deepEqual(readBrowserRecovery('content026'), { text: original, filename: 'frontier-lab-content026-original.json' });
    assert.deepEqual(browserRecoveryOptions().map(item => item.kind), ['content026']);
    assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), original); assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY, PRIMARY]);
  });
  const blocked = new MemoryStorage(); blocked.values.set(PRIMARY, original); blocked.failWriteKey = ORIGINAL;
  inBrowser(blocked, () => {
    const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected a migrated 0.26 company.');
    assert.equal(writeBrowserSnapshot(loaded.state).ok, false);
    assert.equal(blocked.getItem(PRIMARY), original); assert.equal(blocked.getItem(ORIGINAL), null);
    assert.deepEqual(blocked.writes, []); assert.equal(readBrowserRecovery('stored')?.text, original);
  });
});

test('W27-M04: correctly checksummed historical envelopes cannot smuggle new research, canary receipts or appliance contracts', () => {
  const original = JSON.parse(published()).state as GameState;
  const cases: Array<[string, (state: GameState) => void]> = [
    ['canary collection', state => { state.slices.products.canaryReleases = {}; }],
    ['appliance collection', state => { state.slices.products.privateApplianceOrders = {}; }],
    ['S3 discovery', state => { state.slices.research.completedByCompany[state.playerCompanyId].push('S3'); }],
    ['S4 queued research', state => { state.queuedCommands.push({ id: 'future-research', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_research', researchId: 'S4' } }); }],
    ['canary command', state => { state.queuedCommands.push({ id: 'future-canary', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_release_canary', releaseId: 'release', shareBps: 1000, sampleFloor: 100, budgetCUw: 1000000000 } }); }],
    ['canary stop command', state => { state.queuedCommands.push({ id: 'future-stop', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'stop_release_canary', canaryId: 'canary' } }); }],
    ['appliance command', state => { state.queuedCommands.push({ id: 'future-appliance', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'accept_private_appliance_order', buyerId: 'cedar-records', modelId: 'model', designId: 'design', foundry: 'standard' } }); }],
    ['orphan Cedar contract', state => { const contract = Object.values(state.slices.products.commercialContracts)[0]; assert.ok(contract); contract.customerId = 'cedar-records'; }],
  ];
  for (const [label, mutate] of cases) {
    const state = structuredClone(original); mutate(state);
    const result = deserializeState(envelope(state));
    assert.equal(result.ok, false, label); if (!result.ok) assert.match(result.error, /historical save version/, label);
    assert.equal(migrateWave26State(state, CONTENT).ok, false, label + ' via direct migration');
  }
});
