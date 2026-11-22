import { historicalContent, loadHistoricalSnapshot, upgradeHistoricalState } from './fixtures/historical-rules';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { advanceWeek, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState, MAX_SNAPSHOT_BYTES } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { getComputeCostView } from '../src/modules/compute-costs';
import { batchScheduler, batchTariffEstimateCents, getBatchView } from '../src/modules/batch-inference';
import { releaseConfigurationFingerprint } from '../src/modules/release-rehearsals';

// Captured by the archived published Wave 14 engine at bfef7d414b23… before
// Wave 15 implementation. Six authentic checkpoints matched byte-for-byte.
// The fixture has an active paid archive and independently evaluated variant;
// eleven original commands finish five jobs and age their source proofs.
const raw = readFileSync(join(__dirname, 'fixtures/wave14-snapshot.json'), 'utf8');
type Products = GameState['slices']['products'];
type Envelope = { format: string; checksum: string; schemaVersion: number; contentVersion: string; state: GameState };
type RecordedCommand = { week: number; id: string; payload: CommandPayload };
const oracle = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave14-expected.json'), 'utf8')) as {
  sourceCommit: string; sourceTree: string; sourceContent: string; schemaVersion: number;
  fixtureWeek: number; checksum: string; snapshotBytes: number;
  productId: string; publicModelId: string; compressedId: string; documentsId: string;
  creationCommands: RecordedCommand[]; commands: RecordedCommand[];
  originalProduct: Products['offers'][string]; originalDeployment: Products['deployments'][string]; originalPublicContract: Products['contracts'][string];
  originalModel: GameState['slices']['models']['versions'][string]; originalScheduler: ReturnType<typeof batchScheduler>;
  originalBatchJobs: Products['batchJobs']; originalBatchInvoices: Products['batchInvoices']; originalModels: unknown[];
  originalLegacy: unknown; originalStudies: unknown[]; preservedFeedbackInvoiceIds: string[];
  originalCostReport: { week: number; hash: string };
  naturalProgression: { sourceWeek: number; sourceHash: string; finalWeek: number; finalHash: string; finalBytes: number; commands: RecordedCommand[] };
  checkpoints: { week: number; file: string; hash: string; bytes: number; sha256: string }[];
  weeks: unknown[];
};
const envelope = () => JSON.parse(raw) as Envelope;
const olderEnvelope = (wave: number) => JSON.parse(readFileSync(join(__dirname, `fixtures/wave${wave}-snapshot.json`), 'utf8')) as Envelope;
function load() { const result = deserializeState(raw); assert.ok(result.ok, result.ok ? '' : result.error); return result; }
const loadHistorical = () => loadHistoricalSnapshot(raw);
function encoded(value: Envelope) { value.checksum = canonicalStateHash(value.state); return JSON.stringify(value); }
function normalizedHash(state: GameState) { return canonicalStateHash({ ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent }); }
function step(state: GameState) {
  const queued = state.queuedCommands.filter(command => command.companyId === state.playerCompanyId);
  const next = advanceWeek(state, historicalContent(state)); assert.ok(next.accepted, next.reason?.message);
  for (const command of queued) assert.equal(next.state.commandReceipts[command.id]?.status, 'accepted', command.id);
  return next.state;
}
function queueScheduled(state: GameState) {
  for (const command of oracle.commands.filter(command => command.week === state.week)) {
    const next = submitCommand(state, command.payload, historicalContent(state), command.id);
    assert.ok(next.accepted, next.reason?.message); state = next.state;
  }
  return state;
}
function assertNoReplay(state: GameState) {
  assert.ok(!state.slices.research.completed.includes('R4C'));
  assert.ok(!state.slices.research.active.includes('R4C'));
  for (const known of Object.values(state.slices.research.completedByCompany)) assert.ok(!known.includes('R4C'));
  for (const project of Object.values(state.slices.research.projects)) assert.notEqual(project.researchId, 'R4C');
  for (const run of Object.values(state.slices.models.trainingRuns)) {
    if (run.plan) { assert.equal(Object.hasOwn(run.plan, 'replay'), false); assert.ok(!run.plan.methods.includes('R4C')); }
    assert.equal(Object.hasOwn(run.evidence, 'replay'), false);
  }
  for (const command of state.queuedCommands) assert.equal(Object.hasOwn(command.payload, 'replay'), false);
}
function modelReceipts(at: GameState) {
  return [oracle.publicModelId, oracle.compressedId, 'model-wave14-natural-command-12', oracle.documentsId].flatMap(id => {
    const model = at.slices.models.versions[id]; if (!model) return [];
    return [{ id, hash: canonicalStateHash(model), status: model.status, family: model.family, architecture: model.architecture,
      capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps,
      reports: Object.values(at.slices.models.reports).filter(report => report.modelId === id).map(report => ({ id: report.id, week: report.week, suiteId: report.suiteId, hash: canonicalStateHash(report) })) }];
  });
}
function legacyReceipts(at: GameState) {
  return {
    publicModelHash: canonicalStateHash(at.slices.models.versions[oracle.publicModelId]), feedbackHash: canonicalStateHash(at.slices.data.feedbackStudies),
    guardrailsHash: canonicalStateHash(at.slices.products.runtimeGuardrails), releaseRehearsalsHash: canonicalStateHash(at.slices.products.releaseRehearsals),
    preparedReleasesHash: canonicalStateHash(at.slices.products.preparedReleases), assuranceContractsHash: canonicalStateHash(at.slices.products.assuranceContracts),
    assuranceInvoicesHash: canonicalStateHash(at.slices.products.assuranceInvoices), releaseConfigurationFingerprint: releaseConfigurationFingerprint(at, oracle.productId),
    feedbackInvoiceProofs: oracle.preservedFeedbackInvoiceIds.map(id => ({ id, posted: at.slices.company.postedFacts[id] === true,
      inOrdinaryHistory: at.slices.products.invoices.some(invoice => invoice.id === id) })),
  };
}
function observations(at: GameState) {
  const products = at.slices.products, company = at.slices.company.companies[at.playerCompanyId];
  const costs = getComputeCostView(at), latest = costs.latest!, prior = costs.reports.find(report => report.week === oracle.originalCostReport.week);
  const saved = serializeState(at, historicalContent(at)), exported = JSON.parse(saved), pretty = JSON.stringify(exported, null, 2), compact = JSON.stringify(exported);
  const publicInvoices = products.invoices.filter(invoice => invoice.productId === oracle.productId && invoice.week === at.week);
  assert.equal(publicInvoices.length, 1);
  const view = getBatchView(at), batchTargets = latest.targets.filter(target => target.kind === 'batch-inference');
  const targetIds = new Set(batchTargets.map(target => target.id)), requestIds = new Set(batchTargets.flatMap(target => target.requestIds));
  assert.equal(latest.totals.attributedComputeCents + latest.totals.sharedComputeCents, latest.totals.totalComputeCents);
  assert.equal(latest.totals.totalComputeCents + latest.totals.otherOperatingCents, company.lastWeek.operatingExpenseCents);
  assert.equal(latest.totals.companyRevenueCents, company.lastWeek.revenueCents);
  return {
    week: at.week, hash: normalizedHash(at), cashCents: company.cashCents, arrearsCents: company.arrearsCents,
    revenueCents: company.lastWeek.revenueCents, expenseCents: company.lastWeek.operatingExpenseCents,
    trustBps: at.slices.markets.companyTrustBps[at.playerCompanyId],
    product: structuredClone(products.offers[oracle.productId]), deployment: structuredClone(products.deployments[oracle.originalProduct.deploymentId]),
    publicContract: structuredClone(products.contracts[oracle.originalProduct.contractId]), usage: structuredClone(products.lastUsage[oracle.productId]),
    publicInvoice: structuredClone(publicInvoices[0]), scheduler: structuredClone(batchScheduler(at)), batchJobs: structuredClone(products.batchJobs!),
    batchInvoices: structuredClone(products.batchInvoices!), batchInvoicesHash: canonicalStateHash(products.batchInvoices!),
    batchView: { researched: view.researched, products: structuredClone(view.products), models: structuredClone(view.models), board: structuredClone(view.board),
      activeJobs: view.activeJobs, remainingWorkCUw: view.remainingWorkCUw, requestedWeeklyCapCUw: view.requestedWeeklyCapCUw, maximumCommercialStaff: view.maximumCommercialStaff },
    batchProofs: Object.values(products.batchJobs!).map(job => ({ id: job.id, hash: canonicalStateHash(job),
      admissionId: job.admission.publicInvoiceId, admissionPosted: at.slices.company.postedFacts[job.admission.publicInvoiceId] === true,
      admissionInPublicHistory: products.invoices.some(invoice => invoice.id === job.admission.publicInvoiceId),
      admissionInLedger: at.slices.company.ledger.some(fact => fact.id === job.admission.publicInvoiceId),
      invoiceId: job.invoiceId, invoicePosted: job.invoiceId ? at.slices.company.postedFacts[job.invoiceId] === true : null,
      invoiceInLedger: job.invoiceId ? at.slices.company.ledger.some(fact => fact.id === job.invoiceId) : false,
      invoiceInCostHistory: job.invoiceId ? costs.reports.some(report => report.ledgerFacts.some(fact => fact.id === job.invoiceId)) : false,
      workReceiptsHash: canonicalStateHash(job.workReceipts), physicalWorkCUw: job.physicalWork, estimatedGpuCents: batchTariffEstimateCents(job) })),
    models: modelReceipts(at),
    training: Object.values(at.slices.models.trainingRuns).filter(run => run.id.includes('wave14-natural')).map(run => ({
      id: run.id, hash: canonicalStateHash(run), status: run.status, completedWork: run.completedWork, outputModelId: run.outputModelId,
    })),
    legacy: legacyReceipts(at),
    costs: { week: latest.week, hash: canonicalStateHash(latest), totals: structuredClone(latest.totals),
      historyWeeks: costs.reports.map(report => report.week), priorWeekRetained: !!prior, priorReportHash: prior ? canonicalStateHash(prior) : null,
      batchTargets: structuredClone(batchTargets), batchActivities: latest.activities.filter(activity => targetIds.has(activity.targetId)).map(activity => structuredClone(activity)),
      batchWorkloads: latest.workloads.filter(work => targetIds.has(work.targetId)).map(work => structuredClone(work)),
      requests: latest.resources.requests.filter(request => requestIds.has(request.id)).map(request => structuredClone(request)),
      computeGrants: latest.resources.computeGrants.filter(grant => requestIds.has(grant.requestId)).map(grant => structuredClone(grant)),
      staffGrants: latest.resources.staffGrants.filter(grant => requestIds.has(grant.requestId)).map(grant => structuredClone(grant)),
      batchInvoiceFacts: latest.ledgerFacts.filter(fact => products.batchInvoices!.some(invoice => invoice.id === fact.id)).map(fact => structuredClone(fact)),
    },
    save: { prettyBytes: Buffer.byteLength(pretty), compactBytes: Buffer.byteLength(compact), savedBytes: Buffer.byteLength(saved), compacted: saved === compact },
  };
}
const expectedWeeks = oracle.weeks as ReturnType<typeof observations>[];

