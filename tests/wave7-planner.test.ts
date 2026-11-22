import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState } from '../src/contracts/types';
import { previewCommand, advanceWeek } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/validation';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { buildTrainingPlan } from '../src/modules/lab-planner';

const baseId = 'model-natural-business-command-4';
const packetId = 'curated-natural-business-command-54';
function load() { const result = deserializeState(readFileSync(join(__dirname, 'fixtures/wave6-snapshot.json'), 'utf8')); assert.ok(result.ok, result.ok ? '' : result.error); return result.state; }
let researched: GameState | undefined;
function company(prefix: string) {
  if (!researched) {
    const run = new NaturalBusinessCampaign(load(), 'planner-research');
    assert.equal(previewCommand(run.state, { kind: 'start_training', baseModelId: baseId, packetId, recipeId: 'planner-curriculum' }).accepted, false);
    run.discover('R11').discover('R11A'); researched = structuredClone(run.state);
  }
  return new NaturalBusinessCampaign(structuredClone(researched), prefix);
}
const options = { baseModelId: baseId, packetId, recipeId: 'planner-curriculum' };
let trained: { state: GameState; modelId: string } | undefined;
function completed() {
  if (!trained) { const run = company('planner-complete'), modelId = run.train(options); trained = { state: structuredClone(run.state), modelId }; }
  return structuredClone(trained);
}

test('W7-P01: planner curriculum earns finite partial and final gains from paid work and behavior evidence', () => {
  const run = company('planner-paid'), original = structuredClone(run.state.slices.models.versions[baseId]);
  const id = run.queue({ kind: 'start_training', ...options }), runId = 'training-' + id;
  run.step();
  let training = run.state.slices.models.trainingRuns[runId];
  assert.equal(training.requiredWork, 16 * U); assert.equal(training.completedWork, 6 * U); assert.equal(training.physicalWork, 6 * U);
  assert.deepEqual(training.plan?.planner, { baselineRepeatBps: 10000, currentRepeatBps: 8000 });
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.step(2);
  assert.equal(run.state.slices.models.trainingRuns[runId].completedWork, 6 * U);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: false }); run.until(state => state.slices.models.trainingRuns[runId].status === 'complete');
  training = run.state.slices.models.trainingRuns[runId];
  const model = run.state.slices.models.versions[training.outputModelId], half = run.state.slices.models.versions['checkpoint-' + runId];
  assert.deepEqual(half.planner, { baselineRepeatBps: 10000, currentRepeatBps: 9050 });
  assert.deepEqual(model.planner, { baselineRepeatBps: 10000, currentRepeatBps: 8100 });
  assert.equal(training.physicalWork, 16 * U); assert.equal(model.status, 'checkpoint');
  assert.deepEqual(model.capabilityBps, original.capabilityBps); assert.equal(model.reliabilityBps, original.reliabilityBps);
  assert.deepEqual(model.behavior, original.behavior); assert.equal(model.residentMU, original.residentMU);
  assert.equal(model.evaluationReportId, undefined); assert.deepEqual(run.state.slices.models.versions[baseId], original);
  assert.deepEqual(validateState(run.state, CONTENT), []);
});

test('W7-P02: duplicate identities and new corpora cannot compound or reroll the planner target', () => {
  const { state, modelId } = completed();
  assert.equal(previewCommand(state, { kind: 'start_training', ...options }).reason?.code, 'NO_IMPROVEMENT');
  const different = { ...options, baseModelId: modelId, packetId: 'curated-natural-business-command-111' };
  const plan = buildTrainingPlan(state, state.playerCompanyId, different);
  assert.deepEqual(plan.plan.planner, { baselineRepeatBps: 10000, currentRepeatBps: 8000 });
  assert.equal(previewCommand(state, { kind: 'start_training', ...different }).reason?.code, 'NO_IMPROVEMENT');
  const broad = previewCommand(state, { kind: 'start_training', ...options, packetId: 'curated-natural-business-command-124' });
  assert.equal(broad.accepted, false); assert.match(broad.reason!.message, /behavior cases/);
});

test('W7-P03: later behavior training preserves the earned planner while requiring its own work and evaluation', () => {
  const saved = completed(), run = new NaturalBusinessCampaign(saved.state, 'planner-descendant');
  const modelId = run.train({ baseModelId: saved.modelId, packetId: 'curated-natural-business-command-111', recipeId: 'behavior-reliability' });
  const source = run.state.slices.models.versions[saved.modelId], model = run.state.slices.models.versions[modelId];
  assert.deepEqual(model.planner, source.planner); assert.deepEqual(model.capabilityBps, source.capabilityBps);
  assert.ok(model.reliabilityBps > source.reliabilityBps); assert.equal(model.evaluationReportId, undefined);
  assert.deepEqual(validateState(run.state, CONTENT), []);
});

test('W7-P04: planner imports reject unearned, excessive, missing and altered lineage traits', () => {
  const saved = completed(), current = saved.state.slices.models.versions[saved.modelId], runId = current.trainingRunId!;
  for (const mutate of [
    (s: GameState) => { s.slices.models.versions[saved.modelId].planner!.currentRepeatBps = 7999; },
    (s: GameState) => { s.slices.models.versions[saved.modelId].planner!.currentRepeatBps = 8000; },
    (s: GameState) => { delete s.slices.models.versions[saved.modelId].planner; },
    (s: GameState) => { s.slices.models.versions[CONTENT.seedModel.id].planner = { baselineRepeatBps: 10000, currentRepeatBps: 8100 }; },
    (s: GameState) => { s.slices.models.trainingRuns[runId].plan!.planner!.baselineRepeatBps = 8100; },
    (s: GameState) => { const discovery = Object.values(s.slices.research.projects).find(project => project.companyId === s.playerCompanyId && project.researchId === 'R11A')!; s.slices.models.trainingRuns[runId].startedWeek = discovery.availableWeek! - 1; },
  ]) {
    const state = structuredClone(saved.state); mutate(state);
    const result = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: 5, contentVersion: CONTENT.version, checksum: canonicalStateHash(state), state }));
    assert.equal(result.ok, false);
  }
});

test('W7-P05: save and reload preserve planner checkpoints and future ordinary outcomes', () => {
  let left = completed().state;
  const loaded = deserializeState(serializeState(left)); assert.ok(loaded.ok, loaded.ok ? '' : loaded.error); let right = loaded.state;
  for (let i = 0; i < 3; i++) {
    const a = advanceWeek(left), b = advanceWeek(right); assert.ok(a.accepted, a.reason?.message); assert.ok(b.accepted, b.reason?.message);
    left = a.state; right = b.state; assert.equal(canonicalStateHash(left), canonicalStateHash(right));
  }
});
