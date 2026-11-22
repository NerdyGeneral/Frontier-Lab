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
import { batchModelEligible, batchTariffEstimateCents } from '../src/modules/batch-inference';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { browserRecoveryOptions, readBrowserRecovery, readBrowserSnapshot, writeBrowserSnapshot } from '../src/persistence/wave0-browser';

// Captured by the isolated, unmodified published Wave 15 engine at 3132248a7e11….
// Eight original campaign checkpoints matched byte-for-byte. The authentic
// Week 511 fixture is paused midway through paid 50% replay, after a finished
// 25% candidate. Thirteen original commands continue through three finite jobs.
const raw = readFileSync(join(__dirname, 'fixtures/wave15-snapshot.json'), 'utf8');
type Envelope = { format: string; checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
type ObservationContext = { productId: string; publicModelId: string; sourceContent: string; initialCostWeek: number; candidateIds: string[] };
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave15-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceTree: string; sourceContent: string; schemaVersion: number;
  fixtureWeek: number; checksum: string; snapshotBytes: number; snapshotSha256: string; context: ObservationContext;
  creationCommands: RecordedCommand[]; commands: RecordedCommand[];
  originalProduct: GameState['slices']['products']['offers'][string];
  originalDeployment: GameState['slices']['products']['deployments'][string];
  originalPublicContract: GameState['slices']['products']['contracts'][string];
  originalPublicModel: GameState['slices']['models']['versions'][string];
  naturalProgression: { sourceWeek: number; sourceHash: string; finalWeek: number; finalHash: string; finalBytes: number; commands: RecordedCommand[] };
  checkpoints: { week: number; file: string; hash: string; bytes: number; sha256: string }[];
  initialObservation: unknown; weeks: unknown[];
};
const context: ObservationContext = oracle.context;
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

function capture(at: GameState) {
  const products = at.slices.products, company = at.slices.company.companies[at.playerCompanyId];
  const costs = getComputeCostView(at), latest = costs.latest!;
  const saved = serializeState(at, historicalContent(at)), exported = JSON.parse(saved), pretty = JSON.stringify(exported, null, 2), compact = JSON.stringify(exported);
  assert.ok(Buffer.byteLength(saved) <= MAX_SNAPSHOT_BYTES);
  const publicInvoices = products.invoices.filter(invoice => invoice.productId === context.productId && invoice.week === at.week);
  assert.equal(publicInvoices.length, 1);
  assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
  assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
  assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
  const product = products.offers[context.productId];
  const training = Object.values(at.slices.models.trainingRuns).filter(run => run.id.startsWith('training-wave15-natural-'));
  const batchJobs = Object.values(products.batchJobs!).filter(job => job.id.startsWith('batch:wave15-natural-'));
  return {
    week: at.week, hash: canonicalStateHash({ ...at, contentVersion: context.sourceContent, buildVersion: context.sourceContent }),
    cashCents: company.cashCents, arrearsCents: company.arrearsCents, trustBps: at.slices.markets.companyTrustBps[at.playerCompanyId],
    public: { productHash: canonicalStateHash(product), deploymentHash: canonicalStateHash(products.deployments[product.deploymentId]),
      contractHash: canonicalStateHash(products.contracts[product.contractId]), usage: structuredClone(products.lastUsage[context.productId]),
      invoice: structuredClone(publicInvoices[0]), originalModelHash: canonicalStateHash(at.slices.models.versions[context.publicModelId]) },
    researchHash: canonicalStateHash(at.slices.research),
    training: training.map(run => ({ id: run.id, hash: canonicalStateHash(run), status: run.status, completedWork: run.completedWork,
      physicalWork: run.physicalWork, requiredWork: run.requiredWork, outputModelId: run.outputModelId,
      planHash: canonicalStateHash(run.plan), evidenceHash: canonicalStateHash(run.evidence),
      replayShareBps: run.plan?.replay?.shareBps ?? null, replayFloorBps: run.plan?.replay?.preservationFloorBps ?? null })),
    candidates: context.candidateIds.flatMap(id => {
      const model = at.slices.models.versions[id]; if (!model) return [];
      return [{ id, hash: canonicalStateHash(model), status: model.status, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
        rights: inheritedModelRights(at, id, CONTENT), codeEligible: batchModelEligible(at, id, 'code-index'), digestEligible: batchModelEligible(at, id, 'longform-digest'),
        reports: Object.values(at.slices.models.reports).filter(report => report.modelId === id).map(report => ({ id: report.id, week: report.week, hash: canonicalStateHash(report) })) }];
    }),
    batchJobs: batchJobs.map(job => ({ id: job.id, hash: canonicalStateHash(job), orderId: job.orderId, status: job.status,
      completedRequests: job.completedRequests, completedWork: job.completedWork, physicalWork: job.physicalWork, deadlineWeek: job.deadlineWeek,
      latestPool: job.latestGrant?.poolId ?? null, workReceiptsHash: canonicalStateHash(job.workReceipts), usageHash: canonicalStateHash(job.usageHistory),
      estimatedGpuCents: batchTariffEstimateCents(job), invoiceId: job.invoiceId,
      invoicePosted: job.invoiceId ? at.slices.company.postedFacts[job.invoiceId] === true : null,
      admissionPosted: at.slices.company.postedFacts[job.admission.publicInvoiceId] === true,
      admissionInPublicHistory: products.invoices.some(invoice => invoice.id === job.admission.publicInvoiceId) })),
    batchInvoices: products.batchInvoices!.filter(invoice => batchJobs.some(job => job.id === invoice.jobId)).map(invoice => structuredClone(invoice)),
    legacy: { feedbackHash: canonicalStateHash(at.slices.data.feedbackStudies), guardrailsHash: canonicalStateHash(products.runtimeGuardrails),
      rehearsalsHash: canonicalStateHash(products.releaseRehearsals), releasesHash: canonicalStateHash(products.preparedReleases),
      assuranceHash: canonicalStateHash(products.assuranceContracts), assuranceInvoicesHash: canonicalStateHash(products.assuranceInvoices),
      oldBatchJobsHash: canonicalStateHash(Object.values(products.batchJobs!).filter(job => !job.id.startsWith('batch:wave15-natural-'))) },
    costs: { hash: canonicalStateHash(latest), totals: structuredClone(latest.totals), historyWeeks: costs.reports.map(report => report.week),
      initialWeekRetained: costs.reports.some(report => report.week === context.initialCostWeek),
      workloadHashes: latest.workloads.filter(work => work.requestId.includes('wave15-natural-')).map(work => ({ requestId: work.requestId, hash: canonicalStateHash(work) })) },
    save: { prettyBytes: Buffer.byteLength(pretty), compactBytes: Buffer.byteLength(compact), savedBytes: Buffer.byteLength(saved), compacted: saved === compact },
  };
}

