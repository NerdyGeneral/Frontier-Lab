import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialState, serializeState } from '../src/core/index';
import {
  browserSnapshotMatches, readBrowserSnapshotWithBytes, writeBrowserSnapshot,
  writeBrowserSnapshotWithBytes,
} from '../src/persistence/wave0-browser';
import {
  encodeResultsEnvelope, hashSavedSnapshot, parseResultsEnvelope, RESULTS_MAX_BYTES,
  STUDIO_RESULTS_KEY, StudioResultsController,
} from '../src/persistence/studio-results';
import type { ResultsEnvelope, ResultsPersistence, ResultIdentity, SavedByteBinding } from '../src/persistence/studio-results';

const A = 'training:run-a:1', B = 'evaluation:report-b:2', C = 'research:receipt-c:3';
const entry = (key: string, week: number): ResultIdentity => ({ key, week });
const digest = (text: string): SavedByteBinding => ({ algorithm: 'SHA-256', digest: createHash('sha256').update(text).digest('hex'), byteLength: Buffer.byteLength(text) });
const token = (n: number) => n.toString(16).padStart(32, '0');

function harness() {
  let sequence = 0;
  const h = { primary: 'saved-a', text: null as string | null, writes: [] as string[], removes: 0, failWrite: false, failRead: false };
  const persistence: ResultsPersistence = {
    read: () => { if (h.failRead) throw new Error('blocked'); return h.text; },
    write: text => { if (h.failWrite) throw new Error('quota'); h.text = text; h.writes.push(text); },
    remove: () => { h.text = null; h.removes++; },
    snapshotMatches: text => text === h.primary,
    hash: async text => digest(text), token: () => token(++sequence),
  };
  return { h, persistence, controller: new StudioResultsController(persistence) };
}

const envelope = (binding: SavedByteBinding, flags: ResultsEnvelope['flags'], timelineToken = token(200), playerId = 'player'): ResultsEnvelope => ({ version: 1, timelineToken, playerId, binding, flags });

test('30C-RP01 strong binding hashes exact UTF-8 snapshot bytes, including formatting', async () => {
  for (const text of ['{"name":"Lab"}', '{ "name": "Lab" }', '{"name":"研究室 🔬"}']) assert.deepEqual(await hashSavedSnapshot(text), digest(text));
  assert.notDeepEqual(await hashSavedSnapshot('{"a":1}'), await hashSavedSnapshot('{ "a": 1 }'));
});

test('30C-RP02 new timelines baseline historical evidence quietly; only later settled transitions become unread once', async () => {
  const { h, controller: c } = harness();
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  await c.saved(h.primary);
  assert.equal(c.getSnapshot().unreadCount, 0); assert.equal(c.getSnapshot().announcement, null);
  c.observe({ playerId: 'player', week: 1, entries: [entry(A, 1), entry('same-week-history', 1)] });
  assert.equal(c.getSnapshot().unreadCount, 0);
  c.observe({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(A, 1)] });
  assert.deepEqual(c.getSnapshot().announcement?.keys, [B]); assert.equal(c.getSnapshot().unreadCount, 1);
  const announcement = c.getSnapshot().announcement;
  c.observe({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(B, 2), entry(A, 1)] });
  assert.equal(c.getSnapshot().announcement, announcement); assert.equal(c.getSnapshot().unreadCount, 1);
  assert.equal(Object.keys(c.getSnapshot().flags).length, 2);
});

