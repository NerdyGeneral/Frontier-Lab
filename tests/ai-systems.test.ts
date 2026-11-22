import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { AI_SYSTEM_DEFAULTS, AI_SYSTEM_RESEARCH, AI_SYSTEM_RESEARCH_IDS } from '../src/content/ai-systems';
import { DEFAULT_FEATURES } from '../src/content/wave2-market';
import { DEFAULT_MODEL_CUSTOMIZATION } from '../src/content/model-customization';
import type { AISystemSpec } from '../src/contracts/ai-systems';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { aiSystemShapeRejection, getAISystemEffects, getAISystemMetrics, getAISystemResearchIds } from '../src/modules/ai-systems';
import { DEFAULT_MODEL_DESIGN, getAISystemForecastModel, getModelDesignForecast, getModelDesignForBase, modelDesignShapeRejection } from '../src/modules/model-design';
import { buildCustomTrainingPlan, customSystemEvidenceRejection } from '../src/modules/model-design-training';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { requestMeter } from '../src/modules/product-models';
import { getCustomizationReadyFixture } from './fixtures/model-customization';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const expert: AISystemSpec = { ...AI_SYSTEM_DEFAULTS.experts, experts: 16, activeExperts: 2, routing: 'balanced', specialization: 'coding' };
const stateful: AISystemSpec = { ...AI_SYSTEM_DEFAULTS.stateful, stateSlots: 256, memory: 'selective', repair: true };
const adaptive: AISystemSpec = { ...AI_SYSTEM_DEFAULTS.adaptive, maxPasses: 8, search: 'branching', verifier: 'independent', stopping: 'fixed' };
function design(system?: AISystemSpec): ModelDesignSpec {
  return { ...structuredClone(DEFAULT_MODEL_DESIGN), name: system?.kind ?? 'Standard comparison', mode: 'foundation', parameterMillions: 8000,
    computeBudgetCUw: 800 * U, dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 },
    ...(system ? { system: structuredClone(system) } : {}) };
}
const payload = (packetId: string, spec: ModelDesignSpec, baseModelId = CONTENT.seedModel.id) => ({
  kind: 'start_training' as const, baseModelId, packetId, packetIds: [packetId], recipeId: `custom-model-${spec.mode}`, modelDesign: spec,
});
function restored(state: GameState): GameState {
  const parsed = deserializeState(serializeState(state)); assert.ok(parsed.ok, parsed.ok ? undefined : parsed.error); return parsed.state;
}

test('all twelve discoveries unlock explicit choices and malformed or unearned systems cannot enter training', () => {
  assert.equal(AI_SYSTEM_RESEARCH.length, 12);
  assert.deepEqual(AI_SYSTEM_RESEARCH.map(item => item.id), [...AI_SYSTEM_RESEARCH_IDS]);
  for (const research of AI_SYSTEM_RESEARCH) assert.ok(CONTENT.research.some(item => item.id === research.id && item.implemented));
  assert.deepEqual(new Set([expert, stateful, { ...adaptive, stopping: 'confidence' } as AISystemSpec].flatMap(getAISystemResearchIds)), new Set(AI_SYSTEM_RESEARCH_IDS));
  for (const value of [null, {}, { ...expert, version: 2 }, { ...expert, activeExperts: 16 }, { ...expert, specialty: 'coding' },
    { ...stateful, stateSlots: 128 }, { ...stateful, repair: 'yes' }, { ...adaptive, stopping: 'free' }]) assert.ok(aiSystemShapeRejection(value));
  assert.ok(modelDesignShapeRejection({ ...design(), system: undefined }));
  const state = createInitialState(), before = canonicalStateHash(state);
  for (const system of [expert, stateful, adaptive]) {
    const forecast = getModelDesignForecast(state, state.playerCompanyId, CONTENT.seedModel.id, [], design(system));
    assert.match(forecast.reason?.message ?? '', /Complete A/);
  }
  assert.equal(canonicalStateHash(state), before);
});

