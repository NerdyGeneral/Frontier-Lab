import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { CURRICULUM_RULES } from '../src/content/wave17-curriculum';
import type { CommandPayload, GameState, TrainingRun } from '../src/contracts/types';
import type { CorpusEvidence } from '../src/contracts/wave2-lab';
import type { TrainingCurriculumChoice } from '../src/contracts/wave17-curriculum';
import type { TrainingOptions } from '../src/modules/lab-planner';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertCommandShape } from '../src/core/command-shape';
import { assertTrainingCurriculum, assertTrainingCurriculumChoice } from '../src/core/wave17-curriculum-validation';
import { buildTrainingPlan, expectedTrainingOutcome, getCorpusEvidence, getTrainingPreview } from '../src/modules/lab-planner';
import { applyCurriculumOutcome, createTrainingCurriculumReceipt, curriculumAdmissionIdentity } from '../src/modules/training-curriculum';
import { replayPaidBaseline, replayResearchAvailable, trainingEvidenceFingerprint } from '../src/modules/replay-curriculum';
import { getAvailableRoleCapacity } from '../src/modules/workforce';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const BASE = 'model-wave15-natural-command-9';
const TRANSFERABLE_BASE = 'model-natural-business-command-63';
const DOCUMENTS = 'curated-natural-business-command-111';
const CODING = 'curated-natural-business-command-54';
const FEEDBACK = 'feedback-data:wave10-natural-command-2';
type Training = Extract<CommandPayload, { kind: 'start_training' }>;
// Training cannot release a player's service; rival releases are independent ordinary commands.
const playerConfiguration = (state: GameState) => canonicalStateHash({
  offers: Object.fromEntries(Object.entries(state.slices.products.offers).filter(([, offer]) => offer.companyId === state.playerCompanyId)),
  deployments: Object.fromEntries(Object.entries(state.slices.products.deployments).filter(([, deployment]) => deployment.companyId === state.playerCompanyId)),
});
let preparedCache: { state: GameState; conversation: string } | undefined;

/** Published paid company; data preparation and development allocation use ordinary commands. */
function company() {
  if (preparedCache) return structuredClone(preparedCache);
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave16-snapshot.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(imported.state.week, 537);
  const run = new NaturalBusinessCampaign(imported.state, 'w17-curriculum-setup');
  const conversation = run.prepare('specialist-conversation-1', 9500);
  if (run.fleet.cloudCU < 96 * U) { run.queue({ kind: 'set_cloud_capacity', cu: 96 * U }); run.step(); }
  run.queue({ kind: 'allocate_compute', serving: 144 * U, development: 8 * U, research: 0 }); run.step();
  assert.ok(replayResearchAvailable(run.state)); assert.ok(replayPaidBaseline(run.state, BASE));
  assert.deepEqual(validateState(run.state), []);
  preparedCache = { state: structuredClone(run.state), conversation }; return structuredClone(preparedCache);
}
function choices(conversation: string, shareBps?: 5000 | 7500): TrainingOptions {
  return { baseModelId: BASE, packetId: conversation, recipeId: 'compact-conversation-adaptation', profile: 'stable',
    ...(shareBps ? { curriculum: { shareBps, tracks: [{ domain: 'documents', packetIds: [DOCUMENTS] }, { domain: 'coding', packetIds: [CODING] }] } as TrainingCurriculumChoice } : {}) };
}
function payload(conversation: string, shareBps: 5000 | 7500 = 7500): Training { return { kind: 'start_training', ...choices(conversation, shareBps) }; }
function virtualRun(state: GameState, options: TrainingOptions): TrainingRun {
  const planned = buildTrainingPlan(state, state.playerCompanyId, options, CONTENT, true);
  return { id: 'virtual-run', companyId: state.playerCompanyId, baseModelId: options.baseModelId, packetId: options.packetId,
    recipeId: planned.recipe.id, outputModelId: 'virtual-model', startedWeek: state.week + 1, requiredWork: planned.requiredWork,
    completedWork: 0, physicalWork: 0, requiredMemory: planned.requiredMemory, status: 'running', checkpointWork: 0, checkpointModelId: null,
    anchorScores: planned.anchorScores, anchorReliabilityBps: planned.anchorReliabilityBps, evidence: planned.evidence, plan: planned.plan,
    lastProgress: 0, lastBottleneck: '' };
}
let completedCache: { state: GameState; runId: string; modelId: string; conversation: string } | undefined;
function completed() {
  if (completedCache) return structuredClone(completedCache);
  const initial = company(), run = new NaturalBusinessCampaign(initial.state, 'w17-curriculum-completed');
  const modelId = run.train(choices(initial.conversation, 7500)), runId = run.state.slices.models.versions[modelId].trainingRunId!;
  assert.deepEqual(validateState(run.state), []);
  completedCache = { state: structuredClone(run.state), runId, modelId, conversation: initial.conversation };
  return structuredClone(completedCache);
}
function invalidSnapshot(state: GameState, label: string) {
  assert.ok(validateState(state).length, label);
  assert.equal(deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
    contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state })).ok, false, label + ' with a newly correct checksum');
}

