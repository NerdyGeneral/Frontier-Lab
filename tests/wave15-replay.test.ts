import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { REPLAY_RULES } from '../src/content/wave15-replay';
import type { GameState, TrainingRun } from '../src/contracts/types';
import type { TrainingOptions } from '../src/modules/lab-planner';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertReplayTrainingChoice, assertTrainingReplay } from '../src/core/wave15-replay-validation';
import { buildTrainingPlan, expectedTrainingOutcome, getCorpusEvidence, getTrainingPreview } from '../src/modules/lab-planner';
import { applyReplayOutcome, createTrainingReplayReceipt, replayAdmissionIdentity, replayBaseOriginWeek, replayPacketAvailable, replayPaidBaseline, replayPreservationFloor, replayResearchAvailable, trainingEvidenceFingerprint } from '../src/modules/replay-curriculum';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const BASE = 'model-wave11-natural-command-3';
const DOCUMENTS = 'curated-natural-business-command-111';
const CODING = 'curated-natural-business-command-54';
const options = (shareBps?: 2500 | 5000): TrainingOptions => ({ baseModelId: BASE, packetId: DOCUMENTS,
  recipeId: 'document-adaptation', profile: 'stable', ...(shareBps ? { replay: { domain: 'coding', shareBps, packetIds: [CODING] } } : {}) });

function original(): GameState {
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave14-snapshot.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? '' : imported.error); return imported.state;
}
let researchedCache: GameState | undefined;
function researched(): GameState {
  if (researchedCache) return structuredClone(researchedCache);
  const run = new NaturalBusinessCampaign(original(), 'replay-core-research'); run.discover('R4C');
  assert.ok(replayResearchAvailable(run.state)); assert.deepEqual(validateState(run.state), []);
  researchedCache = structuredClone(run.state); return structuredClone(run.state);
}
let completeCache: { state: GameState; runId: string; modelId: string } | undefined;
function completed() {
  if (completeCache) return structuredClone(completeCache);
  const run = new NaturalBusinessCampaign(researched(), 'replay-core-complete');
  const modelId = run.train(options(5000)), runId = run.state.slices.models.versions[modelId].trainingRunId!;
  assert.deepEqual(validateState(run.state), []); completeCache = { state: structuredClone(run.state), runId, modelId };
  return structuredClone(completeCache);
}
function virtualRun(state: GameState, choice: TrainingOptions): TrainingRun {
  const planned = buildTrainingPlan(state, state.playerCompanyId, choice, CONTENT, true);
  return { id: 'preview-run', companyId: state.playerCompanyId, baseModelId: choice.baseModelId, packetId: choice.packetId,
    recipeId: planned.recipe.id, outputModelId: 'preview-model', startedWeek: state.week + 1, requiredWork: planned.requiredWork,
    completedWork: 0, physicalWork: 0, requiredMemory: planned.requiredMemory, status: 'running', checkpointWork: 0, checkpointModelId: null,
    anchorScores: planned.anchorScores, anchorReliabilityBps: planned.anchorReliabilityBps, evidence: planned.evidence, plan: planned.plan,
    lastProgress: 0, lastBottleneck: '' };
}
function invalidSnapshot(state: GameState, label: string) {
  assert.ok(validateState(state).length, label);
  const envelope = { format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion,
    checksum: canonicalStateHash(state), state };
  assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, label + ' still fails with a newly correct checksum');
}