test('operating designs have different strengths and exact serving bills instead of a universal upgrade', () => {
  const state = createInitialState(), owner = state.playerCompanyId;
  const project = (spec: ModelDesignSpec) => getAISystemForecastModel(spec, getModelDesignForecast(state, owner, CONTENT.seedModel.id, [], spec));
  const standard = project(design()), experts = project(design(expert)), memory = project(design(stateful)), reasoner = project(design(adaptive));
  const a = getAISystemMetrics(standard), e = getAISystemMetrics(experts), s = getAISystemMetrics(memory), r = getAISystemMetrics(reasoner);
  assert.ok(e.servingCUwPer1000 < a.servingCUwPer1000); assert.ok(e.residentMU > a.residentMU);
  assert.ok(experts.capabilityBps.coding > standard.capabilityBps.coding); assert.ok(experts.capabilityBps.documents < standard.capabilityBps.documents);
  assert.ok(s.retentionBps > a.retentionBps); assert.ok(s.sessionMemoryMU > a.sessionMemoryMU);
  assert.ok(memory.capabilityBps.coding < standard.capabilityBps.coding);
  assert.ok(r.verifiedCompletionBps > a.verifiedCompletionBps); assert.ok(r.servingCUwPer1000 > a.servingCUwPer1000); assert.ok(r.latencyBps > a.latencyBps);
  for (const model of [standard, experts, memory, reasoner]) {
    const measured = getAISystemMetrics(model), meter = requestMeter(model, DEFAULT_FEATURES);
    assert.equal(measured.servingCUwPer1000, meter.work * 1000 / U);
    assert.equal(measured.sessionMemoryMU, meter.sessionMemory);
  }
  const early = getAISystemMetrics(project(design({ ...adaptive, stopping: 'confidence' })));
  assert.ok(early.servingCUwPer1000 < r.servingCUwPer1000); assert.ok(early.latencyBps < r.latencyBps); assert.ok(early.verifiedCompletionBps < r.verifiedCompletionBps);
  const moreActive = getAISystemMetrics(project(design({ ...expert, activeExperts: 4 })));
  assert.ok(moreActive.servingCUwPer1000 > e.servingCUwPer1000); assert.ok(moreActive.routingQualityBps > e.routingQualityBps);
  const compressed = getAISystemMetrics(project(design({ ...stateful, memory: 'compressed' })));
  assert.ok(compressed.sessionMemoryMU < s.sessionMemoryMU); assert.ok(compressed.retentionBps < s.retentionBps);
  const poor = { ...reasoner, capabilityBps: { conversation: 0, documents: 0, coding: 0, tools: 0 }, advancedCapabilities: { reasoning: 0, longContext: 0, multimodal: 0 } };
  assert.equal(getAISystemMetrics(poor).verifiedCompletionBps, 0, 'An expensive verifier cannot invent trained capability.');
});

test('AI systems require specialty, state or independent-checker evidence and do not double-count sparse savings', () => {
  const fixture = getCustomizationReadyFixture(AI_SYSTEM_RESEARCH_IDS), state = fixture.state, owner = state.playerCompanyId;
  for (const system of [expert, stateful, adaptive]) {
    const spec = design(system), planned = buildCustomTrainingPlan(state, owner, payload(fixture.packetId, spec), CONTENT);
    assert.equal(customSystemEvidenceRejection(spec, planned.plan), undefined);
    const noEvidence = structuredClone(planned.plan);
    noEvidence.corpus.relevantUnits = { conversation: 0, documents: 0, coding: 0, tools: 0 };
    noEvidence.advanced!.corpus.relevantUnits = { reasoning: 0, longContext: 0, multimodal: 0 };
    assert.ok(customSystemEvidenceRejection(spec, noEvidence));
  }
  const checker = buildCustomTrainingPlan(state, owner, payload(fixture.packetId, design(adaptive)), CONTENT);
  checker.plan.corpus.behaviorUnits = 99;
  assert.match(customSystemEvidenceRejection(design(adaptive), checker.plan)?.message ?? '', /100 reviewed/);
  const double = submitCommand(state, payload(fixture.packetId, { ...design(expert), sparsityBps: 5000 }), CONTENT);
  assert.equal(double.accepted, false); assert.match(double.reason?.message ?? '', /same saving twice/);
});

