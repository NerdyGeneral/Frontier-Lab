import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalStateHash, createInitialState, deserializeState, serializeState, validateState, MAX_SNAPSHOT_BYTES, SnapshotTooLargeError } from '../src/core/index';
import {
  browserRecoveryOptions, readBrowserRecovery,
  readBrowserSnapshot, writeBrowserSnapshot,
} from '../src/persistence/wave0-browser';

const PRIMARY = 'frontier-lab.wave0.snapshot';
const ORIGINAL = 'frontier-lab.wave0.original';
const ORIGINAL_WAVE1 = 'frontier-lab.wave1.original';
const ORIGINAL_WAVE2 = 'frontier-lab.wave2.original';
const ORIGINAL_WAVE3 = 'frontier-lab.wave3.original';
const ORIGINAL_WAVE4 = 'frontier-lab.wave4.original';
const ORIGINAL_WAVE5 = 'frontier-lab.wave5.original';
const ORIGINAL_WAVE6 = 'frontier-lab.wave6.original';
const ORIGINAL_WAVE7 = 'frontier-lab.wave7.original';
const ORIGINAL_WAVE8 = 'frontier-lab.wave8.original';
const ORIGINAL_WAVE9 = 'frontier-lab.wave9.original';
const ORIGINAL_WAVE10 = 'frontier-lab.wave10.original';
const ORIGINAL_WAVE11 = 'frontier-lab.wave11.original';
const ORIGINAL_WAVE12 = 'frontier-lab.wave12.original';
const ORIGINAL_WAVE13 = 'frontier-lab.wave13.original';
const ORIGINAL_WAVE14 = 'frontier-lab.wave14.original';
const PREVIOUS = 'frontier-lab.previous.snapshot';
const legacyRaw = readFileSync(join(__dirname, 'fixtures/wave0-snapshot.json'), 'utf8');
const wave1Raw = readFileSync(join(__dirname, 'fixtures/wave1-snapshot.json'), 'utf8');
const wave2Raw = readFileSync(join(__dirname, 'fixtures/wave2-snapshot.json'), 'utf8');
const wave3Raw = readFileSync(join(__dirname, 'fixtures/wave3-snapshot.json'), 'utf8');
const wave4Raw = readFileSync(join(__dirname, 'fixtures/wave4-snapshot.json'), 'utf8');
const wave5Raw = readFileSync(join(__dirname, 'fixtures/wave5-snapshot.json'), 'utf8');

const wave6Raw = readFileSync(join(__dirname, 'fixtures/wave6-snapshot.json'), 'utf8');
const wave7Raw = readFileSync(join(__dirname, 'fixtures/wave7-snapshot.json'), 'utf8');
const wave8Raw = readFileSync(join(__dirname, 'fixtures/wave8-snapshot.json'), 'utf8');
const wave9Raw = readFileSync(join(__dirname, 'fixtures/wave9-snapshot.json'), 'utf8');
const wave10Raw = readFileSync(join(__dirname, 'fixtures/wave10-snapshot.json'), 'utf8');
const wave11Raw = readFileSync(join(__dirname, 'fixtures/wave11-snapshot.json'), 'utf8');
const wave12Raw = readFileSync(join(__dirname, 'fixtures/wave12-snapshot.json'), 'utf8');
const wave13Raw = readFileSync(join(__dirname, 'fixtures/wave13-snapshot.json'), 'utf8');
const wave14Raw = readFileSync(join(__dirname, 'fixtures/wave14-snapshot.json'), 'utf8');

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  writes: string[] = [];
  failRead = false;
  failWriteKey: string | null = null;
  get length() { return this.values.size; }
  getItem(key: string) {
    if (this.failRead) throw new Error('Storage access denied');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWriteKey === key) throw new Error('Quota exceeded');
    this.writes.push(key);
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  seed(key: string, value: string) { this.values.set(key, value); }
}