const expectedWeeks = oracle.weeks as ReturnType<typeof capture>[];

test('W16-S01: published Wave 15 import adds the announced market calendar and preserves paused paid replay, candidates, rights and batch receipts', () => {
  const previous = envelope(), result = load();
  assert.equal(oracle.sourceCommit, '3132248a7e1142a1783d9d352a9bdc889a16c92f');
  assert.equal(oracle.sourceTree, '701d3995ab33b619811c4cb76d6ae1f3e5e1575c');
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.16.0');
  assert.equal(previous.checksum, '4138abaa'); assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(oracle.checksum, previous.checksum); assert.equal(oracle.snapshotBytes, 1_326_250);
  assert.equal(Buffer.byteLength(raw), oracle.snapshotBytes);
  assert.equal(createHash('sha256').update(raw).digest('hex'), oracle.snapshotSha256);
  assert.equal(result.migratedFrom, 16); assert.equal(result.state.week, 511);
  const expected = { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } };
  assert.deepEqual(result.state, expected);
  assert.deepEqual(validateState(result.state, CONTENT), []);
  const expectedSaved = serializeState(expected, historicalContent(expected)), expectedEnvelope = JSON.parse(expectedSaved);
  assert.deepEqual(capture(result.state), { ...(oracle.initialObservation as ReturnType<typeof capture>),
    hash: canonicalStateHash({ ...expected, contentVersion: context.sourceContent, buildVersion: context.sourceContent }),
    save: { prettyBytes: Buffer.byteLength(JSON.stringify(expectedEnvelope, null, 2)), compactBytes: Buffer.byteLength(JSON.stringify(expectedEnvelope)),
      savedBytes: Buffer.byteLength(expectedSaved), compacted: true },
  });
  assert.deepEqual(result.state.slices.products.offers[context.productId], oracle.originalProduct);
  assert.deepEqual(result.state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
  assert.deepEqual(result.state.slices.products.contracts[oracle.originalProduct.contractId], oracle.originalPublicContract);
  assert.deepEqual(result.state.slices.models.versions[context.publicModelId], oracle.originalPublicModel);
  const paused = result.state.slices.models.trainingRuns['training-wave15-natural-command-4'];
  assert.equal(paused.status, 'paused'); assert.equal(paused.plan!.replay!.shareBps, 5000);
  assert.ok(paused.completedWork > 0 && paused.completedWork < paused.requiredWork);
  assert.equal(result.state.slices.models.versions['model-wave15-natural-command-2'].capabilityBps.coding, 2544);
  assert.equal(oracle.checkpoints.length, 8); assert.equal(oracle.naturalProgression.finalHash, '9a5b6de8');
});

