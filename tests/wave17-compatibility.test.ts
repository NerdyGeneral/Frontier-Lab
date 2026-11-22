import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState, MAX_SNAPSHOT_BYTES } from '../src/core/snapshot';
import { getComputeCostView } from '../src/modules/compute-costs';
import { batchPlacementAtWeek, batchTariffEstimateCents } from '../src/modules/batch-inference';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';

// Captured by the isolated, unchanged published Wave 16 source at 1ab56a80d450….
// The ordinary campaign exactly recreates its original active Week 537 save,
// then preserves a real queued capacity change, selected pool, and pause. The
// next sixteen complete states include three placements, fixed-deadline billing,
// ordinary calibration, paid pause/recovery, fresh reports, and a rental reduction.
const raw = readFileSync(join(__dirname, 'fixtures/wave16-snapshot.json'), 'utf8');
type Envelope = { format: string; checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave16-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceTree: string; sourceContent: string; schemaVersion: number;
  fixtureWeek: number; checksum: string; snapshotBytes: number; snapshotSha256: string;
  context: { productId: string; publicModelId: string; batchId: string; trainingId: string; candidateId: string; sourceContent: string; initialCostWeek: number };
  originalActiveCheckpoint: { week: number; checksum: string; bytes: number; matchesPublishedSnapshotExactly: boolean };
  creationCommands: RecordedCommand[]; commands: RecordedCommand[];
  originalProduct: GameState['slices']['products']['offers'][string];
  originalDeployment: GameState['slices']['products']['deployments'][string];
  originalPublicContract: GameState['slices']['products']['contracts'][string];
  originalPublicModel: GameState['slices']['models']['versions'][string];
  initialObservation: ReturnType<typeof capture>; weeks: ReturnType<typeof capture>[];
  finalWeek: number; finalChecksum: string; finalBytes: number;
};
const context = oracle.context;
const { productId, publicModelId, batchId, trainingId, candidateId } = context;
const envelope = () => JSON.parse(raw) as Envelope;
const olderEnvelope = (wave: number) => JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope;
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }
const loadHistorical = () => loadHistoricalSnapshot(raw);
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function normalizedHash(state: GameState) { return canonicalStateHash({ ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent }); }
function step(state: GameState) {
  const due = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
  const next = advanceWeek(state, historicalContent(state)); assert.ok(next.accepted, next.reason?.message);
  for (const command of due) assert.equal(next.state.commandReceipts[command.id]?.status, 'accepted', command.id);
  return next.state;
}
function queueScheduled(state: GameState) {
  for (const command of oracle.commands.filter(command => command.week === state.week)) {
    const queued = submitCommand(state, command.payload, historicalContent(state), command.id);
    assert.ok(queued.accepted, queued.reason?.message); state = queued.state;
  }
  return state;
}

