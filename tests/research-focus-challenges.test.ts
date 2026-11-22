import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { MODEL_CHALLENGES } from '../src/content/model-challenges';
import type { ModelResearchFocus } from '../src/contracts/model-research';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertModelChallengesState } from '../src/core/model-challenges-validation';
import { assertModelResearchState } from '../src/core/model-research-validation';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createLabModule } from '../src/modules/lab';
import { createResearchModule } from '../src/modules/research';
import { DEFAULT_MODEL_DESIGN, getModelDesignForecast } from '../src/modules/model-design';
import { getModelResearchFocus, getModelResearchLevel } from '../src/modules/model-research';
import { getModelChallengeAchievements, modelChallengeCases } from '../src/modules/model-challenges';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createLabModule(CONTENT), createResearchModule(CONTENT)];
function step(game: GameState): GameState {
  const result = advanceWeek(game, CONTENT, modules); assert.ok(result.accepted, result.reason?.message);
  for (const command of game.queuedCommands) assert.equal(result.state.commandReceipts[command.id]?.status, 'accepted', result.state.commandReceipts[command.id]?.reason?.message);
  return result.state;
}
function queue(game: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(game, payload, CONTENT, id); assert.ok(result.accepted, result.reason?.message); return result.state;
}
function until(game: GameState, predicate: (state: GameState) => boolean, limit = 100): GameState {
  for (let i = 0; i < limit && !predicate(game); i++) game = step(game);
  assert.ok(predicate(game), 'Funded work did not finish in time.'); return game;
}
function reload(game: GameState): GameState {
  const decoded = deserializeState(serializeState(game)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}
function initial(): GameState {
  let game = createPlayerOnlyState(); for (let i = 0; i < 3; i++) game = step(game);
  const owner = game.playerCompanyId;
  game.slices.company.companies[owner].cashCents = 1_000_000_000;
  game.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), research: U };
  for (const [id, role] of [['researcher', 'research'], ['reviewer', 'research'], ['data-engineer', 'data'], ['ml1', 'ml'], ['ml2', 'ml'], ['ml3', 'ml'], ['ml4', 'ml']] as const)
    game.slices.company.staff[id] = { id, companyId: owner, role, hiredWeek: 0, readyWeek: 2, assignedFte: U };
  game.slices.company.companies[owner].activeStaff = 7;
  const fleet = game.slices.compute.fleets[owner]; fleet.cloudCU = 32 * U; fleet.memoryMU = 64 * U;
  fleet.allocation = { serving: 0, development: 16 * U, research: 16 * U };
  const definition = CONTENT.research.find(item => item.id === 'R1')!, id = 'scenario-research:R1';
  game.slices.research.completed = ['R1']; game.slices.research.completedByCompany[owner] = ['R1'];
  game.slices.research.projects[id] = { id, companyId: owner, researchId: 'R1', startedWeek: 0, completedWeek: 1, availableWeek: 2,
    requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U,
    role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
  game.slices.company.postedFacts[id + ':fee'] = true;
  const data = game.slices.data.packets[CONTENT.starterData.id]; data.prepared = true; data.readyUnits = data.rawUnits;
  assert.deepEqual(validateState(game), []); return game;
}
function research(game: GameState, focus?: ModelResearchFocus): GameState {
  const target = getModelResearchLevel(game, game.playerCompanyId) + 1;
  return until(queue(game, { kind: 'start_model_research', ...(focus ? { focus } : {}) }, 'focus-' + target), state => getModelResearchLevel(state, state.playerCompanyId) === target);
}
function design(spec: ModelDesignSpec, packetId = CONTENT.starterData.id): CommandPayload {
  return { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId, packetIds: [packetId], recipeId: `custom-model-${spec.mode}`, modelDesign: spec };
}