test('W16-S02: twenty-four full states match published Wave 15 through repeated reloads, replay recovery, evaluations, automatic batch allocation, credits and real costs', () => {
  let state = loadHistorical().state;
  const pausedId = 'training-wave15-natural-command-4', initialProgress = state.slices.models.trainingRuns[pausedId].completedWork;
  assert.equal(expectedWeeks.length, 24); assert.equal(oracle.commands.length, 13);
  assert.equal(MAX_SNAPSHOT_BYTES, 2_000_000);
  for (const expected of expectedWeeks) {
    const before = serializeState(state, historicalContent(state)), restored = deserializeState(before, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), before);
    const carry = restored.state.slices.products.contracts[oracle.originalProduct.contractId].tokenBillRemainder;
    state = step(queueScheduled(restored.state));
    assert.equal(normalizedHash(state), expected.hash, 'Published full state changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []);
    assert.equal(state.slices.products.lastUsage[context.productId].tokens!.billCarryIn, carry);
    assert.deepEqual(capture(state), expected, 'Published receipts changed in Week ' + expected.week);
    assert.deepEqual(state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
    assert.deepEqual(state.slices.models.versions[context.publicModelId], oracle.originalPublicModel);
    assert.equal(state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
    if (state.week === 512) {
      assert.equal(state.slices.models.trainingRuns[pausedId].status, 'paused');
      assert.equal(state.slices.models.trainingRuns[pausedId].completedWork, initialProgress);
    }
    if (state.week === 513) assert.ok(state.slices.models.trainingRuns[pausedId].completedWork > initialProgress);
    assert.equal(getComputeCostView(state).reports.some(report => report.week === context.initialCostWeek), state.week < 519);
  }
  const jobs = Object.values(state.slices.products.batchJobs!).filter(job => job.id.startsWith('batch:wave15-natural-'));
  const invoices = state.slices.products.batchInvoices!.filter(invoice => jobs.some(job => job.id === invoice.jobId));
  assert.deepEqual(jobs.map(job => [job.orderId, job.status, job.completedRequests]), [
    ['code-index', 'completed', 60_000], ['longform-digest', 'expired', 38_808], ['longform-digest', 'completed', 60_000],
  ]);
  assert.equal(invoices.length, 3); assert.equal(invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0), 5_205_300);
  assert.equal(invoices.reduce((sum, invoice) => sum + invoice.creditsCents, 0), 794_700);
  assert.equal(state.slices.models.versions['model-wave15-natural-command-4'].capabilityBps.coding, 5089);
  assert.equal(state.slices.models.versions['model-wave15-natural-command-9'].reliabilityBps, 9280);
  assert.equal(normalizedHash(state), '9a5b6de8'); assert.equal(Buffer.byteLength(serializeState(state, historicalContent(state))), 1_451_812);
  const saved = serializeState(state, historicalContent(state)), reloaded = deserializeState(saved, historicalContent(state)); assert.ok(reloaded.ok, reloaded.ok ? '' : reloaded.error);
  assert.equal(serializeState(reloaded.state, historicalContent(reloaded.state)), saved);
  const oldState = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
  const reimport = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: oracle.sourceContent,
    checksum: canonicalStateHash(oldState), state: oldState }));
  assert.ok(reimport.ok, reimport.ok ? '' : reimport.error); assert.equal(reimport.migratedFrom, 16);
  assert.deepEqual(reimport.state, upgradeHistoricalState(state));
});

test('W16-S03: original checksum validation precedes migration and preserves rejected bytes', () => {
  const changed = envelope(); changed.state.slices.models.trainingRuns['training-wave15-natural-command-4'].completedWork++;
  const text = JSON.stringify(changed), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(changed), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
  const future = envelope(); future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const futureText = encoded(future), rejected = deserializeState(futureText);
  assert.equal(rejected.ok, false); if (!rejected.ok) assert.match(rejected.error, /not supported/);
  assert.equal(encoded(future), futureText);
});

