import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_MODEL_CUSTOMIZATION, MODEL_CUSTOMIZATION_OPTIONS } from '../src/content/model-customization';
import { POLICY_DATA_RULES } from '../src/content/wave11-policy';
import type { ModelCustomization } from '../src/contracts/model-customization';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { DEFAULT_MODEL_DESIGN, getModelDesignForecast, getModelDesignForBase, modelDesignShapeRejection } from '../src/modules/model-design';
import { buildCustomTrainingPlan } from '../src/modules/model-design-training';
import { customizationShapeRejection, getCustomizationEffects, getCustomizationResearchIds } from '../src/modules/model-customization';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { modelWorkBps } from '../src/modules/model-runtime';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { getCustomizationReadyFixture } from './fixtures/model-customization';

const ownedChoices: ModelCustomization = { version: 1, attention: 'grouped-query', contextWindow: 'extended', precision: 'int8', objective: 'grounded', behavior: 'expressive' };
const ids = ['M1', 'M4', 'M6', 'M10', 'M13'];
function design(customization?: ModelCustomization): ModelDesignSpec {
  return { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Paid model profile', mode: 'foundation', family: 'compact', parameterMillions: 8000,
    computeBudgetCUw: 240 * U, dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 },
    ...(customization ? { customization: structuredClone(customization) } : {}) };
}
const options = (packetId: string, spec: ModelDesignSpec, baseModelId = CONTENT.seedModel.id) => ({
  kind: 'start_training' as const, baseModelId, packetId, packetIds: [packetId], recipeId: `custom-model-${spec.mode}`, modelDesign: spec,
});
function restored(game: GameState): GameState {
  const result = deserializeState(serializeState(game)); assert.ok(result.ok, result.ok ? undefined : result.error); return result.state;
}

