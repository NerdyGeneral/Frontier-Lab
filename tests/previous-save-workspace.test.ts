import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, createInitialState, submitCommand } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { MODEL_WORKSPACE_KEY, ModelWorkspaceController, modelWorkspaceDataForExport } from '../src/persistence/model-workspace';
import type { ModelWorkspaceData, ModelWorkspacePersistence } from '../src/persistence/model-workspace';
import { deserializePortableSave, MAX_PORTABLE_SAVE_BYTES, serializePortableSaveFromSnapshot } from '../src/persistence/portable-save';
import { decodeRecoveryArchive, encodeRecoveryArchive, RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';
import { hashSavedSnapshotSync } from '../src/persistence/saved-snapshot-hash';
import { browserSnapshotMatches, readBrowserRecovery, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';

const PRIMARY = 'frontier-lab.wave0.snapshot', PREVIOUS = 'frontier-lab.previous.snapshot';
class RecoveryStorage implements Storage {
  values = new Map<string, string>();
  blocked = new Set<string>();
  requirePackedPrevious = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    if (this.blocked.has(key)) throw new DOMException('Storage unavailable', 'SecurityError');
    if (key === PREVIOUS && this.requirePackedPrevious && !value.startsWith(RECOVERY_ARCHIVE_PREFIX)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
  }
}
async function inBrowser(run: (storage: RecoveryStorage) => void | Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'), storage = new RecoveryStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { await run(storage); }
  finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}
function paidOpening() {
  const queued = submitCommand(createInitialState(CONTENT, 'release'), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'backup-preparation');
  assert.ok(queued.accepted);
  const progressed = advanceWeek(queued.state); assert.ok(progressed.accepted);
  const hired = submitCommand(progressed.state, { kind: 'hire_staff', role: 'ml' }, CONTENT, 'backup-queued-hire'); assert.ok(hired.accepted);
  return hired.state;
}
const workspace = (): ModelWorkspaceData => ({
  manual: {
    recipeId: 'compact-conversation-adaptation', designRoute: 'methods', designDraft: null,
    baseId: 'seed-0', packetId: CONTENT.starterData.id, explicitPacket: true, extraPackets: [], profile: 'stable', workspace: '',
    automated: false, asAdapter: false, retentionMode: 'none', replayChoice: { domain: 'coding', shareBps: 5000, packetIds: [] },
    curriculumChoice: { shareBps: 5000, tracks: [{ domain: 'documents', packetIds: [] }, { domain: 'coding', packetIds: [] }] },
    architecture: 'dense', teacherId: '', teacherDomain: 'conversation', trainingView: 'advanced', designOpen: false,
  },
  delegated: { name: 'Saved next model', baseId: 'seed-0', selected: [CONTENT.starterData.id], method: 'compact-conversation-adaptation', profile: 'stable',
    teacherId: '', teacherDomain: 'conversation', design: structuredClone(DEFAULT_MODEL_DESIGN), suiteId: 'basic-conversation-1', budget: '5000', reserve: '8000', duration: '24', importedTraining: null },
  developmentGoal: { kind: 'purpose', id: 'coding' },
  blueprints: [{ id: 'saved-coding', name: 'Saved coding starter', objective: { kind: 'purpose', id: 'coding' },
    training: { kind: 'start_training', baseModelId: 'seed-0', packetId: CONTENT.starterData.id, recipeId: 'compact-conversation-adaptation', profile: 'stable' } }],
});
function sidecar(bytes: string, playerId: string, data = workspace()) {
  return JSON.stringify({ version: 1, playerId, timelineToken: '0123456789abcdef0123456789abcdef', binding: hashSavedSnapshotSync(bytes), data });
}

test('previous recovery retains paid progress, queued work, both drafts, goals and blueprints from an exact bound sidecar', async () => {
  await inBrowser(storage => {
    const original = paidOpening(), saved = serializeState(original), data = workspace();
    storage.setItem(PRIMARY, saved); storage.setItem(MODEL_WORKSPACE_KEY, sidecar(saved, original.playerCompanyId, data));
    const next = createInitialState(CONTENT, 'release', 'consultancy');
    assert.ok(writeBrowserSnapshotWithBytes(next, { replace: true }).ok);
    const backup = readBrowserRecovery('previous'); assert.ok(backup);
    assert.deepEqual(JSON.parse(backup.text).snapshot, JSON.parse(saved), 'The original engine envelope is wrapped without a new version or paid receipt.');
    const restored = deserializePortableSave(backup.text); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
    assert.deepEqual(restored.state, original); assert.deepEqual(restored.workspace, data);
    assert.deepEqual(restored.state.queuedCommands, original.queuedCommands);
    assert.deepEqual(advanceWeek(restored.state), advanceWeek(original), 'Real queued work resumes identically after restoration.');
  });
});

test('foreign, mismatched, or malformed sidecars never become another campaign’s recovery metadata', async () => {
  await inBrowser(storage => {
    const original = paidOpening(), saved = serializeState(original);
    for (const metadata of [sidecar(saved + ' ', original.playerCompanyId), sidecar(saved, 'another-player'), '{bad-json', sidecar(saved, original.playerCompanyId, { ...workspace(), blueprints: Array(13).fill(workspace().blueprints[0]) })]) {
      storage.setItem(PRIMARY, saved); storage.setItem(MODEL_WORKSPACE_KEY, metadata);
      assert.ok(writeBrowserSnapshotWithBytes(createInitialState(), { replace: true }).ok);
      const backup = readBrowserRecovery('previous'); assert.equal(backup?.text, saved);
      const restored = deserializePortableSave(backup!.text); assert.ok(restored.ok); assert.equal(restored.workspace, undefined);
    }
  });
});

test('live metadata survives an immediate replacement after its sidecar storage fails', async () => {
  await inBrowser(async storage => {
    const original = paidOpening(), written = writeBrowserSnapshotWithBytes(original); assert.ok(written.ok);
    const io: ModelWorkspacePersistence = {
      read: () => storage.getItem(MODEL_WORKSPACE_KEY), write: text => storage.setItem(MODEL_WORKSPACE_KEY, text), remove: () => storage.removeItem(MODEL_WORKSPACE_KEY),
      snapshotMatches: browserSnapshotMatches, hash: async bytes => hashSavedSnapshotSync(bytes), hashSync: hashSavedSnapshotSync,
      token: () => '0123456789abcdef0123456789abcdef',
    };
    const controller = new ModelWorkspaceController(io); controller.open({ playerId: original.playerCompanyId, mode: 'owner', savedBytes: written.savedBytes });
    await controller.saved(written.savedBytes); assert.equal(await controller.restoreData(workspace()), true);
    storage.blocked.add(MODEL_WORKSPACE_KEY);
    controller.setDevelopmentGoal({ kind: 'purpose', id: 'analyst' });
    assert.equal(controller.saveBlueprint('Latest unsaved blueprint', workspace().blueprints[0].training), null);
    const latest = modelWorkspaceDataForExport(controller.getSnapshot()); assert.equal(controller.getSnapshot().persistent, false);
    const result = writeBrowserSnapshotWithBytes(createInitialState(), { replace: true, previousWorkspace: { savedBytes: written.savedBytes, data: latest } }); assert.ok(result.ok);
    const restored = deserializePortableSave(readBrowserRecovery('previous')!.text); assert.ok(restored.ok);
    assert.deepEqual(restored.state, original); assert.deepEqual(restored.workspace, latest);
    assert.equal(restored.workspace!.blueprints.length, 2);
  });
});

test('stale receipts and invalid planning data abort before replacing either primary or previous backup', async () => {
  await inBrowser(storage => {
    const original = paidOpening(), saved = serializeState(original), earlier = serializeState(createInitialState());
    for (const live of [
      { savedBytes: saved + ' ', data: workspace() },
      { savedBytes: saved, data: { ...workspace(), blueprints: Array(13).fill(workspace().blueprints[0]) } },
      { savedBytes: saved, data: { ...workspace(), manual: { ...workspace().manual!, recipeId: 'x'.repeat(MAX_PORTABLE_SAVE_BYTES) } } },
    ]) {
      storage.setItem(PRIMARY, saved); storage.setItem(PREVIOUS, earlier);
      assert.equal(writeBrowserSnapshotWithBytes(createInitialState(), { replace: true, previousWorkspace: live }).ok, false);
      assert.equal(storage.getItem(PRIMARY), saved); assert.equal(storage.getItem(PREVIOUS), earlier);
    }
    storage.setItem(PRIMARY, '{corrupt original');
    assert.equal(writeBrowserSnapshotWithBytes(createInitialState(), { replace: true, previousWorkspace: { savedBytes: '{corrupt original', data: workspace() } }).ok, false);
    assert.equal(storage.getItem(PRIMARY), '{corrupt original'); assert.equal(storage.getItem(PREVIOUS), earlier);
  });
});

test('quota compression preserves a complete portable recovery and archive failure leaves both old saves untouched', async () => {
  await inBrowser(storage => {
    const original = paidOpening(), saved = serializeState(original), earlier = serializeState(createInitialState());
    storage.setItem(PRIMARY, saved); storage.setItem(PREVIOUS, earlier);
    storage.blocked.add(PREVIOUS);
    const options = { replace: true, previousWorkspace: { savedBytes: saved, data: workspace() } };
    assert.equal(writeBrowserSnapshotWithBytes(createInitialState(), options).ok, false);
    assert.equal(storage.getItem(PRIMARY), saved); assert.equal(storage.getItem(PREVIOUS), earlier);
    storage.blocked.delete(PREVIOUS); storage.requirePackedPrevious = true;
    assert.ok(writeBrowserSnapshotWithBytes(createInitialState(), options).ok);
    assert.ok(storage.getItem(PREVIOUS)!.startsWith(RECOVERY_ARCHIVE_PREFIX));
    const backup = readBrowserRecovery('previous')!, restored = deserializePortableSave(backup.text); assert.ok(restored.ok);
    assert.deepEqual(restored.state, original); assert.deepEqual(restored.workspace, workspace());
    assert.equal(decodeRecoveryArchive(storage.getItem(PREVIOUS)!), serializePortableSaveFromSnapshot(saved, workspace()));
  });
});

test('same-byte replacement still backs up planning data before a new workspace timeline clears it', async () => {
  await inBrowser(storage => {
    const original = paidOpening(), saved = serializeState(original);
    storage.setItem(PRIMARY, saved); storage.setItem(MODEL_WORKSPACE_KEY, sidecar(saved, original.playerCompanyId));
    assert.ok(writeBrowserSnapshotWithBytes(original, { replace: true }).ok);
    const restored = deserializePortableSave(readBrowserRecovery('previous')!.text); assert.ok(restored.ok);
    assert.deepEqual(restored.state, original); assert.deepEqual(restored.workspace, workspace());
  });
});

test('historical and corrupt engine-only recovery remain compatible and preserve original bytes', async () => {
  await inBrowser(storage => {
    const raw = readFileSync(join(__dirname, 'fixtures', 'connected-037-paid-published.json'), 'utf8');
    const old = deserializeState(raw); assert.ok(old.ok);
    storage.setItem(PRIMARY, raw); storage.setItem(MODEL_WORKSPACE_KEY, sidecar(raw, old.state.playerCompanyId));
    assert.ok(writeBrowserSnapshotWithBytes(createInitialState(), { replace: true }).ok);
    assert.equal(readBrowserRecovery('content037')?.text, raw);
    const backup = readBrowserRecovery('previous')!;
    assert.deepEqual(JSON.parse(backup.text).snapshot, JSON.parse(raw));
    const restored = deserializePortableSave(backup.text); assert.ok(restored.ok); assert.equal(restored.migratedFrom, 37);
    assert.deepEqual(restored.state, old.state); assert.deepEqual(restored.workspace, workspace());
    storage.setItem(PRIMARY, '{unreadable original\r\n');
    assert.ok(writeBrowserSnapshotWithBytes(createInitialState(), { replace: true }).ok);
    assert.equal(readBrowserRecovery('previous')?.text, '{unreadable original\r\n');
  });
});

test('recovery compression accepts portable-size text without relaxing its finite expansion bound', () => {
  const large = 'Portable recovery text\r\n'.repeat(100_000);
  assert.ok(large.length > 2_000_000 && large.length <= MAX_PORTABLE_SAVE_BYTES);
  assert.equal(decodeRecoveryArchive(encodeRecoveryArchive(large)), large);
  assert.throws(() => encodeRecoveryArchive('x'.repeat(MAX_PORTABLE_SAVE_BYTES + 1)), /too large to compress safely/);
});
