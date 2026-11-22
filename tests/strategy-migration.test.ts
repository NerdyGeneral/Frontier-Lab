import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, validateState } from '../src/core/engine';
import { migrateModelDevelopmentState } from '../src/core/migration';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { containsStrategyFeatures } from '../src/core/strategy-version';
import { getMarketOpportunityView, marketOpportunityDemandMultiplierBps } from '../src/modules/market-opportunities';
import { createRivalCampaign } from '../src/modules/rivals';
import { RECOVERY_ARCHIVE_PREFIX } from '../src/persistence/recovery-codec';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes } from '../src/persistence/wave0-browser';

// Archived by the untouched published 0.33.1 engine, using real commands and ticks.
// University start -> buy/prepare reasoning data -> paid architecture research ->
// complete a four-CUw custom reasoning model -> start a 96-CUw continuation ->
// queue its parent's independent evaluation and a document-data purchase.
// These are not current states relabelled with a historical content header.
const fixtureRoot = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
const initialRaw = readFileSync(join(fixtureRoot, 'strategy-033-initial-published.json'), 'utf8');
const activeRaw = readFileSync(join(fixtureRoot, 'strategy-033-active-published.json'), 'utf8');
const oldContent = { ...CONTENT, version: '0.33.0', buildVersion: '0.33.1' };
const primary = 'frontier-lab.wave0.snapshot', backup = 'frontier-lab.content033.original';
const oldState = (raw = activeRaw): GameState => JSON.parse(raw).state;
const encoded = (state: GameState) => JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
  contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state });
function loaded(raw = activeRaw): GameState {
  const result = deserializeState(raw); assert.ok(result.ok, result.ok ? undefined : result.error); return result.state;
}

