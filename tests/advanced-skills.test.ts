import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { ADVANCED_DATA_CATALOG, ADVANCED_DOMAINS, ADVANCED_EVALUATION_SUITE } from '../src/content/advanced-skills';
import type { CommandPayload, DataPacket, GameState, ModuleContext, TrainingRun } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState, submitCommand } from '../src/core/engine';
import { assertAdvancedSkillsState } from '../src/core/advanced-skills-validation';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { advancedScores, advancedTrainingOutcome, createAdvancedTrainingReceipt, emptyAdvancedScores, getAdvancedCorpusEvidence } from '../src/modules/advanced-skills';
import { buildTrainingPlan } from '../src/modules/lab-planner';
import { createEvaluationReport } from '../src/modules/lab-evaluation';
import { getModelDesignForBase } from '../src/modules/model-design';

function enqueue(game: GameState, payload: CommandPayload) {
  const next = submitCommand(game, payload); assert.ok(next.accepted, next.reason?.message); return next.state;
}
function step(game: GameState) {
  const next = advanceWeek(game); assert.ok(next.accepted, next.reason?.message); return next.state;
}
function packet(id: string, owner: string, qualityBps = 9000): DataPacket {
  return { ...structuredClone(CONTENT.starterData), id, companyId: owner, rawUnits: 200, readyUnits: 200, prepared: true,
    qualityBps, sourceIds: ['reasoning-source'], advancedCoverageBps: { reasoning: 10000, longContext: 2000, multimodal: 0 } };
}
function context(): ModuleContext {
  return { week: 1, phase: 'resolve', content: CONTENT, facts: [], resources: { requests: [], computeGrants: [], staffGrants: [] }, random: { draw: () => 0.5 } };
}

test('old models remain untrained in advanced skills and ordinary snapshots keep working', () => {
  const game = createInitialState(CONTENT, 'release');
  assert.deepEqual(advancedScores(CONTENT.seedModel), emptyAdvancedScores());
  assert.doesNotThrow(() => assertAdvancedSkillsState(game));
  const restored = deserializeState(serializeState(game));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.equal(restored.state.slices.models.versions[CONTENT.seedModel.id].advancedCapabilities, undefined);
});

test('advanced evidence counts prepared owned source units once and uses the best selected revision', () => {
  const game = createInitialState(CONTENT, 'release'), owner = game.playerCompanyId;
  game.slices.data.packets.original = packet('original', owner, 8000);
  game.slices.data.packets.curated = packet('curated', owner, 9500);
  game.slices.data.packets.foreign = { ...packet('foreign', 'other-company'), sourceIds: ['foreign-source'] };
  game.slices.data.packets.unprepared = { ...packet('unprepared', owner), prepared: false, readyUnits: 0, sourceIds: ['unfinished-source'] };
  const evidence = getAdvancedCorpusEvidence(game, owner, ['original','curated','curated','foreign','unprepared']);
  assert.deepEqual(evidence.relevantUnits, { reasoning: 200 * U, longContext: 40 * U, multimodal: 0 });
  assert.deepEqual(evidence.qualityBps, { reasoning: 9500, longContext: 9500, multimodal: 0 });
  assert.equal(evidence.packetIds.includes('foreign'), false);
  assert.deepEqual(evidence, getAdvancedCorpusEvidence(game, owner, ['unprepared','curated','original']));
});

