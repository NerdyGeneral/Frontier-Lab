import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U, type GameState, type TrainingRun } from '../src/contracts/types';
import { submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { DEFAULT_MODEL_DESIGN, getModelDesignForBase } from '../src/modules/model-design';
import { buildCustomTrainingPlan } from '../src/modules/model-design-training';
import { buildTrainingPlan } from '../src/modules/lab-planner';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { evaluatedReleaseIdentityReason, getEvaluatedReleaseIdentity } from '../src/modules/release-identity';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { getCustomizationReadyFixture } from './fixtures/model-customization';

const restrictedBaseId = 'model-wave10-natural-command-3';
const restrictedPacketId = 'feedback-data:wave10-natural-command-2';
function reload(game: GameState): GameState {
  const decoded = deserializeState(serializeState(game)); assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}
function historicalGame(): GameState {
  const directory = typeof __dirname === 'string' ? join(__dirname, 'fixtures') : join(process.cwd(), 'tests', 'fixtures');
  const decoded = deserializeState(readFileSync(join(directory, 'customization-034-active-published.json'), 'utf8'));
  assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error); return decoded.state;
}

test('historical paid foundations and release identities keep their rights, while a fresh replacement has a separate identity', () => {
  const game = historicalGame(), owner = game.playerCompanyId;
  const old = Object.values(game.slices.models.trainingRuns).find(run => run.companyId === owner && run.plan?.kind === 'foundation')!;
  assert.ok(old); assert.equal(old.plan!.foundationRights, undefined);
  const frozenPlan = structuredClone(old.plan);
  const release = getEvaluatedReleaseIdentity(game, restrictedBaseId); assert.ok(release);
  assert.deepEqual(release.rights, { hosted: true, weights: false });
  const restored = reload(game);
  assert.deepEqual(restored.slices.models.trainingRuns[old.id].plan, frozenPlan);
  assert.equal(evaluatedReleaseIdentityReason(restored, release), undefined);
  assert.deepEqual(inheritedModelRights(restored, old.outputModelId, CONTENT), inheritedModelRights(game, old.outputModelId, CONTENT));
  const replacement = { kind: 'start_training' as const, baseModelId: restrictedBaseId, packetId: old.packetId,
    packetIds: old.plan!.corpus.packetIds, recipeId: old.recipeId };
  const newPlan = buildTrainingPlan(game, owner, replacement).plan;
  assert.equal(newPlan.foundationRights, 'independent'); assert.notEqual(newPlan.identity, old.plan!.identity);
  assert.ok(submitCommand(game, replacement).accepted, 'The corrected foundation may replace an otherwise identical historical design.');
  const forged = structuredClone(game);
  forged.slices.models.trainingRuns[old.id].plan!.foundationRights = 'independent';
  assert.ok(validateState(forged).length, 'Historical license semantics cannot change without changing their immutable paid identity.');
  const adaptation = structuredClone(game);
  adaptation.slices.models.trainingRuns[adaptation.slices.models.versions[restrictedBaseId].trainingRunId!].plan!.foundationRights = 'independent';
  assert.ok(validateState(adaptation).length, 'An ordinary adaptation cannot forge an independent foundation marker.');
  assert.equal(inheritedModelRights(adaptation, restrictedBaseId, CONTENT).weights, false);
});