function inBrowser(storage: MemoryStorage, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { run(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

test('browser adapter writes and reads a current save without creating recovery copies', () => {
  const storage = new MemoryStorage();
  inBrowser(storage, () => {
    assert.deepEqual(readBrowserSnapshot(), { kind: 'empty' });
    const state = createInitialState();
    assert.deepEqual(writeBrowserSnapshot(state), { ok: true });
    const restored = readBrowserSnapshot();
    assert.equal(restored.kind, 'loaded');
    if (restored.kind !== 'loaded') throw new Error('Expected a restored run');
    assert.deepEqual(restored.state, state);
    assert.equal(restored.migratedFrom, undefined);
    assert.deepEqual(storage.writes, [PRIMARY]);
    assert.deepEqual(browserRecoveryOptions(), []);
    assert.equal(readBrowserRecovery('stored')?.text, serializeState(state));
  });
});

test('first legacy write archives the untouched v1 bytes before updating the primary snapshot', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, legacyRaw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    assert.equal(restored.kind, 'loaded');
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated run');
    assert.equal(restored.migratedFrom, 1);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), legacyRaw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL), legacyRaw);
    assert.equal(readBrowserRecovery('wave0')?.text, legacyRaw);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave0']);
    const current = deserializeState(storage.getItem(PRIMARY)!);
    assert.equal(current.ok, true);
    assert.equal(current.migratedFrom, undefined);
    assert.equal(current.state.week, restored.state.week);
  });
});

test('an existing original v1 copy is retained across later upgraded writes', () => {
  const storage = new MemoryStorage();
  const firstOriginal = legacyRaw + '\n';
  storage.seed(ORIGINAL, firstOriginal);
  storage.seed(PRIMARY, legacyRaw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), firstOriginal);
    assert.deepEqual(storage.writes, [PRIMARY]);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), firstOriginal);
  });
});

test('first Wave 1 upgrade archives its exact bytes separately from the Wave 0 original', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave1Raw);
  storage.seed(ORIGINAL, legacyRaw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 1 run');
    assert.equal(restored.migratedFrom, 2);
    assert.equal(storage.getItem(PRIMARY), wave1Raw);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE1, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE1), wave1Raw);
    assert.equal(storage.getItem(ORIGINAL), legacyRaw);
    assert.equal(readBrowserRecovery('wave1')?.text, wave1Raw);
    assert.equal(readBrowserRecovery('wave0')?.text, legacyRaw);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave0', 'wave1']);
    const current = deserializeState(storage.getItem(PRIMARY)!);
    assert.equal(current.ok, true);
    assert.equal(current.migratedFrom, undefined);
    assert.deepEqual(current.state, restored.state);
  });
});

test('the first Wave 1 recovery remains unchanged across subsequent migrated writes', () => {
  const storage = new MemoryStorage();
  const firstOriginal = wave1Raw + '\n';
  storage.seed(ORIGINAL_WAVE1, firstOriginal);
  storage.seed(PRIMARY, wave1Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 1 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(storage.getItem(ORIGINAL_WAVE1), firstOriginal);
    assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('a failed Wave 1 archive prevents the primary from being replaced', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave1Raw);
  storage.failWriteKey = ORIGINAL_WAVE1;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 1 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave1Raw);
    assert.equal(storage.getItem(ORIGINAL_WAVE1), null);
    assert.deepEqual(storage.writes, []);
  });
});

test('a failed current primary write leaves the Wave 1 save and successful archive recoverable', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave1Raw);
  storage.failWriteKey = PRIMARY;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 1 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave1Raw);
    assert.equal(storage.getItem(ORIGINAL_WAVE1), wave1Raw);
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE1]);
    assert.equal(readBrowserRecovery('wave1')?.text, wave1Raw);
  });
});