test('W17-C01: two replay budgets fund separate skill floors without changing ordinary targets, profile draws or preview state', () => {
  const { state, conversation } = company(), source = serializeState(state), selected = choices(conversation, 7500), originalChoice = structuredClone(selected);
  const plain = virtualRun(state, choices(conversation)), half = virtualRun(state, choices(conversation, 5000)), deep = virtualRun(state, selected);
  const single = virtualRun(state, { ...choices(conversation), replay: { domain: 'coding', shareBps: 5000, packetIds: [CODING] } });
  assert.equal(plain.requiredWork, 9_900_000_000); assert.equal(single.requiredWork, 19_800_000_000);
  assert.equal(half.requiredWork, 19_800_000_000); assert.equal(deep.requiredWork, 39_600_000_000);
  assert.equal(deep.plan!.curriculum!.nominalReplayWorkCUw, 29_700_000_000);
  assert.deepEqual(deep.plan!.curriculum!.tracks.map(track => track.nominalReplayWorkCUw), [14_850_000_000, 14_850_000_000]);
  assert.deepEqual(deep.plan!.curriculum!.tracks.map(track => track.shareBps), [3750, 3750]);
  assert.deepEqual(deep.plan!.curriculum!.tracks.map(track => track.domain), ['coding', 'documents']);
  for (const run of [half, deep]) {
    assert.equal(run.requiredMemory, plain.requiredMemory); assert.equal(run.requiredMemory, 4 * U);
    assert.equal(run.plan!.curriculum!.ordinaryIdentity, plain.plan!.identity);
    assert.deepEqual(run.plan!.savedAdjustments, plain.plan!.savedAdjustments);
    assert.deepEqual(run.plan!.targets, plain.plan!.targets); assert.deepEqual(run.anchorScores, plain.anchorScores);
    assert.deepEqual(run.plan!.corpus, plain.plan!.corpus); assert.deepEqual(run.evidence, plain.evidence);
  }
  const a = expectedTrainingOutcome(plain, plain.requiredWork), b = expectedTrainingOutcome(deep, deep.requiredWork);
  for (const domain of ['coding', 'documents'] as const) {
    assert.ok(b.capabilityBps[domain] > a.capabilityBps[domain]);
    assert.ok(b.capabilityBps[domain] <= state.slices.models.versions[BASE].capabilityBps[domain]);
  }
  for (const domain of ['conversation', 'tools'] as const) assert.equal(b.capabilityBps[domain], a.capabilityBps[domain]);
  assert.equal(b.reliabilityBps, a.reliabilityBps); assert.deepEqual(b.behavior, a.behavior);
  assert.deepEqual(b.policy, a.policy); assert.deepEqual(b.planner, a.planner);
  assert.ok(expectedTrainingOutcome(single, single.requiredWork).capabilityBps.coding > b.capabilityBps.coding);
  assert.equal(Object.hasOwn(plain.plan!, 'curriculum'), false); assert.equal(Object.hasOwn(single.plan!, 'curriculum'), false);
  assert.equal(Object.hasOwn(deep.plan!, 'replay'), false);
  assert.equal(trainingEvidenceFingerprint(plain.plan!), plain.plan!.corpus.fingerprint);
  const receipt = deep.plan!.curriculum!;
  for (const fraction of [0, .1, .5, 1, 2]) {
    const scores = applyCurriculumOutcome(receipt, { conversation: 0, documents: 0, coding: 0, tools: 0 }, deep.requiredWork * fraction, deep.requiredWork);
    for (const track of receipt.tracks) assert.equal(scores[track.domain], Math.floor(track.preservationFloorBps * Math.min(1, fraction)));
  }
  for (const option of [choices(conversation), choices(conversation, 5000), selected]) {
    const preview = getTrainingPreview(state, state.playerCompanyId, option); assert.ok(!preview.reason, preview.reason?.message);
    const result = expectedTrainingOutcome(virtualRun(state, option), preview.workCUw);
    for (const domain of ['conversation', 'documents', 'coding', 'tools'] as const) assert.ok(result.capabilityBps[domain] >= preview.capabilityRange.minimum[domain] && result.capabilityBps[domain] <= preview.capabilityRange.maximum[domain]);
  }
  for (const profile of ['balanced', 'ambitious'] as const) {
    const ordinary = virtualRun(state, { ...choices(conversation), profile });
    assert.ok(Object.values(ordinary.plan!.savedAdjustments).some(value => value !== 0), 'This profile exercises an actual saved draw.');
    for (const option of [{ ...choices(conversation, 5000), profile }, { ...selected, profile },
      { ...choices(conversation), profile, replay: { domain: 'coding' as const, shareBps: 5000 as const, packetIds: [CODING] } }]) {
      const replay = virtualRun(state, option), preview = getTrainingPreview(state, state.playerCompanyId, option);
      assert.deepEqual(replay.plan!.savedAdjustments, ordinary.plan!.savedAdjustments);
      assert.deepEqual(replay.plan!.targets, ordinary.plan!.targets);
      const outcome = expectedTrainingOutcome(replay, replay.requiredWork);
      assert.equal(outcome.capabilityBps.conversation, expectedTrainingOutcome(ordinary, ordinary.requiredWork).capabilityBps.conversation);
      for (const domain of ['conversation', 'documents', 'coding', 'tools'] as const)
        assert.ok(outcome.capabilityBps[domain] >= preview.capabilityRange.minimum[domain] && outcome.capabilityBps[domain] <= preview.capabilityRange.maximum[domain]);
    }
  }
  assert.equal(serializeState(state), source); assert.deepEqual(selected, originalChoice);
});

