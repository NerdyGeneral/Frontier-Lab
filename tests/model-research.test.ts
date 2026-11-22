import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { getStudioView } from '../src/core/studio';
import { DEFAULT_DECISION_CLOCK_POLICY, nextDecisionStop } from '../src/core/decision-clock';
import { assertModelResearchState } from '../src/core/model-research-validation';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { createCompanyModule } from '../src/modules/company';
import { createComputeModule } from '../src/modules/compute';
import { createResearchModule } from '../src/modules/research';
import { getActiveModelResearch, getModelFamilyGate, getModelResearchLevel, getModelResearchQuote, modelResearchBonusBps, modelResearchQuoteForLevel } from '../src/modules/model-research';
import { emptyRoleAllocation } from '../src/modules/workforce';
import { createPlayerOnlyState } from './fixtures/player-only';

const modules = [createCompanyModule(CONTENT), createComputeModule(CONTENT), createResearchModule(CONTENT)];
function step(game: GameState): GameState {
  const result = advanceWeek(game, CONTENT, modules);
  assert.ok(result.accepted, result.reason?.message); return result.state;
}
function queue(game: GameState, payload: CommandPayload, id?: string): GameState {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.ok(result.accepted, result.reason?.message); return result.state;
}
function initial(): GameState {
  let game = createPlayerOnlyState();
  for (let i = 0; i < 3; i++) game = step(game);
  const owner = game.playerCompanyId;
  game.slices.company.companies[owner].cashCents = 1_000_000_000;
  game.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), research: U };
  const fleet = game.slices.compute.fleets[owner]; fleet.cloudCU = 16 * U; fleet.memoryMU = 32 * U;
  fleet.allocation = { serving: 0, development: 0, research: 8 * U };
  const definition = CONTENT.research.find(item => item.id === 'R1')!, id = 'scenario-research:R1';
  game.slices.research.completed = ['R1']; game.slices.research.completedByCompany[owner] = ['R1'];
  game.slices.research.projects[id] = { id, companyId: owner, researchId: 'R1', startedWeek: 0, completedWeek: 1, availableWeek: 2,
    requiredWork: definition.workCUw, completedWork: definition.workCUw, requiredStaff: definition.staffWeeks * U,
    completedStaff: definition.staffWeeks * U, role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
  game.slices.company.postedFacts[id + ':fee'] = true;
  assert.deepEqual(validateState(game), []); return game;
}
function completeNext(game: GameState): GameState {
  const target = getModelResearchLevel(game, game.playerCompanyId) + 1;
  game = queue(game, { kind: 'start_model_research' }, 'architecture-' + target);
  for (let i = 0; i < 120 && getModelResearchLevel(game, game.playerCompanyId) < target; i++) game = step(game);
  assert.equal(getModelResearchLevel(game, game.playerCompanyId), target); return game;
}
function reload(game: GameState): GameState {
  const decoded = deserializeState(serializeState(game));
  assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}

test('architecture research gates admission, reserves one escalating fee, and rejects duplicate queued starts', () => {
  const fresh = createPlayerOnlyState();
  assert.equal(submitCommand(fresh, { kind: 'start_model_research' }, CONTENT).accepted, false);
  let game = initial(); const owner = game.playerCompanyId;
  assert.equal(getModelResearchLevel(game, owner), 0);
  assert.ok(getModelFamilyGate(game, owner, 'edge')); assert.ok(getModelFamilyGate(game, owner, 'frontier'));
  game = queue(game, { kind: 'start_model_research' }, 'first-architecture');
  assert.equal(game.queuedCommands[0].reservedCents, 250_000);
  assert.equal(submitCommand(game, { kind: 'start_model_research' }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  game = step(game);
  const project = game.slices.research.modelResearch!['model-research-first-architecture'];
  assert.equal(project.level, 1);
  const visible = getStudioView(game).projects.find(item => item.id === project.id);
  assert.ok(visible); assert.equal(visible.targetPanel, 'research-programs'); assert.equal(visible.targetTask, 'architecture-research'); assert.match(visible.title, /Architecture research/);
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === project.id + ':fee').length, 1);
  assert.equal(game.slices.company.ledger.find(fact => fact.id === project.id + ':fee')!.amountCents, 250_000);
  assert.equal(getModelResearchLevel(game, owner), 0, 'Admission is not earned knowledge.');
});

