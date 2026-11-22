import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { SYNTHETIC_RULES } from '../src/content/wave26-synthetic';
import type { CommandPayload } from '../src/contracts/types';
import { previewCommand, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { getTrainingPreview, validateTrainingOptions } from '../src/modules/lab-planner';
import { getSyntheticFixture } from './fixtures/wave26-synthetic';

test('new custom designs cannot bypass a genuine synthetic packet’s teacher and audited curriculum', () => {
  const fixture = getSyntheticFixture(), game = fixture.accepted, owner = game.playerCompanyId;
  assert.equal(game.contentVersion, CONTENT.version);
  const original = canonicalStateHash(game);
  for (const packetIds of [[fixture.packetId], [fixture.sourcePacketId, fixture.packetId]]) {
    const payload: Extract<CommandPayload, { kind: 'start_training' }> = {
      kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: packetIds[0], packetIds,
      recipeId: 'custom-model-adaptation', modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN),
        name: 'Synthetic boundary probe', dataMix: { conversation: 0, documents: 100, coding: 0, tools: 0, reasoning: 0, longContext: 0, multimodal: 0 } },
    };
    const preview = previewCommand(game, payload, CONTENT);
    assert.equal(preview.accepted, false);
    assert.match(preview.reason?.message ?? '', /targeted synthetic curriculum/);
    const submitted = submitCommand(game, payload, CONTENT);
    assert.equal(submitted.accepted, false);
    assert.equal(submitted.reason?.code, 'NOT_READY');
    assert.match(getTrainingPreview(game, owner, payload, CONTENT).reason?.message ?? '', /targeted synthetic curriculum/);
    const delegated = submitCommand(game, { kind: 'start_development_plan', name: 'Synthetic boundary probe',
      training: payload, suiteId: 'expanded-capabilities-1', feeBudgetCents: 1_000_000,
      cashReserveCents: 0, deadlineWeek: game.week + 32 }, CONTENT);
    assert.equal(delegated.accepted, false);
    assert.match(delegated.reason?.message ?? '', /targeted synthetic curriculum/);
  }
  assert.equal(canonicalStateHash(game), original, 'Rejected commands must leave paid evidence and saved models intact.');
});

test('the genuine audited packet still admits its ordinary fixed curriculum; historical custom admission stays unchanged', () => {
  const fixture = getSyntheticFixture(), game = fixture.accepted;
  const payload: Extract<CommandPayload, { kind: 'start_training' }> = { kind: 'start_training',
    baseModelId: CONTENT.seedModel.id, packetId: fixture.packetId, packetIds: [fixture.packetId], recipeId: SYNTHETIC_RULES.recipeId };
  const preview = previewCommand(game, payload, CONTENT);
  assert.equal(preview.accepted, true, preview.reason?.message);
  const submitted = submitCommand(game, payload, CONTENT);
  assert.equal(submitted.accepted, true, submitted.reason?.message);
  const options = { ...payload, recipeId: 'custom-model-adaptation', modelDesign: {
    ...structuredClone(DEFAULT_MODEL_DESIGN), name: 'Historical custom admission',
    dataMix: { conversation: 0, documents: 100, coding: 0, tools: 0, reasoning: 0, longContext: 0, multimodal: 0 },
  } };
  // A focused version-gate assertion, not a fabricated historical save. The
  // existing paid receipt validators are intentionally untouched by this fix.
  const historicalReadView = { ...game, contentVersion: '0.33.0' };
  assert.equal(validateTrainingOptions(historicalReadView, game.playerCompanyId, options,
    { ...CONTENT, version: '0.33.0', buildVersion: '0.33.1' }), undefined);
});