test('30C-RP03 matching reload restores unread and dismissed flags without replay; cache cannot invent outcomes', async () => {
  const { h, persistence } = harness();
  h.text = encodeResultsEnvelope(envelope(digest(h.primary), {
    [A]: { reviewed: false, dismissed: false }, [B]: { reviewed: true, dismissed: true }, ghost: { reviewed: false, dismissed: false },
  }));
  const c = new StudioResultsController(persistence);
  c.open({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  await c.saved(h.primary);
  assert.equal(c.getSnapshot().unreadCount, 1); assert.equal(c.getSnapshot().flags[B].dismissed, true);
  assert.equal(c.getSnapshot().announcement, null); assert.ok(!Object.hasOwn(c.getSnapshot().flags, 'ghost'));
  assert.equal(parseResultsEnvelope(h.text)?.timelineToken, token(200));
  assert.ok(!Object.hasOwn(parseResultsEnvelope(h.text)!.flags, 'ghost'));
});

test('30C-RP04 stale binding, foreign player, corrupt and oversized envelopes all initialize quietly', async () => {
  for (const bad of [
    encodeResultsEnvelope(envelope(digest('different saved bytes'), { [A]: { reviewed: false, dismissed: false } })),
    encodeResultsEnvelope(envelope(digest('saved-a'), { [A]: { reviewed: false, dismissed: false } }, token(200), 'another-player')),
    '{invalid', ' '.repeat(RESULTS_MAX_BYTES + 1),
  ]) {
    const { h, controller: c } = harness(); h.text = bad;
    c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
    await c.saved(h.primary);
    assert.equal(c.getSnapshot().flags[A].reviewed, true); assert.equal(c.getSnapshot().announcement, null);
    assert.notEqual(parseResultsEnvelope(h.text)?.timelineToken, token(200));
  }
});

test('30C-RP05 an accepted identical-byte replacement creates a fresh timeline and reviewed historical baseline', async () => {
  const { h, controller: c } = harness();
  h.text = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: false, dismissed: false } }));
  const input = { playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner' as const, savedBytes: h.primary };
  c.open(input); await c.saved(h.primary); const oldToken = parseResultsEnvelope(h.text)!.timelineToken;
  c.replace(input);
  assert.equal(h.removes, 1); assert.equal(h.text, null, 'Old matching metadata is invalidated synchronously after primary acceptance.');
  assert.equal(c.getSnapshot().unreadCount, 0); assert.equal(c.getSnapshot().announcement, null);
  await c.saved(h.primary);
  assert.notEqual(parseResultsEnvelope(h.text)?.timelineToken, oldToken);
  assert.equal(parseResultsEnvelope(h.text)?.flags[A].reviewed, true);
});

test('30C-RP06 observer and memory acknowledgement changes remain local and cannot rewrite the owner envelope', async () => {
  for (const mode of ['observer', 'memory'] as const) {
    const { h, controller: c } = harness();
    const original = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: false, dismissed: false } })); h.text = original;
    c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode, savedBytes: h.primary });
    c.observe({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(A, 1)] });
    assert.equal(c.getSnapshot().unreadCount, mode === 'memory' ? 1 : 0);
    c.dismiss(A); c.markReviewed([B]); c.restore(A); await c.saved(h.primary);
    c.replace({ playerId: 'player', week: 0, entries: [], mode, savedBytes: h.primary });
    assert.equal(h.text, original); assert.equal(h.writes.length, 0); assert.equal(h.removes, 0);
  }
});

test('30C-RP07 failed sidecar writes do not throw or advance the primary, and later save retries retain local marks', async () => {
  const { h, controller: c } = harness();
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  await c.saved(h.primary); const previous = h.text;
  h.failWrite = true; c.dismiss(A);
  assert.equal(h.text, previous); assert.equal(h.primary, 'saved-a'); assert.equal(c.getSnapshot().flags[A].dismissed, true);
  assert.ok(c.getSnapshot().notice);
  h.failWrite = false; await c.saved(h.primary);
  assert.equal(parseResultsEnvelope(h.text)?.flags[A].dismissed, true); assert.equal(c.getSnapshot().notice, '');
});

test('30C-RP08 only a successful saved-byte receipt advances binding; marks cannot bind to a foreign primary', async () => {
  const { h, controller: c } = harness();
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  await c.saved(h.primary); const previous = h.text;
  c.observe({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(A, 1)] });
  h.primary = 'foreign-primary'; c.dismiss(A); await c.saved('proposed-but-not-persisted');
  assert.equal(h.text, previous); assert.equal(parseResultsEnvelope(h.text)?.binding.digest, digest('saved-a').digest);
  h.primary = 'saved-b'; await c.saved('saved-b');
  assert.equal(parseResultsEnvelope(h.text)?.binding.digest, digest('saved-b').digest);
  assert.equal(parseResultsEnvelope(h.text)?.flags[B].reviewed, false);
});