test('W15-S01: authentic Wave 14 import adds the announced market calendar and preserves active batch work, exact reports and original compact bytes', () => {
  const previous = envelope(), result = load();
  assert.equal(oracle.sourceCommit, 'bfef7d414b23b271b37f5a136b8cc0a376647b1f');
  assert.equal(oracle.sourceTree, '3933071a1a4bd77bf0d4ae05fec883149dac8288');
  assert.equal(previous.schemaVersion, 5); assert.equal(previous.contentVersion, '0.15.0');
  assert.equal(previous.checksum, '101cc8f9'); assert.equal(previous.checksum, canonicalStateHash(previous.state));
  assert.equal(oracle.checksum, previous.checksum); assert.equal(Buffer.byteLength(raw.trimEnd()), 1_224_168);
  assert.equal(oracle.snapshotBytes, 1_224_168); assert.equal(result.migratedFrom, 15); assert.equal(result.state.week, 477);
  assert.deepEqual(result.state, { ...previous.state, contentVersion: CONTENT.version, buildVersion: CONTENT.buildVersion,
    slices: { ...previous.state.slices, markets: { ...previous.state.slices.markets, opportunityCalendar: { startedWeek: previous.state.week, sequenceVersion: 2 as const } } } });
  assert.deepEqual(validateState(result.state, CONTENT), []); assertNoReplay(result.state);
  assert.deepEqual(batchScheduler(result.state), oracle.originalScheduler);
  assert.deepEqual(result.state.slices.products.batchJobs, oracle.originalBatchJobs);
  assert.deepEqual(result.state.slices.products.batchInvoices, []);
  assert.equal(result.state.slices.products.batchJobs!['batch:wave14-natural-command-3'].completedRequests, 24_615);
  assert.deepEqual(modelReceipts(result.state), oracle.originalModels); assert.deepEqual(legacyReceipts(result.state), oracle.originalLegacy);
  assert.equal(oracle.checkpoints.length, 6); assert.equal(oracle.naturalProgression.finalHash, '38350449');
});

