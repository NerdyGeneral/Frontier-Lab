import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U, type CommandPayload, type GameState } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { serializeState, deserializeState } from '../src/core/snapshot';
import { DEFAULT_MODEL_DESIGN, getModelDesignForecast, getModelDesignForBase } from '../src/modules/model-design';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { canonicalStateHash } from '../src/core/canonical';
import { requestMeter, taskScore } from '../src/modules/product-models';
import { SEGMENT_BY_ID } from '../src/content/wave2-market';
import type { ModelDesignSpec } from '../src/contracts/model-design';

function queue(game: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(game, payload, CONTENT, id); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function step(game: GameState): GameState {
  const result = advanceWeek(game); assert.ok(result.accepted, result.reason?.message);
  for (const command of game.queuedCommands.filter(c => c.companyId === game.playerCompanyId)) {
    const receipt = result.state.commandReceipts[command.id]; assert.equal(receipt.status, 'accepted', receipt.reason?.message);
  }
  return result.state;
}
function until(game: GameState, predicate: (s: GameState) => boolean, max = 80): GameState {
  for (let i = 0; i < max && !predicate(game); i++) game = step(game);
  assert.ok(predicate(game), 'Play sequence stalled in week ' + game.week); return game;
}
function reload(game: GameState): GameState {
  const decoded = deserializeState(serializeState(game)); assert.ok(decoded.ok, decoded.ok ? '' : decoded.error); return decoded.state;
}
function prepared(): GameState {
  let game = createInitialState(CONTENT, 'release');
  game = queue(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id });
  game = queue(game, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  return until(game, state => state.slices.data.packets[CONTENT.starterData.id].prepared);
}
function payload(spec: ModelDesignSpec, baseModelId = CONTENT.seedModel.id, packetId = CONTENT.starterData.id): CommandPayload & { kind: 'start_training' } {
  return { kind: 'start_training', baseModelId, packetId, packetIds: [packetId], recipeId: `custom-model-${spec.mode}`, modelDesign: spec };
}

test('model targets respond to actual compute, data balance and architecture without mutating the campaign', () => {
  const game = prepared(), before = canonicalStateHash(game), owner = game.playerCompanyId;
  const spec = structuredClone(DEFAULT_MODEL_DESIGN);
  const forecast = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [CONTENT.starterData.id], spec);
  const moreCompute = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [CONTENT.starterData.id], { ...spec, computeBudgetCUw: 96 * U });
  assert.ok(moreCompute.targets.conversation > forecast.targets.conversation);
  assert.equal(moreCompute.workCUw, 96 * U);
  const code = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [CONTENT.starterData.id], { ...spec,
    dataMix: { conversation: 0, documents: 0, coding: 100, tools: 0, reasoning: 0, longContext: 0, multimodal: 0 } });
  assert.ok(code.targets.coding > forecast.targets.coding);
  const small = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [], { ...spec, mode: 'foundation', parameterMillions: 1000 });
  const big = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [], { ...spec, mode: 'foundation', parameterMillions: 8000 });
  assert.ok(big.residentMU > small.residentMU); assert.ok(big.feeCents > small.feeCents);
  const sparse = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [], { ...spec, mode: 'foundation', sparsityBps: 5000 });
  const dense = getModelDesignForecast(game, owner, CONTENT.seedModel.id, [], { ...spec, mode: 'foundation' });
  assert.ok(sparse.servingWorkBps < dense.servingWorkBps); assert.ok(sparse.residentMU > dense.residentMU);
  assert.match(sparse.reason!.message, /Sparse architecture/);
  assert.equal(canonicalStateHash(game), before);
});

test('paid custom training completes both checkpoints, reloads deterministically, and refuses renamed repeats', () => {
  let game = prepared();
  const spec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Cedar 4B' };
  const command = payload(spec), forecast = getTrainingPreview(game, game.playerCompanyId, command);
  assert.equal(forecast.reason, undefined);
  game = step(queue(game, command, 'cedar'));
  const run = game.slices.models.trainingRuns['training-cedar'];
  assert.equal(run.requiredWork, spec.computeBudgetCUw); assert.equal(run.plan!.modelDesign!.spec.name, 'Cedar 4B');
  assert.equal(game.slices.company.ledger.filter(f => f.id === run.id + ':setup').length, 1);
  game = until(game, s => !!s.slices.models.versions['checkpoint-training-cedar']);
  const restored = reload(game), done = (s: GameState) => !!s.slices.models.versions['model-cedar'];
  const finished = until(game, done), finishedReloaded = until(restored, done);
  assert.deepEqual(finishedReloaded, finished);
  const model = finished.slices.models.versions['model-cedar'];
  assert.equal(model.name, 'Cedar 4B'); assert.deepEqual(model.capabilityBps, forecast.capabilityRange.minimum);
  assert.deepEqual(model.advancedCapabilities, forecast.advancedCapabilityRange!.minimum);
  assert.ok(model.capabilityBps.conversation > CONTENT.seedModel.capabilityBps.conversation);
  assert.equal(previewCommand(finished, payload({ ...spec, name: 'Renamed repeat' }, model.id)).reason?.code, 'NO_IMPROVEMENT');
  for (const change of [
    (s: GameState) => s.slices.models.trainingRuns[run.id].plan!.modelDesign!.researchLevel++,
    (s: GameState) => s.slices.models.trainingRuns[run.id].plan!.targets.conversation++,
    (s: GameState) => s.slices.models.versions[model.id].residentMU++,
    (s: GameState) => s.slices.models.versions[model.id].advancedCapabilities!.reasoning++,
  ]) { const corrupt = structuredClone(finished); change(corrupt); assert.ok(validateState(corrupt).length); }
});

