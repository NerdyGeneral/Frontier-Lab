import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, StaffRole } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { buildTrainingPlan, getCorpusEvidence } from '../src/modules/lab-planner';
import { dataProcessingProfile, deduplicationRollout, getDataQualityView } from '../src/modules/data-quality';
import { hasResearch } from '../src/modules/research';
import { emptyRoleAllocation } from '../src/modules/workforce';

/** The setup is an ordinary company; only accepted commands and real weeks change it. */
class DataCampaign {
  constructor(public state: GameState = createInitialState()) {}
  get id() { return this.state.playerCompanyId; }
  queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload);
    assert.equal(result.accepted, true, result.reason?.message); this.state = result.state; return result.commandId!;
  }
  step(): void {
    const queued = this.state.queuedCommands.filter(command => command.companyId === this.id).map(command => command.id);
    const result = advanceWeek(this.state); assert.equal(result.accepted, true, result.reason?.message); this.state = result.state;
    for (const id of queued) assert.equal(this.state.commandReceipts[id].status, 'accepted', this.state.commandReceipts[id].reason?.message);
    assert.equal(this.state.slices.company.companies[this.id].arrearsCents, 0);
  }
  until(done: () => boolean, limit = 60): void { for (let week = 0; week < limit && !done(); week++) this.step(); assert.ok(done(), 'The paid project must finish with sufficient resource grants.'); }
  founder(role: StaffRole): void { this.queue({ kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), [role]: U } }); }
  allocation(development: number, research = 0): void { this.queue({ kind: 'allocate_compute', serving: 0, development, research }); }
  learn(id: string): void {
    if (hasResearch(this.state, this.id, id)) return;
    const definition = CONTENT.research.find(item => item.id === id)!;
    for (const prerequisite of definition.requires) this.learn(prerequisite);
    this.founder(definition.role); this.allocation(0, 4 * U); this.queue({ kind: 'start_research', researchId: id });
    this.until(() => hasResearch(this.state, this.id, id));
  }
  prepare(catalogId?: string): string {
    const packetId = catalogId ? `data-${this.id}-${catalogId}` : CONTENT.starterData.id;
    if (catalogId) { this.queue({ kind: 'buy_data', catalogId }); this.step(); }
    this.founder('data'); this.queue({ kind: 'prepare_data', packetId }); this.until(() => this.state.slices.data.packets[packetId].prepared); return packetId;
  }
  clean(packetId = CONTENT.starterData.id): string {
    this.founder('data'); const commandId = this.queue({ kind: 'deduplicate_data', packetId });
    const outputId = 'deduplicated-' + commandId;
    this.until(() => !!this.state.slices.data.packets[outputId]?.prepared); return outputId;
  }
}

let researched: GameState | undefined, installed: GameState | undefined;
function researchedCompany(): DataCampaign {
  if (!researched) { const run = new DataCampaign(); run.prepare(); run.learn('R2A'); researched = structuredClone(run.state); }
  return new DataCampaign(structuredClone(researched));
}
function installedCompany(): DataCampaign {
  if (!installed) {
    const run = researchedCompany(); run.founder('ml'); run.allocation(4 * U);
    run.queue({ kind: 'start_system_rollout', method: 'deduplication' }); run.until(() => deduplicationRollout(run.state, run.id)?.status === 'active');
    installed = structuredClone(run.state);
  }
  return new DataCampaign(structuredClone(installed));
}
const options = (packetId: string) => ({ baseModelId: CONTENT.seedModel.id, packetId, recipeId: CONTENT.firstTraining.id });