test('W15-S02: twenty-three full states match published Wave 14 through batch deadlines, credits, training, real costs and retained proof aging', () => {
  let state = loadHistorical().state;
  assert.equal(expectedWeeks.length, 23);
  assert.deepEqual(oracle.commands.map(command => command.week), [477, 477, 483, 484, 485, 486, 487, 490, 492, 493, 494]);
  for (const expected of expectedWeeks) {
    const carry = state.slices.products.contracts[oracle.originalProduct.contractId].tokenBillRemainder;
    state = step(queueScheduled(state));
    assert.equal(normalizedHash(state), expected.hash, 'Published full state changed in Week ' + expected.week);
    assert.deepEqual(validateState(state, historicalContent(state)), []); assertNoReplay(state);
    assert.equal(state.slices.products.lastUsage[oracle.productId].tokens!.billCarryIn, carry);
    assert.deepEqual(observations(state), expected, 'Published receipts changed in Week ' + expected.week);
    assert.deepEqual(state.slices.products.deployments[oracle.originalProduct.deploymentId], oracle.originalDeployment);
    assert.deepEqual(state.slices.models.versions[oracle.publicModelId], oracle.originalModel);
    assert.deepEqual(Object.values(state.slices.data.feedbackStudies!), oracle.originalStudies);
    assert.equal(state.slices.company.companies[state.playerCompanyId].arrearsCents, 0);
    if (state.week < 485) assert.equal(getComputeCostView(state).reports.some(report => report.week === 477), true);
    if (state.week >= 485) assert.equal(getComputeCostView(state).reports.some(report => report.week === 477), false);
  }
  const products = state.slices.products, original = products.batchJobs!['batch:wave14-natural-command-3'];
  assert.equal(products.batchInvoices!.length, 5);
  assert.equal(products.batchInvoices!.reduce((sum, invoice) => sum + invoice.amountCents, 0), 5_799_988);
  assert.equal(products.batchInvoices!.reduce((sum, invoice) => sum + invoice.creditsCents, 0), 750_012);
  assert.equal(products.invoices.some(invoice => invoice.id === original.admission.publicInvoiceId), false);
  assert.equal(state.slices.company.ledger.some(fact => fact.id === original.invoiceId || fact.id === original.admission.publicInvoiceId), false);
  assert.equal(state.slices.company.postedFacts[original.admission.publicInvoiceId], true);
  assert.equal(state.slices.company.postedFacts[original.invoiceId!], true);
  assert.equal(getComputeCostView(state).reports.some(report => report.ledgerFacts.some(fact => fact.id === original.invoiceId)), false);
  assert.equal(normalizedHash(state), '38350449'); assert.equal(Buffer.byteLength(serializeState(state, historicalContent(state))), 1_300_835);
});