test('W15-R01: paid research gates replay while ordinary plans and incomplete UI drafts remain pure and safe', () => {
  const old = original(), before = canonicalStateHash(old);
  assert.equal(previewCommand(old, { kind: 'start_training', ...options(5000) }).reason?.code, 'NOT_READY');
  assert.ok(previewCommand(old, { kind: 'start_training', ...options() }).accepted);
  for (const replay of [undefined, { domain: 'coding', shareBps: 5000, packetIds: [] }, { domain: 'coding', shareBps: 5000, packetIds: ['missing-packet'] }]) {
    const preview = getTrainingPreview(old, old.playerCompanyId, { ...options(), ...(replay ? { replay: replay as never } : {}) });
    assert.ok(preview.workCUw > 0); if (replay) assert.ok(preview.reason);
  }
  assert.equal(canonicalStateHash(old), before);
  const state = researched(), project = Object.values(state.slices.research.projects).find(row => row.companyId === state.playerCompanyId && row.researchId === 'R4C')!;
  assert.equal(project.requiredWork, 6 * U); assert.equal(project.completedWork, project.requiredWork);
  assert.equal(project.requiredStaff, 3 * U); assert.equal(project.completedStaff, project.requiredStaff);
  assert.equal(project.availableWeek, project.completedWeek! + 1);
  const fee = state.slices.company.ledger.filter(row => row.id === project.id + ':fee'); assert.equal(fee.length, 1); assert.equal(fee[0].amountCents, 300_000);
  const oldPlan = buildTrainingPlan(old, old.playerCompanyId, options(), CONTENT, true);
  const newPlan = buildTrainingPlan(state, state.playerCompanyId, options(), CONTENT, true);
  assert.deepEqual(newPlan, oldPlan, 'Discovering replay alone neither changes an ordinary plan nor inserts an optional field.');
  assert.equal(Object.hasOwn(newPlan.plan, 'replay'), false); assert.equal(trainingEvidenceFingerprint(newPlan.plan), newPlan.plan.corpus.fingerprint);
});

test('W15-R02: 25% and 50% replay pay different update budgets while keeping the ordinary profile draw, other skills and behavior fixed', () => {
  const state = researched(), plain = virtualRun(state, options()), light = virtualRun(state, options(2500)), strong = virtualRun(state, options(5000));
  assert.equal(plain.requiredWork, 19_800_000_000); assert.equal(light.requiredWork, 26_400_000_000); assert.equal(strong.requiredWork, 39_600_000_000);
  assert.equal(strong.requiredMemory, plain.requiredMemory); assert.equal(strong.requiredMemory, 4 * U);
  assert.equal(light.plan!.replay!.preservationFloorBps, 2544); assert.equal(strong.plan!.replay!.preservationFloorBps, 5089);
  assert.equal(strong.plan!.replay!.baselineScoreBps, 5357); assert.equal(strong.plan!.replay!.qualityBps, 9500);
  assert.equal(strong.plan!.replay!.requiredEvidence, 100 * U); assert.equal(strong.plan!.replay!.coverageBps, 10000);
  assert.equal(strong.plan!.replay!.ordinaryIdentity, plain.plan!.identity); assert.equal(light.plan!.replay!.ordinaryIdentity, plain.plan!.identity);
  assert.deepEqual(strong.plan!.savedAdjustments, plain.plan!.savedAdjustments); assert.deepEqual(light.plan!.savedAdjustments, plain.plan!.savedAdjustments);
  assert.notEqual(strong.plan!.identity, light.plan!.identity); assert.notEqual(strong.plan!.identity, plain.plan!.identity);
  assert.deepEqual(strong.plan!.corpus, plain.plan!.corpus); assert.deepEqual(strong.evidence, plain.evidence);
  assert.deepEqual(strong.plan!.targets, plain.plan!.targets); assert.deepEqual(strong.anchorScores, plain.anchorScores);
  const results = [plain, light, strong].map(run => expectedTrainingOutcome(run, run.requiredWork));
  assert.equal(results[0].capabilityBps.coding, 2036); assert.equal(results[1].capabilityBps.coding, 2544); assert.equal(results[2].capabilityBps.coding, 5089);
  for (const result of results) {
    assert.equal(result.capabilityBps.documents, 5566);
    for (const domain of ['conversation', 'documents', 'tools'] as const) assert.equal(result.capabilityBps[domain], results[0].capabilityBps[domain]);
    assert.equal(result.reliabilityBps, results[0].reliabilityBps); assert.deepEqual(result.behavior, results[0].behavior);
    assert.deepEqual(result.policy, results[0].policy); assert.deepEqual(result.planner, results[0].planner);
  }
  const receipt = strong.plan!.replay!;
  for (const fraction of [0, .1, .5, 1]) {
    const floor = replayPreservationFloor(receipt, strong.requiredWork * fraction, strong.requiredWork);
    assert.equal(floor, Math.floor(receipt.preservationFloorBps * fraction));
    const ordinary = expectedTrainingOutcome({ ...strong, plan: { ...strong.plan!, replay: undefined } }, strong.requiredWork * fraction).capabilityBps;
    const replayed = applyReplayOutcome(receipt, ordinary, strong.requiredWork * fraction, strong.requiredWork);
    assert.ok(replayed.coding >= ordinary.coding && replayed.coding <= Math.max(ordinary.coding, receipt.baselineScoreBps));
  }
  assert.equal(replayPreservationFloor(receipt, strong.requiredWork * 2, strong.requiredWork), receipt.preservationFloorBps);
});

