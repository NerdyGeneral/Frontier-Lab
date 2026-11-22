import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInitialState, serializeState } from '../src/core/index';
import { readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';
import { RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL = 'frontier-lab.wave0.original', PREVIOUS = 'frontier-lab.previous.snapshot';
const DIRECTORY = typeof __dirname === 'string' ? __dirname : join(process.cwd(), 'tests');
const legacyRaw = readFileSync(join(DIRECTORY, 'fixtures/wave0-snapshot.json'), 'utf8');

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  readonly attempts: { key: string; value: string }[] = [];
  failRead = false;
  failWriteKey: string | null = null;
  quotaRawKey: string | null = null;
  get length() { return this.values.size; }
  getItem(key: string) {
    if (this.failRead) throw new Error('Storage access denied');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.attempts.push({ key, value });
    if (this.failWriteKey === key) throw new Error('Write failed');
    if (this.quotaRawKey === key && !value.startsWith(RECOVERY_ARCHIVE_PREFIX)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  seed(key: string, value: string) { this.values.set(key, value); }
}

function inBrowser<T>(storage: MemoryStorage, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { return run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

/** Observe the real snapshot parsing boundary without exposing production cache
 * internals or replacing validation. deserializeState must parse exact input
 * bytes before checking their checksum, schema and domain invariants. */
function observeSnapshotParses(t: TestContext) {
  const original = JSON.parse, calls = new Map<string, number>();
  t.mock.method(JSON, 'parse', (text: string, ...rest: unknown[]) => {
    calls.set(text, (calls.get(text) ?? 0) + 1);
    return Reflect.apply(original, JSON, [text, ...rest]);
  });
  return (text: string) => calls.get(text) ?? 0;
}

test('W29-P01: a validated read primes ordinary saves, while reads still return independent fully parsed states', t => {
  const storage = new MemoryStorage(), state = createInitialState(), raw = serializeState(state);
  storage.seed(PRIMARY, raw); const parsed = observeSnapshotParses(t);
  inBrowser(storage, () => {
    const first = readBrowserSnapshot(); assert.equal(first.kind, 'loaded');
    if (first.kind !== 'loaded') throw new Error('Expected a current save.');
    assert.equal(parsed(raw), 1);
    assert.deepEqual(writeBrowserSnapshot(first.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(first.state), { ok: true });
    assert.equal(parsed(raw), 1, 'Both saves must skip deserializing the exact prior bytes already validated by read.');
    first.state.week = -1;
    const second = readBrowserSnapshot(); assert.equal(second.kind, 'loaded');
    if (second.kind !== 'loaded') throw new Error('Expected a fresh loaded state.');
    assert.notEqual(second.state, first.state); assert.deepEqual(second.state, state);
    assert.equal(parsed(raw), 2, 'The cache does not retain or return mutable game states.');
    assert.equal(storage.getItem(PRIMARY), raw);
  });
});

test('W29-P02: successful writes prime only prior bytes and never exempt even the same supplied GameState from validation', t => {
  const storage = new MemoryStorage(), state = createInitialState(), raw = serializeState(state), parsed = observeSnapshotParses(t);
  inBrowser(storage, () => {
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true });
    assert.equal(parsed(raw), 0, 'A successful current write already validated these exact prior bytes.');
    const writes = [...storage.writes]; state.week = -1;
    assert.equal(writeBrowserSnapshot(state).ok, false, 'Object identity, revision and cached prior validity cannot authorize an invalid new state.');
    assert.equal(storage.getItem(PRIMARY), raw); assert.deepEqual(storage.writes, writes);
    state.week = 0;
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true }); assert.equal(parsed(raw), 0);
  });
});

test('W29-P03: changed exact bytes invalidate the cache even with the same checksum/revision; corrupt primaries remain protected until confirmed replacement', t => {
  const storage = new MemoryStorage(), state = createInitialState(), raw = serializeState(state);
  const envelope = JSON.parse(raw), compact = JSON.stringify(envelope);
  envelope.state.slices.company.companies[state.playerCompanyId].cashCents++;
  const corrupt = JSON.stringify(envelope), parsed = observeSnapshotParses(t);
  inBrowser(storage, () => {
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true });
    storage.seed(PRIMARY, compact);
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true });
    assert.equal(parsed(compact), 1, 'Whitespace changes still require validation of the actual new string.');
    storage.seed(PRIMARY, corrupt); const writes = [...storage.writes];
    assert.equal(writeBrowserSnapshot(state).ok, false); assert.equal(parsed(corrupt), 1);
    assert.equal(writeBrowserSnapshot(state).ok, false); assert.equal(parsed(corrupt), 1, 'An exact known failure can remain cached and protected.');
    assert.equal(storage.getItem(PRIMARY), corrupt); assert.deepEqual(storage.writes, writes);
    assert.equal(readBrowserRecovery('stored')?.text, corrupt);
    assert.deepEqual(writeBrowserSnapshot(state, { replace: true }), { ok: true });
    assert.deepEqual(storage.writes.slice(-2), [PREVIOUS, PRIMARY]);
    assert.equal(readBrowserRecovery('previous')?.text, corrupt); assert.equal(storage.getItem(PRIMARY), raw);
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true }); assert.equal(parsed(raw), 0);
  });
});

