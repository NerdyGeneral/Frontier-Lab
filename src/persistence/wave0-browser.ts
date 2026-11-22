import { CONTENT } from '../content/catalog';
import { deserializeState, serializeState, SnapshotTooLargeError } from '../core/index';
import type { GameState } from '../contracts/types';
import { compactRecoveryArchives, decodeRecoveryArchive, isRecoveryQuotaError, RecoveryArchiveError, writeRecoveryArchive } from './recovery-codec';
export { RecoveryArchiveError } from './recovery-codec';

const SAVE_KEY = 'frontier-lab.wave0.snapshot';
const WRITER_LOCK = 'frontier-lab.wave0.writer';
const ORIGINAL_V1_KEY = 'frontier-lab.wave0.original';
const ORIGINAL_V2_KEY = 'frontier-lab.wave1.original';
const ORIGINAL_V3_KEY = 'frontier-lab.wave2.original';
const ORIGINAL_V4_KEY = 'frontier-lab.wave3.original';
const ORIGINAL_WAVE4_KEY = 'frontier-lab.wave4.original';
const ORIGINAL_WAVE5_KEY = 'frontier-lab.wave5.original';
const ORIGINAL_WAVE6_KEY = 'frontier-lab.wave6.original';
const ORIGINAL_WAVE7_KEY = 'frontier-lab.wave7.original';
const ORIGINAL_WAVE8_KEY = 'frontier-lab.wave8.original';
const ORIGINAL_WAVE9_KEY = 'frontier-lab.wave9.original';
const ORIGINAL_WAVE10_KEY = 'frontier-lab.wave10.original';
const ORIGINAL_WAVE11_KEY = 'frontier-lab.wave11.original';
const ORIGINAL_WAVE12_KEY = 'frontier-lab.wave12.original';
const ORIGINAL_WAVE13_KEY = 'frontier-lab.wave13.original';
const ORIGINAL_WAVE14_KEY = 'frontier-lab.wave14.original';
const ORIGINAL_WAVE15_KEY = 'frontier-lab.wave15.original';
const ORIGINAL_WAVE16_KEY = 'frontier-lab.wave16.original';
const ORIGINAL_WAVE17_KEY = 'frontier-lab.wave17.original';
const ORIGINAL_WAVE18_KEY = 'frontier-lab.wave18.original';
const ORIGINAL_WAVE19_KEY = 'frontier-lab.wave19.original';
const ORIGINAL_WAVE21_KEY = 'frontier-lab.wave21.original';
const ORIGINAL_CONTENT_023_KEY = 'frontier-lab.content023.original';
const ORIGINAL_CONTENT_026_KEY = 'frontier-lab.content026.original';
const ORIGINAL_CONTENT_027_KEY = 'frontier-lab.content027.original';
const ORIGINAL_CONTENT_028_KEY = 'frontier-lab.content028.original';
const ORIGINAL_CONTENT_033_KEY = 'frontier-lab.content033.original';
const ORIGINAL_CONTENT_034_KEY = 'frontier-lab.content034.original';
const ORIGINAL_CONTENT_035_KEY = 'frontier-lab.content035.original';
const ORIGINAL_CONTENT_036_KEY = 'frontier-lab.content036.original';
const ORIGINAL_CONTENT_037_KEY = 'frontier-lab.content037.original';
const ORIGINAL_CONTENT_029_KEY = 'frontier-lab.content029.original';
const PREVIOUS_KEY = 'frontier-lab.previous.snapshot';
let sessionTail: Promise<void> = Promise.resolve();

type PrimaryValidation = Pick<Extract<ReturnType<typeof deserializeState>, { ok: true }>, 'ok' | 'migratedFrom'> | { ok: false };
/** One last-observed primary per actual storage object. Keep only validation
 * metadata, never a mutable GameState or a history of previously trusted saves. */
const primaryValidation = new WeakMap<Storage, { text: string; result: PrimaryValidation }>();
function rememberPrimary(storage: Storage, text: string, result: PrimaryValidation): PrimaryValidation {
  const metadata: PrimaryValidation = result.ok ? { ok: true, ...(result.migratedFrom ? { migratedFrom: result.migratedFrom } : {}) } : { ok: false };
  primaryValidation.set(storage, { text, result: metadata });
  return metadata;
}
function validatePreviousPrimary(storage: Storage, text: string): PrimaryValidation {
  const previous = primaryValidation.get(storage);
  // Hashes, revision counters and object identities cannot stand in for the
  // exact bytes currently returned by this storage instance.
  return previous?.text === text ? previous.result : rememberPrimary(storage, text, deserializeState(text, CONTENT));
}