test('paid systems survive checkpoints, adaptation and reload without gaining later research or free memory', () => {
  const fixture = getCustomizationReadyFixture(AI_SYSTEM_RESEARCH_IDS);
  const run = new NaturalBusinessCampaign(fixture.state, 'ai-systems-lifecycle');
  const owner = run.state.playerCompanyId;
  const location = Object.values(run.state.slices.compute.racks).find(rack => rack.companyId === owner && rack.location !== 'colocation')!.location;
  const fabricId = 'fabric-' + run.queue({ kind: 'install_fast_fabric', location });
  run.until(state => state.slices.compute.fabricProjects[fabricId]?.status === 'active', 30, 'expert fabric');
  const systems = [expert, stateful, adaptive];
  for (const system of systems) {
    const spec = design(system), command = payload(fixture.packetId, spec);
    const preview = getTrainingPreview(run.state, owner, command, CONTENT); assert.equal(preview.reason, undefined, preview.reason?.message);
    const trainingId = 'training-' + run.queue(command);
    run.until(state => !!state.slices.models.trainingRuns[trainingId]?.checkpointModelId, 120, system.kind + ' checkpoint');
    const receipt = structuredClone(run.state.slices.models.trainingRuns[trainingId].plan!.modelDesign!);
    assert.deepEqual(receipt.system!.spec, system); assert.deepEqual(receipt.system!.effects, getAISystemEffects(system));
    run.state = restored(run.state);
    run.until(state => state.slices.models.trainingRuns[trainingId].status === 'complete', 160, system.kind + ' foundation');
    const paid = run.state.slices.models.trainingRuns[trainingId], model = run.state.slices.models.versions[paid.outputModelId];
    assert.deepEqual(model.modelDesign, receipt);
    assert.deepEqual(model.capabilityBps, preview.capabilityRange.minimum);
    assert.deepEqual(model.advancedCapabilities, preview.advancedCapabilityRange!.minimum);
    assert.equal(paid.requiredWork, spec.computeBudgetCUw);
    assert.equal(getAISystemMetrics(model).sessionMemoryMU, requestMeter(model, DEFAULT_FEATURES).sessionMemory);
    assert.deepEqual(validateState(run.state), []);
    const renamed = submitCommand(run.state, payload(fixture.packetId, { ...spec, name: 'Renamed identical system' }), CONTENT);
    assert.equal(renamed.accepted, false); assert.match(renamed.reason?.message ?? '', /already|same|repeat/i);
    const inherited = getModelDesignForBase(model);
    const changed = { ...inherited, system: undefined };
    delete changed.system;
    assert.equal(submitCommand(run.state, payload(fixture.packetId, changed, model.id), CONTENT).accepted, false);
    const next = { ...inherited, name: system.kind + ' continued', computeBudgetCUw: 80 * U, customization: structuredClone(DEFAULT_MODEL_CUSTOMIZATION) };
    const continuation = buildCustomTrainingPlan(run.state, owner, payload(fixture.packetId, next, model.id), CONTENT);
    assert.equal(continuation.plan.residentMU, model.residentMU);
    assert.equal(continuation.plan.modelDesign!.servingWorkBps, model.modelDesign!.servingWorkBps, 'Adaptation does not apply system serving effects a second time.');
    for (const mutate of [
      (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.system!.effects.sessionMemoryMU = 0; },
      (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.system!.researchIds.pop(); },
      (state: GameState) => { state.slices.models.versions[model.id].modelDesign!.system!.effects.servingWorkBps = 1; },
    ]) { const forged = structuredClone(run.state); mutate(forged); assert.ok(validateState(forged).length); }
  }
  assert.deepEqual(restored(run.state), run.state);
});