test('30C-RP09 latest successful save wins out-of-order hashes; suspended sessions cannot finish old writes', async () => {
  const { h, persistence } = harness();
  const pending: { bytes: string; resolve: (value: SavedByteBinding) => void }[] = [];
  persistence.hash = bytes => new Promise(resolve => pending.push({ bytes, resolve }));
  const c = new StudioResultsController(persistence);
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner' });
  h.primary = 'saved-b'; const first = c.saved('saved-b');
  await Promise.resolve();
  h.primary = 'saved-c'; const second = c.saved('saved-c');
  await Promise.resolve();
  assert.equal(pending.length, 2);
  pending[1].resolve(digest('saved-c')); await second;
  const installed = h.text;
  pending[0].resolve(digest('saved-b')); await first;
  assert.equal(h.text, installed); assert.equal(parseResultsEnvelope(h.text)?.binding.digest, digest('saved-c').digest);
  h.primary = 'saved-d'; const third = c.saved('saved-d'); await Promise.resolve();
  c.suspend(); pending[2].resolve(digest('saved-d')); await third;
  assert.equal(h.text, installed);
});

test('30C-RP10 old initialization callbacks cannot cross a replacement even with repeated player and result IDs', async () => {
  const { h, persistence } = harness();
  const pending: ((value: SavedByteBinding) => void)[] = [];
  persistence.hash = () => new Promise(resolve => pending.push(resolve));
  h.text = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: true, dismissed: true } }));
  const c = new StudioResultsController(persistence);
  const input = { playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner' as const, savedBytes: h.primary };
  c.open(input); c.replace(input);
  pending[0](digest(h.primary)); await Promise.resolve();
  assert.equal(h.text, null); assert.equal(c.getSnapshot().flags[A].dismissed, false);
  pending[1](digest(h.primary)); await Promise.resolve();
  assert.notEqual(parseResultsEnvelope(h.text)?.timelineToken, token(200));
  assert.equal(c.getSnapshot().flags[A].reviewed, true);
});

test('30C-RP11 the 200-record window is selected before dismissal and stale keys are pruned', async () => {
  const { h, controller: c } = harness();
  const entries = Array.from({ length: 205 }, (_, index) => entry('outcome-' + index, 500 - index));
  c.open({ playerId: 'player', week: 500, entries, mode: 'owner', savedBytes: h.primary });
  await c.saved(h.primary); c.dismiss(entries[0].key);
  assert.equal(Object.keys(c.getSnapshot().flags).length, 200); assert.ok(!Object.hasOwn(c.getSnapshot().flags, entries[200].key));
  assert.ok(Buffer.byteLength(h.text!) <= RESULTS_MAX_BYTES);
  c.observe({ playerId: 'player', week: 500, entries: entries.slice(1) });
  h.primary = 'saved-next'; await c.saved(h.primary);
  assert.ok(!Object.hasOwn(c.getSnapshot().flags, entries[0].key));
  assert.ok(!Object.hasOwn(parseResultsEnvelope(h.text)!.flags, entries[0].key));
});

test('30C-RP12 flags edited while restore hashes are pending override restored flags without a celebration', async () => {
  const { h, persistence } = harness();
  let resolve!: (value: SavedByteBinding) => void;
  persistence.hash = () => new Promise(done => { resolve = done; });
  h.text = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: false, dismissed: false } }));
  const c = new StudioResultsController(persistence);
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  c.dismiss(A); resolve(digest(h.primary)); await Promise.resolve();
  assert.equal(c.getSnapshot().flags[A].dismissed, true); assert.equal(c.getSnapshot().announcement, null);
});