test('first Wave 2 upgrade archives exact v3 bytes independently of earlier originals', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave2Raw);
  storage.seed(ORIGINAL, legacyRaw);
  storage.seed(ORIGINAL_WAVE1, wave1Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 2 run');
    assert.equal(restored.migratedFrom, 3);
    assert.equal(restored.state.week, 11);
    assert.equal(restored.state.queuedCommands.filter(command => command.companyId === restored.state.playerCompanyId).length, 2);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave2Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE2, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE2), wave2Raw);
    assert.equal(storage.getItem(ORIGINAL), legacyRaw);
    assert.equal(storage.getItem(ORIGINAL_WAVE1), wave1Raw);
    assert.deepEqual(readBrowserRecovery('wave2'), { text: wave2Raw, filename: 'frontier-lab-wave2-original.json' });
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave0', 'wave1', 'wave2']);
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected a current run');
    assert.equal(current.migratedFrom, undefined);
    assert.deepEqual(current.state, restored.state);
  });
});

test('the first Wave 2 recovery remains untouched across later migrated writes', () => {
  const storage = new MemoryStorage();
  const firstOriginal = wave2Raw + '\n';
  storage.seed(ORIGINAL_WAVE2, firstOriginal);
  storage.seed(PRIMARY, wave2Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 2 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave2')?.text, firstOriginal);
    assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('a failed Wave 2 archive prevents any primary replacement', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave2Raw);
  storage.failWriteKey = ORIGINAL_WAVE2;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 2 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave2Raw);
    assert.equal(storage.getItem(ORIGINAL_WAVE2), null);
    assert.deepEqual(storage.writes, []);
    assert.equal(readBrowserRecovery('stored')?.text, wave2Raw);
  });
});

test('a failed Wave 3 primary write retains the Wave 2 save and successful exact archive', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave2Raw);
  storage.failWriteKey = PRIMARY;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 2 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave2Raw);
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE2]);
    assert.equal(readBrowserRecovery('wave2')?.text, wave2Raw);
    assert.equal(readBrowserRecovery('stored')?.text, wave2Raw);
  });
});

test('first Wave 3 upgrade archives exact v4 bytes before the Wave 4 primary write', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave3Raw);
  storage.seed(ORIGINAL, legacyRaw);
  storage.seed(ORIGINAL_WAVE1, wave1Raw);
  storage.seed(ORIGINAL_WAVE2, wave2Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 3 run');
    assert.equal(restored.migratedFrom, 4);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave3Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE3, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL), legacyRaw);
    assert.equal(storage.getItem(ORIGINAL_WAVE1), wave1Raw);
    assert.equal(storage.getItem(ORIGINAL_WAVE2), wave2Raw);
    assert.deepEqual(readBrowserRecovery('wave3'), { text: wave3Raw, filename: 'frontier-lab-wave3-original.json' });
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave0', 'wave1', 'wave2', 'wave3']);
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected a current Wave 4 run');
    assert.equal(current.migratedFrom, undefined);
    assert.deepEqual(current.state, restored.state);
  });
});

test('the first Wave 3 recovery remains untouched across subsequent upgraded saves', () => {
  const storage = new MemoryStorage();
  const firstOriginal = wave3Raw + '\n';
  storage.seed(PRIMARY, wave3Raw);
  storage.seed(ORIGINAL_WAVE3, firstOriginal);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 3 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave3')?.text, firstOriginal);
    assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('a failed Wave 3 recovery archive leaves the v4 primary untouched', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave3Raw);
  storage.failWriteKey = ORIGINAL_WAVE3;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 3 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave3Raw);
    assert.equal(storage.getItem(ORIGINAL_WAVE3), null);
    assert.deepEqual(storage.writes, []);
    assert.equal(readBrowserRecovery('stored')?.text, wave3Raw);
  });
});

test('a failed Wave 4 primary write retains the exact Wave 3 save and successful archive', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave3Raw);
  storage.failWriteKey = PRIMARY;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 3 run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), wave3Raw);
    assert.equal(readBrowserRecovery('wave3')?.text, wave3Raw);
    assert.equal(readBrowserRecovery('stored')?.text, wave3Raw);
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE3]);
  });
});