test('W15-S03: repeated reloads preserve every old-engine future hash, paused carry, fixed deadlines and once-only invoices within the same 2 MB bound', () => {
  let state = loadHistorical().state;
  assert.equal(MAX_SNAPSHOT_BYTES, 2_000_000);
  for (const expected of expectedWeeks) {
    const before = serializeState(state, historicalContent(state)), restored = deserializeState(before, historicalContent(state));
    assert.ok(restored.ok, restored.ok ? '' : restored.error); assert.equal(restored.migratedFrom, undefined);
    assert.equal(serializeState(restored.state, historicalContent(restored.state)), before);
    state = step(queueScheduled(restored.state)); assert.equal(normalizedHash(state), expected.hash);
    const saved = serializeState(state, historicalContent(state)); assert.equal(Buffer.byteLength(saved), expected.save.savedBytes);
    assert.ok(Buffer.byteLength(saved) < MAX_SNAPSHOT_BYTES);
    const cancelled = state.slices.products.batchJobs!['batch:wave14-natural-command-8'];
    if (state.week === 485) { assert.equal(cancelled.status, 'paused'); assert.equal(cancelled.usageHistory.at(-1)!.staffGranted, 0); assert.equal(cancelled.completedRequests, 6153); }
    if (state.week === 486) { assert.equal(cancelled.status, 'active'); assert.equal(cancelled.usageHistory.at(-1)!.completedRequests, 6154); assert.equal(cancelled.deadlineWeek, 487); }
    if (state.week >= 487) {
      assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.completedRequests, 12_307);
      const invoices = state.slices.products.batchInvoices!.filter(invoice => invoice.jobId === cancelled.id);
      assert.equal(invoices.length, 1); assert.equal(invoices[0].amountCents, 199_988); assert.equal(invoices[0].creditsCents, 450_012);
    }
  }
  const final = serializeState(state, historicalContent(state)), oldState = { ...state, contentVersion: oracle.sourceContent, buildVersion: oracle.sourceContent };
  const oldCompact = JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: oracle.sourceContent,
    checksum: canonicalStateHash(oldState), state: oldState });
  const imported = deserializeState(oldCompact); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(imported.migratedFrom, 15); assert.deepEqual(imported.state, upgradeHistoricalState(state)); assert.equal(serializeState(imported.state, historicalContent(imported.state)), serializeState(upgradeHistoricalState(state)));
});