test('30C-RP13 strict envelopes reject cached outcomes, excessive keys, invalid combinations and oversized encoded metadata', () => {
  const valid = envelope(digest('valid'), { [A]: { reviewed: false, dismissed: false } });
  assert.ok(parseResultsEnvelope(JSON.stringify(valid)));
  assert.equal(parseResultsEnvelope(JSON.stringify({ ...valid, outcomes: ['invented'] })), null);
  assert.equal(encodeResultsEnvelope({ ...valid, flags: { [A]: { reviewed: false, dismissed: true } } }), null);
  assert.equal(encodeResultsEnvelope({ ...valid, flags: Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['key-' + i, { reviewed: true, dismissed: false }])) }), null);
  assert.equal(encodeResultsEnvelope({ ...valid, flags: Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['🔬'.repeat(200) + i, { reviewed: true, dismissed: false }])) }), null);
});

class MemoryStorage implements Storage {
  values = new Map<string, string>(); failKey: string | null = null;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error('quota'); this.values.set(key, value); }
}

test('30C-RP14 primary read/write receipts expose exact successful bytes while preserving legacy writer results and failures', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try {
    const game = createInitialState(), raw = serializeState(game);
    assert.deepEqual(writeBrowserSnapshot(game), { ok: true });
    const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded');
    if (read.kind !== 'loaded') throw new Error('Expected loaded snapshot');
    assert.equal(read.savedBytes, raw); assert.equal(browserSnapshotMatches(raw), true);
    assert.deepEqual(writeBrowserSnapshotWithBytes(game), { ok: true, savedBytes: raw });
    storage.failKey = 'frontier-lab.wave0.snapshot';
    const next = structuredClone(game); next.slices.company.companies[next.playerCompanyId].name = 'Unsaved proposal';
    const failed = writeBrowserSnapshotWithBytes(next);
    assert.equal(failed.ok, false); assert.ok(!Object.hasOwn(failed, 'savedBytes'));
    assert.equal(storage.getItem('frontier-lab.wave0.snapshot'), raw); assert.equal(storage.getItem(STUDIO_RESULTS_KEY), null);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('30C-RP15 accepted replacement invalidates old marks even when token generation fails; an empty primary cannot reuse a past timeline', async () => {
  for (const replacing of [true, false]) {
    const { h, persistence } = harness();
    h.text = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: false, dismissed: false } }));
    if (replacing) persistence.token = () => { throw new Error('Crypto unavailable'); };
    const c = new StudioResultsController(persistence);
    const input = { playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner' as const,
      ...(replacing ? { savedBytes: h.primary } : {}) };
    if (replacing) c.replace(input); else c.open(input);
    assert.equal(h.text, null); assert.equal(h.removes, 1); assert.equal(c.getSnapshot().unreadCount, 0);
    if (replacing) { await c.saved(h.primary); assert.equal(h.text, null); assert.ok(c.getSnapshot().notice); }
  }
});

test('30C-RP16 a slow matching reload can restore old unread marks while preserving later settled evidence and binding to the newest primary', async () => {
  const { h, persistence } = harness();
  const pending: { bytes: string; resolve: (value: SavedByteBinding) => void }[] = [];
  persistence.hash = bytes => new Promise(resolve => pending.push({ bytes, resolve }));
  h.text = encodeResultsEnvelope(envelope(digest(h.primary), { [A]: { reviewed: false, dismissed: false } }));
  const c = new StudioResultsController(persistence);
  c.open({ playerId: 'player', week: 1, entries: [entry(A, 1)], mode: 'owner', savedBytes: h.primary });
  c.observe({ playerId: 'player', week: 2, entries: [entry(B, 2), entry(A, 1)] });
  h.primary = 'saved-b'; const saving = c.saved(h.primary);
  pending[0].resolve(digest('saved-a')); await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(c.getSnapshot().unreadCount, 2); assert.deepEqual(c.getSnapshot().announcement?.keys, [B]);
  assert.equal(pending[1].bytes, 'saved-b'); pending[1].resolve(digest('saved-b')); await saving;
  assert.equal(parseResultsEnvelope(h.text)?.binding.digest, digest('saved-b').digest);
  assert.equal(parseResultsEnvelope(h.text)?.timelineToken, token(200));
});
