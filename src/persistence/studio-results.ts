/** Presentation-only acknowledgement metadata. Outcome records stay in the
 * validated game snapshot; this envelope can never recreate an outcome. */
export const STUDIO_RESULTS_KEY = 'frontier-lab.studio.results.v1';
export const RESULTS_WINDOW = 200;
export const RESULTS_MAX_BYTES = 64 * 1024;

export type ResultFlags = { reviewed: boolean; dismissed: boolean };
export type ResultFlagMap = Readonly<Record<string, ResultFlags>>;
export interface ResultIdentity { key: string; week: number }
export interface SavedByteBinding { algorithm: 'SHA-256'; digest: string; byteLength: number }
export interface ResultsEnvelope {
  version: 1;
  timelineToken: string;
  playerId: string;
  binding: SavedByteBinding;
  flags: ResultFlagMap;
}
export type ResultsSessionMode = 'acquiring' | 'owner' | 'observer' | 'memory';
export interface ResultsSnapshot {
  flags: ResultFlagMap;
  unreadCount: number;
  ready: boolean;
  announcement: { id: number; keys: readonly string[] } | null;
  notice: string;
}
export interface ResultsSessionInput {
  playerId: string;
  week: number;
  entries: readonly ResultIdentity[];
  mode: ResultsSessionMode;
  savedBytes?: string;
}
export interface ResultsPersistence {
  read(): string | null;
  write(text: string): void;
  remove(): void;
  snapshotMatches(bytes: string): boolean;
  hash(bytes: string): Promise<SavedByteBinding>;
  token(): string;
}

const encoder = new TextEncoder();
const reviewed = (): ResultFlags => ({ reviewed: true, dismissed: false });
const emptyFlags = (): Record<string, ResultFlags> => Object.create(null) as Record<string, ResultFlags>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sameBinding = (left: SavedByteBinding, right: SavedByteBinding) => left.algorithm === right.algorithm && left.digest === right.digest && left.byteLength === right.byteLength;

export async function hashSavedSnapshot(bytes: string): Promise<SavedByteBinding> {
  const encoded = encoder.encode(bytes);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return { algorithm: 'SHA-256', digest: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''), byteLength: encoded.byteLength };
}

export function newResultsTimelineToken(): string {
  const token = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(token, value => value.toString(16).padStart(2, '0')).join('');
}

/** Strict, bounded parsing rejects foreign fields instead of retaining cached
 * outcome text, malformed flags, or an oversized metadata history. */
export function parseResultsEnvelope(text: string | null): ResultsEnvelope | null {
  if (!text || encoder.encode(text).byteLength > RESULTS_MAX_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!isObject(value) || Object.keys(value).sort().join(',') !== 'binding,flags,playerId,timelineToken,version'
      || value.version !== 1 || typeof value.timelineToken !== 'string' || !/^[a-f0-9]{32}$/.test(value.timelineToken)
      || typeof value.playerId !== 'string' || !value.playerId || value.playerId.length > 512 || !isObject(value.binding)
      || Object.keys(value.binding).sort().join(',') !== 'algorithm,byteLength,digest'
      || value.binding.algorithm !== 'SHA-256' || typeof value.binding.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.binding.digest)
      || !Number.isSafeInteger(value.binding.byteLength) || (value.binding.byteLength as number) < 1 || !isObject(value.flags)) return null;
    const keys = Object.keys(value.flags);
    if (keys.length > RESULTS_WINDOW) return null;
    const flags = emptyFlags();
    for (const key of keys) {
      const flag = value.flags[key];
      if (!key || key.length > 2048 || !isObject(flag) || Object.keys(flag).sort().join(',') !== 'dismissed,reviewed'
        || typeof flag.reviewed !== 'boolean' || typeof flag.dismissed !== 'boolean' || (flag.dismissed && !flag.reviewed)) return null;
      flags[key] = { reviewed: flag.reviewed, dismissed: flag.dismissed };
    }
    return { version: 1, timelineToken: value.timelineToken, playerId: value.playerId,
      binding: { algorithm: 'SHA-256', digest: value.binding.digest, byteLength: value.binding.byteLength as number }, flags };
  } catch { return null; }
}

export function encodeResultsEnvelope(envelope: ResultsEnvelope): string | null {
  const text = JSON.stringify(envelope);
  return encoder.encode(text).byteLength <= RESULTS_MAX_BYTES && parseResultsEnvelope(text) ? text : null;
}

