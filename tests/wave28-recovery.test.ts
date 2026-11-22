import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInitialState, deserializeState, serializeState } from '../src/core/index';
import { browserRecoveryOptions, readBrowserRecovery, writeBrowserSnapshot, RecoveryArchiveError } from '../src/persistence/wave0-browser';
import { decodeRecoveryArchive, encodeRecoveryArchive, RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL = 'frontier-lab.content027.original', PREVIOUS = 'frontier-lab.previous.snapshot';
const OLD_COPY = 'frontier-lab.content026.original';
const raw = readFileSync(join(__dirname, 'fixtures/wave27-appliance-published.json'), 'utf8') + '\r\n';
const loaded = deserializeState(raw);
if (!loaded.ok) throw new Error(loaded.error);
const upgraded = loaded.state, next = serializeState(upgraded);
const packed = encodeRecoveryArchive(raw);

class QuotaStorage implements Storage {
  values = new Map<string, string>();
  attempts: Array<{ key: string; packed: boolean }> = [];
  writes: string[] = [];
  quotaBytes = Number.MAX_SAFE_INTEGER;
  failPrimary = false;
  archiveError: Error | null = null;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  get usedBytes() { return [...this.values].reduce((sum, [key, value]) => sum + 2 * (key.length + value.length), 0); }
  setItem(key: string, value: string) {
    this.attempts.push({ key, packed: value.startsWith(RECOVERY_ARCHIVE_PREFIX) });
    if (key === ORIGINAL && this.archiveError) throw this.archiveError;
    if (key === PRIMARY && this.failPrimary) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const prior = this.values.get(key), previousBytes = prior === undefined ? 0 : 2 * (key.length + prior.length);
    if (this.usedBytes - previousBytes + 2 * (key.length + value.length) > this.quotaBytes) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.writes.push(key);
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser(storage: QuotaStorage, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
function seeded() {
  const storage = new QuotaStorage();
  storage.values.set(PRIMARY, raw);
  storage.values.set(OLD_COPY, 'Earlier exact archive\r\n漢字 🧪\n');
  return storage;
}
function constrained() {
  const storage = seeded();
  storage.quotaBytes = storage.usedBytes + 2 * (ORIGINAL.length + packed.length) + Math.max(0, 2 * (next.length - raw.length)) + 128;
  return storage;
}

test('W28-R01: packed recovery returns exact Unicode, whitespace and even unpaired code units', () => {
  const text = '\ufeff{ "name": "研究 – café 🧪", "line": "literal\\n" }\r\n\t\n' + '\ud800 lone \udfff\u0000' + ' repeated archive content '.repeat(4000);
  const encoded = encodeRecoveryArchive(text);
  assert.ok(encoded.startsWith(RECOVERY_ARCHIVE_PREFIX));
  assert.ok(encoded.length < text.length);
  assert.equal(decodeRecoveryArchive(encoded), text);
  assert.deepEqual(Buffer.from(decodeRecoveryArchive(encoded)), Buffer.from(text));
  assert.equal(decodeRecoveryArchive(text), text);
  assert.equal(encodeRecoveryArchive(text), encoded, 'Packing is deterministic.');
});

test('W28-R02: ordinary storage keeps the original raw archive and primary path unchanged', () => {
  const storage = seeded();
  inBrowser(storage, () => {
    assert.deepEqual(writeBrowserSnapshot(upgraded), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), raw);
    assert.equal(storage.getItem(PRIMARY), next);
    assert.deepEqual(storage.writes, [ORIGINAL, PRIMARY]);
    assert.equal(storage.attempts.some(attempt => attempt.packed), false);
    assert.equal(readBrowserRecovery('content027')?.text, raw);
  });
});

test('W28-R03: a real storage quota falls back only for the new archive before the raw primary write', () => {
  const storage = constrained(), old = storage.getItem(OLD_COPY);
  inBrowser(storage, () => {
    assert.deepEqual(writeBrowserSnapshot(upgraded), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), packed);
    assert.equal(storage.getItem(OLD_COPY), old);
    assert.equal(storage.getItem(PRIMARY), next);
    assert.deepEqual(storage.attempts, [{ key: ORIGINAL, packed: false }, { key: ORIGINAL, packed: true }, { key: PRIMARY, packed: false }]);
    assert.equal(readBrowserRecovery('content027')?.text, raw);
    assert.equal(readBrowserRecovery('stored')?.text, next);
    assert.ok(browserRecoveryOptions().some(option => option.kind === 'content027'));
    const archive = storage.getItem(ORIGINAL);
    assert.deepEqual(writeBrowserSnapshot(upgraded), { ok: true });
    assert.equal(storage.getItem(ORIGINAL), archive, 'An existing archive is never repacked or rewritten.');
  });
});

test('W28-R04: generic quota wording and other storage errors never trigger archive compression', () => {
  for (const error of [new Error('Quota exceeded'), new DOMException('Blocked', 'SecurityError'), Object.assign(new Error('Not a DOM quota'), { name: 'QuotaExceededError' })]) {
    const storage = seeded(); storage.archiveError = error;
    inBrowser(storage, () => {
      assert.equal(writeBrowserSnapshot(upgraded).ok, false);
      assert.equal(storage.getItem(PRIMARY), raw);
      assert.equal(storage.getItem(ORIGINAL), null);
      assert.deepEqual(storage.attempts, [{ key: ORIGINAL, packed: false }]);
      assert.deepEqual(storage.writes, []);
    });
  }
});

test('W28-R05: insufficient room for even the packed archive preserves every existing key and primary', () => {
  const storage = seeded(), before = [...storage.values];
  storage.quotaBytes = storage.usedBytes + 16;
  inBrowser(storage, () => {
    assert.equal(writeBrowserSnapshot(upgraded).ok, false);
    assert.deepEqual([...storage.values], before);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(storage.attempts, [{ key: ORIGINAL, packed: false }, { key: ORIGINAL, packed: true }]);
  });
});

test('W28-R06: a failed primary write retains both its original raw bytes and a completed packed recovery', () => {
  const storage = constrained(); storage.failPrimary = true;
  inBrowser(storage, () => {
    assert.equal(writeBrowserSnapshot(upgraded).ok, false);
    assert.equal(storage.getItem(PRIMARY), raw);
    assert.equal(storage.getItem(ORIGINAL), packed);
    assert.equal(readBrowserRecovery('content027')?.text, raw);
    assert.deepEqual(storage.writes, [ORIGINAL]);
  });
});

test('W28-R07: explicit replacement can pack its new previous-run archive without changing older copies', () => {
  const storage = new QuotaStorage();
  const previous = 'Invalid original with exact newlines\r\n研究 🧪\n' + ' preserved '.repeat(8000);
  const current = createInitialState(), serialized = serializeState(current);
  storage.values.set(PRIMARY, previous); storage.values.set(OLD_COPY, raw);
  const encoded = encodeRecoveryArchive(previous);
  storage.quotaBytes = storage.usedBytes + 2 * (PREVIOUS.length + encoded.length) + Math.max(0, 2 * (serialized.length - previous.length)) + 128;
  inBrowser(storage, () => {
    assert.deepEqual(writeBrowserSnapshot(current, { replace: true }), { ok: true });
    assert.equal(storage.getItem(PREVIOUS), encoded);
    assert.equal(readBrowserRecovery('previous')?.text, previous);
    assert.equal(storage.getItem(OLD_COPY), raw);
    assert.equal(storage.getItem(PRIMARY), serialized);
    assert.deepEqual(storage.writes, [PREVIOUS, PRIMARY]);
  });
});

test('W28-R08: malformed packed archives fail actionably without rewriting or hiding the stored primary', () => {
  const cases = [
    'FRONTIER-LAB-RECOVERY:GZIP:99\n',
    RECOVERY_ARCHIVE_PREFIX + '2:00000000:2\nnot-base64!',
    packed.replace(/\n\d+:[0-9a-f]{8}:/, '\n123:00000000:'),
    packed.slice(0, -8),
  ];
  for (const corrupt of cases) {
    const storage = seeded(); storage.values.set(ORIGINAL, corrupt);
    inBrowser(storage, () => {
      assert.throws(() => readBrowserRecovery('content027'), error => error instanceof RecoveryArchiveError && /Export another recovery copy or import/.test(error.message));
      assert.equal(storage.getItem(ORIGINAL), corrupt);
      assert.equal(readBrowserRecovery('stored')?.text, raw);
      assert.deepEqual(storage.writes, []);
    });
  }
});