test('W17-C02: admission requires two distinct non-focus sources, paid research and exact prior evidence, with no adapter or one-skill stacking', () => {
  const { state, conversation } = company(), command = payload(conversation), reportId = replayPaidBaseline(state, BASE)!.id;
  assert.ok(previewCommand(state, command).accepted);
  for (const malformed of [null, false, {}, { shareBps: 2500, tracks: command.curriculum!.tracks },
    { shareBps: 7500, tracks: [] }, { ...command.curriculum, unknown: true },
    { shareBps: 7500, tracks: [command.curriculum!.tracks[0], command.curriculum!.tracks[0]] },
    { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: [] }, command.curriculum!.tracks[0]] },
    { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: [CODING, CODING] }, command.curriculum!.tracks[0]] },
    { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: ['__proto__'] }, command.curriculum!.tracks[0]] },
    { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: [CODING], baselineScoreBps: 9000 }, command.curriculum!.tracks[0]] }])
    assert.throws(() => assertTrainingCurriculumChoice(malformed));
  assert.throws(() => assertCommandShape({ ...command, replay: { domain: 'coding', shareBps: 5000, packetIds: [CODING] } }), /not both/);
  for (const changed of [
    { ...command, asAdapter: true }, { ...command, recipeId: 'behavior-reliability' },
    { ...command, curriculum: { shareBps: 7500, tracks: [{ domain: 'conversation', packetIds: [CODING] }, command.curriculum!.tracks[0]] } },
    { ...command, curriculum: { shareBps: 7500, tracks: [{ domain: 'documents', packetIds: [DOCUMENTS] }, { domain: 'coding', packetIds: [DOCUMENTS] }] } },
    { ...command, packetIds: [conversation, CODING] },
    { ...command, curriculum: { shareBps: 7500, tracks: [{ domain: 'documents', packetIds: [conversation] }, { domain: 'coding', packetIds: [CODING] }] } },
  ]) assert.equal(previewCommand(state, changed as Training).accepted, false);
  const medium = previewCommand(state, { ...command, baseModelId: 'model-natural-business-command-159' });
  assert.equal(medium.reason?.code, 'NO_IMPROVEMENT', 'Retention alone cannot admit a candidate below every existing target.');
  const cases: Array<[string, (changed: GameState) => void]> = [
    ['unearned method', value => { value.slices.research.completedByCompany[value.playerCompanyId] = value.slices.research.completedByCompany[value.playerCompanyId].filter(id => id !== 'R4C'); }],
    ['research still pending', value => { Object.values(value.slices.research.projects).find(project => project.companyId === value.playerCompanyId && project.researchId === 'R4C')!.availableWeek = value.week + 1; }],
    ['missing exact report', value => { delete value.slices.models.reports[reportId]; }],
    ['scenario report', value => { value.slices.models.reports[reportId].scenarioStart = true; }],
    ['unpaid baseline review', value => { Object.values(value.slices.models.evaluationRuns).find(run => run.reportId === reportId)!.completedStaff--; }],
    ['foreign base', value => { value.slices.models.versions[BASE].companyId = 'foreign'; }],
    ['unprepared track', value => { value.slices.data.packets[CODING].prepared = false; }],
    ['foreign track', value => { value.slices.data.packets[DOCUMENTS].companyId = 'foreign'; }],
    ['unlicensed track', value => { value.slices.data.packets[DOCUMENTS].rights.hosted = false; }],
    ['missing prior preparation', value => { const job = Object.values(value.slices.data.preparationJobs).find(job => job.packetId === CODING)!; delete value.slices.data.preparationJobs[job.id]; }],
    ['unavailable preparation', value => { Object.values(value.slices.data.preparationJobs).find(job => job.packetId === DOCUMENTS)!.completedWeek = value.week + 1; }],
    ['no relevant units', value => { value.slices.data.packets[CODING].coverageBps.coding = 0; }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(state); mutate(changed); assert.equal(previewCommand(changed, command).accepted, false, label); }
  for (const curriculum of [null, {}, { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: [] }, { domain: 'documents', packetIds: [] }] },
    { shareBps: 5000, tracks: [{ domain: 'coding', packetIds: ['missing'] }, { domain: 'documents', packetIds: ['also-missing'] }] }]) {
    const draft = getTrainingPreview(state, state.playerCompanyId, { ...choices(conversation), curriculum: curriculum as never });
    assert.ok(draft.reason); assert.ok(draft.workCUw > 0);
  }
});