test('W6-D01: deduplication requires research and independently paid rollout meters before use', () => {
  const initial = createInitialState();
  assert.equal(previewCommand(initial, { kind: 'deduplicate_data', packetId: CONTENT.starterData.id }).accepted, false);
  const run = researchedCompany();
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: CONTENT.starterData.id }).accepted, false, 'Discovery alone does not clean a dataset.');
  run.founder('data'); run.allocation(4 * U);
  run.queue({ kind: 'start_system_rollout', method: 'deduplication' }); run.step();
  let rollout = deduplicationRollout(run.state, run.id)!;
  assert.equal(rollout.completedWork, U); assert.equal(rollout.completedStaff, 0); assert.equal(rollout.status, 'building');
  assert.equal(run.state.slices.compute.fleets[run.id].lastWork.development, U);
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: CONTENT.starterData.id }).accepted, false);
  run.founder('ml'); run.allocation(0); run.step(); rollout = deduplicationRollout(run.state, run.id)!;
  assert.equal(rollout.completedStaff, U); assert.equal(rollout.status, 'ready');
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: CONTENT.starterData.id }).accepted, false, 'A completed rollout activates at the next boundary.');
  run.step(); assert.equal(deduplicationRollout(run.state, run.id)!.status, 'active');
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: CONTENT.starterData.id }).accepted, true);
  assert.ok(run.state.slices.company.companies[run.id].cashCents < initial.slices.company.companies[run.id].cashCents);
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D02: cleanup pays data effort, pauses without free progress, and preserves its immutable source', () => {
  const run = installedCompany(), original = structuredClone(run.state.slices.data.packets[CONTENT.starterData.id]);
  run.queue({ kind: 'assign_founder', allocations: { ...emptyRoleAllocation(), data: U / 2, research: U / 2 } });
  const commandId = run.queue({ kind: 'deduplicate_data', packetId: original.id });
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: original.id }).reason?.code, 'ALREADY_ACTIVE');
  run.step();
  const outputId = 'deduplicated-' + commandId, jobId = 'preparation-' + commandId;
  assert.equal(run.state.slices.data.preparationJobs[jobId].completedStaff, U / 2);
  assert.equal(run.state.slices.data.packets[outputId].prepared, false);
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(outputId) }).accepted, false);
  run.queue({ kind: 'set_job_paused', jobId, paused: true }); run.founder('data'); run.step();
  assert.equal(run.state.slices.data.preparationJobs[jobId].completedStaff, U / 2);
  run.queue({ kind: 'set_job_paused', jobId, paused: false }); run.step();
  const cleaned = run.state.slices.data.packets[outputId];
  assert.equal(cleaned.prepared, true); assert.equal(cleaned.readyUnits, original.readyUnits);
  assert.deepEqual(run.state.slices.data.packets[original.id], original);
  assert.equal(cleaned.qualityBps, original.qualityBps); assert.deepEqual(cleaned.coverageBps, original.coverageBps); assert.deepEqual(cleaned.rights, original.rights);
  assert.deepEqual(cleaned.sourceIds, original.sourceIds); assert.equal(cleaned.broadUnits, original.broadUnits); assert.equal(cleaned.behaviorUnits, original.behaviorUnits);
  assert.equal(cleaned.deduplication!.sourceUnits, 100); assert.equal(cleaned.deduplication!.duplicateProcessingUnits, 10);
  assert.equal(cleaned.deduplication!.processedUnits, 110); assert.equal(cleaned.deduplication!.reductionBps, 909);
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: outputId }).reason?.code, 'NO_IMPROVEMENT');
  assert.equal(previewCommand(run.state, { kind: 'deduplicate_data', packetId: original.id }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D03: cleaned evidence saves future update work without changing targets, identity, or distinct source accounting', () => {
  const run = installedCompany(), cleanedId = run.clean();
  const original = buildTrainingPlan(run.state, run.id, options(CONTENT.starterData.id), CONTENT, true);
  const cleaned = buildTrainingPlan(run.state, run.id, options(cleanedId), CONTENT, true);
  const combined = buildTrainingPlan(run.state, run.id, { ...options(cleanedId), packetIds: [CONTENT.starterData.id, cleanedId] }, CONTENT, true);
  assert.equal(original.requiredWork, 12 * U); assert.equal(cleaned.requiredWork, 10_909_200_000);
  assert.equal(cleaned.plan.deduplication!.savedWorkCUw, 1_090_800_000);
  assert.equal(cleaned.plan.identity, original.plan.identity); assert.equal(combined.plan.identity, original.plan.identity);
  assert.equal(cleaned.plan.corpus.fingerprint, original.plan.corpus.fingerprint);
  assert.equal(combined.plan.corpus.distinctUnits, 100); assert.equal(combined.requiredWork, cleaned.requiredWork);
  assert.deepEqual(cleaned.plan.targets, original.plan.targets); assert.deepEqual(cleaned.plan.savedAdjustments, original.plan.savedAdjustments);
  assert.deepEqual(cleaned.plan.behaviorTarget, original.plan.behaviorTarget); assert.equal(cleaned.requiredMemory, original.requiredMemory);
  assert.deepEqual(cleaned.plan.checkpoints, original.plan.checkpoints);
  const pending = run.queue({ kind: 'start_training', ...options(cleanedId) });
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(CONTENT.starterData.id) }).reason?.code, 'ALREADY_ACTIVE');
  run.founder('ml'); run.allocation(4 * U); run.until(() => run.state.slices.models.trainingRuns['training-' + pending]?.status === 'complete');
  const completed = run.state.slices.models.trainingRuns['training-' + pending];
  assert.equal(completed.physicalWork, cleaned.requiredWork);
  assert.deepEqual(run.state.slices.models.versions[completed.outputModelId].capabilityBps, { conversation: 4800, documents: 3056, coding: 2000, tools: 2080 });
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(CONTENT.starterData.id) }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D04: a later cleanup cannot reprice an admitted run or create a second roll of its outcome', () => {
  const run = installedCompany(); run.founder('ml'); run.allocation(0);
  const commandId = run.queue({ kind: 'start_training', ...options(CONTENT.starterData.id), profile: 'stable' }); run.step();
  const runId = 'training-' + commandId, saved = structuredClone(run.state.slices.models.trainingRuns[runId].plan);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.step();
  const cleanedId = run.clean();
  assert.deepEqual(run.state.slices.models.trainingRuns[runId].plan, saved);
  assert.equal(run.state.slices.models.trainingRuns[runId].requiredWork, 13_200_000_000);
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(cleanedId), profile: 'stable' }).reason?.code, 'ALREADY_ACTIVE');
  assert.equal(previewCommand(run.state, { kind: 'start_training', ...options(cleanedId), profile: 'balanced' }).reason?.code, 'ALREADY_ACTIVE');
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D05: curation retains earned cleanup but a lower-quality cleaned copy cannot discount stronger dirty evidence', () => {
  const run = installedCompany(), cleanedId = run.clean();
  const dirtyCuration = run.queue({ kind: 'curate_data', packetId: CONTENT.starterData.id });
  const dirtyId = 'curated-' + dirtyCuration; run.until(() => !!run.state.slices.data.packets[dirtyId]?.prepared);
  const mixed = buildTrainingPlan(run.state, run.id, { ...options(dirtyId), packetIds: [dirtyId, cleanedId] });
  assert.equal(mixed.plan.corpus.distinctUnits, 100); assert.equal(mixed.plan.corpus.qualityBps.conversation, 9000);
  assert.equal(mixed.plan.deduplication, undefined); assert.equal(mixed.requiredWork, 12 * U);
  const clean90 = run.clean(dirtyId), before = structuredClone(run.state.slices.data.packets[clean90].deduplication);
  const curate = run.queue({ kind: 'curate_data', packetId: clean90 }), clean95 = 'curated-' + curate;
  run.until(() => !!run.state.slices.data.packets[clean95]?.prepared);
  assert.equal(run.state.slices.data.packets[clean95].qualityBps, 9500);
  assert.deepEqual(run.state.slices.data.packets[clean95].deduplication, before);
  assert.equal(getCorpusEvidence(run.state, run.id, [CONTENT.starterData.id, cleanedId, dirtyId, clean90, clean95]).distinctUnits, 100);
  assert.equal(buildTrainingPlan(run.state, run.id, options(clean95)).requiredWork, 10_909_200_000);
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D06: partial corpus cleanup is weighted once and composes after efficient adaptation', () => {
  const run = installedCompany(), cleanId = run.clean(), otherId = run.prepare('specialist-documents-1');
  const combined = buildTrainingPlan(run.state, run.id, { ...options(cleanId), packetIds: [cleanId, CONTENT.starterData.id, otherId] });
  assert.equal(combined.plan.corpus.distinctUnits, 220); assert.equal(combined.plan.deduplication!.reductionBps, 413);
  assert.deepEqual(combined.plan.deduplication!.sourceIds, ['starter-public']);
  assert.equal(dataProcessingProfile(run.state.slices.data.packets[otherId]).reductionBps, 1000, 'Authored repeated passes cannot exceed the ten-percent saving cap.');
  run.learn('R4');
  const efficient = buildTrainingPlan(run.state, run.id, options(cleanId));
  assert.equal(efficient.plan.deduplication!.originalWorkCUw, 9 * U);
  assert.equal(efficient.requiredWork, 8_181_900_000);
  assert.deepEqual(efficient.plan.methods.filter(id => id === 'R4' || id === 'R2A'), ['R4', 'R2A']);
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D07: forged cleanup receipts, rights, work grants and unpaid revisions fail snapshot validation', () => {
  const run = installedCompany(), cleanId = run.clean();
  run.founder('ml'); run.allocation(0);
  const commandId = run.queue({ kind: 'start_training', ...options(cleanId) }); run.step();
  const runId = 'training-' + commandId;
  const corruptions: ((state: GameState) => void)[] = [
    state => { state.slices.data.packets[cleanId].deduplication!.reductionBps = 2000; },
    state => { state.slices.data.packets[cleanId].deduplication!.duplicateProcessingUnits++; },
    state => { state.slices.data.packets[cleanId].deduplication!.rolloutId = 'missing-rollout'; },
    state => { state.slices.data.packets[cleanId].sourceIds = ['invented-source']; },
    state => { state.slices.data.packets[cleanId].rights.feedback = true; },
    state => { state.slices.data.packets[cleanId].rawUnits++; },
    state => { const job = Object.values(state.slices.data.preparationJobs).find(job => job.packetId === cleanId)!; job.requiredStaff = U / 2; job.completedStaff = U / 2; },
    state => { const job = Object.values(state.slices.data.preparationJobs).find(job => job.packetId === cleanId)!; job.status = 'running'; job.completedStaff = 0; delete job.completedWeek; },
    state => { delete state.slices.models.trainingRuns[runId].plan!.deduplication; },
    state => { state.slices.models.trainingRuns[runId].requiredWork--; },
    state => { state.slices.models.trainingRuns[runId].plan!.deduplication!.savedWorkCUw++; },
  ];
  for (const corrupt of corruptions) { const bad = structuredClone(run.state); corrupt(bad); assert.ok(validateState(bad).length > 0, 'Corrupted cleanup evidence must be rejected.'); }
  assert.deepEqual(validateState(run.state), []);
});

