import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { WORKFORCE_POINTS_CONTENT_VERSION } from '../src/content/wave29';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { migrateWave29State } from '../src/core/migration';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';

const oldContent = { ...CONTENT, version: WORKFORCE_POINTS_CONTENT_VERSION, buildVersion: '0.32.0' };
const fixtureRoot = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const envelope = (state: GameState) => JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
  contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state });
function oldSave(): GameState {
  const result = deserializeState(readFileSync(join(fixtureRoot, 'wave27-canary-published.json'), 'utf8'), oldContent);
  assert.ok(result.ok, result.ok ? undefined : result.error); return result.state;
}
class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; failKey: string | null = null;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error('Quota'); this.writes.push(key); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser(storage: MemoryStorage, action: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { action(); } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('v42 save migration preserves frozen training, economic history, commands and random streams exactly', () => {
  const original = oldSave(), before = structuredClone(original), result = migrateWave29State(original, CONTENT);
  assert.ok(result.ok, result.ok ? undefined : result.error); assert.equal(result.migratedFrom, 30);
  assert.equal(result.state.contentVersion, CONTENT.version);
  const expected = structuredClone(original); expected.contentVersion = CONTENT.version; expected.buildVersion = CONTENT.buildVersion;
  expected.slices.markets.opportunityCalendar = { startedWeek: original.week, sequenceVersion: 2 };
  assert.deepEqual(result.state, expected); assert.deepEqual(original, before);
  assert.equal(result.state.slices.research.modelResearch, undefined);
  assert.ok(Object.values(result.state.slices.models.versions).every(model => model.advancedCapabilities === undefined && model.modelDesign === undefined));
  const loaded = deserializeState(envelope(original)); assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  assert.deepEqual(loaded.state, result.state);
  const restored = deserializeState(serializeState(result.state)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.deepEqual(restored.state, result.state); assert.equal(restored.migratedFrom, undefined);
  const advanced = advanceWeek(restored.state); assert.ok(advanced.accepted, advanced.reason?.message);
});

test('advanced features cannot be relabelled as a valid older save even with a recomputed checksum', () => {
  const original = oldSave();
  const changes: Array<(state: GameState) => void> = [
    state => { state.slices.models.versions[Object.keys(state.slices.models.versions)[0]].advancedCapabilities = { reasoning: 0, longContext: 0, multimodal: 0 }; },
    state => { state.slices.data.packets[Object.keys(state.slices.data.packets)[0]].advancedCoverageBps = { reasoning: 0, longContext: 0, multimodal: 0 }; },
    state => { state.slices.research.modelResearch = {}; },
    state => { state.slices.models.versions[Object.keys(state.slices.models.versions)[0]].family = 'edge'; },
    state => { Object.assign(Object.values(state.slices.models.trainingRuns)[0].plan!, { advanced: {} }); },
    state => { state.queuedCommands.push({ id: 'future-research', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'start_model_research' } }); },
    state => { state.queuedCommands.push({ id: 'future-data', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, payload: { kind: 'buy_data', catalogId: 'advanced-reasoning-1' } }); },
  ];
  for (const change of changes) {
    const changed = structuredClone(original); change(changed);
    assert.equal(deserializeState(envelope(changed)).ok, false);
    assert.equal(migrateWave29State(changed, CONTENT).ok, false);
    assert.ok(validateState(changed, oldContent).length > 0);
  }
});

test('the first upgraded browser write archives exact v42 bytes before replacing the current save', () => {
  const primary = 'frontier-lab.wave0.snapshot', backup = 'frontier-lab.content029.original';
  const original = envelope(oldSave()) + '\n';
  for (const failBackup of [false, true]) {
    const storage = new MemoryStorage(); storage.values.set(primary, original); if (failBackup) storage.failKey = backup;
    inBrowser(storage, () => {
      const loaded = readBrowserSnapshot(); assert.equal(loaded.kind, 'loaded'); if (loaded.kind !== 'loaded') return;
      assert.equal(loaded.migratedFrom, 30); assert.deepEqual(storage.writes, []);
      const written = writeBrowserSnapshot(loaded.state);
      if (failBackup) { assert.equal(written.ok, false); assert.equal(storage.getItem(primary), original); assert.deepEqual(storage.writes, []); }
      else {
        assert.equal(written.ok, true); assert.deepEqual(storage.writes, [backup, primary]);
        assert.deepEqual(readBrowserRecovery('content029'), { text: original, filename: 'frontier-lab-content029-original.json' });
        assert.ok(browserRecoveryOptions().some(option => option.kind === 'content029'));
      }
    });
  }
});
