import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameState } from '../src/contracts/types';
import type { DevelopmentTrainingOrder } from '../src/contracts/development-plans';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { SYNTHETIC_RULES } from '../src/content/wave26-synthetic';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getModelDesignForBase } from '../src/modules/model-design';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { buildDevelopmentTrainingOrder } from '../src/ui/development-plan-draft';
import { ModelDesignForecast } from '../src/ui/model-designer';
import { getSyntheticFixture } from './fixtures/wave26-synthetic';
import { getCustomizationReadyFixture } from './fixtures/model-customization';

/** Exercise the UI-constructed command through both ordinary preview and the
 * plan's real delegated admission, retaining the paid source provenance. */
function admitConstructedOrder(initial: GameState, training: DevelopmentTrainingOrder, label: string, inspect?: (state: GameState) => void) {
  const direct = previewCommand(initial, training); assert.ok(direct.accepted, direct.reason?.message);
  const payload = { kind: 'start_development_plan' as const, name: label, training, suiteId: 'basic-conversation-1' as const,
    feeBudgetCents: 1_000_000, cashReserveCents: 0, deadlineWeek: initial.week + 40 };
  const preview = previewCommand(initial, payload); assert.ok(preview.accepted, preview.reason?.message);
  const queued = submitCommand(initial, payload, CONTENT, label); assert.ok(queued.accepted, queued.reason?.message);
  let game = queued.state;
  const planId = 'development-' + label;
  for (let week = 0; week < 5; week++) {
    const next = advanceWeek(game); assert.ok(next.accepted, next.reason?.message); game = next.state;
    const step = game.slices.models.developmentPlans?.[planId]?.steps.find(item => item.key === 'train');
    if (step && game.commandReceipts[step.commandId]?.status === 'accepted') {
      assert.deepEqual(step.payload, training);
      assert.deepEqual(game.slices.models.developmentPlans![planId].training, training);
      const run = game.slices.models.trainingRuns['training-' + step.commandId]; assert.ok(run);
      assert.deepEqual(validateState(game), []);
      inspect?.(game);
      return run;
    }
  }
  assert.fail('The UI-constructed training order was not admitted by its delegated plan.');
}

test('custom plan builder names the correct foundation or adaptation recipe and both constructed commands are admitted', () => {
  const fixture = getSyntheticFixture(), game = fixture.accepted, base = game.slices.models.versions[CONTENT.seedModel.id];
  for (const mode of ['adaptation', 'foundation'] as const) {
    const design = { ...getModelDesignForBase(base), name: 'UI custom ' + mode, mode };
    const draft = { base, packetIds: [CONTENT.starterData.id], method: 'custom', profile: 'ambitious' as const, design,
      teacherModelId: fixture.teacherModelId, teacherDomain: 'documents' as const };
    const before = canonicalStateHash(draft), training = buildDevelopmentTrainingOrder(draft)!;
    assert.equal(canonicalStateHash(draft), before);
    assert.equal(training.recipeId, `custom-model-${mode}`);
    assert.deepEqual(training.modelDesign, design);
    for (const key of ['profile', 'continueFromParent', 'teacherModelId', 'teacherDomain', 'replay', 'automatedCheckpoints']) assert.equal(Object.hasOwn(training, key), false, key);
    const run = admitConstructedOrder(structuredClone(game), training, 'ui-custom-' + mode);
    assert.equal(run.plan?.modelDesign?.spec.mode, mode);
    assert.deepEqual(run.plan?.modelDesign?.spec, design);
  }
});

