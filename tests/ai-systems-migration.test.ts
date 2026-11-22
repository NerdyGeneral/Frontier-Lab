import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { migrateGameplayPolishState } from '../src/core/migration';
import { containsAISystemsFeatures } from '../src/core/ai-systems-version';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';

// Captured using untouched published 259cdad (0.36.1). The active fixture has a
// paid custom training run and earned research, customers and rival plans.
const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const initial = readFileSync(join(directory, 'systems-036-initial-published.json'), 'utf8');
const active = readFileSync(join(directory, 'systems-036-active-published.json'), 'utf8');
const historical = { ...CONTENT, version: '0.36.0', buildVersion: '0.36.1' };
const encode = (state: GameState) => JSON.stringify({ format: 'frontier-lab', schemaVersion: 5,
  contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state });

test('published 0.36 labs upgrade without altering any paid record, money or random stream', () => {
  for (const raw of [initial, active]) {
    const envelope = JSON.parse(raw), original: GameState = envelope.state;
    assert.equal(canonicalStateHash(original), envelope.checksum);
    assert.deepEqual(validateState(original, historical), []);
    const result = deserializeState(raw); assert.ok(result.ok, result.ok ? undefined : result.error);
    assert.equal(result.migratedFrom, 36);
    assert.deepEqual(result.state, { ...original, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion });
    assert.equal(containsAISystemsFeatures(result.state), false);
    const direct = migrateGameplayPolishState(original, CONTENT); assert.ok(direct.ok, direct.ok ? undefined : direct.error);
    assert.deepEqual(direct.state, result.state);
  }
});

test('old paid design continues with the same frozen plan after upgrade, export and reload', () => {
  const original: GameState = JSON.parse(active).state;
  const imported = deserializeState(active); assert.ok(imported.ok, imported.ok ? undefined : imported.error);
  const paid = Object.values(original.slices.models.trainingRuns).find(run => run.status === 'running' && run.plan?.modelDesign)!;
  assert.ok(paid?.plan?.modelDesign);
  let upgraded = imported.state;
  const restored = deserializeState(serializeState(upgraded)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  let reloaded = restored.state;
  let old = original;
  for (let week = 0; week < 5; week++) {
    const next = advanceWeek(upgraded), again = advanceWeek(reloaded), before = advanceWeek(old, historical);
    assert.ok(next.accepted, next.reason?.message); assert.ok(again.accepted, again.reason?.message); assert.ok(before.accepted, before.reason?.message);
    upgraded = next.state; reloaded = again.state; old = before.state;
    assert.deepEqual(upgraded, reloaded);
    assert.deepEqual(upgraded.slices.models.trainingRuns[paid.id], old.slices.models.trainingRuns[paid.id]);
    assert.deepEqual(upgraded.slices.models.trainingRuns[paid.id].plan, paid.plan);
    assert.deepEqual(upgraded.slices.models.versions, old.slices.models.versions);
  }
});

test('new system designs, discoveries, challenges and orders cannot hide under a historical header', () => {
  const mutations: Array<(game: GameState) => void> = [
    game => { game.slices.campaign.systemsBriefs = {}; },
    game => { Object.assign(Object.values(game.slices.models.trainingRuns).find(run => run.plan?.modelDesign)!.plan!.modelDesign!.spec,
      { system: { version: 1, kind: 'stateful', stateSlots: 16, memory: 'fixed', repair: false } }); },
    game => { game.queuedCommands.push({ id: 'future-system', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
      payload: { kind: 'accept_systems_brief', offerId: 'systems-offer-continuity-desk-0', modelId: 'seed-0' } }); },
    game => { game.queuedCommands.push({ id: 'future-test', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
      payload: { kind: 'evaluate_model', modelId: 'seed-0', suiteId: 'systems-retention-1' } }); },
    ...Array.from({ length: 12 }, (_, index) => (game: GameState) => {
      game.queuedCommands.push({ id: 'future-discovery', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
        payload: { kind: 'start_research', researchId: 'A' + (index + 1) } });
    }),
  ];
  for (const mutate of mutations) {
    const game: GameState = JSON.parse(active).state; mutate(game);
    assert.equal(containsAISystemsFeatures(game), true);
    const result = deserializeState(encode(game)); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /historical save version/);
    assert.equal(migrateGameplayPolishState(game, CONTENT).ok, false);
    assert.ok(validateState(game, historical).length > 0);
  }
  assert.equal(containsAISystemsFeatures({ name: 'A1', source: 'A12', message: 'systems-retention-1' }), false);
});

class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; failArchive = false;
  get length() { return this.values.size; } getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failArchive && key === 'frontier-lab.content036.original') throw new Error('Archive unavailable');
    this.values.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) { this.values.delete(key); } clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function browser(store: MemoryStorage, action: () => void) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: store } });
  try { action(); } finally { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('browser upgrade archives exact original 0.36 bytes and never replaces an unarchived primary', () => {
  for (const failArchive of [false, true]) {
    const store = new MemoryStorage(), primary = 'frontier-lab.wave0.snapshot', raw = initial.replace(/\n/g, '\r\n') + '\t\n';
    store.values.set(primary, raw); store.failArchive = failArchive;
    browser(store, () => {
      const loaded = readBrowserSnapshotWithBytes(); assert.equal(loaded.kind, 'loaded'); if (loaded.kind !== 'loaded') return;
      assert.equal(loaded.migratedFrom, 36); assert.deepEqual(store.writes, []);
      const result = writeBrowserSnapshotWithBytes(loaded.state);
      assert.equal(result.ok, !failArchive);
      if (failArchive) { assert.equal(store.getItem(primary), raw); assert.deepEqual(store.writes, []); }
      else {
        assert.deepEqual(store.writes, ['frontier-lab.content036.original', primary]);
        assert.equal(readBrowserRecovery('content036')?.text, raw);
        assert.ok(browserRecoveryOptions().some(option => option.kind === 'content036'));
      }
    });
  }
});