test('reasoning training needs matching prepared data and produces a separate measured skill', () => {
  let game = prepared();
  const spec: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Cedar reasoning',
    dataMix: { conversation: 0, documents: 0, coding: 0, tools: 0, reasoning: 100, longContext: 0, multimodal: 0 } };
  assert.equal(previewCommand(game, payload(spec)).accepted, false, 'A slider must not invent reasoning examples.');
  game = step(queue(game, { kind: 'buy_data', catalogId: 'advanced-reasoning-1' }));
  const data = Object.values(game.slices.data.packets).find(p => p.companyId === game.playerCompanyId && p.catalogId === 'advanced-reasoning-1')!;
  game = until(queue(game, { kind: 'prepare_data', packetId: data.id }), s => s.slices.data.packets[data.id].prepared);
  const command = payload(spec, CONTENT.seedModel.id, data.id), forecast = getTrainingPreview(game, game.playerCompanyId, command);
  assert.equal(forecast.reason, undefined);
  game = until(queue(game, command, 'reasoning'), s => !!s.slices.models.versions['model-reasoning']);
  const model = game.slices.models.versions['model-reasoning'];
  assert.ok(model.advancedCapabilities!.reasoning > 3000);
  assert.equal(model.advancedCapabilities!.longContext, 0); assert.equal(model.advancedCapabilities!.multimodal, 0);
  assert.deepEqual(model.capabilityBps, CONTENT.seedModel.capabilityBps, 'Unallocated core skills stay intact.');
  assert.deepEqual(model.advancedCapabilities, forecast.advancedCapabilityRange!.minimum);
  assert.deepEqual(reload(game), game);
  game = step(queue(game, { kind: 'allocate_compute', serving: 0, development: 2 * U, research: 2 * U }));
  game = until(queue(game, { kind: 'start_research', researchId: 'R1' }), s => s.slices.research.completed.includes('R1'));
  game = until(queue(game, { kind: 'evaluate_model', modelId: model.id, suiteId: 'advanced-capabilities-1' }, 'reasoning-test'), s => !!s.slices.models.reports['report-evaluation-reasoning-test']);
  const report = game.slices.models.reports['report-evaluation-reasoning-test'];
  assert.equal(report.cases.length, 60); assert.equal(report.basicChatEligible, false);
  assert.deepEqual(report.advancedCapabilities, model.advancedCapabilities);
  assert.equal(report.cases.filter(c => c.domain === 'reasoning').length, 20);
  assert.deepEqual(reload(game), game);
});

test('custom blueprint hardware dimensions govern deployed inference and advanced skills affect appropriate products', () => {
  const game = prepared(), base = game.slices.models.versions[CONTENT.seedModel.id];
  const spec = { ...getModelDesignForBase(base), mode: 'foundation' as const, parameterMillions: 8000 };
  const f = getModelDesignForecast(game, game.playerCompanyId, base.id, [], spec);
  const model = { ...structuredClone(base), modelDesign: { spec, researchLevel: 0, frontierRating: f.frontierRating,
    servingWorkBps: f.servingWorkBps, requiredEvidence: f.requiredEvidence, ceilings: f.ceilings, advancedCeilings: f.advancedCeilings } };
  const features = { memory: false, deepReasoning: true, extendedContext: true };
  assert.ok(requestMeter(model, features).work > requestMeter(base, features).work);
  const low = { ...model, advancedCapabilities: { reasoning: 0, longContext: 0, multimodal: 0 } };
  const high = { ...model, advancedCapabilities: { reasoning: 9000, longContext: 9000, multimodal: 9000 } };
  assert.ok(taskScore(high, SEGMENT_BY_ID.professional, features) > taskScore(low, SEGMENT_BY_ID.professional, features));
});
