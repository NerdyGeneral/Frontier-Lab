import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { migrateStrategyState } from '../src/core/migration';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION, containsModelCustomizationFeatures } from '../src/core/model-customization-version';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';

// Produced with untouched published source f60d136 and real paid commands.
// The established-company fixture has a frozen custom development plan, paid
// research focus, a chapter choice, rival plans and a queued data purchase.
const fixtureRoot = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const initialRaw = readFileSync(join(fixtureRoot, 'customization-034-initial-published.json'), 'utf8');
const activeRaw = readFileSync(join(fixtureRoot, 'customization-034-active-published.json'), 'utf8');
const oldContent = { ...CONTENT, version: '0.34.0', buildVersion: '0.34.0' };
const oldState = (): GameState => JSON.parse(activeRaw).state;
const encoded = (state: GameState) => JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
  contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state });
const customization = { version: 1, attention: 'standard', contextWindow: 'standard', precision: 'full', objective: 'generalist', behavior: 'balanced' } as const;

test('published 0.34 campaigns migrate by changing only version metadata', () => {
  assert.ok([MODEL_CUSTOMIZATION_CONTENT_VERSION, '0.36.0', '0.37.0'].includes(CONTENT.version));
  for (const raw of [initialRaw, activeRaw]) {
    const envelope = JSON.parse(raw), original = envelope.state as GameState, before = structuredClone(original);
    assert.equal(envelope.contentVersion, '0.34.0');
    assert.equal(original.buildVersion, '0.34.0');
    assert.equal(canonicalStateHash(original), envelope.checksum);
    assert.deepEqual(validateState(original, oldContent), []);
    const result = deserializeState(raw); assert.ok(result.ok, result.ok ? undefined : result.error);
    assert.equal(result.migratedFrom, 34);
    const expected: GameState = { ...structuredClone(original), contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion };
    assert.deepEqual(result.state, expected);
    assert.deepEqual(original, before);
    const direct = migrateStrategyState(original, CONTENT); assert.ok(direct.ok, direct.ok ? undefined : direct.error);
    assert.deepEqual(direct.state, expected);
    assert.deepEqual(validateState(result.state), []);
    assert.equal(containsModelCustomizationFeatures(result.state), false, 'Migration cannot grant discoveries or rewrite a model design.');
  }
});

test('frozen custom plans, paid research, active work and queued orders continue deterministically after upgrade', () => {
  const original = oldState(), result = deserializeState(activeRaw); assert.ok(result.ok, result.ok ? undefined : result.error);
  const game = result.state;
  assert.ok(Object.keys(game.slices.models.developmentPlans ?? {}).length > 0);
  assert.ok(Object.values(game.slices.research.modelResearch ?? {}).some(project => project.focus));
  assert.ok(game.queuedCommands.some(command => command.id === 'archive-034-queued-data'));
  assert.deepEqual(game.slices, original.slices);
  assert.deepEqual(game.random, original.random);
  assert.deepEqual(game.queuedCommands, original.queuedCommands);
  const restored = deserializeState(serializeState(game)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.equal(restored.migratedFrom, undefined);
  assert.deepEqual(restored.state, game);
  const first = advanceWeek(game), second = advanceWeek(restored.state);
  assert.ok(first.accepted, first.reason?.message); assert.ok(second.accepted, second.reason?.message);
  assert.deepEqual(first.state, second.state);
  assert.equal(first.state.commandReceipts['archive-034-queued-data'].status, 'accepted');
  for (const [id, run] of Object.entries(original.slices.models.trainingRuns))
    assert.deepEqual(first.state.slices.models.trainingRuns[id].plan, run.plan, 'Paid plan must stay frozen: ' + id);
});

test('historical headers cannot smuggle new research or customization through migration', () => {
  const mutations: Array<(game: GameState) => void> = [
    game => { Object.assign(game.slices.models.versions[Object.keys(game.slices.models.versions)[0]], { customization }); },
    game => { Object.assign(Object.values(game.slices.models.developmentPlans!)[0].training.modelDesign!, { customization }); },
    game => { Object.assign(Object.values(game.slices.models.trainingRuns).find(run => run.plan?.modelDesign)!.plan!.modelDesign!.spec, { customization }); },
    ...Array.from({ length: 13 }, (_, index) => (game: GameState) => {
      game.queuedCommands.push({ id: 'future-method', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
        payload: { kind: 'start_research', researchId: 'M' + (index + 1) } });
    }),
    game => { game.slices.research.completedByCompany[game.playerCompanyId].push('M1'); },
  ];
  for (const mutate of mutations) {
    const forged = oldState(); mutate(forged);
    assert.equal(containsModelCustomizationFeatures(forged), true);
    const result = deserializeState(encoded(forged)); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /historical save version/);
    assert.equal(migrateStrategyState(forged, CONTENT).ok, false);
    assert.ok(validateState(forged, oldContent).length > 0);
  }
  assert.equal(containsModelCustomizationFeatures({ name: 'M1', message: 'M13', source: 'M2' }), false, 'Historical names are not research evidence.');
});

class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = [];
  failArchive = false; compressArchive = false;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === 'frontier-lab.content034.original' && (this.failArchive || this.compressArchive && !value.startsWith(RECOVERY_ARCHIVE_PREFIX)))
      throw new DOMException('Quota', 'QuotaExceededError');
    this.values.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser(storage: MemoryStorage, action: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { action(); } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('the first upgraded browser write archives the exact 0.34 bytes before replacement, including compressed recovery', () => {
  const primary = 'frontier-lab.wave0.snapshot', backup = 'frontier-lab.content034.original';
  const original = initialRaw.replace(/\n/g, '\r\n') + '\t\n';
  for (const compressed of [false, true]) {
    const storage = new MemoryStorage(); storage.values.set(primary, original); storage.compressArchive = compressed;
    inBrowser(storage, () => {
      const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded'); if (read.kind !== 'loaded') return;
      assert.equal(read.migratedFrom, 34); assert.equal(read.savedBytes, original); assert.deepEqual(storage.writes, []);
      const result = writeBrowserSnapshotWithBytes(read.state); assert.equal(result.ok, true);
      assert.deepEqual(storage.writes, [backup, primary]);
      assert.equal(JSON.parse(storage.getItem(primary)!).contentVersion, CONTENT.version);
      assert.deepEqual(readBrowserRecovery('content034'), { text: original, filename: 'frontier-lab-content034-original.json' });
      assert.ok(browserRecoveryOptions().some(option => option.kind === 'content034'));
      assert.equal(storage.getItem(backup)!.startsWith(RECOVERY_ARCHIVE_PREFIX), compressed);
    });
  }
});

test('a failed 0.34 recovery archive leaves the original browser campaign untouched', () => {
  const primary = 'frontier-lab.wave0.snapshot', storage = new MemoryStorage();
  storage.values.set(primary, initialRaw); storage.failArchive = true;
  inBrowser(storage, () => {
    const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded'); if (read.kind !== 'loaded') return;
    const result = writeBrowserSnapshotWithBytes(read.state); assert.equal(result.ok, false);
    assert.equal(storage.getItem(primary), initialRaw); assert.deepEqual(storage.writes, []);
  });
});
