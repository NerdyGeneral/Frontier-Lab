import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { validateState } from '../src/core/engine';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { getModelResearchLevel } from '../src/modules/model-research';
import { getModelChallengeAchievements } from '../src/modules/model-challenges';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

/** Reproduces docs/evidence/strategy-034-challenge-progression.json from a real
 * published business. This is a mature-company continuation, not a fresh-start
 * speedrun: no balances, scores, research, employees or work grants are injected. */
test('paid Architecture research and a custom foundation earn Frontier and Horizon titles through ordinary weeks', () => {
  const fixtures = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const decoded = deserializeState(readFileSync(join(fixtures, 'wave26-published.json'), 'utf8'));
  assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
  const run = new NaturalBusinessCampaign(decoded.state, 'challenge-feasibility');
  assert.equal(run.week, 556);
  assert.equal(run.cash, 615_519_786);
  assert.ok(['R1', 'R2', 'R3'].every(id => run.research.includes(id)), 'The published business has already paid for the prerequisite methods.');
  run.queue({ kind: 'set_cloud_capacity', cu: 128 * U }); run.step();
  run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 0, research: 32 * U });
  run.founder('research'); run.step();
  const packetId = run.prepare('advanced-broad-1', 9500);
  for (let level = 1; level <= 5; level++) {
    run.queue({ kind: 'start_model_research', focus: 'reliability' });
    run.until(state => getModelResearchLevel(state, state.playerCompanyId) === level, 40, 'Architecture level ' + level);
  }
  const projects = Object.values(run.state.slices.research.modelResearch ?? {}).filter(project => project.companyId === run.state.playerCompanyId);
  assert.equal(projects.reduce((sum, project) => sum + project.feeCents, 0), 13_750_000);
  assert.equal(projects.reduce((sum, project) => sum + project.completedWork, 0), 440 * U);
  assert.equal(projects.reduce((sum, project) => sum + project.completedStaff, 0), 20 * U);
  run.queue({ kind: 'allocate_compute', serving: 160 * U, development: 32 * U, research: 0 }); run.step();
  const modelId = run.train({ baseModelId: CONTENT.seedModel.id, packetId, packetIds: [packetId], recipeId: 'custom-model-foundation',
    modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Horizon proof 32B', mode: 'foundation', family: 'medium',
      parameterMillions: 32000, computeBudgetCUw: 1600 * U,
      dataMix: { conversation: 1, documents: 1, coding: 1, tools: 1, reasoning: 1, longContext: 1, multimodal: 1 } } });
  const model = run.state.slices.models.versions[modelId], training = run.state.slices.models.trainingRuns[model.trainingRunId!];
  assert.equal(training.completedWork, 1600 * U); assert.equal(training.requiredMemory, 48 * U);
  assert.equal(training.preparationCompleted, 5 * U); assert.equal(model.residentMU, 16 * U);
  assert.deepEqual(model.capabilityBps, { conversation: 9107, documents: 9107, coding: 9057, tools: 9057 });
  assert.deepEqual(model.advancedCapabilities, { reasoning: 9007, longContext: 9007, multimodal: 9007 });
  assert.equal(model.reliabilityBps, 9708);
  run.evaluate(modelId, 'expanded-capabilities-1');
  for (const suiteId of ['challenge-applied-1', 'challenge-frontier-1', 'challenge-horizon-1'] as const) {
    run.evaluate(modelId, suiteId);
    const report = Object.values(run.state.slices.models.reports).find(item => item.modelId === modelId && item.suiteId === suiteId)!;
    assert.equal(report.passedCases, 21); assert.equal(report.challenge?.passed, true);
    assert.ok(Object.values(report.challenge!.skills).every(skill => skill.passed === 3));
  }
  assert.equal(run.week, 638); assert.equal(run.commands.length, 17);
  assert.equal(run.company.arrearsCents, 0); assert.ok(run.minimumCashCents > 0);
  assert.deepEqual(validateState(run.state), []);
  const reloaded = deserializeState(serializeState(run.state)); assert.ok(reloaded.ok, reloaded.ok ? undefined : reloaded.error);
  const achievements = getModelChallengeAchievements(reloaded.state, reloaded.state.playerCompanyId);
  assert.deepEqual(achievements.map(achievement => achievement.title), ['Applied Researcher', 'Frontier Fellow', 'Horizon Laureate']);
  assert.deepEqual(achievements.map(achievement => achievement.week), [636, 637, 638]);
  assert.ok(achievements.every(achievement => achievement.modelId === modelId));
});