function capture(state: GameState) {
  const products = state.slices.products, company = state.slices.company.companies[state.playerCompanyId];
  const product = products.offers[productId], fleet = state.slices.compute.fleets[state.playerCompanyId];
  const costs = getComputeCostView(state), latest = costs.latest!;
  const batch = products.batchJobs![batchId], training = state.slices.models.trainingRuns[trainingId];
  const candidate = state.slices.models.versions[candidateId];
  const publicInvoice = products.invoices.find(invoice => invoice.productId === productId && invoice.week === state.week);
  assert.ok(publicInvoice);
  assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
  assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
  assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
  assert.deepEqual(validateState(state, historicalContent(state)), []);
  return {
    week: state.week, hash: normalizedHash(state), cashCents: company.cashCents, arrearsCents: company.arrearsCents,
    trustBps: state.slices.markets.companyTrustBps[state.playerCompanyId],
    public: { productHash: canonicalStateHash(product), deploymentHash: canonicalStateHash(products.deployments[product.deploymentId]),
      contractHash: canonicalStateHash(products.contracts[product.contractId]), usage: structuredClone(products.lastUsage[productId]),
      invoice: structuredClone(publicInvoice), originalModelHash: canonicalStateHash(state.slices.models.versions[publicModelId]) },
    fleet: { cloudCU: fleet.cloudCU, ownedCU: fleet.ownedCU, allocation: structuredClone(fleet.allocation),
      resourceHash: canonicalStateHash(fleet.lastGrants) },
    batch: { id: batch.id, hash: canonicalStateHash(batch), status: batch.status, deadlineWeek: batch.deadlineWeek,
      terminalWeek: batch.terminalWeek, completedRequests: batch.completedRequests, completedWork: batch.completedWork,
      physicalWork: batch.physicalWork, currentPoolId: batchPlacementAtWeek(batch), placementHistory: structuredClone(batch.placementHistory),
      latestUsage: structuredClone(batch.usageHistory.at(-1)), workReceiptsHash: canonicalStateHash(batch.workReceipts),
      invoice: structuredClone(products.batchInvoices!.find(invoice => invoice.jobId === batch.id) ?? null),
      estimatedGpuCents: batchTariffEstimateCents(batch), admissionPosted: state.slices.company.postedFacts[batch.admission.publicInvoiceId] === true },
    training: training ? { id: training.id, hash: canonicalStateHash(training), status: training.status,
      completedWork: training.completedWork, physicalWork: training.physicalWork, requiredWork: training.requiredWork,
      planHash: canonicalStateHash(training.plan), planIdentity: training.plan?.identity, evidenceHash: canonicalStateHash(training.evidence),
      checkpointModelIds: training.checkpointModelIds } : null,
    candidate: candidate ? { id: candidate.id, hash: canonicalStateHash(candidate), status: candidate.status,
      capabilityBps: structuredClone(candidate.capabilityBps), reliabilityBps: candidate.reliabilityBps,
      behavior: structuredClone(candidate.behavior), policy: structuredClone(candidate.policy),
      rights: inheritedModelRights(state, candidate.id, CONTENT),
      reports: Object.values(state.slices.models.reports).filter(report => report.modelId === candidate.id).map(report => ({
        id: report.id, suiteId: report.suiteId, week: report.week, hash: canonicalStateHash(report) })) } : null,
    legacy: { feedbackHash: canonicalStateHash(state.slices.data.feedbackStudies), researchHash: canonicalStateHash(state.slices.research),
      runtimeHash: canonicalStateHash(products.runtimeGuardrails), assuranceHash: canonicalStateHash(products.assuranceContracts),
      oldBatchHash: canonicalStateHash(Object.values(products.batchJobs!).filter(job => job.id !== batchId)) },
    costs: { hash: canonicalStateHash(latest), totals: structuredClone(latest.totals), historyWeeks: costs.reports.map(report => report.week),
      initialWeekRetained: costs.reports.some(report => report.week === context.initialCostWeek),
      workloads: latest.workloads.filter(work => work.requestId.includes('wave16-')).map(work => ({ requestId: work.requestId,
        hash: canonicalStateHash(work), cloudRentCents: work.cloudRentCents, ownedVariableCents: work.ownedVariableCents })) },
    queuedHash: canonicalStateHash(state.queuedCommands), saveBytes: Buffer.byteLength(serializeState(state, historicalContent(state))),
  };
}

test('W17-S01: published Wave 16 import adds the announced market calendar and preserves real queued capacity, explicit placement, paid work and fixed delivery terms', () => {
  const previous = envelope(), result = load();
  assert.equal(oracle.sourceCommit, '1ab56a80d4501ba214eb778a2ab20a38a6dc5547');
  assert.equal(oracle.sourceTree, '26c9f4a267c3d5814b2f77d2d290381ab63b62e4');
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.17.0');
  assert.equal(previous.checksum, '97dad50f'); assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(oracle.checksum, previous.checksum); assert.equal(oracle.snapshotBytes, 1_457_252);
  assert.equal(Buffer.byteLength(raw), oracle.snapshotBytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), oracle.snapshotSha256);
  assert.equal(oracle.snapshotSha256, '9e7aa2e2a35b27289eb4c423cc8ce7cbfd3ef11d4e8bb481498808f1c9e30bf1');
  assert.equal(result.migratedFrom, 17); assert.equal(result.state.week, 537);
  const expected = { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } };
  assert.deepEqual(result.state, expected);
  assert.deepEqual(capture(result.state), { ...oracle.initialObservation, hash: normalizedHash(expected), saveBytes: Buffer.byteLength(serializeState(expected, historicalContent(expected))) });
  assert.deepEqual(result.state.slices.products.offers[productId], oracle.originalProduct);
  assert.deepEqual(result.state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
  assert.deepEqual(result.state.slices.products.contracts[oracle.originalProduct.contractId], oracle.originalPublicContract);
  assert.deepEqual(result.state.slices.models.versions[publicModelId], oracle.originalPublicModel);
  const queued = result.state.queuedCommands.filter(command => command.companyId === result.state.playerCompanyId);
  assert.deepEqual(queued.map(command => command.payload.kind), ['set_batch_capacity', 'set_batch_job_placement', 'set_batch_job_paused']);
  const batch = result.state.slices.products.batchJobs![batchId];
  assert.equal(batch.status, 'active'); assert.equal(batch.completedWork, 8_800_000_000); assert.equal(batch.deadlineWeek, 540);
  assert.equal(batchPlacementAtWeek(batch), 'owned:colocation:training');
  assert.equal(oracle.originalActiveCheckpoint.matchesPublishedSnapshotExactly, true);
  assert.equal(oracle.originalActiveCheckpoint.checksum, '0591ee14');
});