test('W17-C03: independent paid cleanup discounts each role once while aliases, reordered tracks and caller mutation cannot create a fresh attempt', () => {
  const initial = company(), run = new NaturalBusinessCampaign(initial.state, 'w17-curriculum-cleanup');
  const cleanFocus = 'deduplicated-' + run.queue({ kind: 'deduplicate_data', packetId: initial.conversation });
  const cleanDocuments = 'deduplicated-' + run.queue({ kind: 'deduplicate_data', packetId: DOCUMENTS });
  const cleanCoding = 'deduplicated-' + run.queue({ kind: 'deduplicate_data', packetId: CODING });
  run.until(state => [cleanFocus, cleanDocuments, cleanCoding].every(id => state.slices.data.packets[id]?.prepared), 10, 'three paid corpus cleanups');
  const dirty = buildTrainingPlan(run.state, run.state.playerCompanyId, choices(initial.conversation, 7500), CONTENT, true);
  const cleaned: TrainingOptions = { ...choices(cleanFocus, 7500), curriculum: { shareBps: 7500,
    tracks: [{ domain: 'coding', packetIds: [cleanCoding, CODING] }, { domain: 'documents', packetIds: [cleanDocuments, DOCUMENTS] }] } };
  const clean = buildTrainingPlan(run.state, run.state.playerCompanyId, cleaned, CONTENT, true);
  assert.equal(dirty.requiredWork, 39_600_000_000); assert.equal(clean.requiredWork, 35_640_000_000);
  assert.equal(clean.plan.deduplication!.savedWorkCUw, 990_000_000);
  assert.deepEqual(clean.plan.curriculum!.tracks.map(track => track.deduplication!.savedWorkCUw), [1_485_000_000, 1_485_000_000]);
  assert.equal(clean.plan.curriculum!.nominalFocusWorkCUw, dirty.plan.curriculum!.nominalFocusWorkCUw);
  assert.equal(clean.plan.curriculum!.nominalReplayWorkCUw, dirty.plan.curriculum!.nominalReplayWorkCUw);
  assert.deepEqual(clean.plan.curriculum!.tracks.map(track => track.preservationFloorBps), dirty.plan.curriculum!.tracks.map(track => track.preservationFloorBps));
  assert.equal(clean.plan.identity, dirty.plan.identity); assert.deepEqual(clean.plan.savedAdjustments, dirty.plan.savedAdjustments);
  assert.deepEqual(expectedTrainingOutcome(virtualRun(run.state, cleaned), clean.requiredWork), expectedTrainingOutcome(virtualRun(run.state, choices(initial.conversation, 7500)), dirty.requiredWork));
  const reversed = structuredClone(cleaned); reversed.curriculum!.tracks.reverse();
  for (const track of reversed.curriculum!.tracks) track.packetIds.reverse();
  assert.deepEqual(buildTrainingPlan(run.state, run.state.playerCompanyId, reversed, CONTENT, true), clean);
  const submittedPayload: Training = { kind: 'start_training', ...structuredClone(cleaned) };
  const queued = submitCommand(run.state, submittedPayload, CONTENT, 'w17-frozen-choice'); assert.ok(queued.accepted, queued.reason?.message);
  const retained = structuredClone(queued.state.queuedCommands.find(command => command.id === 'w17-frozen-choice')!);
  submittedPayload.curriculum!.tracks[0].packetIds.push('later-caller-change'); submittedPayload.curriculum!.shareBps = 5000;
  assert.deepEqual(queued.state.queuedCommands.find(command => command.id === 'w17-frozen-choice'), retained);
  assert.equal(previewCommand(queued.state, { kind: 'start_training', ...reversed }).reason?.code, 'ALREADY_ACTIVE');
  const renamed = structuredClone(run.state); renamed.slices.models.versions[BASE].name = 'New model label'; renamed.slices.data.packets[CODING].name = 'New corpus label';
  assert.equal(buildTrainingPlan(renamed, renamed.playerCompanyId, choices(initial.conversation, 7500), CONTENT, true).plan.identity, dirty.plan.identity);
  const corpora = cleaned.curriculum!.tracks.map(track => getCorpusEvidence(run.state, run.state.playerCompanyId, track.packetIds)) as [CorpusEvidence, CorpusEvidence];
  const fractional = createTrainingCurriculumReceipt(run.state, run.state.slices.models.versions[BASE], cleaned.curriculum!, corpora, dirty.plan.curriculum!.ordinaryIdentity, 5, 5)!;
  assert.equal(fractional.nominalReplayWorkCUw, 15); assert.deepEqual(fractional.tracks.map(track => track.nominalReplayWorkCUw), [8, 7]);
});

