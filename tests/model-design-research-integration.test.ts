import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { serializeState, deserializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { createResearchModule } from '../src/modules/research';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { getModelResearchLevel } from '../src/modules/model-research';
import { requestMeter } from '../src/modules/product-models';
import { modelWorkBps } from '../src/modules/model-runtime';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createLabModule(CONTENT), createResearchModule(CONTENT)];
function step(game: GameState) {
  const result = advanceWeek(game, CONTENT, modules);
  assert.ok(result.accepted, result.reason?.message); return result.state;
}
function queue(game: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.ok(result.accepted, result.reason?.message); return result.state;
}
function until(game: GameState, done: (game: GameState) => boolean, limit = 100) {
  for (let i = 0; i < limit && !done(game); i++) game = step(game);
  assert.ok(done(game), 'The funded project should complete within the limit.'); return game;
}
function reload(game: GameState) {
  const result = deserializeState(serializeState(game));
  assert.ok(result.ok, result.ok ? undefined : result.error); return result.state;
}
function initial() {
  let game = createPlayerOnlyState();
  for (let i = 0; i < 3; i++) game = step(game);
  const owner = game.playerCompanyId;
  game.slices.company.companies[owner].cashCents = 1_000_000_000;
  game.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), research: U };
  for (const [id, role] of [['architect', 'research'], ['ml1', 'ml'], ['ml2', 'ml'], ['ml3', 'ml'], ['ml4', 'ml']] as const)
    game.slices.company.staff[id] = { id, companyId: owner, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  game.slices.company.companies[owner].activeStaff = 5;
  const fleet = game.slices.compute.fleets[owner];
  fleet.cloudCU = 32 * U; fleet.memoryMU = 64 * U; fleet.allocation = { serving: 0, development: 16 * U, research: 8 * U };
  const definition = CONTENT.research.find(item => item.id === 'R1')!, id = 'scenario-research:R1';
  game.slices.research.completed = ['R1']; game.slices.research.completedByCompany[owner] = ['R1'];
  game.slices.research.projects[id] = { id, companyId: owner, researchId: 'R1', startedWeek: 0, completedWeek: 1, availableWeek: 2,
    requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
    role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
  game.slices.company.postedFacts[id + ':fee'] = true;
  const packet = game.slices.data.packets[CONTENT.starterData.id]; packet.prepared = true; packet.readyUnits = packet.rawUnits;
  assert.deepEqual(validateState(game), []); return game;
}
function payload(spec: ModelDesignSpec, baseModelId = CONTENT.seedModel.id): Extract<CommandPayload, { kind: 'start_training' }> {
  return { kind: 'start_training', baseModelId, packetId: CONTENT.starterData.id,
    recipeId: `custom-model-${spec.mode}`, modelDesign: spec };
}

test('paid architecture discovery during a paused custom run does not rewrite its frozen targets or research level', () => {
  let game = initial(); const owner = game.playerCompanyId;
  const spec: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Before the breakthrough', computeBudgetCUw: 96 * U };
  game = step(queue(game, payload(spec), 'frozen-research-model'));
  const id = 'training-frozen-research-model', original = structuredClone(game.slices.models.trainingRuns[id].plan!);
  assert.equal(original.modelDesign!.researchLevel, 0);
  assert.ok(game.slices.models.trainingRuns[id].completedWork > 0 && game.slices.models.trainingRuns[id].completedWork < 96 * U);
  game = queue(game, { kind: 'set_job_paused', jobId: id, paused: true }, 'pause-for-architecture');
  game = queue(game, { kind: 'start_model_research' }, 'breakthrough');
  game = until(game, state => getModelResearchLevel(state, owner) === 1);
  assert.equal(game.slices.models.trainingRuns[id].status, 'paused');
  assert.deepEqual(game.slices.models.trainingRuns[id].plan, original);
  assert.deepEqual(validateState(game), []); game = reload(game);
  game = step(queue(game, { kind: 'set_job_paused', jobId: id, paused: false }, 'resume-old-plan'));
  game = until(game, state => state.slices.models.trainingRuns[id].status === 'complete');
  assert.deepEqual(game.slices.models.trainingRuns[id].plan, original);
  const output = game.slices.models.versions['model-frozen-research-model'];
  assert.equal(output.modelDesign!.researchLevel, 0, 'Old plans do not acquire new research retroactively.');
  assert.deepEqual(reload(game), game);
  const next = getTrainingPreview(game, owner, payload({ ...spec, name: 'After the breakthrough' }));
  assert.ok(next.capabilityRange.minimum.conversation > output.capabilityBps.conversation);
});

test('a real Edge foundation pays its design and training work; legacy adaptation preserves size, memory and serving cost', () => {
  let game = initial(); const owner = game.playerCompanyId;
  const spec: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Edge two billion', mode: 'foundation', family: 'edge',
    parameterMillions: 2000, computeBudgetCUw: U };
  assert.equal(submitCommand(game, payload(spec), CONTENT).accepted, false, 'Edge is gated before research.');
  game = until(queue(game, { kind: 'start_model_research' }, 'edge-research'), state => getModelResearchLevel(state, owner) === 1);
  const forecast = getTrainingPreview(game, owner, payload(spec));
  assert.equal(forecast.workCUw, U); assert.equal(forecast.memoryMU, 3 * U); assert.equal(forecast.feeCents, 80_000);
  game = queue(game, payload(spec), 'edge-two-billion');
  game = step(game);
  let run = game.slices.models.trainingRuns['training-edge-two-billion'];
  assert.equal(run.preparationCompleted, U); assert.equal(run.completedWork, 0, 'Foundation design finishes before update work.');
  game = until(game, state => state.slices.models.trainingRuns[run.id].status === 'complete');
  run = game.slices.models.trainingRuns[run.id];
  const edge = game.slices.models.versions[run.outputModelId];
  assert.equal(edge.family, 'edge'); assert.equal(edge.residentMU, U); assert.equal(edge.modelDesign!.spec.parameterMillions, 2000);
  assert.equal(modelWorkBps(edge), edge.modelDesign!.servingWorkBps, 'Runtime uses the frozen design serving factor.');
  assert.ok(modelWorkBps(edge) > 10000 && modelWorkBps(edge) <= 20000, 'Two-billion Edge retains size cost after the earned research discount.');
  const features = { memory: false, deepReasoning: false, extendedContext: false };
  const originalMeter = requestMeter(edge, features);
  assert.equal(originalMeter.work, 100000 * edge.modelDesign!.servingWorkBps / 10000, 'Edge family and frozen design serving factors are each applied once.');
  const legacy = { kind: 'start_training', baseModelId: edge.id, packetId: CONTENT.starterData.id,
    recipeId: 'compact-conversation-adaptation', continueFromParent: true } as const;
  const legacyForecast = getTrainingPreview(game, owner, legacy);
  assert.equal(legacyForecast.memoryMU, 2 * edge.residentMU, 'Legacy adaptation uses the custom model’s actual workspace.');
  game = until(queue(game, legacy, 'edge-legacy-adaptation'), state => state.slices.models.trainingRuns['training-edge-legacy-adaptation']?.status === 'complete');
  const adapted = game.slices.models.versions['model-edge-legacy-adaptation'];
  assert.equal(adapted.residentMU, edge.residentMU, 'Adapting does not resize an already paid architecture.');
  assert.deepEqual(adapted.modelDesign, edge.modelDesign); assert.deepEqual(requestMeter(adapted, features), originalMeter);
  assert.deepEqual(validateState(game), []); assert.deepEqual(reload(game), game);
});

test('equivalent relative training weights cannot bypass the paid-plan duplicate identity', () => {
  let game = initial();
  const spec = structuredClone(DEFAULT_MODEL_DESIGN);
  game = queue(game, payload(spec), 'original-mix');
  const equivalent = { ...structuredClone(spec), name: 'Different label', dataMix: Object.fromEntries(Object.entries(spec.dataMix).map(([domain, weight]) => [domain, weight * 2])) as ModelDesignSpec['dataMix'] };
  const duplicate = submitCommand(game, payload(equivalent), CONTENT, 'same-ratios');
  assert.equal(duplicate.accepted, false, 'Relative weights with the same ratio are the same engineering plan.');
  assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE');
});