test('W15-S04: original checksum validation precedes migration and cannot conceal changed batch progress', () => {
  const changed = envelope(); changed.state.slices.products.batchJobs!['batch:wave14-natural-command-3'].completedRequests++;
  const text = JSON.stringify(changed), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /checksum/);
  assert.equal(JSON.stringify(changed), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});

test('W15-S05: every old header rejects queued replay choices including empty, false and both valid shares', () => {
  const choices = [null, false, {}, [], { domain: 'coding', shareBps: 2500, packetIds: ['old-replay-packet'] },
    { domain: 'documents', shareBps: 5000, packetIds: ['old-replay-packet'] }];
  for (let wave = 0; wave <= 14; wave++) for (const replay of choices) {
    const forged = olderEnvelope(wave);
    forged.state.queuedCommands = [{ id: 'old-header-replay-training', companyId: forged.state.playerCompanyId,
      issuedForWeek: forged.state.week + 1, reservedCents: 0,
      payload: { kind: 'start_training', recipeId: 'document-adaptation', baseModelId: Object.keys(forged.state.slices.models.versions)[0], packetId: 'old-corpus', replay } as CommandPayload }];
    assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted queued replay ${JSON.stringify(replay)}.`);
  }
});

test('W15-S06: old headers reject replay fields in frozen plans and retained command or evidence history even when empty', () => {
  for (let wave = 0; wave <= 14; wave++) for (const replay of [{}, false]) {
    const plan = olderEnvelope(wave), runs = plan.state.slices.models.trainingRuns ??= {};
    const first = Object.values(runs)[0];
    if (first) Object.assign(first, { plan: { ...(first.plan ?? {}), replay } });
    else Object.assign(runs, { 'old-header-plan': { id: 'old-header-plan', plan: { replay }, evidence: {} } });
    assert.equal(deserializeState(encoded(plan)).ok, false, `Wave ${wave} accepted frozen replay.`);
    const history = olderEnvelope(wave), id = 'old-header-replay-history';
    Object.assign(history.state.commandReceipts, { [id]: { id, week: history.state.week, status: 'accepted', payload: { kind: 'start_training', replay } } });
    assert.equal(deserializeState(encoded(history)).ok, false, `Wave ${wave} accepted retained replay history.`);
    const evidence = olderEnvelope(wave), packet = Object.values(evidence.state.slices.data.packets)[0];
    Object.assign(packet, { replay });
    assert.equal(deserializeState(encoded(evidence)).ok, false, `Wave ${wave} accepted replay under an older evidence shape.`);
  }
});

test('W15-S07: R4C cannot appear in old research aliases, company knowledge, projects, frozen methods or queued and historical commands', () => {
  const mutations: Array<[string, (state: GameState) => void]> = [
    ['completed alias', state => { state.slices.research.completed.push('R4C'); }],
    ['active alias', state => { state.slices.research.active.push('R4C'); }],
    ['company knowledge', state => { state.slices.research.completedByCompany ??= {}; (state.slices.research.completedByCompany[state.playerCompanyId] ??= []).push('R4C'); }],
    ['project', state => { state.slices.research.projects ??= {}; Object.assign(state.slices.research.projects, { 'old-r4c-project': { id: 'old-r4c-project', companyId: state.playerCompanyId, researchId: 'R4C' } }); }],
    ['training methods', state => {
      state.slices.models.trainingRuns ??= {}; const run = Object.values(state.slices.models.trainingRuns)[0];
      if (run?.plan) run.plan.methods.push('R4C');
      else Object.assign(state.slices.models.trainingRuns, { 'old-r4c-plan': { plan: { methods: ['R4C'] }, evidence: {} } });
    }],
    ['queued research', state => { state.queuedCommands = [{ id: 'old-r4c-command', companyId: state.playerCompanyId, issuedForWeek: state.week + 1, reservedCents: 0, payload: { kind: 'start_research', researchId: 'R4C' } }]; }],
    ['historical research', state => { const id = 'old-r4c-history'; Object.assign(state.commandReceipts, { [id]: { id, week: state.week, status: 'accepted', payload: { kind: 'start_research', researchId: 'R4C' } } }); }],
  ];
  for (let wave = 0; wave <= 14; wave++) for (const [label, mutate] of mutations) {
    const forged = olderEnvelope(wave); mutate(forged.state);
    assert.equal(deserializeState(encoded(forged)).ok, false, `Wave ${wave} accepted ${label}.`);
  }
});

test('W15-S08: an otherwise valid paid R4C discovery cannot be relabeled as published Wave 14', () => {
  let state = loadHistoricalSnapshot(raw, '0.16.0').state;
  const queued = submitCommand(state, { kind: 'start_research', researchId: 'R4C' }, historicalContent(state), 'wave15-compat-paid-r4c');
  assert.ok(queued.accepted, queued.reason?.message); state = queued.state;
  while (!state.slices.research.completed.includes('R4C') && state.week < 497) state = step(state);
  assert.ok(state.slices.research.completed.includes('R4C')); assert.deepEqual(validateState(state, historicalContent(state)), []);
  assert.ok(deserializeState(serializeState(state, historicalContent(state))).ok);
  const project = state.slices.research.projects['research-wave15-compat-paid-r4c'];
  assert.equal(project.requiredWork, 6_000_000_000); assert.equal(project.requiredStaff, 3_000_000_000);
  const forged = JSON.parse(serializeState(state, historicalContent(state))) as Envelope;
  forged.contentVersion = '0.15.0'; forged.state.contentVersion = '0.15.0'; forged.state.buildVersion = '0.15.0';
  const rejected = deserializeState(encoded(forged)); assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /The Wave 14 save contains methods or receipts that were unavailable in that build/);
});

test('W15-S09: all fifteen previous generations migrate without replay adoption and preserve rights, paid training and batch evidence', () => {
  for (let wave = 0; wave <= 14; wave++) {
    const previous = olderEnvelope(wave), result = deserializeState(JSON.stringify(previous));
    assert.ok(result.ok, result.ok ? '' : result.error); assert.equal(result.migratedFrom, wave + 1); assertNoReplay(result.state);
    for (const packet of Object.values(previous.state.slices.data.packets)) assert.deepEqual(result.state.slices.data.packets[packet.id].rights, packet.rights);
    for (const model of Object.values(previous.state.slices.models.versions)) if (model.policy) assert.deepEqual(result.state.slices.models.versions[model.id].policy, model.policy);
    assert.deepEqual(result.state.slices.products.runtimeGuardrails, previous.state.slices.products.runtimeGuardrails);
    assert.deepEqual(result.state.slices.products.assuranceContracts, previous.state.slices.products.assuranceContracts);
    assert.deepEqual(result.state.slices.products.assuranceInvoices, previous.state.slices.products.assuranceInvoices);
    for (const key of ['batchSchedulers', 'batchJobs', 'batchInvoices'] as const) assert.deepEqual(result.state.slices.products[key], previous.state.slices.products[key]);
    for (const run of Object.values(previous.state.slices.models.trainingRuns ?? {})) assert.deepEqual(result.state.slices.models.trainingRuns[run.id], run);
  }
});

test('W15-S10: authentic batch receipts remain unavailable beneath a relabeled Wave 13 header', () => {
  const forged = envelope();
  forged.contentVersion = '0.14.0'; forged.state.contentVersion = '0.14.0'; forged.state.buildVersion = '0.14.0';
  const result = deserializeState(encoded(forged)); assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unavailable in that build/);
});

test('W15-S11: unknown future content remains rejected without changing the original company', () => {
  const future = envelope(); future.contentVersion = '99.0.0'; future.state.contentVersion = '99.0.0'; future.state.buildVersion = '99.0.0';
  const text = encoded(future), result = deserializeState(text);
  assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /not supported/);
  assert.equal(encoded(future), text); assert.equal(canonicalStateHash(envelope().state), oracle.checksum);
});
