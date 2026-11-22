import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { hashText } from '../core/canonical';

const MARKER = 'FRONTIER-LAB-RECOVERY:';
export const RECOVERY_ARCHIVE_PREFIX = MARKER + 'GZIP:1\n';
const MAX_TEXT_UNITS = 2_000_000;
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
  let binary = '';
  for (let offset = 0; offset < compressed.length; offset += 16384) {
    binary += String.fromCharCode(...compressed.subarray(offset, offset + 16384));
  }
  return RECOVERY_ARCHIVE_PREFIX + text.length + ':' + hashText(text) + ':' + input.length + '\n' + btoa(binary);
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
    const base64 = payload.slice(boundary + 1);
    if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid recovery base64.');
    const binary = atob(base64);
    if (binary.length < 18 || binary.length > MAX_JSON_BYTES) throw new Error('Invalid compressed recovery length.');
    const compressed = Uint8Array.from(binary, character => character.charCodeAt(0));
    const trailerLength = new DataView(compressed.buffer, compressed.byteOffset + compressed.length - 4, 4).getUint32(0, true);
    if (trailerLength !== expectedBytes) throw new Error('Recovery gzip length changed.');
    const unpacked = gunzipSync(compressed, new Uint8Array(expectedBytes));
    if (unpacked.length !== expectedBytes) throw new Error('Recovery decompressed length changed.');
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