test('W15-R03: replay accepts one non-focus domain with exact paid source evidence and rejects malformed or overlapping source choices', () => {
  const state = researched(), payload = { kind: 'start_training' as const, ...options(5000) }, reportId = replayPaidBaseline(state, BASE)!.id;
  const before = canonicalStateHash(state); assert.ok(previewCommand(state, payload).accepted); assert.equal(canonicalStateHash(state), before);
  for (const malformed of [null, false, {}, { domain: 'coding', shareBps: 10000, packetIds: [CODING] }, { domain: 'coding', shareBps: 2500, packetIds: [] },
    { domain: 'coding', shareBps: 2500, packetIds: [CODING, CODING] }, { domain: 'coding', shareBps: 2500, packetIds: [CODING], reportId },
    { domain: 'coding', shareBps: 2500, packetIds: ['__proto__'] }]) assert.throws(() => assertReplayTrainingChoice(malformed));
  assert.equal(previewCommand(state, { ...payload, replay: { ...payload.replay!, domain: 'documents' } }).accepted, false);
  assert.equal(previewCommand(state, { ...payload, asAdapter: true }).accepted, false);
  assert.equal(previewCommand(state, { ...payload, recipeId: 'behavior-reliability' }).accepted, false);
  assert.equal(previewCommand(state, { ...payload, replay: { ...payload.replay!, packetIds: [DOCUMENTS] } }).accepted, false);
  assert.equal(previewCommand(state, { ...payload, packetIds: [DOCUMENTS, CODING] }).accepted, false);
  const originalDocument = state.slices.data.packets[DOCUMENTS].parentPacketId!;
  assert.equal(previewCommand(state, { ...payload, replay: { ...payload.replay!, packetIds: [originalDocument] } }).accepted, false,
    'Different packet IDs cannot hide overlapping immutable source lineage.');
  const cases: Array<[string, (value: GameState) => void]> = [
    ['unresearched replay method', value => { value.slices.research.completedByCompany[value.playerCompanyId] = value.slices.research.completedByCompany[value.playerCompanyId].filter(id => id !== 'R4C'); }],
    ['missing exact paid report', value => { delete value.slices.models.reports[reportId]; }],
    ['scenario evidence', value => { value.slices.models.reports[reportId].scenarioStart = true; }],
    ['unpaid report work', value => { Object.values(value.slices.models.evaluationRuns).find(run => run.reportId === reportId)!.completedWork--; }],
    ['foreign prior model', value => { value.slices.models.versions[BASE].companyId = 'someone-else'; }],
    ['unfinished prior model', value => { value.slices.models.versions[BASE].status = 'checkpoint'; }],
    ['unprepared replay data', value => { value.slices.data.packets[CODING].prepared = false; }],
    ['foreign replay data', value => { value.slices.data.packets[CODING].companyId = 'someone-else'; }],
    ['unlicensed replay data', value => { value.slices.data.packets[CODING].rights.hosted = false; }],
    ['irrelevant paired policy labels', value => { value.slices.data.packets[CODING].coverageBps.coding = 0; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(state); mutate(changed); assert.equal(previewCommand(changed, payload).accepted, false, label); }
});

test('W15-R04: replay retains source/report fingerprints and refuses repeat choices across names, descendants or data-cleanup aliases', () => {
  const base = completed(), state = base.state, run = state.slices.models.trainingRuns[base.runId], replay = run.plan!.replay!;
  assert.equal(run.completedWork, run.requiredWork); assert.ok(run.physicalWork > 0); assert.equal(run.requiredWork, 39_600_000_000);
  assert.notEqual(trainingEvidenceFingerprint(run.plan!), run.plan!.corpus.fingerprint);
  assert.equal(state.slices.models.versions[base.modelId].trainingEvidenceId, trainingEvidenceFingerprint(run.plan!));
  assert.equal(previewCommand(state, { kind: 'start_training', ...options(5000) }).reason?.code, 'NO_IMPROVEMENT');
  const renamed = structuredClone(state); renamed.slices.models.versions[BASE].name = 'A renamed base'; renamed.slices.data.packets[CODING].name = 'A renamed corpus';
  assert.equal(buildTrainingPlan(renamed, state.playerCompanyId, options(5000)).plan.identity, run.plan!.identity);
  assert.equal(buildTrainingPlan(renamed, state.playerCompanyId, options(5000)).plan.replay!.baseModelFingerprint, replay.baseModelFingerprint);
  const next = new NaturalBusinessCampaign(state, 'replay-core-descendant'); next.evaluate(base.modelId, 'expanded-capabilities-1');
  const descendant = { ...options(5000), baseModelId: base.modelId };
  assert.equal(buildTrainingPlan(next.state, state.playerCompanyId, descendant).plan.identity, run.plan!.identity);
  assert.equal(previewCommand(next.state, { kind: 'start_training', ...descendant }).reason?.code, 'NO_IMPROVEMENT',
    'A paid descendant report cannot reset the same finite replay choice.');
  assert.deepEqual(validateState(next.state), []);
});

test('W15-R05: primary and replay cleanup stay independent and neither data processing choice rerolls or multiplies evidence', () => {
  const run = new NaturalBusinessCampaign(researched(), 'replay-core-cleanup');
  const focus = 'deduplicated-' + run.queue({ kind: 'deduplicate_data', packetId: DOCUMENTS });
  const rehearsal = 'deduplicated-' + run.queue({ kind: 'deduplicate_data', packetId: CODING });
  run.until(state => !!state.slices.data.packets[focus]?.prepared && !!state.slices.data.packets[rehearsal]?.prepared, 8, 'paid independent corpus cleanup');
  const dirty = buildTrainingPlan(run.state, run.state.playerCompanyId, options(5000), CONTENT, true);
  const cleanFocus = buildTrainingPlan(run.state, run.state.playerCompanyId, { ...options(5000), packetId: focus }, CONTENT, true);
  const cleanReplay = buildTrainingPlan(run.state, run.state.playerCompanyId, { ...options(5000), replay: { domain: 'coding', shareBps: 5000, packetIds: [rehearsal] } }, CONTENT, true);
  const both = buildTrainingPlan(run.state, run.state.playerCompanyId, { ...options(5000), packetId: focus, replay: { domain: 'coding', shareBps: 5000, packetIds: [rehearsal] } }, CONTENT, true);
  assert.equal(dirty.requiredWork, 39_600_000_000); assert.equal(cleanFocus.requiredWork, 37_620_000_000); assert.equal(cleanReplay.requiredWork, 37_620_000_000); assert.equal(both.requiredWork, 35_640_000_000);
  assert.equal(cleanFocus.plan.replay!.nominalFocusWorkCUw, 19_800_000_000); assert.equal(cleanFocus.plan.replay!.nominalReplayWorkCUw, 19_800_000_000);
  assert.equal(cleanFocus.plan.replay!.deduplication, undefined); assert.equal(cleanReplay.plan.deduplication, undefined);
  assert.ok(both.plan.deduplication && both.plan.replay!.deduplication);
  assert.equal(both.plan.deduplication!.savedWorkCUw, 1_980_000_000); assert.equal(both.plan.replay!.deduplication!.savedWorkCUw, 1_980_000_000);
  for (const plan of [cleanFocus, cleanReplay, both]) {
    assert.equal(plan.plan.identity, dirty.plan.identity); assert.deepEqual(plan.plan.savedAdjustments, dirty.plan.savedAdjustments);
    assert.equal(plan.plan.replay!.preservationFloorBps, dirty.plan.replay!.preservationFloorBps);
    assert.equal(plan.plan.corpus.distinctUnits, dirty.plan.corpus.distinctUnits); assert.equal(plan.plan.replay!.corpus.distinctUnits, dirty.plan.replay!.corpus.distinctUnits);
  }
  const id = run.train({ ...options(5000), packetId: focus, replay: { domain: 'coding', shareBps: 5000, packetIds: [rehearsal] } });
  assert.equal(run.state.slices.models.versions[id].capabilityBps.coding, 5089);
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(5000) }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
});

test('W15-R06: retained replay plans reject forged work, source evidence, rights, chronology and saved outcomes under valid checksums', () => {
  const base = completed(), selected = (state: GameState) => state.slices.models.trainingRuns[base.runId];
  const cases: Array<[string, (state: GameState) => void]> = [
    ['unaccepted replay run', state => { delete state.commandReceipts[base.runId.slice('training-'.length)]; }],
    ['missing researched method', state => { selected(state).plan!.methods = selected(state).plan!.methods.filter(id => id !== 'R4C'); }],
    ['different prior model fingerprint', state => { selected(state).plan!.replay!.baseModelFingerprint = '00000000'; }],
    ['unpaid prior report', state => { selected(state).plan!.replay!.baselineReportId = 'missing-report'; }],
    ['invented prior skill', state => { selected(state).plan!.replay!.baselineScoreBps++; }],
    ['unbounded preservation', state => { selected(state).plan!.replay!.preservationFloorBps = 9999; }],
    ['free replay updates', state => { selected(state).plan!.replay!.replayWorkCUw--; selected(state).requiredWork--; selected(state).completedWork--; }],
    ['changed nominal replay share', state => { selected(state).plan!.replay!.shareBps = 2500; }],
    ['invented nominal focus work', state => { selected(state).plan!.replay!.nominalFocusWorkCUw--; }],
    ['changed primary work', state => { selected(state).plan!.replay!.focusWorkCUw--; }],
    ['rerolled ordinary variance identity', state => { selected(state).plan!.replay!.ordinaryIdentity = 'training-identity-00000000'; }],
    ['rerolled focus score', state => { selected(state).plan!.savedAdjustments.documents++; }],
    ['invented clean-source saving', state => { selected(state).plan!.replay!.deduplication = { sourceIds: ['specialist-coding-1'], reductionBps: 1000, originalWorkCUw: 19_800_000_000, savedWorkCUw: 1_980_000_000 }; }],
    ['lost replay provenance', state => { selected(state).plan!.replay!.corpus.fingerprint = 'corpus-00000000'; }],
    ['invented replay units', state => { selected(state).plan!.replay!.corpus.relevantUnits.coding++; }],
    ['laundered source rights', state => { selected(state).plan!.replay!.corpus.rights.weights = false; }],
    ['lost combined model evidence', state => { state.slices.models.versions[base.modelId].trainingEvidenceId = selected(state).plan!.corpus.fingerprint; }],
    ['unpaid retained model capability', state => { state.slices.models.versions[base.modelId].capabilityBps.coding++; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base.state); mutate(changed); invalidSnapshot(changed, label); }

  const overlap = structuredClone(base.state), run = selected(overlap), previous = run.plan!.replay!;
  const corpus = getCorpusEvidence(overlap, run.companyId, [DOCUMENTS]), choice = { domain: 'coding' as const, shareBps: 5000 as const, packetIds: [DOCUMENTS] };
  run.plan!.replay = createTrainingReplayReceipt(overlap, overlap.slices.models.versions[BASE], choice, corpus, previous.ordinaryIdentity,
    previous.nominalFocusWorkCUw, previous.focusWorkCUw, previous.baselineReportId)!;
  run.plan!.identity = replayAdmissionIdentity(previous.ordinaryIdentity, choice, corpus);
  assert.throws(() => assertTrainingReplay(overlap, run, previous.ordinaryIdentity, previous.nominalFocusWorkCUw, previous.focusWorkCUw, CONTENT), /reused the primary/,
    'Even a fully rebuilt self-consistent receipt cannot hide shared primary/replay source evidence.');
  invalidSnapshot(overlap, 'self-consistent overlapping source forgery');
  const late = structuredClone(base.state), saved = selected(late), receipt = saved.plan!.replay!;
  Object.values(late.slices.data.preparationJobs).find(job => job.packetId === CODING)!.completedWeek = saved.startedWeek;
  assert.throws(() => assertTrainingReplay(late, saved, receipt.ordinaryIdentity, receipt.nominalFocusWorkCUw, receipt.focusWorkCUw, CONTENT), /prior completed preparation/);
  assert.equal(REPLAY_RULES.maximumPackets, 20);
});

test('W15-R07: an importable older prepared source without its preparation receipt is rejected before queueing and can gain paid replay provenance', () => {
  const state = researched(), sourceId = 'starter-public';
  const oldPreparation = Object.values(state.slices.data.preparationJobs).find(job => job.packetId === sourceId)!;
  assert.ok(oldPreparation); delete state.slices.data.preparationJobs[oldPreparation.id];
  assert.deepEqual(validateState(state), [], 'Ordinary imported data keeps its established validity rules.');
  const imported = deserializeState(serializeState(state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const payload = { kind: 'start_training' as const, ...options(), replay: { domain: 'conversation' as const, shareBps: 5000 as const, packetIds: [sourceId] } };
  assert.equal(replayPacketAvailable(imported.state, sourceId, imported.state.playerCompanyId), false);
  const preview = previewCommand(imported.state, payload); assert.equal(preview.accepted, false); assert.equal(preview.reason?.code, 'NOT_READY');
  assert.match(preview.reason!.message, /earlier completed preparation/); assert.match(preview.reason!.message, /curated or cleaned revision/);
  const queued = submitCommand(imported.state, payload, CONTENT, 'unsupported-legacy-replay');
  assert.equal(queued.accepted, false); assert.equal(queued.state.queuedCommands.some(command => command.id === 'unsupported-legacy-replay'), false);
  assert.ok(previewCommand(imported.state, { kind: 'start_training', ...options() }).accepted,
    'Replay provenance requirements do not change ordinary training admission.');
  const advanced = advanceWeek(queued.state); assert.ok(advanced.accepted, advanced.reason?.message);
  assert.equal(advanced.state.week, state.week + 1, 'The rejected replay cannot block the simulation clock.');
  const run = new NaturalBusinessCampaign(advanced.state, 'replay-core-legacy-repair');
  const revision = 'curated-' + run.queue({ kind: 'curate_data', packetId: sourceId });
  run.until(snapshot => !!snapshot.slices.data.packets[revision]?.prepared, 8, 'paid curation of the older source');
  assert.ok(replayPacketAvailable(run.state, revision, run.state.playerCompanyId));
  const id = 'training-' + run.queue({ ...payload, replay: { ...payload.replay, packetIds: [revision] } });
  run.step(); assert.ok(run.state.slices.models.trainingRuns[id]);
  assert.deepEqual(validateState(run.state), [], 'The same admitted provenance predicate also accepts the committed replay run.');
});

test('W15-R08: the authored seed gains legitimate replay admission through its own paid expanded evaluation and Week 0 origin', () => {
  const run = new NaturalBusinessCampaign(researched(), 'replay-core-paid-seed'), seedId = CONTENT.seedModel.id;
  assert.equal(run.state.slices.models.versions[seedId].createdWeek, undefined);
  assert.equal(replayBaseOriginWeek(run.state, seedId), 0);
  const payload = { kind: 'start_training' as const, ...options(5000), baseModelId: seedId };
  assert.equal(previewCommand(run.state, payload).accepted, false, 'Authored origin alone does not replace paid capability evidence.');
  run.evaluate(seedId, 'expanded-capabilities-1');
  const report = replayPaidBaseline(run.state, seedId)!; assert.ok(report); assert.equal(report.modelId, seedId);
  const evaluation = Object.values(run.state.slices.models.evaluationRuns).find(item => item.reportId === report.id)!;
  assert.equal(evaluation.status, 'complete'); assert.equal(evaluation.completedWork, 4 * U); assert.equal(evaluation.completedStaff, U);
  assert.ok(previewCommand(run.state, payload).accepted);
  const id = 'training-' + run.queue(payload); run.step();
  const training = run.state.slices.models.trainingRuns[id]; assert.ok(training.plan!.replay); assert.ok(training.completedWork > 0);
  assert.equal(training.plan!.replay!.baselineReportId, report.id); assert.ok(report.week < training.startedWeek);
  assert.deepEqual(validateState(run.state), []);
  const loaded = deserializeState(serializeState(run.state)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error);
  assert.equal(serializeState(loaded.state), serializeState(run.state));
});