test('W17-C04: real ML and development grants fund checkpoints, partial floors, pause and exact continuation without automatic release', () => {
  const initial = company(), run = new NaturalBusinessCampaign(initial.state, 'w17-curriculum-progress');
  const originalOffers = playerConfiguration(run.state);
  const members = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  const serving = run.fleet.allocation.serving;
  for (const member of members) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('commercial');
  // This historical company also loses its on-site rack operators for the week.
  run.queue({ kind: 'allocate_compute', serving: Math.min(serving, run.fleet.cloudCU - 8 * U), development: 8 * U, research: 0 });
  const runId = 'training-' + run.queue({ ...payload(initial.conversation), automatedCheckpoints: true }); run.step();
  const current = () => run.state.slices.models.trainingRuns[runId];
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'ml'), 0);
  assert.equal(current().completedWork, 0); assert.equal(current().physicalWork, 0);
  for (const member of members) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 }); run.step();
  assert.equal(current().completedWork, 0); assert.equal(current().physicalWork, 0);
  run.queue({ kind: 'allocate_compute', serving, development: 2 * U, research: 0 });
  run.until(() => !!current().checkpointModelIds?.length, 10, 'first paid curriculum checkpoint');
  const frozen = canonicalStateHash(current().plan!.curriculum), paidWork = current().completedWork, paidPhysical = current().physicalWork;
  const checkpoints = Object.fromEntries(current().checkpointModelIds!.map(id => [id, canonicalStateHash(run.state.slices.models.versions[id])]));
  assert.ok(paidWork > 0 && paidPhysical > 0); assert.ok(current().checkpointOverheadCompleted! > 0);
  assert.equal(current().plan!.checkpointOverheadRequired, 2 * U);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.step(2);
  assert.equal(current().completedWork, paidWork); assert.equal(current().physicalWork, paidPhysical); assert.equal(canonicalStateHash(current().plan!.curriculum), frozen);
  const saved = serializeState(run.state), loaded = deserializeState(saved); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); assert.equal(serializeState(loaded.state), saved);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: false });
  const reopening = deserializeState(serializeState(run.state)); assert.ok(reopening.ok, reopening.ok ? '' : reopening.error);
  const second = new NaturalBusinessCampaign(reopening.state, 'w17-curriculum-no-more-commands');
  let executedAfterResume = 0, paidAfterResumeCents = 0;
  const overheadBefore = current().checkpointOverheadCompleted!;
  for (let week = 0; week < 40 && current().status !== 'complete'; week++) {
    run.step(); second.step(); assert.equal(canonicalStateHash(run.state), canonicalStateHash(second.state));
    const costs = run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
    const row = costs.workloads.find(row => row.requestId === runId + ':work');
    executedAfterResume += row?.effectiveWorkCUw ?? 0; paidAfterResumeCents += row?.ownedVariableCents ?? 0;
  }
  assert.equal(current().status, 'complete'); assert.equal(current().completedWork, current().requiredWork);
  assert.equal(current().checkpointOverheadCompleted, 2 * U); assert.equal(current().checkpointModelIds!.length, 10);
  assert.equal(executedAfterResume, current().requiredWork - paidWork + 2 * U - overheadBefore); assert.ok(paidAfterResumeCents > 0);
  for (const [id, checksum] of Object.entries(checkpoints)) assert.equal(canonicalStateHash(run.state.slices.models.versions[id]), checksum);
  assert.equal(canonicalStateHash(current().plan!.curriculum), frozen);
  const model = run.state.slices.models.versions[current().outputModelId];
  assert.equal(model.trainingEvidenceId, trainingEvidenceFingerprint(current().plan!));
  assert.equal(Object.values(run.state.slices.models.reports).some(report => report.modelId === model.id), false);
  assert.equal(playerConfiguration(run.state), originalOffers);
  assert.deepEqual(validateState(run.state), []);
});