test('new custom foundations ignore reference rights, retain their own data restrictions, and keep adaptation licenses intact', () => {
  const fixture = getCustomizationReadyFixture(), campaign = new NaturalBusinessCampaign(fixture.state, 'foundation-rights');
  const owner = campaign.state.playerCompanyId, originalRights = inheritedModelRights(campaign.state, restrictedBaseId, CONTENT);
  assert.deepEqual(originalRights, { hosted: true, weights: false });
  const spec = { ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Independent documents foundation', mode: 'foundation' as const,
    computeBudgetCUw: 32 * U, dataMix: { conversation: 0, documents: 100, coding: 0, tools: 0, reasoning: 0, longContext: 0, multimodal: 0 } };
  const order = { baseModelId: restrictedBaseId, packetId: fixture.packetId, recipeId: 'custom-model-foundation', modelDesign: spec };
  const independent = buildCustomTrainingPlan(campaign.state, owner, order, CONTENT);
  const seedReference = buildCustomTrainingPlan(campaign.state, owner, { ...order, baseModelId: CONTENT.seedModel.id }, CONTENT);
  const historical = buildCustomTrainingPlan(campaign.state, owner, order, CONTENT, campaign.week, null);
  assert.deepEqual(independent.plan, seedReference.plan, 'A comparison reference does not change the independent foundation.');
  assert.notEqual(independent.plan.identity, historical.plan.identity, 'A historical foundation does not prevent a clean replacement.');
  const foundationId = campaign.train(order), foundationRun = campaign.state.slices.models.trainingRuns[campaign.state.slices.models.versions[foundationId].trainingRunId!];
  assert.equal(foundationRun.plan!.foundationRights, 'independent');
  assert.deepEqual(inheritedModelRights(campaign.state, foundationId, CONTENT), { hosted: true, weights: true });

  // Reconstruct the pre-fix receipt shape using the same paid work, results and
  // admission dates. This covers an old foundation with a restricted reference
  // without retaining another full business snapshot in the fixture archive.
  const historicalCampaign = new NaturalBusinessCampaign(structuredClone(campaign.state), 'historical-foundation-rights');
  historicalCampaign.state.slices.models.trainingRuns[foundationRun.id].plan = buildCustomTrainingPlan(historicalCampaign.state,
    owner, order, CONTENT, foundationRun.startedWeek, null).plan;
  assert.deepEqual(validateState(historicalCampaign.state), []);
  assert.deepEqual(inheritedModelRights(historicalCampaign.state, foundationId, CONTENT), originalRights);
  historicalCampaign.evaluate(foundationId, 'basic-conversation-1');
  const historicalRelease = getEvaluatedReleaseIdentity(historicalCampaign.state, foundationId); assert.ok(historicalRelease);
  assert.deepEqual(historicalRelease.rights, originalRights);
  assert.equal(evaluatedReleaseIdentityReason(reload(historicalCampaign.state), historicalRelease), undefined);
  assert.ok(submitCommand(historicalCampaign.state, { kind: 'start_training', ...order }).accepted,
    'An old restricted foundation does not block its corrected independent replacement.');

  campaign.evaluate(foundationId, 'basic-conversation-1');
  const release = getEvaluatedReleaseIdentity(campaign.state, foundationId); assert.ok(release);
  campaign.state = reload(campaign.state);
  assert.equal(evaluatedReleaseIdentityReason(campaign.state, release), undefined);

  const base = campaign.state.slices.models.versions[restrictedBaseId];
  const adaptationId = campaign.train({ ...order, recipeId: 'custom-model-adaptation', modelDesign: { ...getModelDesignForBase(base),
    name: 'Restricted adaptation', mode: 'adaptation', computeBudgetCUw: 64 * U, dataMix: spec.dataMix } });
  assert.deepEqual(inheritedModelRights(campaign.state, adaptationId, CONTENT), originalRights);
  const adaptationRun = campaign.state.slices.models.trainingRuns[campaign.state.slices.models.versions[adaptationId].trainingRunId!];
  assert.equal(adaptationRun.plan!.foundationRights, undefined);
  const forged = structuredClone(campaign.state);
  forged.slices.models.trainingRuns[adaptationRun.id].plan!.foundationRights = 'independent';
  assert.ok(validateState(forged).length, 'A custom adaptation cannot bypass inherited licenses.');
  assert.equal(inheritedModelRights(forged, adaptationId, CONTENT).weights, false);

  const restrictedFoundationId = campaign.train({ ...order, packetIds: [fixture.packetId, restrictedPacketId] });
  assert.deepEqual(inheritedModelRights(campaign.state, restrictedFoundationId, CONTENT), originalRights,
    'Starting a separate lineage never discards restrictions on evidence actually used for training.');
  assert.deepEqual(inheritedModelRights(campaign.state, restrictedBaseId, CONTENT), originalRights);
  assert.deepEqual(validateState(campaign.state), []); assert.deepEqual(reload(campaign.state), campaign.state);

  // Removing the version marker alone must not reinterpret an admitted foundation as historical.
  const changed = structuredClone(campaign.state), saved: TrainingRun = changed.slices.models.trainingRuns[foundationRun.id];
  delete saved.plan!.foundationRights;
  assert.ok(validateState(changed).length);
});