function supportedWindow(entries: readonly ResultIdentity[]): ResultIdentity[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (!entry.key || seen.has(entry.key) || !Number.isSafeInteger(entry.week) || entry.week < 0) return false;
    seen.add(entry.key); return true;
  }).slice(0, RESULTS_WINDOW).map(entry => ({ key: entry.key, week: entry.week }));
}

/** One controller per mounted lab. Every async digest is guarded by session and
 * save identity; the synchronous primary writer remains authoritative. */
export class StudioResultsController {
  private readonly persistence: ResultsPersistence;
  private listeners = new Set<() => void>();
  private state: ResultsSnapshot = { flags: emptyFlags(), unreadCount: 0, ready: false, announcement: null, notice: '' };
  private mode: ResultsSessionMode = 'acquiring';
  private sessionIdentity = 0;
  private saveIdentity = 0;
  private announcementIdentity = 0;
  private playerId = '';
  private timelineToken = '';
  private week = 0;
  private entries: ResultIdentity[] = [];
  private binding: SavedByteBinding | null = null;
  private boundBytes: string | null = null;
  private boundKeys: string[] = [];
  private latestReceiptBytes: string | null = null;
  private touched = new Set<string>();
  private initialization: Promise<void> = Promise.resolve();

  constructor(persistence: ResultsPersistence) { this.persistence = persistence; }
  getSnapshot = (): ResultsSnapshot => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(next: Partial<ResultsSnapshot>) {
    const flags = next.flags ?? this.state.flags;
    this.state = { ...this.state, ...next, flags,
      unreadCount: Object.values(flags).filter(flag => !flag.reviewed && !flag.dismissed).length };
    for (const listener of this.listeners) listener();
  }

  suspend = () => {
    this.sessionIdentity++; this.saveIdentity++;
    this.mode = 'acquiring'; this.binding = null; this.boundBytes = null; this.latestReceiptBytes = null;
    this.publish({ ready: false, announcement: null });
  };

  /** Accepted replacement calls this only after the primary write succeeds.
   * Even an identical snapshot receives an independent random timeline. */
  replace = (input: ResultsSessionInput) => this.open(input, true);
  open = (input: ResultsSessionInput, replacing = false) => {
    const identity = ++this.sessionIdentity;
    this.saveIdentity++; this.mode = input.mode; this.playerId = input.playerId; this.week = input.week;
    this.entries = supportedWindow(input.entries); this.binding = null; this.boundBytes = null; this.boundKeys = [];
    this.latestReceiptBytes = input.savedBytes ?? null; this.touched.clear();
    let tokenFailed = false;
    try { this.timelineToken = this.persistence.token(); }
    catch { this.timelineToken = ''; tokenFailed = true; }
    const flags = emptyFlags();
    for (const entry of this.entries) flags[entry.key] = reviewed();
    this.publish({ flags, ready: true, announcement: null, notice: tokenFailed ? 'Result review marks are kept in this tab.' : '' });

    let stored: ResultsEnvelope | null = null;
    if (input.mode === 'owner') {
      if (replacing || !input.savedBytes) {
        try { this.persistence.remove(); }
        catch {
          // Removal can fail separately from writing. An invalid sentinel is a
          // second best-effort way to prevent a same-byte import reusing flags.
          try { this.persistence.write(''); } catch { this.publish({ notice: 'Result review marks are kept in this tab.' }); }
        }
      } else if (input.savedBytes && !tokenFailed) {
        try { stored = parseResultsEnvelope(this.persistence.read()); }
        catch { this.publish({ notice: 'Result review marks are kept in this tab.' }); }
      }
    }
    if (input.mode !== 'owner' || !input.savedBytes || tokenFailed) { this.initialization = Promise.resolve(); return; }
    const bytes = input.savedBytes;
    const initialKeys = new Set(this.entries.map(entry => entry.key));
    this.initialization = this.persistence.hash(bytes).then(binding => {
      if (identity !== this.sessionIdentity || this.mode !== 'owner') return;
      // Later receipts from this controller are allowed while the initial digest
      // runs. An unrelated primary write cannot establish a trusted timeline.
      if (!this.persistence.snapshotMatches(this.latestReceiptBytes ?? bytes)) return;
      if (!replacing && stored?.playerId === this.playerId && sameBinding(stored.binding, binding)) {
        this.timelineToken = stored.timelineToken;
        const restored = emptyFlags();
        for (const entry of this.entries) {
          restored[entry.key] = initialKeys.has(entry.key) && !this.touched.has(entry.key) && own(stored.flags, entry.key)
            ? { ...stored.flags[entry.key] } : { ...(this.state.flags[entry.key] ?? reviewed()) };
        }
        this.publish({ flags: restored });
      }
      this.binding = binding; this.boundBytes = bytes; this.boundKeys = [...initialKeys];
      this.persist();
    }).catch(() => {
      if (identity === this.sessionIdentity) this.publish({ notice: 'Result review marks are kept in this tab.' });
    });
  };