test('synthetic plan builder omits an earlier profile choice and delegates exactly one paid audited packet', () => {
  const fixture = getSyntheticFixture(), game = fixture.accepted, base = game.slices.models.versions[CONTENT.seedModel.id];
  const training = buildDevelopmentTrainingOrder({ base, packetIds: [fixture.packetId], method: SYNTHETIC_RULES.recipeId,
    profile: 'ambitious', design: getModelDesignForBase(base), teacherModelId: fixture.teacherModelId, teacherDomain: 'documents' })!;
  assert.deepEqual(training.packetIds, [fixture.packetId]);
  for (const key of ['profile', 'continueFromParent', 'teacherModelId', 'teacherDomain', 'modelDesign']) assert.equal(Object.hasOwn(training, key), false, key);
  const polluted = previewCommand(game, { ...training, profile: 'ambitious' });
  assert.equal(polluted.accepted, false); assert.match(polluted.reason!.message, /profile/);
  const run = admitConstructedOrder(game, training, 'ui-synthetic-plan');
  assert.equal(run.packetId, fixture.packetId);
  assert.equal(run.plan?.kind, 'synthetic');
  assert.ok(run.plan?.synthetic, 'The delegated run keeps the source audit and teacher provenance.');
});

test('a UI-built customized foundation is admitted through a paid delegated plan and keeps its complete profile in a save', () => {
  const fixture = getCustomizationReadyFixture(['M1', 'M4', 'M6', 'M10', 'M13']);
  const game = fixture.state, base = game.slices.models.versions[CONTENT.seedModel.id];
  const design: ModelDesignSpec = { ...getModelDesignForBase(base), name: 'Document service design', mode: 'foundation',
    computeBudgetCUw: 72e9, dataMix: { conversation: 20, documents: 40, coding: 0, tools: 10, reasoning: 10, longContext: 20, multimodal: 0 },
    customization: { version: 1, attention: 'grouped-query', contextWindow: 'extended', precision: 'int8', objective: 'grounded', behavior: 'expressive' } };
  const training = buildDevelopmentTrainingOrder({ base, packetIds: [fixture.packetId], method: 'custom', profile: 'ambitious', design,
    teacherModelId: 'unrelated-teacher', teacherDomain: 'coding' })!;
  assert.notEqual(training.modelDesign, design);
  assert.notEqual(training.modelDesign!.customization, design.customization);
  const approved = structuredClone(design);
  design.customization!.behavior = 'careful';
  assert.equal(training.modelDesign!.customization!.behavior, 'expressive', 'The delegated order owns a complete copy of the approved design.');
  const run = admitConstructedOrder(game, training, 'ui-customized-foundation', state => {
    const decoded = deserializeState(serializeState(state, CONTENT), CONTENT);
    assert.ok(decoded.ok, decoded.ok ? undefined : decoded.error);
    assert.deepEqual(decoded.state.slices.models.developmentPlans!['development-ui-customized-foundation'].training.modelDesign, approved);
    const loadedRun = Object.values(decoded.state.slices.models.trainingRuns).find(item => item.plan?.modelDesign?.spec.name === approved.name);
    assert.deepEqual(loadedRun?.plan?.modelDesign?.spec, approved);
  });
  assert.deepEqual(run.plan?.modelDesign?.spec, approved);
  assert.deepEqual(run.plan?.modelDesign?.customization?.choices, approved.customization);

  const expected = getTrainingPreview(game, game.playerCompanyId, training);
  assert.ok(expected.behavior);
  const html = renderToStaticMarkup(<ModelDesignForecast game={game} baseModelId={base.id} packetIds={[fixture.packetId]} value={approved} />);
  const number = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%';
  for (const [label, value] of [['Confident errors', expected.behavior.confidentErrorBps], ['Unnecessary refusals', expected.behavior.falseRefusalBps]] as const) {
    const row = html.match(new RegExp(`<dt>${label}[\\s\\S]*?<b>([^<]+)</b>`));
    assert.ok(row, label + ' must be present in the custom forecast');
    assert.equal(row[1], number(value), 'The forecast shows the earned outcome from real data, not an unattained target.');
  }
  assert.match(html, /Evidence target \/ skill/);
  assert.match(html, /Serving vs family reference/);
});