test('advanced training earns evidence-limited scores through paid work and freezes a foundation or parent anchor', () => {
  const game = createInitialState(CONTENT, 'release'), owner = game.playerCompanyId, base = game.slices.models.versions[CONTENT.seedModel.id];
  const data = packet('advanced-test', owner); game.slices.data.packets[data.id] = data;
  const options = { baseModelId: base.id, packetId: data.id };
  const planned = buildTrainingPlan(game, owner, options);
  const targets = { reasoning: 8000, longContext: 7000, multimodal: 6000 }, ceilings = { reasoning: 9000, longContext: 9000, multimodal: 9000 };
  const receipt = createAdvancedTrainingReceipt(game, base.id, [data.id], targets, ceilings, 100 * U, true);
  const run: TrainingRun = { ...planned, plan: { ...planned.plan, advanced: receipt }, id: 'training-helper', companyId: owner,
    baseModelId: base.id, packetId: data.id, outputModelId: 'model-helper', recipeId: CONTENT.firstTraining.id,
    startedWeek: 1, completedWork: 0, physicalWork: 0, status: 'running', checkpointWork: 0, checkpointModelId: null,
    lastProgress: 0, lastBottleneck: '' };
  assert.deepEqual(advancedTrainingOutcome(run, 0), emptyAdvancedScores());
  assert.deepEqual(advancedTrainingOutcome(run, run.requiredWork), { reasoning: 7200, longContext: 2520, multimodal: 0 });
  assert.ok(advancedTrainingOutcome(run, run.requiredWork / 2)!.reasoning < 7200);
  const frozen = structuredClone(receipt);
  targets.reasoning = 1000; data.qualityBps = 1000;
  assert.deepEqual(receipt, frozen, 'Admission receipt must not alias mutable design choices or packets.');
  base.advancedCapabilities = { reasoning: 3000, longContext: 1500, multimodal: 1000 };
  const adapted = createAdvancedTrainingReceipt(game, base.id, [data.id], frozen.targets, ceilings, 100 * U, false);
  assert.deepEqual(adapted.anchors, base.advancedCapabilities);
  assert.deepEqual(createAdvancedTrainingReceipt(game, base.id, [data.id], frozen.targets, ceilings, 100 * U, true).anchors, emptyAdvancedScores());
});

test('new data is charged, requires preparation, retains coverage across save/load and rejects invented coverage', () => {
  let game = createInitialState(CONTENT, 'release');
  const item = ADVANCED_DATA_CATALOG[0], initialCash = game.slices.company.companies[game.playerCompanyId].cashCents;
  game = step(enqueue(game, { kind: 'buy_data', catalogId: item.id }));
  const bought = Object.values(game.slices.data.packets).find(p => p.catalogId === item.id)!;
  assert.ok(bought); assert.deepEqual(bought.advancedCoverageBps, item.advancedCoverageBps);
  assert.ok(game.slices.company.companies[game.playerCompanyId].cashCents <= initialCash - item.feeCents);
  assert.deepEqual(getAdvancedCorpusEvidence(game, game.playerCompanyId, [bought.id]).relevantUnits, emptyAdvancedScores());
  game = enqueue(game, { kind: 'prepare_data', packetId: bought.id });
  for (let i = 0; i < 20 && !game.slices.data.packets[bought.id].prepared; i++) game = step(game);
  assert.equal(game.slices.data.packets[bought.id].prepared, true);
  assert.equal(getAdvancedCorpusEvidence(game, game.playerCompanyId, [bought.id]).relevantUnits.reasoning, item.rawUnits * U);
  const restored = deserializeState(serializeState(game)); assert.ok(restored.ok, restored.ok ? undefined : restored.error);
  assert.deepEqual(restored.state.slices.data.packets[bought.id].advancedCoverageBps, item.advancedCoverageBps);
  const forged = structuredClone(game); forged.slices.data.packets[bought.id].advancedCoverageBps!.reasoning--;
  assert.throws(() => assertAdvancedSkillsState(forged), /authored data source/);
});

test('advanced evaluations independently measure all three domains and never grant basic-chat release evidence', () => {
  const model = { ...structuredClone(CONTENT.seedModel), advancedCapabilities: { reasoning: 9500, longContext: 0, multimodal: 6500 }, reliabilityBps: 10000 };
  const report = createEvaluationReport(model, 'advanced-check', ADVANCED_EVALUATION_SUITE.id, context(), CONTENT);
  assert.deepEqual(report.advancedCapabilities, model.advancedCapabilities);
  assert.equal(report.basicChatEligible, false); assert.equal(report.cases.length, 60);
  for (const domain of ADVANCED_DOMAINS) assert.equal(report.cases.filter(item => item.domain === domain).length, 20);
  const passed = (domain: string) => report.cases.filter(item => item.domain === domain && item.passed).length;
  assert.ok(passed('reasoning') > passed('longContext')); assert.ok(passed('multimodal') > passed('longContext'));
  assert.deepEqual(createEvaluationReport(model, 'advanced-check', ADVANCED_EVALUATION_SUITE.id, context(), CONTENT), report);
});

