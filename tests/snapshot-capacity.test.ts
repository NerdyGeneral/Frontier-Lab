import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'fflate';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { advanceWeek, assertSnapshotCapacity, canonicalStateHash, createInitialState, deserializeState, MAX_DECODED_SNAPSHOT_BYTES, MAX_SNAPSHOT_BYTES, serializeState, SnapshotTooLargeError, submitCommand, validateState } from '../src/core/index';
import { encodeBase64, gunzipBounded } from '../src/core/bounded-gzip';
import { browserSnapshotMatches, readBrowserRecovery, readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';
import { decodeRecoveryArchive, encodeRecoveryArchive, RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';
import { hashSavedSnapshotSync } from '../src/persistence/saved-snapshot-hash';
import { hashSavedSnapshot } from '../src/persistence/studio-results';
import { ModelWorkspaceController, parseModelWorkspace } from '../src/persistence/model-workspace';
import type { ModelWorkspacePersistence } from '../src/persistence/model-workspace';

const PRIMARY = 'frontier-lab.wave0.snapshot', ORIGINAL = 'frontier-lab.wave0.original';
const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
function load(text: string): GameState {
  const result = deserializeState(text); assert.ok(result.ok, result.ok ? '' : result.error); return result.state;
}
const envelope = (state: GameState) => ({ format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: CONTENT.version, checksum: canonicalStateHash(state), state });
function wrap(text: string) {
  const bytes = new TextEncoder().encode(text);
  return { format: 'frontier-lab-compressed', version: 1, encoding: 'gzip-base64', decodedBytes: bytes.length, payload: encodeBase64(gzipSync(bytes, { level: 6, mtime: 0 })) };
}

class QuotaStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  quota = Number.MAX_SAFE_INTEGER;
  rejectRawPrimary = false;
  primaryError: Error | null = null;
  get length() { return this.values.size; }
  get usedBytes() { return [...this.values].reduce((total, [key, value]) => total + 2 * (key.length + value.length), 0); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === PRIMARY && this.primaryError) throw this.primaryError;
    if (key === PRIMARY && this.rejectRawPrimary && JSON.parse(value).format !== 'frontier-lab-compressed') throw new DOMException('Quota exceeded', 'QuotaExceededError');
    const previous = this.values.get(key), replaced = previous === undefined ? 0 : 2 * (key.length + previous.length);
    if (this.usedBytes - replaced + 2 * (key.length + value.length) > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser<T>(storage: Storage, run: () => T): T {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  const restore = () => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); };
  try {
    const result = run();
    if (result instanceof Promise) return result.finally(restore) as T;
    restore(); return result;
  } catch (error) { restore(); throw error; }
}

test('small saves retain exact bytes and compressed historical saves follow the same migration checks', () => {
  const state = createInitialState(), ordinary = JSON.stringify(envelope(state), null, 2);
  assert.equal(serializeState(state), ordinary);
  const packed = serializeState(state, CONTENT, { compress: true });
  assert.equal(JSON.parse(packed).format, 'frontier-lab-compressed');
  assert.deepEqual(load(packed), state);
  assert.equal(serializeState(load(packed), CONTENT, { compress: true }), packed);
  const old = fixture('wave0-snapshot.json'), original = deserializeState(old), compressed = deserializeState(JSON.stringify(wrap(old)));
  assert.deepEqual(compressed, original, 'Compression must not skip historical checksum, migration, or domain validation.');
});

test('18 ordinary evaluations can cross the old save ceiling and preserve every report on export and browser reload', () => {
  let state = load(fixture('polish-035-active-published.json'));
  const originalReports = Object.keys(state.slices.models.reports).length;
  const models = Object.values(state.slices.models.versions).filter(model => model.companyId === state.playerCompanyId
    && !Object.values(state.slices.models.reports).some(report => report.modelId === model.id && report.suiteId === 'expanded-capabilities-1')).slice(0, 18);
  assert.equal(models.length, 18);
  for (const [index, model] of models.entries()) {
    const result = submitCommand(state, { kind: 'evaluate_model', modelId: model.id, suiteId: 'expanded-capabilities-1' }, CONTENT, 'save-cap-evaluation-' + index);
    assert.ok(result.accepted, result.accepted ? '' : result.reason?.message); state = result.state;
  }
  for (let week = 0; week < 4; week++) {
    const result = advanceWeek(state); assert.ok(result.accepted, result.accepted ? '' : result.reason?.message); state = result.state;
    assert.doesNotThrow(() => assertSnapshotCapacity(state));
  }
  assert.equal(Object.keys(state.slices.models.reports).length, originalReports + 18);
  assert.deepEqual(validateState(state), []);
  assert.ok(Buffer.byteLength(JSON.stringify(envelope(state))) > MAX_SNAPSHOT_BYTES, 'The authentic campaign must reproduce the former failure.');
  const saved = serializeState(state);
  assert.equal(JSON.parse(saved).format, 'frontier-lab-compressed');
  assert.ok(Buffer.byteLength(saved) < MAX_SNAPSHOT_BYTES);
  assert.deepEqual(load(saved), state);
  assert.equal(serializeState(load(saved)), saved);
  inBrowser(new QuotaStorage(), () => {
    assert.deepEqual(writeBrowserSnapshotWithBytes(state), { ok: true, savedBytes: saved });
    const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded');
    if (read.kind !== 'loaded') throw new Error('Expected a compressed save to reopen.');
    assert.equal(read.savedBytes, saved); assert.deepEqual(read.state, state);
    assert.equal(canonicalStateHash(read.state), canonicalStateHash(state));
  });
});

test('compressed imports reject corrupt payloads, altered checksums, unsupported wrappers and dishonest expansion lengths', () => {
  const valid = JSON.parse(serializeState(createInitialState(), CONTENT, { compress: true }));
  const gzip = Buffer.from(valid.payload, 'base64'), badCrc = Buffer.from(gzip); badCrc[badCrc.length - 8] ^= 1;
  const doubled = Buffer.concat([gzip, gzip]), trailingJunk = Buffer.concat([gzip.subarray(0, -8), Buffer.from([1, 2, 3, 4]), gzip.subarray(-8)]);
  const cases = [
    { ...valid, version: 2 }, { ...valid, encoding: 'unknown' }, { ...valid, extra: true },
    { ...valid, decodedBytes: MAX_DECODED_SNAPSHOT_BYTES + 1 }, { ...valid, decodedBytes: 1.5 },
    { ...valid, decodedBytes: valid.decodedBytes - 1 }, { ...valid, payload: 'not-base64!' },
    { ...valid, payload: valid.payload.slice(0, -12) }, { ...valid, payload: badCrc.toString('base64') },
    { ...valid, payload: doubled.toString('base64') }, { ...valid, payload: trailingJunk.toString('base64') },
    wrap(JSON.stringify(valid)),
  ];
  for (const value of cases) assert.equal(deserializeState(JSON.stringify(value)).ok, false);
  for (const extra of [doubled, trailingJunk]) assert.throws(() => gunzipBounded(extra, valid.decodedBytes, MAX_DECODED_SNAPSHOT_BYTES), /Noncanonical gzip/);
  const archive = encodeRecoveryArchive('An exact older recovery copy '.repeat(100));
  const split = archive.lastIndexOf('\n'), archiveGzip = Buffer.from(archive.slice(split + 1), 'base64');
  assert.throws(() => decodeRecoveryArchive(archive.slice(0, split + 1) + Buffer.concat([archiveGzip, archiveGzip]).toString('base64')));
  const tampered = envelope(createInitialState()); tampered.state.seed += '-altered';
  const mismatch = deserializeState(JSON.stringify(wrap(JSON.stringify(tampered))));
  assert.equal(mismatch.ok, false); if (!mismatch.ok) assert.match(mismatch.error, /checksum/);
  const invalid = createInitialState(); invalid.week = -1;
  assert.equal(deserializeState(JSON.stringify(wrap(JSON.stringify(envelope(invalid))))).ok, false, 'A correct checksum cannot authorize invalid game data.');
  const expansion = gzipSync(new Uint8Array(2 * 1024 * 1024).fill(32), { mtime: 0 });
  new DataView(expansion.buffer, expansion.byteOffset + expansion.length - 4, 4).setUint32(0, 64, true);
  assert.throws(() => gunzipBounded(expansion, 64, MAX_DECODED_SNAPSHOT_BYTES), /exceeds its declared length/);
  assert.equal(deserializeState(JSON.stringify({ ...valid, decodedBytes: 64, payload: encodeBase64(expansion) })).ok, false);
});

test('capacity preflight and the writer share both finite bounds and leave the previous usable save intact', () => {
  const original = serializeState(createInitialState()), decodedTooLarge = createInitialState();
  for (let index = 0; index < 6000; index++) {
    const id = 'decoded-cap-' + index;
    decodedTooLarge.commandReceipts[id] = { id, week: 0, status: 'rejected', reason: { code: 'NOT_READY', message: '界'.repeat(2000) } };
  }
  assert.deepEqual(validateState(decodedTooLarge), []);
  assert.throws(() => assertSnapshotCapacity(decodedTooLarge), error => error instanceof SnapshotTooLargeError && /32 MiB/.test(error.message));
  assert.throws(() => serializeState(decodedTooLarge), error => error instanceof SnapshotTooLargeError && /32 MiB/.test(error.message));
  const encodedTooLarge = createInitialState(), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let random = 0x12345678;
  for (let index = 0; index < 2500; index++) {
    let message = '';
    for (let letter = 0; letter < 1000; letter++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5; message += alphabet[(random >>> 0) % alphabet.length];
    }
    const id = 'encoded-cap-' + index;
    encodedTooLarge.commandReceipts[id] = { id, week: 0, status: 'rejected', reason: { code: 'NOT_READY', message } };
  }
  assert.deepEqual(validateState(encodedTooLarge), []);
  assert.ok(Buffer.byteLength(JSON.stringify(encodedTooLarge)) < MAX_DECODED_SNAPSHOT_BYTES);
  assert.throws(() => assertSnapshotCapacity(encodedTooLarge), error => error instanceof SnapshotTooLargeError && /2 MB compressed/.test(error.message));
  assert.throws(() => serializeState(encodedTooLarge), SnapshotTooLargeError);
  const storage = new QuotaStorage(); storage.values.set(PRIMARY, original);
  inBrowser(storage, () => {
    for (const state of [decodedTooLarge, encodedTooLarge]) {
      assert.equal(writeBrowserSnapshotWithBytes(state).ok, false);
      assert.equal(storage.getItem(PRIMARY), original); assert.deepEqual(storage.writes, []);
      assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded');
    }
  });
});

test('a mature import fits the modeled 5 MiB browser quota without losing its migration or previous-run archives', () => {
  const storage = new QuotaStorage(); storage.quota = 5 * 1024 * 1024;
  const historical = fixture('wave14-snapshot.json'); storage.setItem(PRIMARY, historical);
  inBrowser(storage, () => {
    const upgraded = load(historical); assert.equal(writeBrowserSnapshotWithBytes(upgraded).ok, true);
    const previous = storage.getItem(PRIMARY)!;
    const incoming = load(fixture('polish-035-active-published.json'));
    const result = writeBrowserSnapshotWithBytes(incoming, { replace: true }); assert.ok(result.ok, result.ok ? '' : result.error);
    assert.equal(JSON.parse(result.savedBytes).format, 'frontier-lab-compressed');
    assert.deepEqual(load(result.savedBytes), incoming);
    assert.equal(readBrowserRecovery('wave14')?.text, historical);
    assert.equal(readBrowserRecovery('previous')?.text, previous);
    assert.ok(storage.usedBytes <= storage.quota);
    assert.equal(writeBrowserSnapshotWithBytes(incoming).ok, true, 'A retry must not repeat the old quota dead end.');
  });
});

test('primary quota pressure losslessly compacts existing recovery copies while leaving unrelated storage alone', () => {
  const storage = new QuotaStorage(), original = 'Exact original recovery\r\n研究 🧪\n'.repeat(20000);
  storage.values.set(PRIMARY, serializeState(createInitialState())); storage.values.set(ORIGINAL, original);
  storage.values.set('unrelated-app', 'untouched'); storage.quota = storage.usedBytes + 16;
  inBrowser(storage, () => {
    const result = writeBrowserSnapshotWithBytes(load(fixture('polish-035-active-published.json')));
    assert.ok(result.ok, result.ok ? '' : result.error);
    assert.ok(storage.getItem(ORIGINAL)!.startsWith(RECOVERY_ARCHIVE_PREFIX));
    assert.equal(readBrowserRecovery('wave0')?.text, original);
    assert.equal(storage.getItem('unrelated-app'), 'untouched');
    assert.equal(storage.getItem(PRIMARY), result.savedBytes);
    assert.ok(storage.usedBytes <= storage.quota);
  });
});

test('archive quota pressure can compact older copies before preserving a new original and never evicts evidence', () => {
  const storage = new QuotaStorage(), historical = fixture('wave14-snapshot.json'), older = 'Older exact copy\r\n'.repeat(40000);
  storage.values.set(PRIMARY, historical); storage.values.set(ORIGINAL, older); storage.quota = storage.usedBytes + 16;
  inBrowser(storage, () => {
    const result = writeBrowserSnapshotWithBytes(load(historical)); assert.ok(result.ok, result.ok ? '' : result.error);
    assert.equal(readBrowserRecovery('wave0')?.text, older);
    assert.equal(readBrowserRecovery('wave14')?.text, historical);
    assert.ok(storage.getItem(ORIGINAL)!.startsWith(RECOVERY_ARCHIVE_PREFIX));
    assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded');
  });
});

test('unrecoverable quota or non-quota failures retain a usable primary and every recovery text', () => {
  const incoming = load(fixture('polish-035-active-published.json'));
  for (const failure of [null, new Error('Quota exceeded'), new DOMException('Blocked', 'SecurityError')]) {
    const storage = new QuotaStorage(), original = serializeState(createInitialState()), recovery = 'An older short copy';
    storage.values.set(PRIMARY, original); storage.values.set(ORIGINAL, recovery);
    storage.quota = storage.usedBytes; storage.primaryError = failure;
    inBrowser(storage, () => {
      assert.equal(writeBrowserSnapshotWithBytes(incoming).ok, false);
      assert.equal(storage.getItem(PRIMARY), original); assert.equal(readBrowserRecovery('wave0')?.text, recovery);
      assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded'); assert.deepEqual(storage.writes, []);
    });
  }
  const unicode = '\ud800 preserved code unit \udfff\r\n研究 🧪'.repeat(100);
  assert.equal(decodeRecoveryArchive(encodeRecoveryArchive(unicode)), unicode);
});

test('sidecar hashes follow the actual compressed write receipt and restore the existing model blueprint', async () => {
  const storage = new QuotaStorage(), state = createInitialState(), original = serializeState(state), metadataKey = 'test-model-workspace';
  storage.values.set(PRIMARY, original);
  await inBrowser(storage, async () => {
    const io: ModelWorkspacePersistence = {
      read: () => storage.getItem(metadataKey), write: text => storage.setItem(metadataKey, text), remove: () => storage.removeItem(metadataKey),
      snapshotMatches: browserSnapshotMatches, hash: hashSavedSnapshot, hashSync: hashSavedSnapshotSync, token: () => '0123456789abcdef0123456789abcdef',
    };
    const workspace = new ModelWorkspaceController(io); workspace.open({ playerId: state.playerCompanyId, mode: 'owner', savedBytes: original }); await workspace.saved(original);
    const training = { kind: 'start_training', baseModelId: 'seed-0', packetId: 'starter-data', recipeId: 'compact-conversation-adaptation', profile: 'stable' } as const;
    assert.equal(workspace.saveBlueprint('Continue after reload', training), null);
    storage.rejectRawPrimary = true;
    const written = writeBrowserSnapshotWithBytes(state); assert.ok(written.ok, written.ok ? '' : written.error);
    assert.equal(JSON.parse(written.savedBytes).format, 'frontier-lab-compressed'); await workspace.saved(written.savedBytes);
    const binding = { algorithm: 'SHA-256', digest: createHash('sha256').update(written.savedBytes, 'utf8').digest('hex'), byteLength: Buffer.byteLength(written.savedBytes) };
    assert.deepEqual(hashSavedSnapshotSync(written.savedBytes), binding); assert.deepEqual(await hashSavedSnapshot(written.savedBytes), binding);
    assert.deepEqual(parseModelWorkspace(storage.getItem(metadataKey))!.binding, binding);
    const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded');
    if (read.kind !== 'loaded') throw new Error('Expected a compressed browser save.');
    assert.equal(read.savedBytes, written.savedBytes);
    const reopened = new ModelWorkspaceController(io); reopened.open({ playerId: read.state.playerCompanyId, mode: 'owner', savedBytes: read.savedBytes }); await reopened.saved(read.savedBytes);
    assert.equal(reopened.getSnapshot().blueprints[0].name, 'Continue after reload'); assert.deepEqual(reopened.getSnapshot().blueprints[0].training, training);
  });
});
