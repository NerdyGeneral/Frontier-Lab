import { gzipSync, strFromU8, strToU8 } from 'fflate';
import { hashText } from '../core/canonical';
import { decodeBase64, encodeBase64, gunzipBounded } from '../core/bounded-gzip';
import { MAX_PORTABLE_SAVE_BYTES } from './portable-save';

const MARKER = 'FRONTIER-LAB-RECOVERY:';
export const RECOVERY_ARCHIVE_PREFIX = MARKER + 'GZIP:1\n';
// Previous-run recovery can include the same bounded planning metadata as a
// downloaded portable save. Historical engine-only archives remain unchanged.
const MAX_TEXT_UNITS = MAX_PORTABLE_SAVE_BYTES;
const MAX_JSON_BYTES = MAX_TEXT_UNITS * 6 + 2;

export class RecoveryArchiveError extends Error {
  constructor(message = 'This compressed recovery copy could not be verified. Existing copies and the current save are unchanged. Export another recovery copy or import a previously exported snapshot.') {
    super(message);
    this.name = 'RecoveryArchiveError';
  }
}

/** The JSON string wrapper preserves every UTF-16 code unit, including lone surrogates. */
export function encodeRecoveryArchive(text: string): string {
  if (text.length > MAX_TEXT_UNITS) throw new RecoveryArchiveError('This recovery copy is too large to compress safely. Export the untouched stored save before replacing it; existing copies and the primary save are unchanged.');
  const input = strToU8(JSON.stringify(text));
  const compressed = gzipSync(input, { level: 6, mtime: 0 });
  return RECOVERY_ARCHIVE_PREFIX + text.length + ':' + hashText(text) + ':' + input.length + '\n' + encodeBase64(compressed);
}

/** Raw archives retain their exact text; packed archives must pass bounded integrity checks. */
export function decodeRecoveryArchive(stored: string): string {
  if (!stored.startsWith(MARKER)) return stored;
  try {
    if (!stored.startsWith(RECOVERY_ARCHIVE_PREFIX)) throw new Error('Unknown recovery encoding.');
    const payload = stored.slice(RECOVERY_ARCHIVE_PREFIX.length), boundary = payload.indexOf('\n');
    if (boundary < 0) throw new Error('Missing recovery header.');
    const match = /^(0|[1-9]\d{0,6}):([0-9a-f]{8}):(0|[1-9]\d{0,7})$/.exec(payload.slice(0, boundary));
    if (!match) throw new Error('Invalid recovery header.');
    const expectedUnits = Number(match[1]), expectedHash = match[2], expectedBytes = Number(match[3]);
    if (expectedUnits > MAX_TEXT_UNITS || expectedBytes < 2 || expectedBytes > MAX_JSON_BYTES) throw new Error('Recovery length is outside its bound.');
    const compressed = decodeBase64(payload.slice(boundary + 1), MAX_JSON_BYTES);
    const unpacked = gunzipBounded(compressed, expectedBytes, MAX_JSON_BYTES);
    const text: unknown = JSON.parse(strFromU8(unpacked));
    if (typeof text !== 'string' || text.length !== expectedUnits || hashText(text) !== expectedHash) throw new Error('Recovery text integrity changed.');
    return text;
  } catch {
    throw new RecoveryArchiveError();
  }
}

export function isRecoveryQuotaError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'QuotaExceededError';
}

/** Only caller-owned recovery keys are eligible. Compaction preserves the exact
 * exported text and never deletes a copy, including an unreadable packed copy. */
export function compactRecoveryArchives(storage: Pick<Storage, 'getItem' | 'setItem'>, keys: readonly string[]): boolean {
  let changed = false;
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw === null || raw.startsWith(MARKER)) continue;
    let packed: string;
    try {
      packed = encodeRecoveryArchive(raw);
      if (packed.length >= raw.length) continue;
      if (decodeRecoveryArchive(packed) !== raw) throw new RecoveryArchiveError();
    } catch (error) {
      if (!(error instanceof RecoveryArchiveError)) throw error;
      continue;
    }
    storage.setItem(key, packed);
    changed = true;
  }
  return changed;
}

/** Only a real quota error on this new archive enables compression. Existing keys are never evicted. */
export function writeRecoveryArchive(storage: Pick<Storage, 'setItem'>, key: string, text: string): void {
  try {
    storage.setItem(key, text);
  } catch (error) {
    if (!isRecoveryQuotaError(error)) throw error;
    const packed = encodeRecoveryArchive(text);
    if (packed.length >= text.length) throw error;
    storage.setItem(key, packed);
  }
}