test('paid research focus changes future design tradeoffs and retains legacy balanced behavior', () => {
  const original = initial(), owner = original.playerCompanyId;
  const legacy = research(original), balanced = research(original, 'balanced');
  const capability = research(original, 'capability'), efficiency = research(original, 'efficiency'), reliability = research(original, 'reliability');
  const spec: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), mode: 'foundation', parameterMillions: 8000, computeBudgetCUw: 400 * U };
  const forecast = (game: GameState) => getModelDesignForecast(game, owner, CONTENT.seedModel.id, [CONTENT.starterData.id], spec);
  assert.deepEqual(forecast(legacy), forecast(balanced)); assert.equal(getModelResearchFocus(legacy, owner), undefined);
  assert.ok(forecast(capability).ceilings.conversation > forecast(balanced).ceilings.conversation);
  assert.ok(forecast(efficiency).servingWorkBps < forecast(balanced).servingWorkBps);
  assert.ok(forecast(efficiency).ceilings.conversation < forecast(balanced).ceilings.conversation);
  assert.ok(forecast(reliability).reliabilityTargetBps > forecast(balanced).reliabilityTargetBps);
  for (const game of [legacy, balanced, capability, efficiency, reliability]) {
    assert.deepEqual(game.slices.models.versions, original.slices.models.versions, 'Research cannot rewrite existing model versions.');
    assert.deepEqual(reload(game), game);
  }
  const id = Object.keys(capability.slices.research.modelResearch!)[0];
  for (const mutate of [
    (game: GameState) => { game.slices.research.modelResearch![id].focus = 'efficiency'; },
    (game: GameState) => { delete game.slices.research.modelResearch![id].focus; delete game.slices.research.modelResearch![id].focusFactId; },
    (game: GameState) => { delete game.slices.company.postedFacts[game.slices.research.modelResearch![id].focusFactId!]; },
  ]) { const forged = structuredClone(capability); mutate(forged); assert.throws(() => assertModelResearchState(forged)); }
});

test('a paused design retains exact research provenance after a different focus finishes', () => {
  let game = research(initial(), 'capability'); const owner = game.playerCompanyId;
  const spec = { ...structuredClone(DEFAULT_MODEL_DESIGN), computeBudgetCUw: 96 * U };
  game = step(queue(game, design(spec), 'focused-plan'));
  const id = 'training-focused-plan', saved = structuredClone(game.slices.models.trainingRuns[id].plan!);
  assert.equal(saved.modelDesign!.researchFocus!.counts.capability, 1);
  game = step(queue(game, { kind: 'set_job_paused', jobId: id, paused: true }));
  game = research(game, 'reliability');
  assert.equal(getModelResearchFocus(game, owner)!.counts.reliability, 1);
  assert.deepEqual(game.slices.models.trainingRuns[id].plan, saved); game = reload(game);
  game = until(queue(game, { kind: 'set_job_paused', jobId: id, paused: false }), state => state.slices.models.trainingRuns[id].status === 'complete');
  assert.deepEqual(game.slices.models.trainingRuns[id].plan, saved);
  assert.deepEqual(game.slices.models.versions['model-focused-plan'].modelDesign, saved.modelDesign);
  const forged = structuredClone(game); forged.slices.models.trainingRuns[id].plan!.modelDesign!.researchFocus!.reliabilityBonusBps++;
  assert.ok(validateState(forged).length); assert.deepEqual(reload(game), game);
});

test('challenge tiers measure harder authored tasks, enforce every skill, and cannot reroll by renaming', () => {
  const model = structuredClone(CONTENT.seedModel);
  model.capabilityBps = { conversation: 7600, documents: 7600, coding: 7600, tools: 7600 };
  model.advancedCapabilities = { reasoning: 7600, longContext: 7600, multimodal: 7600 }; model.reliabilityBps = 9300;
  const counts = MODEL_CHALLENGES.map(tier => modelChallengeCases(model, tier.id).filter(item => item.passed).length);
  assert.deepEqual(counts, [21, 14, 0]);
  for (const tier of MODEL_CHALLENGES) assert.deepEqual(modelChallengeCases({ ...model, id: 'renamed-id', name: 'A fresh label' }, tier.id), modelChallengeCases(model, tier.id));
  model.capabilityBps = { conversation: 9900, documents: 9900, coding: 9900, tools: 9900 };
  model.advancedCapabilities = { reasoning: 9900, longContext: 9900, multimodal: 9900 }; model.reliabilityBps = 9900;
  assert.equal(modelChallengeCases(model, 'challenge-horizon-1').filter(item => item.passed).length, 21);
  model.advancedCapabilities.multimodal = 0;
  assert.equal(modelChallengeCases(model, 'challenge-applied-1').filter(item => item.domain === 'multimodal' && item.passed).length, 0);
});