test('Wave 4 content upgrade archives exact schema5 bytes before replacing the primary', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave4Raw); storage.seed(ORIGINAL_WAVE3, wave3Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 4 run');
    assert.equal(restored.migratedFrom, 5); assert.equal(restored.state.schemaVersion, 5);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE4, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE3), wave3Raw);
    assert.deepEqual(readBrowserRecovery('wave4'), { text: wave4Raw, filename: 'frontier-lab-wave4-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave3', 'wave4']);
  });
});

test('Wave 4 recovery is never overwritten, including a later content upgrade', () => {
  const storage = new MemoryStorage(), original = wave4Raw + '\n';
  storage.seed(PRIMARY, wave4Raw); storage.seed(ORIGINAL_WAVE4, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 4 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave4')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 4 backup blocks replacement and a failed primary write retains the original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE4, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave4Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 4 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave4Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE4), failureKey === PRIMARY ? wave4Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE4] : []);
    });
  }
});

test('Wave 5 upgrade archives exact bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave5Raw); storage.seed(ORIGINAL_WAVE4, wave4Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 5 run');
    assert.equal(restored.migratedFrom, 6); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE5, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE4), wave4Raw);
    assert.deepEqual(readBrowserRecovery('wave5'), { text: wave5Raw, filename: 'frontier-lab-wave5-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave4', 'wave5']);
  });
});

test('Wave 5 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave5Raw + '\n';
  storage.seed(PRIMARY, wave5Raw); storage.seed(ORIGINAL_WAVE5, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 5 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave5')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 5 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE5, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave5Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 5 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave5Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE5), failureKey === PRIMARY ? wave5Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE5] : []);
    });
  }
});

test('Wave 6 upgrade archives exact bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave6Raw); storage.seed(ORIGINAL_WAVE5, wave5Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 6 run');
    assert.equal(restored.migratedFrom, 7); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE6, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE5), wave5Raw);
    assert.deepEqual(readBrowserRecovery('wave6'), { text: wave6Raw, filename: 'frontier-lab-wave6-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave5', 'wave6']);
  });
});

test('Wave 6 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave6Raw + '\n';
  storage.seed(PRIMARY, wave6Raw); storage.seed(ORIGINAL_WAVE6, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 6 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave6')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 6 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE6, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave6Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 6 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave6Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE6), failureKey === PRIMARY ? wave6Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE6] : []);
    });
  }
});

test('Wave 7 upgrade archives exact bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave7Raw); storage.seed(ORIGINAL_WAVE6, wave6Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 7 run');
    assert.equal(restored.migratedFrom, 8); assert.deepEqual(storage.writes, []);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE7, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE6), wave6Raw);
    assert.deepEqual(readBrowserRecovery('wave7'), { text: wave7Raw, filename: 'frontier-lab-wave7-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave6', 'wave7']);
  });
});

test('Wave 7 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave7Raw + '\n';
  storage.seed(PRIMARY, wave7Raw); storage.seed(ORIGINAL_WAVE7, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 7 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave7')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 7 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE7, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave7Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 7 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave7Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE7), failureKey === PRIMARY ? wave7Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE7] : []);
    });
  }
});

test('Wave 8 upgrade archives exact bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave8Raw); storage.seed(ORIGINAL_WAVE7, wave7Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 8 run');
    assert.equal(restored.migratedFrom, 9); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave8Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE8, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE7), wave7Raw);
    assert.deepEqual(readBrowserRecovery('wave8'), { text: wave8Raw, filename: 'frontier-lab-wave8-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave7', 'wave8']);
  });
});

test('Wave 8 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave8Raw + '\n';
  storage.seed(PRIMARY, wave8Raw); storage.seed(ORIGINAL_WAVE8, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 8 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave8')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 8 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE8, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave8Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 8 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave8Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE8), failureKey === PRIMARY ? wave8Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE8] : []);
    });
  }
});