test('W17-S02: sixteen full states match published Wave 16 through owned/cloud/automatic placement, exact invoices, paid training pause, evaluations and rental changes', () => {
  let state = loadHistorical().state;
  assert.equal(oracle.weeks.length, 16); assert.equal(oracle.commands.length, 10);
  assert.equal(MAX_SNAPSHOT_BYTES, 2_000_000);
  let pausedProgress = 0;
  for (const expected of oracle.weeks) {
    const before = serializeState(state, historicalContent(state)), restored = deserializeState(before, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), before);
    const carry = restored.state.slices.products.contracts[oracle.originalProduct.contractId].tokenBillRemainder;
    state = step(queueScheduled(restored.state));
    assert.equal(normalizedHash(state), expected.hash, 'Published full state changed in Week ' + expected.week);
    assert.deepEqual(capture(state), expected, 'Published receipts changed in Week ' + expected.week);
    assert.equal(state.slices.products.lastUsage[productId].tokens!.billCarryIn, carry);
    assert.deepEqual(state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
    assert.deepEqual(state.slices.models.versions[publicModelId], oracle.originalPublicModel);
    assert.equal(state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
    if (state.week === 538) {
      assert.equal(state.slices.products.batchJobs![batchId].status, 'paused');
      assert.equal(batchPlacementAtWeek(state.slices.products.batchJobs![batchId]), 'general-cloud');
      assert.equal(state.slices.compute.fleets[state.playerCompanyId].cloudCU, 96_000_000_000);
    }
    if (state.week === 539) {
      pausedProgress = state.slices.models.trainingRuns[trainingId].completedWork;
      assert.ok(pausedProgress > 0 && pausedProgress < state.slices.models.trainingRuns[trainingId].requiredWork);
    }
    if (state.week === 540 || state.week === 541) {
      assert.equal(state.slices.models.trainingRuns[trainingId].status, 'paused');
      assert.equal(state.slices.models.trainingRuns[trainingId].completedWork, pausedProgress);
    }
    if (state.week === 542) assert.ok(state.slices.models.trainingRuns[trainingId].completedWork > pausedProgress);
    assert.equal(getComputeCostView(state).reports.some(report => report.week === context.initialCostWeek), state.week < 545);
  }
  const batch = state.slices.products.batchJobs![batchId], invoice = state.slices.products.batchInvoices!.find(item => item.jobId === batchId)!;
  assert.equal(batch.completedRequests, 40_000); assert.equal(batch.status, 'completed');
  assert.equal(batch.terminalWeek, 540); assert.equal(batch.deadlineWeek, 540);
  assert.deepEqual(batch.placementHistory!.map(item => item.poolId), ['owned:colocation:training', 'general-cloud', 'auto']);
  assert.equal(invoice.amountCents, 650_000); assert.equal(invoice.creditsCents, 0);
  assert.equal(state.slices.products.batchInvoices!.filter(item => item.jobId === batchId).length, 1);
  assert.equal(state.slices.company.postedFacts[batch.admission.publicInvoiceId], true);
  assert.equal(state.slices.models.trainingRuns[trainingId].requiredWork, 16_000_000_000);
  assert.equal(state.slices.models.trainingRuns[trainingId].physicalWork, 8_888_888_889);
  assert.equal(state.slices.models.versions[candidateId].behavior!.confidentErrorBps, 525);
  assert.equal(Object.values(state.slices.models.reports).filter(report => report.modelId === candidateId).length, 2);
  assert.equal(state.slices.compute.fleets[state.playerCompanyId].cloudCU, 80_000_000_000);
  assert.equal(state.slices.compute.fleets[state.playerCompanyId].allocation.development, 0);
  assert.equal(normalizedHash(state), '48f10a80'); assert.equal(Buffer.byteLength(serializeState(state, historicalContent(state))), 1_501_532);
  const saved = serializeState(state, historicalContent(state)), reloaded = deserializeState(saved, historicalContent(state)); assert.ok(reloaded.ok, reloaded.ok ? '' : reloaded.error);
  assert.equal(serializeState(reloaded.state, historicalContent(reloaded.state)), saved);
  const oldState = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
  const reimport = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: oracle.sourceContent,
    checksum: canonicalStateHash(oldState), state: oldState }));
  assert.ok(reimport.ok, reimport.ok ? '' : reimport.error); assert.equal(reimport.migratedFrom, 17); assert.deepEqual(reimport.state, upgradeHistoricalState(state));
});