test('W6-D08: cleaned revisions and frozen training requirements survive deterministic save/load and continued work', () => {
  const run = installedCompany(), cleanId = run.clean(); run.founder('ml'); run.allocation(4 * U);
  const id = run.queue({ kind: 'start_training', ...options(cleanId) }); run.step();
  const encoded = serializeState(run.state), loaded = deserializeState(encoded);
  assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.error); if (!loaded.ok) return;
  assert.equal(canonicalStateHash(loaded.state), canonicalStateHash(run.state));
  const after = advanceWeek(run.state), replay = advanceWeek(loaded.state);
  assert.equal(after.accepted, true, after.reason?.message); assert.equal(replay.accepted, true, replay.reason?.message);
  assert.equal(canonicalStateHash(after.state), canonicalStateHash(replay.state));
  assert.equal(after.state.slices.models.trainingRuns['training-' + id].requiredWork, 10_909_200_000);
  assert.equal(getDataQualityView(run.state, run.state.slices.data.packets[cleanId]).cleaned, true);
  if (process.env.DATA_CAMPAIGN_EXPORT) { mkdirSync(dirname(process.env.DATA_CAMPAIGN_EXPORT), { recursive: true }); writeFileSync(process.env.DATA_CAMPAIGN_EXPORT, encoded); }
});