test('advanced state validation rejects skill awards with no paid training provenance', () => {
  const game = createInitialState(CONTENT, 'release');
  game.slices.models.versions[CONTENT.seedModel.id].advancedCapabilities = { reasoning: 9000, longContext: 8000, multimodal: 7000 };
  assert.throws(() => assertAdvancedSkillsState(game), /paid training/);
});

test('a paid custom reasoning run survives reload, earns checkpoint skills and can be independently evaluated', () => {
  let game = createInitialState(CONTENT, 'release');
  const owner = game.playerCompanyId, baseId = CONTENT.seedModel.id, baseline = structuredClone(game.slices.models.versions[baseId]);
  game = step(enqueue(game, { kind: 'buy_data', catalogId: 'advanced-reasoning-1' }));
  const dataId = Object.values(game.slices.data.packets).find(item => item.companyId === owner && item.catalogId === 'advanced-reasoning-1')!.id;
  game = enqueue(game, { kind: 'prepare_data', packetId: dataId });
  game = enqueue(game, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  for (let i = 0; i < 12 && !game.slices.data.packets[dataId].prepared; i++) game = step(game);
  assert.equal(game.slices.data.packets[dataId].prepared, true);
  const modelDesign = { ...getModelDesignForBase(baseline), name: 'Reasoning specialist',
    dataMix: { conversation: 0, documents: 0, coding: 0, tools: 0, reasoning: 100, longContext: 0, multimodal: 0 } };
  const started = submitCommand(game, { kind: 'start_training', recipeId: 'custom-model-adaptation', baseModelId: baseId, packetId: dataId, modelDesign }, CONTENT, 'advanced-paid');
  assert.ok(started.accepted, started.reason?.message); game = step(started.state);
  const initialRun = game.slices.models.trainingRuns['training-advanced-paid'];
  assert.ok(initialRun?.plan?.advanced); assert.ok(initialRun.plan.modelDesign);
  assert.ok(initialRun.physicalWork > 0);
  const saved = deserializeState(serializeState(game)); assert.ok(saved.ok, saved.ok ? undefined : saved.error);
  function finish(state: GameState) {
    for (let i = 0; i < 20 && !state.slices.models.versions['model-advanced-paid']; i++) state = step(state);
    assert.ok(state.slices.models.versions['model-advanced-paid']); return state;
  }
  game = finish(game);
  assert.equal(serializeState(finish(saved.state)), serializeState(game));
  const model = game.slices.models.versions['model-advanced-paid'];
  assert.deepEqual(model.capabilityBps, baseline.capabilityBps, 'Advanced-only training must retain unselected core skills.');
  assert.ok(model.advancedCapabilities!.reasoning > 0); assert.equal(model.advancedCapabilities!.longContext, 0); assert.equal(model.advancedCapabilities!.multimodal, 0);
  const checkpoint = game.slices.models.versions['checkpoint-training-advanced-paid'];
  assert.ok(checkpoint.advancedCapabilities!.reasoning > 0 && checkpoint.advancedCapabilities!.reasoning < model.advancedCapabilities!.reasoning);
  assert.deepEqual(game.slices.models.versions[baseId], baseline, 'Training must keep its parent immutable.');
  const forged = structuredClone(game); forged.slices.models.versions[model.id].advancedCapabilities!.reasoning++;
  assert.throws(() => serializeState(forged), /advanced skills/);
  game = enqueue(game, { kind: 'allocate_compute', serving: 0, development: 2 * U, research: 2 * U });
  game = enqueue(game, { kind: 'start_research', researchId: 'R1' });
  for (let i = 0; i < 10 && !game.slices.research.completed.includes('R1'); i++) game = step(game);
  assert.ok(game.slices.research.completed.includes('R1'));
  game = enqueue(game, { kind: 'evaluate_model', modelId: model.id, suiteId: ADVANCED_EVALUATION_SUITE.id });
  for (let i = 0; i < 12 && !Object.values(game.slices.models.reports).some(report => report.modelId === model.id && report.suiteId === ADVANCED_EVALUATION_SUITE.id); i++) game = step(game);
  const report = Object.values(game.slices.models.reports).find(item => item.modelId === model.id && item.suiteId === ADVANCED_EVALUATION_SUITE.id);
  assert.ok(report); assert.deepEqual(report.advancedCapabilities, model.advancedCapabilities); assert.equal(report.cases.length, 60);
  assert.equal(report.basicChatEligible, false); assert.doesNotThrow(() => serializeState(game));
});