test('W29-P04: storage instances are isolated, only the latest primary is retained, and observed emptiness clears cached metadata', t => {
  const first = new MemoryStorage(), second = new MemoryStorage(), stateA = createInitialState(), stateB = structuredClone(stateA);
  stateB.slices.company.companies[stateB.playerCompanyId].name = 'Another valid company';
  const rawA = serializeState(stateA), rawB = serializeState(stateB), parsed = observeSnapshotParses(t);
  inBrowser(first, () => { assert.deepEqual(writeBrowserSnapshot(stateA), { ok: true }); });
  second.seed(PRIMARY, rawA);
  inBrowser(second, () => { assert.deepEqual(writeBrowserSnapshot(stateA), { ok: true }); });
  assert.equal(parsed(rawA), 1, 'Identical bytes in an unvalidated Storage object are a miss.');
  inBrowser(first, () => {
    first.seed(PRIMARY, rawB); assert.deepEqual(writeBrowserSnapshot(stateB), { ok: true }); assert.equal(parsed(rawB), 1);
    first.seed(PRIMARY, rawA); assert.deepEqual(writeBrowserSnapshot(stateA), { ok: true });
    assert.equal(parsed(rawA), 2, 'Returning to historic bytes must not use a history cache.');
    first.removeItem(PRIMARY); assert.deepEqual(readBrowserSnapshot(), { kind: 'empty' });
    first.seed(PRIMARY, rawA); assert.deepEqual(writeBrowserSnapshot(stateA), { ok: true }); assert.equal(parsed(rawA), 3);
  });
});

test('W29-P05: failed primary writes do not prime proposed bytes and cache hits still require working access to actual storage', t => {
  const storage = new MemoryStorage(), original = createInitialState(), next = structuredClone(original);
  next.slices.company.companies[next.playerCompanyId].name = 'Proposed company';
  const raw = serializeState(original), proposed = serializeState(next), parsed = observeSnapshotParses(t);
  storage.seed(PRIMARY, raw);
  inBrowser(storage, () => {
    assert.equal(readBrowserSnapshot().kind, 'loaded'); storage.failWriteKey = PRIMARY;
    assert.equal(writeBrowserSnapshot(next).ok, false); assert.equal(storage.getItem(PRIMARY), raw); assert.deepEqual(storage.writes, []);
    assert.equal(parsed(raw), 1);
    storage.failWriteKey = null;
    // Another writer later installs the proposed bytes. Our failed write must
    // not have falsely marked that unobserved primary as a successful write.
    storage.seed(PRIMARY, proposed);
    assert.deepEqual(writeBrowserSnapshot(next), { ok: true }); assert.equal(parsed(proposed), 1);
    storage.failRead = true; const writes = [...storage.writes];
    assert.equal(writeBrowserSnapshot(next).ok, false); assert.deepEqual(storage.writes, writes);
    storage.failRead = false; assert.equal(storage.getItem(PRIMARY), proposed);
  });
});

test('W29-P06: cached migrated reads retain archive-before-primary ordering through archive failures and never prime an unsuccessful proposal', t => {
  const parsed = observeSnapshotParses(t);
  for (const installElsewhere of [false, true]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, legacyRaw);
    inBrowser(storage, () => {
      const loaded = readBrowserSnapshot(); if (loaded.kind !== 'loaded') throw new Error('Expected migrated original.');
      assert.equal(loaded.migratedFrom, 1);
      const proposed = serializeState(loaded.state), before = parsed(proposed);
      storage.failWriteKey = ORIGINAL;
      assert.equal(writeBrowserSnapshot(loaded.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), legacyRaw); assert.equal(storage.getItem(ORIGINAL), null); assert.deepEqual(storage.writes, []);
      storage.failWriteKey = null;
      if (installElsewhere) storage.seed(PRIMARY, proposed);
      assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
      if (installElsewhere) {
        assert.equal(parsed(proposed), before + 1, 'Archive failure must not prime proposed current bytes.');
        assert.deepEqual(storage.writes, [PRIMARY]);
      } else {
        assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY]); assert.equal(readBrowserRecovery('wave0')?.text, legacyRaw);
        assert.equal(parsed(proposed), before);
      }
      assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
      assert.equal(storage.getItem(PRIMARY), proposed);
    });
  }
});

test('W29-P07: cache hits preserve replacement confirmation, failed backups and quota-compressed exact recovery without evicting other saves', t => {
  const storage = new MemoryStorage(), original = createInitialState(), next = structuredClone(original);
  next.slices.company.companies[next.playerCompanyId].name = 'Confirmed replacement';
  const raw = serializeState(original), proposed = serializeState(next), parsed = observeSnapshotParses(t);
  storage.seed(PRIMARY, raw); storage.seed(ORIGINAL, 'An older protected recovery copy');
  inBrowser(storage, () => {
    assert.equal(readBrowserSnapshot().kind, 'loaded'); storage.failWriteKey = PREVIOUS;
    assert.equal(writeBrowserSnapshot(next, { replace: true }).ok, false);
    assert.equal(storage.getItem(PRIMARY), raw); assert.deepEqual(storage.writes, []);
    storage.failWriteKey = null; storage.quotaRawKey = PREVIOUS;
    assert.deepEqual(writeBrowserSnapshot(next, { replace: true }), { ok: true });
    assert.deepEqual(storage.writes, [PREVIOUS, PRIMARY]); assert.ok(storage.getItem(PREVIOUS)!.startsWith(RECOVERY_ARCHIVE_PREFIX));
    assert.equal(readBrowserRecovery('previous')?.text, raw); assert.equal(storage.getItem(PRIMARY), proposed);
    assert.equal(storage.getItem(ORIGINAL), 'An older protected recovery copy');
    assert.deepEqual(writeBrowserSnapshot(next), { ok: true });
    assert.equal(parsed(raw), 1); assert.equal(parsed(proposed), 0);
  });
});