export type SessionMode = 'acquiring' | 'owner' | 'observer' | 'memory';
export type StoredSnapshot =
  | { kind: 'empty' }
  | { kind: 'loaded'; state: GameState; migratedFrom?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22 | 24 | 27 | 28 | 29 | 30 | 33 | 34 | 35 | 36 | 37 }
  | { kind: 'invalid' | 'unavailable'; message: string };
export type RecoveryKind = 'stored' | 'wave0' | 'wave1' | 'wave2' | 'wave3' | 'wave4' | 'wave5' | 'wave6' | 'wave7' | 'wave8' | 'wave9' | 'wave10' | 'wave11' | 'wave12' | 'wave13' | 'wave14' | 'wave15' | 'wave16' | 'wave17' | 'wave18' | 'wave19' | 'wave21' | 'content023' | 'content026' | 'content027' | 'content028' | 'content029' | 'content033' | 'content034' | 'content035' | 'content036' | 'content037' | 'previous';
export interface RecoveryOption { kind: RecoveryKind; label: string; filename: string }
const RECOVERY_OPTIONS: readonly RecoveryOption[] = [
  { kind: 'stored', label: 'Export untouched stored save', filename: 'frontier-lab-stored-save.json' },
  { kind: 'wave0', label: 'Export original Wave 0 save', filename: 'frontier-lab-wave0-original.json' },
  { kind: 'wave1', label: 'Export original Wave 1 save', filename: 'frontier-lab-wave1-original.json' },
  { kind: 'wave2', label: 'Export original Wave 2 save', filename: 'frontier-lab-wave2-original.json' },
  { kind: 'wave3', label: 'Export original Wave 3 save', filename: 'frontier-lab-wave3-original.json' },
  { kind: 'wave4', label: 'Export original Wave 4 save', filename: 'frontier-lab-wave4-original.json' },
  { kind: 'wave5', label: 'Export original Wave 5 save', filename: 'frontier-lab-wave5-original.json' },
  { kind: 'wave6', label: 'Export original Wave 6 save', filename: 'frontier-lab-wave6-original.json' },
  { kind: 'wave7', label: 'Export original Wave 7 save', filename: 'frontier-lab-wave7-original.json' },
  { kind: 'wave8', label: 'Export original Wave 8 save', filename: 'frontier-lab-wave8-original.json' },
  { kind: 'wave9', label: 'Export original Wave 9 save', filename: 'frontier-lab-wave9-original.json' },
  { kind: 'wave10', label: 'Export original Wave 10 save', filename: 'frontier-lab-wave10-original.json' },
  { kind: 'wave11', label: 'Export original Wave 11 save', filename: 'frontier-lab-wave11-original.json' },
  { kind: 'wave12', label: 'Export original Wave 12 save', filename: 'frontier-lab-wave12-original.json' },
  { kind: 'wave13', label: 'Export original Wave 13 save', filename: 'frontier-lab-wave13-original.json' },
  { kind: 'wave14', label: 'Export original Wave 14 save', filename: 'frontier-lab-wave14-original.json' },
  { kind: 'wave15', label: 'Export original Wave 15 save', filename: 'frontier-lab-wave15-original.json' },
  { kind: 'wave16', label: 'Export original Wave 16 save', filename: 'frontier-lab-wave16-original.json' },
  { kind: 'wave17', label: 'Export original Wave 17 save', filename: 'frontier-lab-wave17-original.json' },
  { kind: 'wave18', label: 'Export original Wave 18 save', filename: 'frontier-lab-wave18-original.json' },
  { kind: 'wave19', label: 'Export original Wave 19 save', filename: 'frontier-lab-wave19-original.json' },
  { kind: 'wave21', label: 'Export original Wave 21 save', filename: 'frontier-lab-wave21-original.json' },
  { kind: 'content023', label: 'Export original 0.23 content save', filename: 'frontier-lab-content023-original.json' },
  { kind: 'content026', label: 'Export original 0.26 content save', filename: 'frontier-lab-content026-original.json' },
  { kind: 'content027', label: 'Export original 0.27 content save', filename: 'frontier-lab-content027-original.json' },
  { kind: 'content028', label: 'Export original 0.28 content save', filename: 'frontier-lab-content028-original.json' },
  { kind: 'content034', label: 'Export original 0.34 content save', filename: 'frontier-lab-content034-original.json' },
  { kind: 'content035', label: 'Export original 0.35 content save', filename: 'frontier-lab-content035-original.json' },
  { kind: 'content037', label: 'Export original 0.37 content save', filename: 'frontier-lab-content037-original.json' },
  { kind: 'content036', label: 'Export original 0.36 content save', filename: 'frontier-lab-content036-original.json' },
  { kind: 'content033', label: 'Export original 0.33 content save', filename: 'frontier-lab-content033-original.json' },
  { kind: 'content029', label: 'Export original 0.29 content save', filename: 'frontier-lab-content029-original.json' },
  { kind: 'previous', label: 'Export previous saved run', filename: 'frontier-lab-previous-save.json' },
];
const RECOVERY_KEYS: Record<RecoveryKind, string> = { stored: SAVE_KEY, wave0: ORIGINAL_V1_KEY, wave1: ORIGINAL_V2_KEY, wave2: ORIGINAL_V3_KEY, wave3: ORIGINAL_V4_KEY, wave4: ORIGINAL_WAVE4_KEY, wave5: ORIGINAL_WAVE5_KEY, wave6: ORIGINAL_WAVE6_KEY, wave7: ORIGINAL_WAVE7_KEY, wave8: ORIGINAL_WAVE8_KEY, wave9: ORIGINAL_WAVE9_KEY, wave10: ORIGINAL_WAVE10_KEY, wave11: ORIGINAL_WAVE11_KEY, wave12: ORIGINAL_WAVE12_KEY, wave13: ORIGINAL_WAVE13_KEY, wave14: ORIGINAL_WAVE14_KEY, wave15: ORIGINAL_WAVE15_KEY, wave16: ORIGINAL_WAVE16_KEY, wave17: ORIGINAL_WAVE17_KEY, wave18: ORIGINAL_WAVE18_KEY, wave19: ORIGINAL_WAVE19_KEY, wave21: ORIGINAL_WAVE21_KEY, content023: ORIGINAL_CONTENT_023_KEY, content026: ORIGINAL_CONTENT_026_KEY, content027: ORIGINAL_CONTENT_027_KEY, content028: ORIGINAL_CONTENT_028_KEY, content029: ORIGINAL_CONTENT_029_KEY, content033: ORIGINAL_CONTENT_033_KEY, content034: ORIGINAL_CONTENT_034_KEY, content035: ORIGINAL_CONTENT_035_KEY, content036: ORIGINAL_CONTENT_036_KEY, content037: ORIGINAL_CONTENT_037_KEY, previous: PREVIOUS_KEY };
const ARCHIVE_KEYS = Object.values(RECOVERY_KEYS).filter(key => key !== SAVE_KEY);