test('W17-C05: each replay corpus constrains distribution rights through later paid descendants and exact evaluation remains separate', () => {
  const initial = company(), run = new NaturalBusinessCampaign(initial.state, 'w17-curriculum-rights');
  assert.deepEqual(inheritedModelRights(run.state, TRANSFERABLE_BASE, CONTENT), { hosted: true, weights: true });
  const choice: TrainingOptions = { ...choices(initial.conversation, 7500), baseModelId: TRANSFERABLE_BASE,
    curriculum: { shareBps: 7500, tracks: [{ domain: 'documents', packetIds: [DOCUMENTS] }, { domain: 'coding', packetIds: [FEEDBACK] }] } };
  const modelId = run.train(choice), model = run.state.slices.models.versions[modelId], training = run.state.slices.models.trainingRuns[model.trainingRunId!];
  assert.equal(training.plan!.corpus.rights.weights, true);
  assert.equal(training.plan!.curriculum!.tracks.find(track => track.domain === 'documents')!.corpus.rights.weights, true);
  assert.equal(training.plan!.curriculum!.tracks.find(track => track.domain === 'coding')!.corpus.rights.weights, false);
  assert.deepEqual(inheritedModelRights(run.state, modelId, CONTENT), { hosted: true, weights: false });
  assert.deepEqual(inheritedModelRights(run.state, TRANSFERABLE_BASE, CONTENT), { hosted: true, weights: true });
  assert.equal(Object.values(run.state.slices.models.reports).some(report => report.modelId === modelId), false);
  run.evaluate(modelId);
  const report = Object.values(run.state.slices.models.reports).find(report => report.modelId === modelId && report.suiteId === 'expanded-capabilities-1')!;
  const paid = Object.values(run.state.slices.models.evaluationRuns).find(evaluation => evaluation.reportId === report.id)!;
  assert.equal(paid.completedWork, paid.requiredWork); assert.equal(paid.completedStaff, paid.requiredStaff);
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...choice, baseModelId: modelId }).reason?.code, 'NO_IMPROVEMENT', 'A new paid baseline cannot reset the same lineage curriculum.');
  const descendant = run.train({ baseModelId: modelId, packetId: initial.conversation, recipeId: 'behavior-reliability' });
  assert.deepEqual(run.state.slices.models.versions[descendant].capabilityBps, model.capabilityBps);
  assert.deepEqual(inheritedModelRights(run.state, descendant, CONTENT), { hosted: true, weights: false });
  assert.deepEqual(validateState(run.state), []);
});