test('Wave 9 upgrade archives exact bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave9Raw); storage.seed(ORIGINAL_WAVE8, wave8Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 9 run');
    assert.equal(restored.migratedFrom, 10); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave9Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE9, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE8), wave8Raw);
    assert.deepEqual(readBrowserRecovery('wave9'), { text: wave9Raw, filename: 'frontier-lab-wave9-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave8', 'wave9']);
  });
});

test('Wave 9 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave9Raw + '\n';
  storage.seed(PRIMARY, wave9Raw); storage.seed(ORIGINAL_WAVE9, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 9 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave9')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 9 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE9, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave9Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 9 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave9Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE9), failureKey === PRIMARY ? wave9Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE9] : []);
    });
  }
});

test('Wave 10 upgrade archives exact mid-review bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave10Raw); storage.seed(ORIGINAL_WAVE9, wave9Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 10 run');
    assert.equal(restored.migratedFrom, 11); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave10Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE10, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE9), wave9Raw);
    assert.deepEqual(readBrowserRecovery('wave10'), { text: wave10Raw, filename: 'frontier-lab-wave10-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave9', 'wave10']);
  });
});

test('Wave 10 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave10Raw + '\n';
  storage.seed(PRIMARY, wave10Raw); storage.seed(ORIGINAL_WAVE10, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 10 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave10')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 10 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE10, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave10Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 10 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave10Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE10), failureKey === PRIMARY ? wave10Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE10] : []);
    });
  }
});

test('Wave 11 upgrade archives exact mid-policy-training bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave11Raw); storage.seed(ORIGINAL_WAVE10, wave10Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 11 run');
    assert.equal(restored.migratedFrom, 12); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave11Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE11, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE10), wave10Raw);
    assert.deepEqual(readBrowserRecovery('wave11'), { text: wave11Raw, filename: 'frontier-lab-wave11-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave10', 'wave11']);
  });
});

test('Wave 11 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave11Raw + '\n';
  storage.seed(PRIMARY, wave11Raw); storage.seed(ORIGINAL_WAVE11, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 11 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave11')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 11 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE11, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave11Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 11 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave11Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE11), failureKey === PRIMARY ? wave11Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE11] : []);
    });
  }
});

test('Wave 12 upgrade archives exact mid-guardrail-rollout bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave12Raw); storage.seed(ORIGINAL_WAVE11, wave11Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 12 run');
    assert.equal(restored.migratedFrom, 13); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave12Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE12, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE11), wave11Raw);
    assert.deepEqual(readBrowserRecovery('wave12'), { text: wave12Raw, filename: 'frontier-lab-wave12-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave11', 'wave12']);
  });
});

test('Wave 12 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave12Raw + '\n';
  storage.seed(PRIMARY, wave12Raw); storage.seed(ORIGINAL_WAVE12, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 12 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave12')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 12 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE12, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave12Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 12 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave12Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE12), failureKey === PRIMARY ? wave12Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE12] : []);
    });
  }
});

test('Wave 13 upgrade archives exact active-assurance-term bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave13Raw); storage.seed(ORIGINAL_WAVE12, wave12Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 13 run');
    assert.equal(restored.migratedFrom, 14); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave13Raw);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE13, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE12), wave12Raw);
    assert.deepEqual(readBrowserRecovery('wave13'), { text: wave13Raw, filename: 'frontier-lab-wave13-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave12', 'wave13']);
  });
});

test('Wave 13 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave13Raw + '\n';
  storage.seed(PRIMARY, wave13Raw); storage.seed(ORIGINAL_WAVE13, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 13 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave13')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 13 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE13, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave13Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 13 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave13Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE13), failureKey === PRIMARY ? wave13Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE13] : []);
    });
  }
});