function preserveRecoveryArchive(storage: Storage, key: string, text: string): void {
  const existing = storage.getItem(key);
  if (existing !== null) {
    try { if (decodeRecoveryArchive(existing) === text) return; }
    catch (error) { if (!(error instanceof RecoveryArchiveError)) throw error; }
  }
  try { writeRecoveryArchive(storage, key, text); }
  catch (error) {
    if (!isRecoveryQuotaError(error) || !compactRecoveryArchives(storage, ARCHIVE_KEYS.filter(archiveKey => archiveKey !== key))) throw error;
    writeRecoveryArchive(storage, key, text);
  }
}

export type StoredSnapshotWithBytes = Exclude<StoredSnapshot, { kind: 'loaded' }>
  | (Extract<StoredSnapshot, { kind: 'loaded' }> & { savedBytes: string });
export type SnapshotWriteResult = { ok: true } | { ok: false; error: string };
export type SnapshotWriteWithBytesResult = { ok: true; savedBytes: string } | { ok: false; error: string };

/** The additive receipt exposes only bytes actually validated on read or written
 * successfully. UI sidecars may hash them without altering snapshot contents. */
export function readBrowserSnapshotWithBytes(): StoredSnapshotWithBytes {
  try {
    const storage = window.localStorage, saved = storage.getItem(SAVE_KEY);
    if (saved === null) { primaryValidation.delete(storage); return { kind: 'empty' }; }
    const result = deserializeState(saved, CONTENT);
    rememberPrimary(storage, saved, result);
    return result.ok
      ? { kind: 'loaded', state: result.state, savedBytes: saved, ...(result.migratedFrom ? { migratedFrom: result.migratedFrom } : {}) }
      : { kind: 'invalid', message: `The saved snapshot could not be opened: ${result.error}` };
  } catch {
    return { kind: 'unavailable', message: 'This browser is not allowing local saves.' };
  }
}