test('W17-C06: checksum-correct imports cannot forge curriculum costs, evidence, chronology, identity, paid work or model outcomes', () => {
  const base = completed(), selected = (state: GameState) => state.slices.models.trainingRuns[base.runId];
  const cases: Array<[string, (state: GameState) => void]> = [
    ['unaccepted command', state => { delete state.commandReceipts[base.runId.slice('training-'.length)]; }],
    ['missing research method', state => { selected(state).plan!.methods = selected(state).plan!.methods.filter(id => id !== 'R4C'); }],
    ['base fingerprint', state => { selected(state).plan!.curriculum!.baseModelFingerprint = '00000000'; }],
    ['missing baseline report', state => { selected(state).plan!.curriculum!.baselineReportId = 'missing-report'; }],
    ['invented incoming skill', state => { selected(state).plan!.curriculum!.tracks[0].baselineScoreBps++; }],
    ['free retention', state => { selected(state).plan!.curriculum!.tracks[0].preservationFloorBps++; }],
    ['wrong total budget', state => { selected(state).plan!.curriculum!.shareBps = 5000; }],
    ['wrong track share', state => { selected(state).plan!.curriculum!.tracks[0].shareBps = 2500; }],
    ['noncanonical saved track order', state => { selected(state).plan!.curriculum!.tracks.reverse(); }],
    ['invented nominal focus work', state => { selected(state).plan!.curriculum!.nominalFocusWorkCUw--; }],
    ['invented nominal replay work', state => { selected(state).plan!.curriculum!.nominalReplayWorkCUw--; }],
    ['invented focus saving', state => { selected(state).plan!.curriculum!.focusWorkCUw--; }],
    ['unpaid replay unit', state => { const run = selected(state); run.plan!.curriculum!.tracks[0].replayWorkCUw--; run.plan!.curriculum!.replayWorkCUw--; run.requiredWork--; run.completedWork--; }],
    ['fake cleanup', state => { selected(state).plan!.curriculum!.tracks[0].deduplication = { sourceIds: ['specialist-coding-1'], originalWorkCUw: 14_850_000_000, savedWorkCUw: 1_485_000_000, reductionBps: 1000 }; }],
    ['changed source fingerprint', state => { selected(state).plan!.curriculum!.tracks[0].corpus.fingerprint = 'corpus-00000000'; }],
    ['changed source rights', state => { selected(state).plan!.curriculum!.tracks[0].corpus.rights.weights = false; }],
    ['invented coverage', state => { selected(state).plan!.curriculum!.tracks[0].coverageBps--; }],
    ['invented quality', state => { selected(state).plan!.curriculum!.tracks[0].qualityBps--; }],
    ['rerolled identity', state => { selected(state).plan!.curriculum!.ordinaryIdentity = 'training-identity-00000000'; }],
    ['rerolled profile', state => { selected(state).plan!.savedAdjustments.conversation++; }],
    ['lost combined evidence', state => { state.slices.models.versions[base.modelId].trainingEvidenceId = selected(state).plan!.corpus.fingerprint; }],
    ['free model score', state => { state.slices.models.versions[base.modelId].capabilityBps.coding++; }],
    ['extra receipt field', state => { Object.assign(selected(state).plan!.curriculum!, { freeSkill: true }); }],
    ['extra track field', state => { Object.assign(selected(state).plan!.curriculum!.tracks[0], { newTargetBps: 9999 }); }],
  ];
  for (const [label, mutate] of cases) { const changed = structuredClone(base.state); mutate(changed); invalidSnapshot(changed, label); }
  const overlap = structuredClone(base.state), run = selected(overlap), previous = run.plan!.curriculum!;
  const choice: TrainingCurriculumChoice = { shareBps: 7500, tracks: [{ domain: 'coding', packetIds: [CODING] }, { domain: 'documents', packetIds: [CODING] }] };
  const corpus = getCorpusEvidence(overlap, run.companyId, [CODING]), corpora: [CorpusEvidence, CorpusEvidence] = [corpus, corpus];
  run.plan!.curriculum = createTrainingCurriculumReceipt(overlap, overlap.slices.models.versions[BASE], choice, corpora,
    previous.ordinaryIdentity, previous.nominalFocusWorkCUw, previous.focusWorkCUw, previous.baselineReportId)!;
  run.plan!.identity = curriculumAdmissionIdentity(previous.ordinaryIdentity, choice, corpora);
  assert.throws(() => assertTrainingCurriculum(overlap, run, previous.ordinaryIdentity, previous.nominalFocusWorkCUw, previous.focusWorkCUw, CONTENT), /reused a source/);
  invalidSnapshot(overlap, 'self-consistent overlapping-source receipt');
  for (const lateKind of ['preparation', 'research'] as const) {
    const late = structuredClone(base.state), saved = selected(late), receipt = saved.plan!.curriculum!;
    if (lateKind === 'preparation') Object.values(late.slices.data.preparationJobs).find(job => job.packetId === CODING)!.completedWeek = saved.startedWeek;
    else Object.values(late.slices.research.projects).find(project => project.companyId === late.playerCompanyId && project.researchId === 'R4C')!.availableWeek = saved.startedWeek;
    assert.throws(() => assertTrainingCurriculum(late, saved, receipt.ordinaryIdentity, receipt.nominalFocusWorkCUw, receipt.focusWorkCUw, CONTENT));
  }
  const twin = structuredClone(base.state); selected(twin).plan!.replay = structuredClone(Object.values(twin.slices.models.trainingRuns).find(run => run.plan?.replay)!.plan!.replay!);
  invalidSnapshot(twin, 'stacked old and new replay receipts');
  assert.equal(CURRICULUM_RULES.maximumPacketsPerTrack, 20);
});