test('W17-S03: checksum verification precedes migration and unsupported future headers leave their exact input intact', () => {
  const changed = envelope(); changed.state.slices.products.batchJobs![batchId].completedWork++;
  const text = JSON.stringify(changed), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(changed), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
  const future = envelope(); future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const futureText = encoded(future), rejected = deserializeState(futureText);
  assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(rejected.error, /not supported/);
  assert.equal(encoded(future), futureText);
});

test('W17-S04: all seventeen previous generations preserve authored rights, policy, paid training, replay and exact batch placements without adopting a new curriculum', () => {
  for (let wave = 0; wave <= 16; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1);
    assert.deepEqual(validateState(result.state, CONTENT), []);
    for (const packet of Object.values(previous.state.slices.data.packets)) assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    for (const model of Object.values(previous.state.slices.models.versions)) if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    for (const key of ['runtimeGuardrails', 'assuranceContracts', 'assuranceInvoices', 'batchSchedulers', 'batchJobs', 'batchInvoices'] as const) {
      assert.deepEqual(result.state.slices.products[key], previous.state.slices.products[key]);
    }
    for (const run of Object.values(previous.state.slices.models.trainingRuns ?? {})) {
      assert.deepEqual(result.state.slices.models.trainingRuns[run.id], run);
      if (run.plan) assert.equal(Object.hasOwn(result.state.slices.models.trainingRuns[run.id].plan!, 'curriculum'), false);
    }
  }
});

class MemoryStorage {
  readonly values = new Map<string, string>();
  failKey: string | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (key === this.failKey) throw new Error('Simulated unavailable local storage'); this.values.set(key, value); }
}
function installStorage(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window'), storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
  return storage;
}
const saveKey = 'frontier-lab.wave0.snapshot', archiveKey = 'frontier-lab.wave16.original';

test('W17-S05: browser migration archives the exact Wave 16 source bytes before replacement and leaves earlier originals untouched', t => {
  const storage = installStorage(t), originalText = '\n' + raw + '\n';
  storage.values.set(saveKey, originalText);
  const loaded = readBrowserSnapshot(); assert.equal(loaded.kind, 'loaded');
  if (loaded.kind !== 'loaded') return;
  assert.equal(loaded.migratedFrom, 17); assert.equal(storage.values.size, 1);
  assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
  assert.equal(storage.values.get(archiveKey), originalText);
  assert.equal(storage.values.get(saveKey), serializeState(loaded.state, historicalContent(loaded.state)));
  assert.ok(browserRecoveryOptions().some(option => option.kind === 'wave16'));
  assert.deepEqual(readBrowserRecovery('wave16'), { text: originalText, filename: 'frontier-lab-wave16-original.json' });
  storage.values.set(archiveKey, 'an earlier untouched original'); storage.values.set(saveKey, originalText);
  assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
  assert.equal(storage.values.get(archiveKey), 'an earlier untouched original');
});