export function readBrowserSnapshot(): StoredSnapshot {
  const result = readBrowserSnapshotWithBytes();
  if (result.kind !== 'loaded') return result;
  return { kind: 'loaded', state: result.state, ...(result.migratedFrom ? { migratedFrom: result.migratedFrom } : {}) };
}

export function browserSnapshotMatches(savedBytes: string): boolean {
  try { return window.localStorage.getItem(SAVE_KEY) === savedBytes; }
  catch { return false; }
}

export function writeBrowserSnapshotWithBytes(state: GameState, options: { replace?: boolean } = {}): SnapshotWriteWithBytesResult {
  try {
    // Every supplied state still receives complete serialization/validation.
    let next = serializeState(state, CONTENT);
    const storage = window.localStorage, previous = storage.getItem(SAVE_KEY);
    if (previous !== null) {
      const prior = validatePreviousPrimary(storage, previous);
      if (!prior.ok && !options.replace) {
        return { ok: false, error: 'The stored save failed validation. Its original bytes are untouched. Export it, or confirm an import or new lab before replacing it.' };
      }
      // Archive an original before any upgraded write. If the archive fails,
      // the primary snapshot is not touched, and the UI can still export.
      const originalKey = prior.ok && prior.migratedFrom === 1 ? ORIGINAL_V1_KEY
        : prior.ok && prior.migratedFrom === 2 ? ORIGINAL_V2_KEY
        : prior.ok && prior.migratedFrom === 3 ? ORIGINAL_V3_KEY
        : prior.ok && prior.migratedFrom === 4 ? ORIGINAL_V4_KEY
        : prior.ok && prior.migratedFrom === 5 ? ORIGINAL_WAVE4_KEY
        : prior.ok && prior.migratedFrom === 6 ? ORIGINAL_WAVE5_KEY
        : prior.ok && prior.migratedFrom === 7 ? ORIGINAL_WAVE6_KEY
        : prior.ok && prior.migratedFrom === 8 ? ORIGINAL_WAVE7_KEY
        : prior.ok && prior.migratedFrom === 9 ? ORIGINAL_WAVE8_KEY
        : prior.ok && prior.migratedFrom === 10 ? ORIGINAL_WAVE9_KEY
        : prior.ok && prior.migratedFrom === 11 ? ORIGINAL_WAVE10_KEY
        : prior.ok && prior.migratedFrom === 12 ? ORIGINAL_WAVE11_KEY
        : prior.ok && prior.migratedFrom === 13 ? ORIGINAL_WAVE12_KEY
        : prior.ok && prior.migratedFrom === 14 ? ORIGINAL_WAVE13_KEY
        : prior.ok && prior.migratedFrom === 15 ? ORIGINAL_WAVE14_KEY
        : prior.ok && prior.migratedFrom === 16 ? ORIGINAL_WAVE15_KEY
        : prior.ok && prior.migratedFrom === 17 ? ORIGINAL_WAVE16_KEY
        : prior.ok && prior.migratedFrom === 18 ? ORIGINAL_WAVE17_KEY
        : prior.ok && prior.migratedFrom === 19 ? ORIGINAL_WAVE18_KEY
        : prior.ok && prior.migratedFrom === 20 ? ORIGINAL_WAVE19_KEY
        : prior.ok && prior.migratedFrom === 22 ? ORIGINAL_WAVE21_KEY
        : prior.ok && prior.migratedFrom === 24 ? ORIGINAL_CONTENT_023_KEY
        : prior.ok && prior.migratedFrom === 27 ? ORIGINAL_CONTENT_026_KEY
        : prior.ok && prior.migratedFrom === 28 ? ORIGINAL_CONTENT_027_KEY
        : prior.ok && prior.migratedFrom === 29 ? ORIGINAL_CONTENT_028_KEY
        : prior.ok && prior.migratedFrom === 30 ? ORIGINAL_CONTENT_029_KEY
        : prior.ok && prior.migratedFrom === 33 ? ORIGINAL_CONTENT_033_KEY
        : prior.ok && prior.migratedFrom === 34 ? ORIGINAL_CONTENT_034_KEY
        : prior.ok && prior.migratedFrom === 35 ? ORIGINAL_CONTENT_035_KEY
        : prior.ok && prior.migratedFrom === 36 ? ORIGINAL_CONTENT_036_KEY
        : prior.ok && prior.migratedFrom === 37 ? ORIGINAL_CONTENT_037_KEY : null;
      if (originalKey !== null && storage.getItem(originalKey) === null) {
        preserveRecoveryArchive(storage, originalKey, previous);
      }
      if (options.replace && previous !== next) preserveRecoveryArchive(storage, PREVIOUS_KEY, previous);
    } else primaryValidation.delete(storage);
    try { storage.setItem(SAVE_KEY, next); }
    catch (error) {
      if (!isRecoveryQuotaError(error)) throw error;
      // Leave the old primary in place until setItem succeeds. A compressed
      // primary often suffices without touching any existing recovery copies.
      const packed = serializeState(state, CONTENT, { compress: true });
      if (packed !== next) {
        next = packed;
        try { storage.setItem(SAVE_KEY, next); }
        catch (packedError) {
          if (!isRecoveryQuotaError(packedError) || !compactRecoveryArchives(storage, ARCHIVE_KEYS)) throw packedError;
          storage.setItem(SAVE_KEY, next);
        }
      } else {
        if (!compactRecoveryArchives(storage, ARCHIVE_KEYS)) throw error;
        storage.setItem(SAVE_KEY, next);
      }
    }
    // A failed archive or primary write must never prime the proposed bytes.
    rememberPrimary(storage, next, { ok: true });
    return { ok: true, savedBytes: next };
  } catch (error) {
    return { ok: false, error: error instanceof SnapshotTooLargeError || error instanceof RecoveryArchiveError ? error.message : 'Local save failed. Export a snapshot to keep this run.' };
  }
}