test('Wave 14 upgrade archives exact active-batch bytes before replacing the primary and retains older recovery copies', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, wave14Raw); storage.seed(ORIGINAL_WAVE13, wave13Raw);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 14 run');
    assert.equal(restored.migratedFrom, 15); assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(PRIMARY), wave14Raw);
    assert.equal(restored.state.slices.products.batchJobs!['batch:wave14-natural-command-3'].completedRequests, 24_615);
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(storage.writes, [ORIGINAL_WAVE14, PRIMARY]);
    assert.equal(storage.getItem(ORIGINAL_WAVE13), wave13Raw);
    assert.deepEqual(readBrowserRecovery('wave14'), { text: wave14Raw, filename: 'frontier-lab-wave14-original.json' });
    const current = readBrowserSnapshot();
    if (current.kind !== 'loaded') throw new Error('Expected the current run');
    assert.equal(current.migratedFrom, undefined); assert.deepEqual(current.state, restored.state);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['wave13', 'wave14']);
  });
});

test('Wave 14 original bytes are never overwritten by later saves', () => {
  const storage = new MemoryStorage(), original = wave14Raw + '\n';
  storage.seed(PRIMARY, wave14Raw); storage.seed(ORIGINAL_WAVE14, original);
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 14 run');
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.deepEqual(writeBrowserSnapshot(restored.state), { ok: true });
    assert.equal(readBrowserRecovery('wave14')?.text, original); assert.deepEqual(storage.writes, [PRIMARY, PRIMARY]);
  });
});

test('failed Wave 14 backup blocks replacement; failed primary writes retain both original and archive', () => {
  for (const failureKey of [ORIGINAL_WAVE14, PRIMARY]) {
    const storage = new MemoryStorage(); storage.seed(PRIMARY, wave14Raw); storage.failWriteKey = failureKey;
    inBrowser(storage, () => {
      const restored = readBrowserSnapshot();
      if (restored.kind !== 'loaded') throw new Error('Expected a migrated Wave 14 run');
      assert.equal(writeBrowserSnapshot(restored.state).ok, false);
      assert.equal(storage.getItem(PRIMARY), wave14Raw);
      assert.equal(storage.getItem(ORIGINAL_WAVE14), failureKey === PRIMARY ? wave14Raw : null);
      assert.deepEqual(storage.writes, failureKey === PRIMARY ? [ORIGINAL_WAVE14] : []);
    });
  }
});

test('empty, corrupt and unknown-version stored bytes block automatic replacement and remain exportable', () => {
  const future = JSON.parse(serializeState(createInitialState()));
  future.schemaVersion = 99;
  for (const raw of ['', '{broken json', JSON.stringify(future)]) {
    const storage = new MemoryStorage();
    storage.seed(PRIMARY, raw);
    inBrowser(storage, () => {
      assert.equal(readBrowserSnapshot().kind, 'invalid');
      const result = writeBrowserSnapshot(createInitialState());
      assert.equal(result.ok, false);
      assert.equal(storage.getItem(PRIMARY), raw);
      assert.deepEqual(storage.writes, []);
      assert.equal(readBrowserRecovery('stored')?.text, raw);
      assert.deepEqual(browserRecoveryOptions(true).map(option => option.kind), ['stored']);
    });
  }
});

test('confirmed replacement keeps the previous raw save before installing the new run', () => {
  const storage = new MemoryStorage();
  const raw = '{an invalid save that the player chose to replace';
  storage.seed(PRIMARY, raw);
  inBrowser(storage, () => {
    const state = createInitialState();
    assert.deepEqual(writeBrowserSnapshot(state, { replace: true }), { ok: true });
    assert.deepEqual(storage.writes, [PREVIOUS, PRIMARY]);
    assert.equal(storage.getItem(PREVIOUS), raw);
    assert.equal(storage.getItem(PRIMARY), serializeState(state));
    assert.equal(readBrowserRecovery('previous')?.text, raw);
    assert.deepEqual(browserRecoveryOptions().map(option => option.kind), ['previous']);
  });
});

