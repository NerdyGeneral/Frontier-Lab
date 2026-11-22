import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SNAPSHOT_BYTES } from '../src/core/snapshot';
import { hashSavedSnapshotSync } from '../src/persistence/saved-snapshot-hash';

const reference = (text: string) => ({ algorithm: 'SHA-256', digest: createHash('sha256').update(text, 'utf8').digest('hex'), byteLength: Buffer.byteLength(text, 'utf8') });

test('synchronous saved-byte SHA-256 matches published known vectors', () => {
  for (const [text, digest] of [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ]) assert.deepEqual(hashSavedSnapshotSync(text), { ...reference(text), digest });
});

test('synchronous saved-byte SHA-256 uses exact UTF-8 bytes including Unicode and malformed surrogate replacement', () => {
  for (const text of ['研究室 🔬 — café', '\u0000\u0001\u007f\u0080\u0800\uffff', '\ud800', '\udc00', 'A\ud800B\udc00C',
    JSON.stringify({ name: '实验室 🧠', model: 'Modèle spécialisé', description: '日本語 / العربية / Українська' }),
    'é'.repeat(27) + '🔬', '界'.repeat(21), '🧠'.repeat(16) + 'e\u0301']) {
    assert.deepEqual(hashSavedSnapshotSync(text), reference(text));
  }
  assert.notEqual(hashSavedSnapshotSync('{"a":1}').digest, hashSavedSnapshotSync('{ "a": 1 }').digest, 'Whitespace is part of the exact saved-byte binding.');
});

test('synchronous saved-byte SHA-256 handles one- and two-block padding boundaries', () => {
  for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 118, 119, 120, 121, 127, 128, 129, 255, 256, 257, 1023, 1024, 1025]) {
    const text = Array.from({ length }, (_, i) => String.fromCharCode(32 + (i * 37) % 95)).join('');
    assert.deepEqual(hashSavedSnapshotSync(text), reference(text), 'UTF-8 byte length ' + length);
  }
});

test('synchronous saved-byte SHA-256 matches Node for a real mature snapshot and the full 2 MB import limit', t => {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const snapshot = readFileSync(join(directory, 'wave26-published.json'), 'utf8');
  assert.deepEqual(hashSavedSnapshotSync(snapshot), reference(snapshot));
  const maximum = snapshot + ' '.repeat(MAX_SNAPSHOT_BYTES - Buffer.byteLength(snapshot, 'utf8'));
  assert.equal(Buffer.byteLength(maximum), MAX_SNAPSHOT_BYTES);
  assert.deepEqual(JSON.parse(maximum), JSON.parse(snapshot), 'Padding remains a valid representation of the real snapshot.');
  const expected = reference(maximum), samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now(); const result = hashSavedSnapshotSync(maximum); samples.push(performance.now() - started);
    assert.deepEqual(result, expected);
  }
  samples.sort((a, b) => a - b);
  t.diagnostic(`2 MB synchronous SHA-256: median ${samples[2].toFixed(2)} ms; slowest ${samples.at(-1)!.toFixed(2)} ms. Performance is observed, not a timing-sensitive pass condition.`);
});