export function writeBrowserSnapshot(state: GameState, options: { replace?: boolean } = {}): SnapshotWriteResult {
  const result = writeBrowserSnapshotWithBytes(state, options);
  return result.ok ? { ok: true } : result;
}

export function browserRecoveryOptions(includeStored = false): RecoveryOption[] {
  try {
    return RECOVERY_OPTIONS.filter(option => (option.kind !== 'stored' || includeStored) && window.localStorage.getItem(RECOVERY_KEYS[option.kind]) !== null).map(option => ({ ...option }));
  } catch { return []; }
}

/** Recovery exports restore exact original text without parsing or migrating the game snapshot. */
export function readBrowserRecovery(kind: RecoveryKind): { text: string; filename: string } | null {
  try {
    const text = window.localStorage.getItem(RECOVERY_KEYS[kind]);
    const option = RECOVERY_OPTIONS.find(option => option.kind === kind);
    return text !== null && option ? { text: kind === 'stored' ? text : decodeRecoveryArchive(text), filename: option.filename } : null;
  } catch (error) {
    if (error instanceof RecoveryArchiveError) throw error;
    return null;
  }
}

/** A single tab may advance and write this local run. No lock means memory-only play. */
export function openBrowserSession(onMode: (mode: SessionMode) => void): () => void {
  let closed = false;
  let release: (() => void) | undefined;
  // Serialize a remount behind the previous cleanup. React's development
  // remount must not briefly compete with its own outstanding lock request.
  sessionTail = sessionTail.then(async () => {
    if (closed) return;
    if (!navigator.locks) {
      onMode('memory');
      return;
    }
    await navigator.locks.request(WRITER_LOCK, { ifAvailable: true }, async (lock) => {
      if (closed) return;
      if (!lock) {
        onMode('observer');
        return;
      }
      await new Promise<void>((resolve) => {
        release = resolve;
        onMode('owner');
      });
    });
  }).catch(() => {
    if (!closed) onMode('memory');
  });
  return () => {
    closed = true;
    release?.();
  };
}