test('W16-S04: all sixteen old generations preserve authored rights, training, replay and batch evidence without adopting new placement', () => {
  for (let wave = 0; wave <= 15; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1);
    assert.deepEqual(validateState(result.state, CONTENT), []);
    for (const packet of Object.values(previous.state.slices.data.packets)) assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    for (const model of Object.values(previous.state.slices.models.versions)) if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    for (const key of ['runtimeGuardrails', 'assuranceContracts', 'assuranceInvoices', 'batchSchedulers', 'batchJobs', 'batchInvoices'] as const) {
      assert.deepEqual(result.state.slices.products[key], previous.state.slices.products[key]);
    }
    for (const run of Object.values(previous.state.slices.models.trainingRuns ?? {})) assert.deepEqual(result.state.slices.models.trainingRuns[run.id], run);
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
const saveKey = 'frontier-lab.wave0.snapshot', archiveKey = 'frontier-lab.wave15.original';

test('W16-S05: browser migration archives exact original Wave 15 bytes and preserves an existing archive', t => {
  const storage = installStorage(t), originalText = '\n' + raw + '\n';
  storage.values.set(saveKey, originalText);
  const loaded = readBrowserSnapshot(); assert.equal(loaded.kind, 'loaded');
  if (loaded.kind !== 'loaded') return;
  assert.equal(loaded.migratedFrom, 16); assert.equal(storage.values.size, 1);
  assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
  assert.equal(storage.values.get(archiveKey), originalText);
  assert.equal(storage.values.get(saveKey), serializeState(loaded.state, historicalContent(loaded.state)));
  assert.ok(browserRecoveryOptions().some(option => option.kind === 'wave15'));
  assert.deepEqual(readBrowserRecovery('wave15'), { text: originalText, filename: 'frontier-lab-wave15-original.json' });
  storage.values.set(archiveKey, 'an earlier untouched original'); storage.values.set(saveKey, originalText);
  assert.deepEqual(writeBrowserSnapshot(loaded.state), { ok: true });
  assert.equal(storage.values.get(archiveKey), 'an earlier untouched original');
});

test('W16-S06: archive and primary write failures retain a usable original and raw recovery export', t => {
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

test('W16-S07: every old header rejects explicit placement and atomic capacity commands, including automatic pool selection', () => {
  const payloads: CommandPayload[] = [
    { kind: 'accept_batch_job', productId: context.productId, orderId: 'code-index', modelId: context.publicModelId,
      weeklyWorkCapCUw: 16_000_000_000, poolId: 'auto' },
    { kind: 'set_batch_job_placement', jobId: 'batch:legacy-placement-target', poolId: 'general-cloud' },
    { kind: 'set_batch_capacity', cloudCU: 96_000_000_000, servingCU: 96_000_000_000 },
  ];
  for (let wave = 0; wave <= 15; wave++) for (const payload of payloads) {
    const previous = olderEnvelope(wave);
    previous.state.queuedCommands = [{ id: 'old-header-placement-command', companyId: previous.state.playerCompanyId,
      issuedForWeek: previous.state.week + 1, reservedCents: 0, payload }];
    assert.equal(deserializeState(encoded(previous)).ok, false, `Wave ${wave} accepted ${payload.kind}.`);
  }
});

test('W16-S08: otherwise valid explicit placement cannot be relabeled as Wave 15 and empty history cannot bypass the old-build gate', () => {
  const state = loadHistoricalSnapshot(raw, '0.17.0').state;
  const accepted = submitCommand(state, { kind: 'accept_batch_job', productId: context.productId, orderId: 'code-index',
    modelId: context.publicModelId, weeklyWorkCapCUw: 16_000_000_000, poolId: 'general-cloud' }, historicalContent(state), 'wave16-compat-placement');
  assert.ok(accepted.accepted, accepted.reason?.message);
  const advanced = step(accepted.state), job = advanced.slices.products.batchJobs!['batch:wave16-compat-placement'];
  assert.ok(job.placementHistory?.length); assert.equal(job.placementHistory[0].poolId, 'general-cloud');
  assert.deepEqual(validateState(advanced, historicalContent(advanced)), []);
  assert.equal(deserializeState(serializeState(advanced, historicalContent(advanced))).ok, true);
  const forged = JSON.parse(serializeState(advanced, historicalContent(advanced))) as Envelope;
  forged.contentVersion = '0.16.0'; forged.state.contentVersion = '0.16.0'; forged.state.buildVersion = '0.16.0';
  const rejected = deserializeState(encoded(forged)); assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /The Wave 15 save contains methods or receipts that were unavailable in that build/);
  for (const placementHistory of [[], null, false, {}]) {
    const legacy = envelope(), target = Object.values(legacy.state.slices.products.batchJobs!)[0];
    Object.assign(target, { placementHistory });
    assert.equal(deserializeState(encoded(legacy)).ok, false);
  }
});