class MemoryStorage implements Storage {
  values = new Map<string, string>(); writes: string[] = []; attempts: string[] = [];
  failKey: string | null = null; quotaRawArchive = false; quotaEveryArchive = false;
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.attempts.push(key);
    if (key === this.failKey) throw new Error('Storage write failed');
    if (key === backup && (this.quotaEveryArchive || this.quotaRawArchive && !value.startsWith(RECOVERY_ARCHIVE_PREFIX))) throw new DOMException('Quota', 'QuotaExceededError');
    this.values.set(key, value); this.writes.push(key);
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
function inBrowser(storage: MemoryStorage, action: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  try { action(); } finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('authentic published 0.33 saves migrate by changing only version metadata and adding a calendar at the saved week', () => {
  for (const [raw, checksum, week] of [[initialRaw, '9e6e854a', 0], [activeRaw, 'e6849aa3', 6]] as const) {
    const envelope = JSON.parse(raw), original = envelope.state as GameState, before = structuredClone(original);
    assert.equal(envelope.contentVersion, '0.33.0'); assert.equal(original.buildVersion, '0.33.1'); assert.equal(original.schemaVersion, 5);
    assert.equal(envelope.checksum, checksum); assert.equal(canonicalStateHash(original), checksum); assert.equal(original.week, week);
    assert.deepEqual(validateState(original, oldContent), []);
    const result = deserializeState(raw); assert.ok(result.ok, result.ok ? undefined : result.error); assert.equal(result.migratedFrom, 33);
    assert.equal(result.state.contentVersion, CONTENT.version);
    const expected = structuredClone(original); expected.contentVersion = CONTENT.version; expected.buildVersion = CONTENT.buildVersion;
    expected.slices.markets.opportunityCalendar = { startedWeek: week, sequenceVersion: 2 };
    assert.deepEqual(result.state, expected, 'Cash, time, identifiers, queues, paid evidence, contracts and random streams must remain intact.');
    assert.deepEqual(original, before);
    const direct = migrateModelDevelopmentState(original, CONTENT); assert.ok(direct.ok, direct.ok ? undefined : direct.error); assert.deepEqual(direct.state, expected);
    assert.equal(getMarketOpportunityView(result.state).upcoming?.startsWeek, week + 6);
    assert.equal(marketOpportunityDemandMultiplierBps(result.state, 'regular'), 10000);
    assert.equal(result.state.slices.models.developmentPlans, undefined);
    assert.equal(result.state.slices.campaign.chapters, undefined);
    assert.ok(Object.values(result.state.slices.markets.rivals).every(rival => rival.campaign === undefined));
    assert.deepEqual(validateState(result.state), []);
  }
});

test('migration preserves the completed seven-skill model, active frozen training, paid architecture progress and queued orders', () => {
  const original = oldState(), migrated = loaded();
  const finished = original.slices.models.versions['model-archive-completed-model'];
  const runId = 'training-archive-active-model', projectId = 'model-research-archive-architecture';
  assert.ok(finished.advancedCapabilities!.reasoning > 0); assert.ok(finished.modelDesign);
  assert.equal(original.slices.models.trainingRuns[runId].completedWork, 3_000_000_000);
  assert.equal(original.slices.research.modelResearch![projectId].completedWork, 5_000_000_000);
  assert.equal(original.slices.research.modelResearch![projectId].focus, undefined);
  assert.deepEqual(migrated.slices.models, original.slices.models);
  assert.deepEqual(migrated.slices.research, original.slices.research);
  assert.deepEqual(migrated.queuedCommands, original.queuedCommands);
  const restored = deserializeState(serializeState(migrated)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.equal(restored.migratedFrom, undefined); assert.deepEqual(restored.state, migrated);
  const advanced = advanceWeek(migrated), replayed = advanceWeek(restored.state);
  assert.ok(advanced.accepted, advanced.reason?.message); assert.ok(replayed.accepted, replayed.reason?.message);
  assert.equal(serializeState(advanced.state), serializeState(replayed.state));
  assert.equal(advanced.state.week, original.week + 1);
  assert.deepEqual(advanced.state.slices.models.versions[finished.id], finished);
  assert.deepEqual(advanced.state.slices.models.trainingRuns[runId].plan, original.slices.models.trainingRuns[runId].plan);
  for (const id of ['archive-pending-evaluation', 'archive-pending-data']) assert.equal(advanced.state.commandReceipts[id]?.status, 'accepted');
  assert.equal(advanced.state.slices.research.modelResearch![projectId].focus, undefined, 'An old paid iteration must not acquire a new focus on upgrade.');
});

test('old save headers cannot import new plans, product strategies, rival campaigns, research focus or challenge evidence', () => {
  const mutations: Array<[string, (game: GameState) => void]> = [
    ['development plans', game => { game.slices.models.developmentPlans = {}; }],
    ['calendar', game => { game.slices.markets.opportunityCalendar = { startedWeek: game.week }; }],
    ['chapters', game => { Object.assign(game.slices.campaign, { chapters: {} }); }],
    ['product strategy', game => { game.slices.products.offers['rival-swift-product'].strategy = { audience: 'value', routingPolicy: 'balanced', updatedWeek: 0, commandId: 'invented-strategy' }; }],
    ['rival campaign', game => { const rival = game.slices.markets.rivals['rival-swift']; rival.campaign = createRivalCampaign(game, rival, CONTENT); }],
    ['routing protocol', game => { Object.assign(game.slices.products, { routingProtocol: 2 }); }],
    ['research focus command', game => { game.queuedCommands.push({ id: 'future-focus', companyId: game.playerCompanyId, issuedForWeek: game.week + 1, payload: { kind: 'start_model_research', focus: 'efficiency' } }); }],
    ['paid focus receipt', game => { const project = game.slices.research.modelResearch!['model-research-archive-architecture']; project.focus = 'efficiency'; project.focusFactId = project.id + ':focus:efficiency'; game.slices.company.postedFacts[project.focusFactId] = true; }],
    ['frozen focus bonus', game => { Object.assign(game.slices.models.trainingRuns['training-archive-active-model'].plan!.modelDesign!, { researchFocus: { counts: { balanced: 0, capability: 0, efficiency: 1, reliability: 0 }, capacityBonusBps: 0, efficiencyBonusBps: 100, reliabilityBonusBps: 0 } }); }],
    ['challenge suite', game => { game.queuedCommands.find(command => command.id === 'archive-pending-evaluation')!.payload = { kind: 'evaluate_model', modelId: 'model-archive-completed-model', suiteId: 'challenge-applied-1' }; }],
    ['plan command', game => { Object.assign(game.queuedCommands[0].payload, { kind: 'cancel_development_plan', planId: 'future-plan' }); }],
    ['strategy command', game => { game.queuedCommands[0].payload = { kind: 'set_product_strategy', productId: 'rival-swift-product', audience: 'value', routingPolicy: 'balanced' }; }],
    ['chapter command', game => { game.queuedCommands[0].payload = { kind: 'select_chapter', chapterId: 'first-product' }; }],
  ];
  for (const [name, mutate] of mutations) {
    const forged = oldState(); mutate(forged);
    const result = deserializeState(encoded(forged)); assert.equal(result.ok, false, name);
    if (!result.ok) assert.match(result.error, /historical save version/, name + ' should fail before migration can normalize its fields.');
    assert.equal(migrateModelDevelopmentState(forged, CONTENT).ok, false, name);
    assert.ok(validateState(forged, oldContent).length > 0, name);
  }
});

test('historical release and runtime captures reject new routing policies and 20/80 percent shares before migration', () => {
  // An authentic published snapshot supplies real frozen captures, unlike the
  // small 0.33 archives, whose lab has not yet earned runtime audits.
  const raw = readFileSync(join(fixtureRoot, 'wave13-snapshot.json'), 'utf8');
  const original = JSON.parse(raw).state as GameState;
  const baseline = deserializeState(raw); assert.ok(baseline.ok, baseline.ok ? undefined : baseline.error);
  assert.equal(containsStrategyFeatures(original), false);
  for (const historicalShare of [0, 6000]) assert.equal(containsStrategyFeatures({ binding: { secondaryShareBps: historicalShare } }), false);
  assert.ok(Object.keys(original.slices.products.releaseRehearsals ?? {}).length > 0);
  assert.ok(Object.keys(original.slices.products.runtimeGuardrails ?? {}).length > 0);
  for (const policy of ['balanced', 'economy', 'quality'] as const) {
    const forged = structuredClone(original);
    Object.values(forged.slices.products.releaseRehearsals!)[0].configuration.routingPolicy = policy;
    assert.equal(containsStrategyFeatures(forged), true);
    const result = deserializeState(encoded(forged)); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /historical save version/);
  }
  for (const secondaryShareBps of [2000, 8000]) {
    const forged = structuredClone(original);
    Object.values(forged.slices.products.runtimeGuardrails!)[0].binding.secondaryShareBps = secondaryShareBps;
    assert.equal(containsStrategyFeatures(forged), true);
    const result = deserializeState(encoded(forged)); assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /historical save version/);
  }
});

test('the first upgraded browser write archives exact original 0.33 bytes before overwriting the primary', () => {
  const original = activeRaw.replace(/\n/g, '\r\n') + '\t\n';
  for (const readFirst of [false, true]) {
    const storage = new MemoryStorage(); storage.values.set(primary, original);
    inBrowser(storage, () => {
      let state = loaded(original);
      if (readFirst) {
        const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded'); if (read.kind !== 'loaded') return;
        assert.equal(read.migratedFrom, 33); assert.equal(read.savedBytes, original); state = read.state;
      }
      assert.deepEqual(storage.writes, []);
      const result = writeBrowserSnapshotWithBytes(state); assert.equal(result.ok, true);
      assert.deepEqual(storage.writes, [backup, primary]);
      assert.deepEqual(readBrowserRecovery('content033'), { text: original, filename: 'frontier-lab-content033-original.json' });
      assert.ok(browserRecoveryOptions().some(option => option.kind === 'content033'));
      assert.equal(JSON.parse(storage.getItem(primary)!).contentVersion, CONTENT.version);
      storage.writes.length = 0;
      assert.equal(writeBrowserSnapshotWithBytes(state).ok, true);
      assert.deepEqual(storage.writes, [primary], 'Later saves must not overwrite the original archive.');
      assert.equal(readBrowserRecovery('content033')!.text, original);
    });
  }
});

test('an archive failure prevents the first upgraded primary write, and a primary failure leaves the archive recoverable', () => {
  for (const failKey of [backup, primary]) {
    const storage = new MemoryStorage(); storage.values.set(primary, activeRaw); storage.failKey = failKey;
    inBrowser(storage, () => {
      const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded'); if (read.kind !== 'loaded') return;
      assert.equal(writeBrowserSnapshotWithBytes(read.state).ok, false);
      assert.equal(storage.getItem(primary), activeRaw);
      if (failKey === backup) { assert.deepEqual(storage.writes, []); assert.deepEqual(storage.attempts, [backup]); }
      else { assert.deepEqual(storage.writes, [backup]); assert.equal(readBrowserRecovery('content033')!.text, activeRaw); }
      storage.failKey = null;
      assert.equal(writeBrowserSnapshotWithBytes(read.state).ok, true, 'A failed write must not poison the cached primary metadata.');
      assert.equal(readBrowserRecovery('content033')!.text, activeRaw);
    });
  }
});

test('quota compression preserves the exact published snapshot and complete quota failure leaves the original untouched', () => {
  for (const failBoth of [false, true]) {
    const storage = new MemoryStorage(); storage.values.set(primary, activeRaw); storage.quotaRawArchive = true; storage.quotaEveryArchive = failBoth;
    inBrowser(storage, () => {
      const result = writeBrowserSnapshotWithBytes(loaded());
      if (failBoth) {
        assert.equal(result.ok, false); assert.equal(storage.getItem(primary), activeRaw);
        assert.deepEqual(storage.writes, []); assert.deepEqual(storage.attempts, [backup, backup]);
      } else {
        assert.equal(result.ok, true); assert.ok(storage.getItem(backup)!.startsWith(RECOVERY_ARCHIVE_PREFIX));
        assert.deepEqual(storage.attempts, [backup, backup, primary]);
        assert.equal(readBrowserRecovery('content033')!.text, activeRaw);
      }
    });
  }
});

test('backup decisions revalidate changed primary bytes instead of trusting an earlier read', () => {
  const storage = new MemoryStorage(); storage.values.set(primary, initialRaw);
  inBrowser(storage, () => {
    const read = readBrowserSnapshotWithBytes(); assert.equal(read.kind, 'loaded');
    storage.values.set(primary, activeRaw);
    assert.equal(writeBrowserSnapshotWithBytes(loaded()).ok, true);
    assert.equal(readBrowserRecovery('content033')!.text, activeRaw, 'Archive the exact primary present at replacement time.');
  });
  const invalid = new MemoryStorage(); invalid.values.set(primary, activeRaw);
  inBrowser(invalid, () => {
    assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded');
    const changed = activeRaw + 'not JSON'; invalid.values.set(primary, changed);
    assert.equal(writeBrowserSnapshotWithBytes(loaded()).ok, false);
    assert.equal(invalid.getItem(primary), changed); assert.deepEqual(invalid.writes, []);
  });
});
