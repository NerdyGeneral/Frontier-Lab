import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CONTENT } from '../src/content/catalog';
import { createInitialState, advanceWeek, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { containsConnectedCompanyFeatures } from '../src/core/connected-company-version';
import { deserializePortableSave, serializePortableSave } from '../src/persistence/portable-save';
import type { ModelWorkspaceData } from '../src/persistence/model-workspace';
import type { GameState } from '../src/contracts/types';
import { readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes, readBrowserRecovery } from '../src/persistence/wave0-browser';

const workspace: ModelWorkspaceData = { manual: null, delegated: null,
  developmentGoal: { kind: 'purpose', id: 'coding' },
  blueprints: [{ id: 'coding-blueprint', name: 'Coding starter', suiteId: 'basic-conversation-1',
    objective: { kind: 'purpose', id: 'coding' },
    training: { kind: 'start_training', baseModelId: 'seed-0', packetId: CONTENT.starterData.id, recipeId: 'compact-conversation-adaptation', profile: 'stable' } }],
};

test('portable export restores exact game, objectives and blueprints without authorizing work', () => {
  const game = createInitialState(CONTENT, 'release');
  const raw = serializePortableSave(game, workspace);
  const restored = deserializePortableSave(raw);
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.deepEqual(restored.state, game);
  assert.deepEqual(restored.workspace, workspace);
  assert.equal(restored.state.queuedCommands.length, 0);
  restored.workspace!.blueprints[0].name = 'Independent copy';
  assert.equal(workspace.blueprints[0].name, 'Coding starter');
  const legacy = deserializePortableSave(serializeState(game));
  assert.ok(legacy.ok); assert.equal(legacy.workspace, undefined);
});

test('portable import rejects changed checksums, extra workspace authority, and invalid drafts', () => {
  const game = createInitialState(CONTENT, 'release');
  const clean = JSON.parse(serializePortableSave(game, workspace));
  const changed = structuredClone(clean); changed.workspace.blueprints[0].name = 'Tampered';
  assert.equal(deserializePortableSave(JSON.stringify(changed)).ok, false);
  for (const mutation of [
    (value: any) => { value.workspace.queuedCommands = [{ kind: 'start_training' }]; },
    (value: any) => { value.workspace.blueprints[0].training.profile = 'free'; },
    (value: any) => { value.workspace.blueprints.push(...Array(13).fill(value.workspace.blueprints[0])); },
  ]) {
    const bad = structuredClone(clean); mutation(bad);
    bad.checksum = canonicalStateHash({ snapshot: bad.snapshot, workspace: bad.workspace });
    assert.equal(deserializePortableSave(JSON.stringify(bad)).ok, false);
  }
});

// Captured by the paid 0.37 release scenario before this implementation. Gzip
// wraps the exact original bytes; no records were synthesized with new rules.
const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const raw037 = readFileSync(join(directory, 'connected-037-paid-published.json'), 'utf8');
const compressed = JSON.parse(raw037);
const originalEnvelope = JSON.parse(gunzipSync(Buffer.from(compressed.payload, 'base64')).toString());
const original: GameState = originalEnvelope.state;

test('authentic 0.37 paid campaign upgrades by metadata only and stays deterministic after reload', () => {
  assert.equal(original.contentVersion, '0.37.0');
  assert.equal(originalEnvelope.checksum, canonicalStateHash(original));
  const restored = deserializeState(raw037); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.equal(restored.migratedFrom, 37);
  assert.deepEqual(restored.state, { ...original, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion });
  assert.equal(containsConnectedCompanyFeatures(restored.state), false);
  const second = deserializeState(serializeState(restored.state)); assert.ok(second.ok);
  const next = advanceWeek(restored.state), replay = advanceWeek(second.state);
  assert.ok(next.accepted, next.reason?.message); assert.ok(replay.accepted, replay.reason?.message);
  assert.deepEqual(next.state, replay.state);
  assert.deepEqual(validateState(next.state), []);
  assert.deepEqual(next.state.slices.models.versions, original.slices.models.versions);
});

test('new company records cannot enter through a historical content header', () => {
  const mutations: Array<(game: GameState) => void> = [
    game => { game.slices.models.developmentPlanArchive = {}; },
    game => { game.slices.campaign.progression = createInitialState(CONTENT, 'release').slices.campaign.progression; },
    game => { const offer = Object.values(game.slices.products.offers)[0]; offer.retiredWeek = game.week; },
    game => { game.queuedCommands.push({ id: 'future-experiment', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
      payload: { kind: 'start_research_experiment', programId: 'efficient-systems', modelId: 'seed-0' } }); },
  ];
  for (const mutate of mutations) {
    const game = structuredClone(original); mutate(game);
    assert.equal(containsConnectedCompanyFeatures(game), true);
    const text = JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: '0.37.0', checksum: canonicalStateHash(game), state: game });
    assert.equal(deserializeState(text).ok, false);
  }
});

test('first upgraded browser write archives the exact 0.37 bytes before replacing the primary', t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>([['frontier-lab.wave0.snapshot', raw037]]);
  const localStorage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
  t.after(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });
  const loaded = readBrowserSnapshotWithBytes();
  assert.equal(loaded.kind, 'loaded'); if (loaded.kind !== 'loaded') return;
  assert.equal(loaded.migratedFrom, 37);
  const written = writeBrowserSnapshotWithBytes(loaded.state); assert.ok(written.ok, written.ok ? undefined : written.error);
  assert.equal(readBrowserRecovery('content037')?.text, raw037);
  assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded');
});