  observe = (input: Pick<ResultsSessionInput, 'playerId' | 'week' | 'entries'>) => {
    if (!this.state.ready || this.mode === 'acquiring') return;
    if (input.playerId !== this.playerId || input.week < this.week) {
      this.open({ ...input, mode: this.mode }); return;
    }
    const nextEntries = supportedWindow(input.entries);
    const previousKeys = new Set(this.entries.map(entry => entry.key));
    const settled = (this.mode === 'owner' || this.mode === 'memory') && input.week === this.week + 1;
    const freshKeys = nextEntries.filter(entry => !previousKeys.has(entry.key) && settled && entry.week > this.week && entry.week <= input.week).map(entry => entry.key);
    const freshSet = new Set(freshKeys), flags = emptyFlags();
    for (const entry of nextEntries) flags[entry.key] = own(this.state.flags, entry.key) ? this.state.flags[entry.key]
      : { reviewed: !freshSet.has(entry.key), dismissed: false };
    this.touched = new Set([...this.touched].filter(key => own(flags, key)));
    this.entries = nextEntries; this.week = input.week;
    this.publish({ flags, ...(freshKeys.length ? { announcement: { id: ++this.announcementIdentity, keys: freshKeys } } : {}) });
  };

  /** Called with a successful primary-write receipt, never proposed bytes. */
  saved = (savedBytes: string): Promise<void> => {
    if (this.mode !== 'owner' || !this.timelineToken) return Promise.resolve();
    const session = this.sessionIdentity, save = ++this.saveIdentity;
    const keys = this.entries.map(entry => entry.key);
    this.latestReceiptBytes = savedBytes;
    return this.initialization.then(() => this.persistence.hash(savedBytes)).then(binding => {
      if (session !== this.sessionIdentity || save !== this.saveIdentity || this.mode !== 'owner') return;
      if (!this.persistence.snapshotMatches(savedBytes)) return;
      this.binding = binding; this.boundBytes = savedBytes; this.boundKeys = keys;
      this.persist();
    }).catch(() => {
      if (session === this.sessionIdentity && save === this.saveIdentity) this.publish({ notice: 'Result review marks are kept in this tab.' });
    });
  };

  private persist() {
    if (this.mode !== 'owner' || !this.binding || !this.boundBytes || !this.timelineToken) return;
    try {
      if (!this.persistence.snapshotMatches(this.boundBytes)) return;
      const flags = emptyFlags();
      for (const key of this.boundKeys) if (own(this.state.flags, key)) flags[key] = this.state.flags[key];
      const text = encodeResultsEnvelope({ version: 1, timelineToken: this.timelineToken, playerId: this.playerId, binding: this.binding, flags });
      if (!text) { this.publish({ notice: 'Result review marks are kept in this tab.' }); return; }
      this.persistence.write(text);
      if (this.state.notice) this.publish({ notice: '' });
    } catch { this.publish({ notice: 'Result review marks are kept in this tab.' }); }
  }

  markReviewed = (keys: readonly string[]) => {
    const flags = { ...this.state.flags };
    let changed = false;
    for (const key of keys) if (own(flags, key)) { flags[key] = { ...flags[key], reviewed: true }; this.touched.add(key); changed = true; }
    if (changed) { this.publish({ flags }); this.persist(); }
  };
  dismiss = (key: string) => this.changeFlag(key, { reviewed: true, dismissed: true });
  restore = (key: string) => this.changeFlag(key, { reviewed: true, dismissed: false });
  private changeFlag(key: string, flag: ResultFlags) {
    if (!own(this.state.flags, key)) return;
    this.touched.add(key); this.publish({ flags: { ...this.state.flags, [key]: flag } }); this.persist();
  }
}
