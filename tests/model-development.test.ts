import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U, type CommandPayload, type GameState } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { expectedTrainingOutcome, getTrainingPreview, type TrainingOptions } from '../src/modules/lab-planner';
import { getModelDevelopmentRows, getTrainingDevelopment } from '../src/modules/model-development';

function enqueue(game: GameState, payload: CommandPayload, id?: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.ok(result.accepted, result.reason?.message);
  return result.state;
}
function step(game: GameState) {
  const updated = advanceWeek(game);
  assert.ok(updated.accepted, updated.reason?.message);
  for (const command of game.queuedCommands.filter(item => item.companyId === game.playerCompanyId)) {
    const receipt = updated.state.commandReceipts[command.id];
    assert.equal(receipt?.status, 'accepted', receipt?.reason?.message);
  }
  return updated.state;
}
function until(game: GameState, done: (state: GameState) => boolean) {
  for (let i = 0; i < 20 && !done(game); i++) game = step(game);
  assert.ok(done(game), 'Training path did not advance by week ' + game.week); return game;
}
function reload(game: GameState) {
  const restored = deserializeState(serializeState(game));
  assert.ok(restored.ok, restored.ok ? undefined : restored.error); return restored.state;
}

test('a paid second generation learns its new skill, keeps most earlier skill, and matches its forecast and saved checkpoints', () => {
  let game = createInitialState(CONTENT, 'release');
  const packetId = CONTENT.starterData.id;
  const first = { baseModelId: CONTENT.seedModel.id, packetId, recipeId: CONTENT.firstTraining.id };
  const blocked = getTrainingDevelopment(game, first);
  assert.equal(blocked.forecastUsable, false); assert.deepEqual(blocked.rows, []);
  game = enqueue(game, { kind: 'prepare_data', packetId });
  game = enqueue(game, { kind: 'allocate_compute', serving: 0, development: 4 * U, research: 0 });
  game = until(game, s => s.slices.data.packets[packetId].prepared);
  game = until(enqueue(game, { kind: 'start_training', ...first }, 'first'), s => !!s.slices.models.versions['model-first']);
  const parent = game.slices.models.versions['model-first'];
  assert.equal(parent.capabilityBps.conversation, 4800);
  assert.equal(parent.reliabilityBps, 8600);
  game = step(enqueue(game, { kind: 'buy_data', catalogId: 'specialist-documents-1' }));
  const docs = Object.values(game.slices.data.packets).find(p => p.companyId === game.playerCompanyId && p.catalogId === 'specialist-documents-1')!;
  game = until(enqueue(game, { kind: 'prepare_data', packetId: docs.id }), s => s.slices.data.packets[docs.id].prepared);
  const child: TrainingOptions = { baseModelId: parent.id, packetId: docs.id, recipeId: 'document-adaptation', continueFromParent: true };
  const forecast = getTrainingDevelopment(game, child);
  assert.equal(forecast.forecastUsable, true);
  const ordinary = getTrainingPreview(game, game.playerCompanyId, {baseModelId: parent.id, packetId: docs.id, recipeId: 'document-adaptation'});
  const expectedConversation = parent.capabilityBps.conversation - Math.round((parent.capabilityBps.conversation - ordinary.capabilityRange.minimum.conversation) / 4);
  assert.equal(forecast.rows.find(row => row.id === 'conversation')!.minBps, expectedConversation);
  game = step(enqueue(game, { kind: 'start_training', ...child }, 'second'));
  const initialRun = game.slices.models.trainingRuns['training-second'];
  assert.deepEqual(expectedTrainingOutcome(initialRun, 0).capabilityBps, parent.capabilityBps);
  const corrupt = structuredClone(game);
  corrupt.slices.models.trainingRuns['training-second'].plan!.parentScores!.capabilityBps.documents++;
  assert.throws(() => serializeState(corrupt), /exact selected parent scores/);
  const resumed = reload(game);
  const done = (s: GameState) => !!s.slices.models.versions['model-second'];
  game = until(game, done);
  assert.equal(serializeState(until(resumed, done)), serializeState(game));
  const model = game.slices.models.versions['model-second'];
  const actual = getModelDevelopmentRows(parent, model);
  assert.equal(model.parentModelId, parent.id);
  assert.ok(model.capabilityBps.documents > parent.capabilityBps.documents);
  assert.ok(model.capabilityBps.conversation < parent.capabilityBps.conversation);
  assert.ok(model.capabilityBps.conversation > ordinary.capabilityRange.minimum.conversation);
  assert.deepEqual(actual, forecast.rows);
  assert.deepEqual(game.slices.models.versions[parent.id], parent);
  const repeat = { ...first, baseModelId: model.id, continueFromParent: true as const };
  assert.equal(previewCommand(game, { kind: 'start_training', ...repeat }).reason?.code, 'NO_IMPROVEMENT');
  const repeatedForecast = getTrainingDevelopment(game, repeat);
  assert.match(repeatedForecast.explanation, /same evidence/);
  assert.equal(repeatedForecast.forecastUsable, false);
  assert.deepEqual(repeatedForecast.rows, []);
  assert.equal(previewCommand(game, { kind: 'start_training', ...first, continueFromParent: true }).reason?.code, 'INVALID_COMMAND');
});