test('a paid trained model earns a lasting challenge title; unpaid cases, forged results and repeats are rejected', () => {
  let game = initial(); const owner = game.playerCompanyId;
  assert.equal(submitCommand(game, { kind: 'evaluate_model', modelId: CONTENT.seedModel.id, suiteId: 'challenge-applied-1' }, CONTENT).accepted, false);
  game = step(queue(game, { kind: 'buy_data', catalogId: 'advanced-broad-1' }));
  const packet = Object.values(game.slices.data.packets).find(item => item.catalogId === 'advanced-broad-1')!;
  game = until(queue(game, { kind: 'prepare_data', packetId: packet.id }), state => state.slices.data.packets[packet.id].prepared);
  const spec: ModelDesignSpec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Applied generalist', mode: 'foundation', parameterMillions: 8000, computeBudgetCUw: 400 * U,
    dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 } };
  game = until(queue(game, design(spec, packet.id), 'challenge-candidate'), state => !!state.slices.models.versions['model-challenge-candidate']);
  const modelId = 'model-challenge-candidate';
  game = until(queue(game, { kind: 'evaluate_model', modelId, suiteId: 'expanded-capabilities-1' }, 'challenge-baseline'), state => !!state.slices.models.reports['report-evaluation-challenge-baseline']);
  const baseline = game.slices.models.versions[modelId].evaluationReportId;
  assert.equal(submitCommand(game, { kind: 'evaluate_model', modelId, suiteId: 'challenge-frontier-1' }, CONTENT).accepted, false, 'A higher tier needs the earlier earned title.');
  game = step(queue(game, { kind: 'evaluate_model', modelId, suiteId: 'challenge-applied-1' }, 'applied-title'));
  game = until(game, state => !!state.slices.models.reports['report-evaluation-applied-title']);
  const report = game.slices.models.reports['report-evaluation-applied-title'];
  assert.ok(report.challenge?.passed, JSON.stringify(report.challenge)); assert.equal(report.challenge.earnedTitle, 'Applied Researcher');
  assert.equal(report.cases.length, 21); assert.equal(game.slices.models.versions[modelId].evaluationReportId, baseline, 'A challenge does not replace release evidence.');
  assert.equal(getModelChallengeAchievements(game, owner)[0].reportId, report.id);
  assert.equal(submitCommand(game, { kind: 'evaluate_model', modelId, suiteId: 'challenge-applied-1' }, CONTENT).accepted, false);
  game = until(queue(game, { kind: 'evaluate_model', modelId, suiteId: 'challenge-frontier-1' }, 'frontier-attempt'), state => !!state.slices.models.reports['report-evaluation-frontier-attempt']);
  assert.equal(game.slices.models.reports['report-evaluation-frontier-attempt'].challenge!.passed, false);
  assert.equal(getModelChallengeAchievements(game, owner).length, 1, 'A failed harder test does not remove a title.');
  assert.deepEqual(reload(game), game);
  for (const mutate of [
    (state: GameState) => { state.slices.models.reports[report.id].challenge!.earnedTitle = 'Horizon Laureate'; },
    (state: GameState) => { state.slices.models.reports[report.id].cases[0].passed = !state.slices.models.reports[report.id].cases[0].passed; },
    (state: GameState) => { state.slices.models.evaluationRuns['evaluation-applied-title'].completedWork = 0; },
    (state: GameState) => { state.slices.models.reports[report.id].challenge!.admission.admittedWeek++; },
    (state: GameState) => { delete state.commandReceipts['applied-title']; },
  ]) { const forged = structuredClone(game); mutate(forged); assert.throws(() => assertModelChallengesState(forged, CONTENT)); }
});