test('absent choices rebuild authentic historical plans exactly; neutral choices have the same effects and anti-reroll identity', () => {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const raw = JSON.parse(readFileSync(join(directory, 'customization-034-active-published.json'), 'utf8'));
  const decoded = deserializeState(JSON.stringify(raw)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
  const historicalRuns = Object.values(decoded.state.slices.models.trainingRuns).filter(item => item.plan?.modelDesign);
  assert.ok(historicalRuns.length > 0, 'The authentic archived company contains a paid custom run.');
  for (const run of historicalRuns) {
    const rebuilt = buildCustomTrainingPlan(decoded.state, run.companyId, { baseModelId: run.baseModelId, packetId: run.packetId,
      packetIds: run.plan!.corpus.packetIds, recipeId: run.recipeId, modelDesign: run.plan!.modelDesign!.spec }, CONTENT, run.startedWeek, run.plan!.foundationRights ?? null);
    assert.deepEqual(rebuilt.plan, run.plan);
    assert.equal(rebuilt.requiredWork, run.requiredWork); assert.equal(rebuilt.requiredMemory, run.requiredMemory);
  }
  const fixture = getCustomizationReadyFixture(), game = fixture.state, owner = game.playerCompanyId;
  const legacy = design(), neutral = { ...design(), name: 'A renamed neutral plan', customization: structuredClone(DEFAULT_MODEL_CUSTOMIZATION) };
  const first = buildCustomTrainingPlan(game, owner, options(fixture.packetId, legacy), CONTENT);
  const second = buildCustomTrainingPlan(game, owner, options(fixture.packetId, neutral), CONTENT);
  assert.equal(first.plan.identity, second.plan.identity);
  assert.deepEqual(first.plan.targets, second.plan.targets); assert.deepEqual(first.plan.advanced, second.plan.advanced);
  assert.equal(first.requiredWork, second.requiredWork); assert.equal(first.requiredMemory, second.requiredMemory);
  assert.equal(first.recipe.feeCents, second.recipe.feeCents);
  assert.deepEqual(getTrainingPreview(game, owner, options(fixture.packetId, legacy)).capabilityRange,
    getTrainingPreview(game, owner, options(fixture.packetId, neutral)).capabilityRange);
  const queued = submitCommand(game, options(fixture.packetId, legacy), CONTENT, 'neutral-identity-original'); assert.ok(queued.accepted, queued.reason?.message);
  const duplicate = submitCommand(queued.state, options(fixture.packetId, neutral), CONTENT, 'neutral-identity-copy');
  assert.equal(duplicate.accepted, false); assert.match(duplicate.reason?.message ?? '', /already|plan/i);
});

test('customization rejects malformed and unearned choices and gives each specialization a real resource or skill cost', () => {
  for (const malformed of [null, {}, { ...DEFAULT_MODEL_CUSTOMIZATION, version: 2 }, { ...DEFAULT_MODEL_CUSTOMIZATION, precision: 'free' },
    { ...DEFAULT_MODEL_CUSTOMIZATION, objective: 'reasoning', freeScore: 100 }, { ...DEFAULT_MODEL_CUSTOMIZATION, attention: NaN }])
    assert.ok(customizationShapeRejection(malformed));
  assert.ok(modelDesignShapeRejection({ ...design(), customization: undefined }));
  const fixture = getCustomizationReadyFixture(), game = fixture.state;
  const locked = submitCommand(game, options(fixture.packetId, design(ownedChoices)), CONTENT);
  assert.equal(locked.accepted, false); assert.match(locked.reason?.message ?? '', /Complete M/);
  for (const field of ['attention', 'contextWindow', 'precision', 'objective'] as const) for (const choice of MODEL_CUSTOMIZATION_OPTIONS[field].slice(1)) {
    const profile = { ...DEFAULT_MODEL_CUSTOMIZATION, [field]: choice.value };
    const effects = getCustomizationEffects(profile);
    assert.ok(effects.computeIntensityBps > 10000 || effects.residentMemoryBps > 10000 || effects.workspaceMemoryBps > 10000
      || effects.hardwareServingBps > 10000 || effects.runtimeServingBps > 10000 || effects.evidenceBps > 10000
      || effects.reliabilityDeltaBps < 0 || Object.values(effects.skillBps).some(value => value < 10000), choice.name + ' must have a cost.');
    assert.ok(getCustomizationResearchIds(profile).includes(choice.requiredResearch!));
  }
});

test('paid researched choices progress through immutable checkpoints, preserve hardware, and earn behavior from evidence', () => {
  const fixture = getCustomizationReadyFixture(ids);
  const run = new NaturalBusinessCampaign(fixture.state, 'customization-lifecycle');
  const owner = run.state.playerCompanyId, spec = design(ownedChoices), payload = options(fixture.packetId, spec);
  const forecast = getModelDesignForecast(run.state, owner, payload.baseModelId, payload.packetIds, spec);
  const preview = getTrainingPreview(run.state, owner, payload, CONTENT); assert.equal(preview.reason, undefined);
  const highBudget = { ...spec, computeBudgetCUw: 1000 * U };
  const baseline = getModelDesignForecast(run.state, owner, payload.baseModelId, payload.packetIds, { ...highBudget, customization: structuredClone(DEFAULT_MODEL_CUSTOMIZATION) });
  const specialized = getModelDesignForecast(run.state, owner, payload.baseModelId, payload.packetIds, highBudget);
  assert.ok(specialized.targets.documents > baseline.targets.documents);
  assert.ok(specialized.targets.coding < baseline.targets.coding);
  assert.ok(specialized.residentMU < baseline.residentMU); assert.ok(specialized.servingWorkBps < baseline.servingWorkBps);
  assert.ok(specialized.requiredEvidence > baseline.requiredEvidence); assert.ok(specialized.reliabilityTargetBps < baseline.reliabilityTargetBps);
  const commandId = run.queue(payload), trainingId = 'training-' + commandId;
  run.until(state => !!state.slices.models.trainingRuns[trainingId]?.checkpointModelId, 60, 'profile checkpoint');
  const training = run.state.slices.models.trainingRuns[trainingId], checkpoint = run.state.slices.models.versions[training.checkpointModelId!];
  assert.ok(training.completedWork < training.requiredWork);
  assert.equal(training.requiredWork, spec.computeBudgetCUw, 'Efficiency never removes paid work from the chosen budget.');
  assert.deepEqual(training.plan!.methods, getCustomizationResearchIds(ownedChoices));
  assert.deepEqual(checkpoint.modelDesign, training.plan!.modelDesign);
  assert.ok(checkpoint.behavior!.confidentErrorBps > 1000 && checkpoint.behavior!.confidentErrorBps < preview.behavior!.confidentErrorBps);
  assert.ok(checkpoint.behavior!.falseRefusalBps < 700 && checkpoint.behavior!.falseRefusalBps > preview.behavior!.falseRefusalBps);
  const frozen = canonicalStateHash(training.plan);
  run.queue({ kind: 'set_job_paused', jobId: trainingId, paused: true }); run.step();
  run.discover('M12');
  assert.equal(canonicalStateHash(run.state.slices.models.trainingRuns[trainingId].plan), frozen);
  run.state = restored(run.state);
  run.queue({ kind: 'set_job_paused', jobId: trainingId, paused: false });
  run.until(state => state.slices.models.trainingRuns[trainingId].status === 'complete', 60, 'profile foundation');
  const completed = run.state.slices.models.trainingRuns[trainingId], model = run.state.slices.models.versions[completed.outputModelId];
  assert.equal(completed.completedWork, 240 * U); assert.equal(model.residentMU, forecast.residentMU);
  assert.equal(modelWorkBps(model), forecast.servingWorkBps); assert.equal(completed.requiredMemory, forecast.requiredMemory);
  assert.deepEqual(model.capabilityBps, preview.capabilityRange.minimum);
  assert.deepEqual(model.advancedCapabilities, preview.advancedCapabilityRange!.minimum);
  assert.deepEqual(model.behavior, preview.behavior);
  for (const mutate of [
    (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.customization!.effects.skillBps.reasoning++; },
    (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.customization!.hardwareServingWorkBps++; },
    (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.customization!.behaviorTraining!.target.confidentErrorBps = 0; },
    (state: GameState) => { state.slices.models.trainingRuns[trainingId].plan!.modelDesign!.customization!.researchIds.pop(); },
    (state: GameState) => { state.slices.models.versions[model.id].residentMU--; },
  ]) { const forged = structuredClone(run.state); mutate(forged); assert.ok(validateState(forged).length); }
  for (const patch of [{ attention: 'standard' }, { contextWindow: 'standard' }, { precision: 'full' }]) {
    const bad = getModelDesignForBase(model); bad.customization = { ...bad.customization!, ...patch } as ModelCustomization;
    assert.equal(submitCommand(run.state, options(fixture.packetId, bad, model.id), CONTENT).accepted, false);
  }
  const adaptation = getModelDesignForBase(model); adaptation.name = 'Careful generalist continuation'; adaptation.computeBudgetCUw = 120 * U;
  adaptation.customization = { ...adaptation.customization!, objective: 'generalist', behavior: 'careful' };
  const continuedId = run.train(options(fixture.packetId, adaptation, model.id));
  const continued = run.state.slices.models.versions[continuedId];
  assert.equal(continued.residentMU, model.residentMU);
  assert.equal(continued.modelDesign!.customization!.hardwareServingWorkBps, model.modelDesign!.customization!.hardwareServingWorkBps);
  assert.ok(modelWorkBps(continued) < modelWorkBps(model), 'The paid new objective changes runtime effort while keeping architecture cost.');
  assert.ok(continued.behavior!.confidentErrorBps < model.behavior!.confidentErrorBps);
  assert.ok(continued.behavior!.falseRefusalBps > model.behavior!.falseRefusalBps);
  const calibration = { baseModelId: model.id, packetId: fixture.packetId, recipeId: 'calibration-curriculum' };
  const calibratedPreview = getTrainingPreview(run.state, owner, calibration, CONTENT); assert.equal(calibratedPreview.reason, undefined);
  const calibratedId = run.train(calibration), calibrated = run.state.slices.models.versions[calibratedId];
  assert.deepEqual(calibrated.behavior, calibratedPreview.behavior);
  assert.ok(calibrated.behavior!.confidentErrorBps < model.behavior!.confidentErrorBps, 'Inherited profile receipts must not override later ordinary calibration.');
  const policyPacket = run.prepare(POLICY_DATA_RULES.id, 9500);
  const policyId = run.train({ baseModelId: model.id, packetId: policyPacket, recipeId: 'policy-conservative-refusal' });
  const policyModel = run.state.slices.models.versions[policyId];
  assert.ok(policyModel.behavior!.falseRefusalBps > model.behavior!.falseRefusalBps, 'Later paid policy training must supersede the inherited expressive receipt.');
  const policyContinuation = getModelDesignForBase(policyModel); policyContinuation.name = 'Expressive with retained policy'; policyContinuation.computeBudgetCUw = 72 * U;
  const policyContinuationId = run.train(options(fixture.packetId, policyContinuation, policyId));
  const preserved = run.state.slices.models.versions[policyContinuationId];
  assert.deepEqual(preserved.policy, policyModel.policy);
  assert.ok(preserved.behavior!.falseRefusalBps >= policyModel.behavior!.falseRefusalBps, 'A behavior objective cannot evade the existing policy refusal tradeoff through quality interpolation.');
  assert.deepEqual(restored(run.state).slices.models.versions[continuedId], continued);
});

test('specialized objectives and behavior require actual matching evidence and cannot use unearned switches', () => {
  const fixture = getCustomizationReadyFixture(ids), game = fixture.state;
  const unweighted = design(ownedChoices); unweighted.dataMix = { conversation: 1, documents: 0, coding: 0, tools: 0, reasoning: 0, longContext: 0, multimodal: 0 };
  const result = submitCommand(game, options(fixture.packetId, unweighted), CONTENT);
  assert.equal(result.accepted, false); assert.match(result.reason?.message ?? '', /objective.*weight|target skill/);
  const humanWithoutBehavior = Object.values(game.slices.data.packets).find(packet => packet.companyId === game.playerCompanyId && packet.prepared && packet.catalogId === 'broad-corpus-1' && !packet.behaviorUnits);
  assert.ok(humanWithoutBehavior, 'The authentic company retains its prepared broad corpus.');
  const profile = { ...ownedChoices, objective: 'generalist' as const }, insufficient = design(profile);
  const behavior = submitCommand(game, options(humanWithoutBehavior.id, insufficient), CONTENT);
  assert.equal(behavior.accepted, false); assert.match(behavior.reason?.message ?? '', /100 reviewed behavior/);
});