test('W17-S06: archive or primary write failures preserve the usable old save and its raw recovery export', t => {
  const storage = installStorage(t), migrated = load().state;
  for (const failingKey of [archiveKey, saveKey]) {
    storage.values.clear(); storage.values.set(saveKey, raw); storage.failKey = failingKey;
    assert.equal(writeBrowserSnapshot(migrated).ok, false);
    assert.equal(storage.values.get(saveKey), raw);
    assert.equal(storage.values.get(archiveKey), failingKey === archiveKey ? undefined : raw);
    assert.equal(readBrowserRecovery('stored')?.text, raw);
    assert.equal(readBrowserSnapshot().kind, 'loaded');
  }
});

test('W17-S07: every older header rejects queued curriculum selection, including empty, null and false forms', () => {
  const values = [null, false, [], {}, { shareBps: 5000, tracks: [
    { domain: 'coding', packetIds: ['curated-natural-business-command-54'] },
    { domain: 'documents', packetIds: ['curated-natural-business-command-111'] },
  ] }];
  for (let wave = 0; wave <= 16; wave++) for (const curriculum of values) {
    const previous = olderEnvelope(wave);
    const payload = { kind: 'start_training', baseModelId: publicModelId, packetId: 'starter-public', curriculum };
    previous.state.queuedCommands = [{ id: 'old-header-curriculum-command', companyId: previous.state.playerCompanyId,
      issuedForWeek: previous.state.week + 1, reservedCents: 0, payload: payload as CommandPayload }];
    const rejected = deserializeState(encoded(previous));
    assert.equal(rejected.ok, false, `Wave ${wave} accepted curriculum ${JSON.stringify(curriculum)}.`);
    // Shape validation can reject malformed values before the feature gate.
    // S09 separately verifies the gate for an otherwise valid adopted record.
  }
});

test('W17-S08: retained curriculum-shaped plan evidence cannot hide under any older build with paid training', () => {
  // Wave 0 predates TrainingRun records, and the Wave 3/4 fixtures contain none.
  // Their queued-option guards are covered above; use actual paid records here.
  let paidFixtures = 0;
  for (let wave = 1; wave <= 16; wave++) {
    const source = olderEnvelope(wave);
    if (!Object.keys(source.state.slices.models.trainingRuns ?? {}).length) continue;
    paidFixtures++;
    for (const curriculum of [null, false, [], {}]) {
      const previous = olderEnvelope(wave);
      const run = Object.values(previous.state.slices.models.trainingRuns)[0];
      assert.ok(run, 'The published fixture has paid training evidence.');
      const plan = run.plan ?? {};
      Object.assign(run, { plan: { ...plan, curriculum } });
      const rejected = deserializeState(encoded(previous));
      assert.equal(rejected.ok, false, `Wave ${wave} accepted a new retained curriculum field.`);
    }
  }
  assert.equal(paidFixtures, 14);
});

test('W17-S09: an otherwise valid adopted two-skill curriculum cannot be relabeled as the previous published build', () => {
  const state = loadHistoricalSnapshot(raw, '0.18.0').state;
  const accepted = submitCommand(state, {
    kind: 'start_training', baseModelId: 'model-wave15-natural-command-9', packetId: 'deduplicated-command-1538',
    recipeId: 'compact-conversation-adaptation', profile: 'stable', curriculum: { shareBps: 7500, tracks: [
      { domain: 'coding', packetIds: ['curated-natural-business-command-54'] },
      { domain: 'documents', packetIds: ['curated-natural-business-command-111'] },
    ] },
  }, historicalContent(state), 'wave17-compat-adoption');
  assert.ok(accepted.accepted, accepted.reason?.message);
  const advanced = step(accepted.state), run = advanced.slices.models.trainingRuns['training-wave17-compat-adoption'];
  assert.ok(run.plan?.curriculum); assert.equal(run.plan.curriculum.tracks.length, 2);
  assert.deepEqual(validateState(advanced, historicalContent(advanced)), []);
  assert.equal(deserializeState(serializeState(advanced, historicalContent(advanced))).ok, true);
  const forged = JSON.parse(serializeState(advanced, historicalContent(advanced))) as Envelope;
  forged.contentVersion = '0.17.0'; forged.state.contentVersion = '0.17.0'; forged.state.buildVersion = '0.17.0';
  const rejected = deserializeState(encoded(forged)); assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /The Wave 16 save contains methods or receipts that were unavailable in that build/);
});