test('failed migration backup leaves the legacy primary untouched', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, legacyRaw);
  storage.failWriteKey = ORIGINAL;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), legacyRaw);
    assert.equal(storage.getItem(ORIGINAL), null);
    assert.deepEqual(storage.writes, []);
  });
});

test('failed primary write preserves both the legacy primary and its successful backup', () => {
  const storage = new MemoryStorage();
  storage.seed(PRIMARY, legacyRaw);
  storage.failWriteKey = PRIMARY;
  inBrowser(storage, () => {
    const restored = readBrowserSnapshot();
    if (restored.kind !== 'loaded') throw new Error('Expected a migrated run');
    assert.equal(writeBrowserSnapshot(restored.state).ok, false);
    assert.equal(storage.getItem(PRIMARY), legacyRaw);
    assert.equal(storage.getItem(ORIGINAL), legacyRaw);
    assert.deepEqual(storage.writes, [ORIGINAL]);
  });
});

test('failed replacement backup prevents the new run from overwriting the current snapshot', () => {
  const storage = new MemoryStorage();
  const old = serializeState(createInitialState());
  storage.seed(PRIMARY, old);
  storage.failWriteKey = PREVIOUS;
  inBrowser(storage, () => {
    const next = createInitialState();
    next.slices.company.companies[next.playerCompanyId].name = 'A replacement lab';
    assert.equal(writeBrowserSnapshot(next, { replace: true }).ok, false);
    assert.equal(storage.getItem(PRIMARY), old);
    assert.deepEqual(storage.writes, []);
  });
});

test('unavailable storage and invalid live states fail without promising a saved run', () => {
  const storage = new MemoryStorage();
  storage.failRead = true;
  inBrowser(storage, () => {
    assert.equal(readBrowserSnapshot().kind, 'unavailable');
    assert.equal(writeBrowserSnapshot(createInitialState()).ok, false);
    assert.equal(readBrowserRecovery('stored'), null);
    assert.deepEqual(browserRecoveryOptions(true), []);
    assert.deepEqual(storage.writes, []);
  });
  storage.failRead = false;
  inBrowser(storage, () => {
    const invalid = createInitialState();
    invalid.week = -1;
    assert.equal(writeBrowserSnapshot(invalid).ok, false);
    assert.deepEqual(storage.writes, []);
  });
});

test('UTF-8 snapshot limits match import and prevent an oversized autosave from replacing the usable run', () => {
  const storage = new MemoryStorage(), state = createInitialState(), original = serializeState(state);
  storage.seed(PRIMARY, original);
  for (let i = 0; i < 700; i++) {
    const id = `historical-rejection-${i}`;
    state.commandReceipts[id] = { id, week: 0, status: 'rejected', reason: { code: 'NOT_READY', message: '界'.repeat(1000) } };
  }
  assert.deepEqual(validateState(state), []);
  const envelope = JSON.parse(original);
  envelope.state = state; envelope.checksum = canonicalStateHash(state);
  const oversized = JSON.stringify(envelope);
  assert.ok(oversized.length < MAX_SNAPSHOT_BYTES, 'Character count alone must not admit an oversized UTF-8 file.');
  assert.ok(new TextEncoder().encode(oversized).byteLength > MAX_SNAPSHOT_BYTES);
  const imported = deserializeState(oversized);
  assert.equal(imported.ok, false);
  if (imported.ok) throw new Error('Expected the UTF-8 byte limit to reject import');
  assert.match(imported.error, /2 MB/);
  assert.throws(() => serializeState(state), SnapshotTooLargeError);
  inBrowser(storage, () => {
    const result = writeBrowserSnapshot(state);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error('Expected an oversized save to be rejected');
    assert.match(result.error, /2 MB save limit/);
    assert.equal(storage.getItem(PRIMARY), original);
    assert.deepEqual(storage.writes, []);
    assert.equal(readBrowserSnapshot().kind, 'loaded');
  });
});