test('architecture research requires both paid meters, preserves pause progress, and unlocks only next week', () => {
  let game = initial(); const owner = game.playerCompanyId;
  game.slices.company.founderAssignments[owner] = emptyRoleAllocation();
  game = step(queue(game, { kind: 'start_model_research' }, 'paused-architecture'));
  const id = 'model-research-paused-architecture';
  let project = game.slices.research.modelResearch![id];
  assert.equal(project.completedWork, 8 * U); assert.equal(project.completedStaff, 0);
  assert.equal(project.status, 'running'); assert.equal(getModelResearchLevel(game, owner), 0);
  game = step(queue(game, { kind: 'set_model_research_paused', projectId: id, paused: true }));
  const paused = structuredClone(game.slices.research.modelResearch![id]);
  game.slices.company.founderAssignments[owner] = { ...emptyRoleAllocation(), research: U };
  game = step(game); assert.deepEqual(game.slices.research.modelResearch![id], paused);
  game = reload(game);
  game = step(queue(game, { kind: 'set_model_research_paused', projectId: id, paused: false }));
  game = step(game); project = game.slices.research.modelResearch![id];
  assert.equal(project.status, 'complete'); assert.equal(project.completedStaff, 2 * U);
  assert.equal(getModelResearchLevel(game, owner), 0);
  assert.equal(submitCommand(game, { kind: 'start_model_research' }, CONTENT).reason?.code, 'ALREADY_ACTIVE');
  const completedWeek = game.week;
  const beforeAvailable = game;
  game = step(game);
  assert.equal(getModelResearchLevel(game, owner), 1); assert.equal(getModelFamilyGate(game, owner, 'edge'), null);
  assert.equal(nextDecisionStop(beforeAvailable, game, { ...DEFAULT_DECISION_CLOCK_POLICY, cashReserveCents: 0, opportunities: false }, completedWeek)?.target, '#architecture-research');
  assert.equal(getModelResearchLevel(game, owner, completedWeek), 0, 'Historical admission cannot borrow later knowledge.');
  assert.equal(getModelResearchLevel(game, owner, game.week), 1);
  assert.equal(game.slices.company.ledger.filter(fact => fact.id === id + ':fee').length, 1, 'Resume does not charge a second entry fee.');
  assert.deepEqual(reload(game), game);
});

test('sequential paid iterations unlock Frontier at level 3 and continue past family unlocks', () => {
  let game = initial(); const owner = game.playerCompanyId;
  const originalModel = structuredClone(game.slices.models.versions[CONTENT.seedModel.id]);
  for (let target = 1; target <= 4; target++) {
    const next = getModelResearchQuote(game, owner);
    assert.equal(next.level, target);
    if (target > 1) assert.ok(next.feeCents > modelResearchQuoteForLevel(target - 1).feeCents);
    game = completeNext(game);
    assert.equal(getModelResearchLevel(game, owner), target);
    assert.equal(getActiveModelResearch(game, owner), undefined);
    assert.equal(getModelFamilyGate(game, owner, 'frontier') === null, target >= 3);
  }
  assert.deepEqual(game.slices.models.versions[CONTENT.seedModel.id], originalModel, 'Research does not rewrite existing model scores.');
  assert.ok(modelResearchBonusBps(4) > modelResearchBonusBps(3));
  assert.ok(modelResearchBonusBps(4) - modelResearchBonusBps(3) < modelResearchBonusBps(1));
  assert.deepEqual(validateState(game), []); assert.deepEqual(reload(game), game);
});

test('saved research rejects changed costs, skipped levels, unearned knowledge and missing payment provenance', () => {
  const game = completeNext(initial()); const id = Object.keys(game.slices.research.modelResearch!)[0];
  for (const mutate of [
    (state: GameState) => { state.slices.research.modelResearch![id].feeCents = 0; },
    (state: GameState) => { state.slices.research.modelResearch![id].level = 2; },
    (state: GameState) => { state.slices.research.modelResearch![id].completedWork = 0; },
    (state: GameState) => { state.slices.research.modelResearch![id].availableWeek!--; },
    (state: GameState) => { delete state.slices.company.postedFacts[id + ':fee']; },
    (state: GameState) => { delete state.commandReceipts[id.slice('model-research-'.length)]; },
  ]) {
    const forged = structuredClone(game); mutate(forged);
    assert.throws(() => assertModelResearchState(forged));
  }
});

test('iteration quotes stay finite for long campaigns and remain derived from the level', () => {
  for (const level of [1, 3, 10, 100, 10_000, 100_000]) {
    const quote = modelResearchQuoteForLevel(level);
    for (const value of [quote.feeCents, quote.requiredWork, quote.requiredStaff, quote.potentialBonusBps]) assert.ok(Number.isSafeInteger(value) && value >= 0);
  }
  assert.throws(() => modelResearchQuoteForLevel(0));
  assert.throws(() => modelResearchQuoteForLevel(Number.NaN));
});
