import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelVersion } from '../src/contracts/types';
import type { ModelDesignSpec } from '../src/contracts/model-design';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_MODEL_CUSTOMIZATION, MODEL_CUSTOMIZATION_OPTIONS } from '../src/content/model-customization';
import { DESIGN_RESEARCH_IDS } from '../src/content/model-designs';
import { canonicalStateHash, createInitialState, getGameView } from '../src/core/index';
import { getModelDesignForecast, getModelDesignForBase } from '../src/modules/model-design';
import { ModelDesigner } from '../src/ui/model-designer';
import { MODEL_CUSTOMIZATION_KEYS, MODEL_DESIGN_PURPOSES, applyModelDesignPurpose, applyModelDesignResearch, inheritModelDesignDraft } from '../src/ui/model-design-draft';
import { LabPanel, ModelsPanel } from '../src/ui/lab-panels';
import { StudioModelSelectionProvider, StudioTaskModeProvider, StudioTrainingSelectionProvider } from '../src/ui/studio-interaction-context';
import { createResearchTrainingSelection } from '../src/ui/research-training-intent';

const noAction = () => assert.fail('Rendering must not spend resources or queue commands.');
const draft = (): ModelDesignSpec => ({ ...getModelDesignForBase(CONTENT.seedModel), name: 'Retained design draft' });

function buttonFor(html: string, name: string) {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find(match => match[1].includes(`aria-label="${name}`));
  assert.ok(button, 'Missing visible choice: ' + name);
  return button;
}

function savedModel(): ModelVersion {
  const game = createInitialState();
  const spec: ModelDesignSpec = { ...draft(), mode: 'foundation', parameterMillions: 6000,
    customization: { version: 1, attention: 'grouped-query', contextWindow: 'extended', precision: 'int8', objective: 'grounded', behavior: 'expressive' } };
  const forecast = getModelDesignForecast(game, game.playerCompanyId, CONTENT.seedModel.id, [], spec);
  return { ...structuredClone(CONTENT.seedModel), id: 'saved-profile', name: 'Saved specialized model', companyId: game.playerCompanyId,
    parentModelId: CONTENT.seedModel.id, createdWeek: 1, residentMU: forecast.residentMU,
    modelDesign: { spec, researchLevel: 2, frontierRating: forecast.frontierRating, servingWorkBps: forecast.servingWorkBps,
      requiredEvidence: forecast.requiredEvidence, ceilings: forecast.ceilings, advancedCeilings: forecast.advancedCeilings,
      ...(forecast.customization ? { customization: forecast.customization } : {}) } };
}

test('compact sections expose selected choices and keep every locked foundation choice previewable', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<ModelDesigner game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]}
    value={{ ...draft(), mode: 'foundation' }} onChange={noAction} canAct showForecast={false} />);
  for (const field of MODEL_CUSTOMIZATION_KEYS) for (const option of MODEL_CUSTOMIZATION_OPTIONS[field]) {
    const [_, attributes, body] = buttonFor(html, option.name);
    assert.doesNotMatch(attributes, /\bdisabled=/, option.name + ' should be previewable');
    if (option.requiredResearch) {
      assert.match(attributes, /data-locked="true"/);
      assert.ok(body.includes('Research needed'));
      assert.ok(attributes.includes('Requires ' + CONTENT.research.find(item => item.id === option.requiredResearch)!.name));
    }
  }
  assert.doesNotMatch(html, /role="dialog"|hidden=""/);
  for (const label of ['Learning &amp; responses', 'Size, attention, context &amp; precision', 'Training mix']) assert.ok(html.includes(label));
  assert.match(html, /model-design-section-disclosure" open=""/);
  for (const purpose of MODEL_DESIGN_PURPOSES) assert.ok(html.includes(purpose.name));
  assert.equal(canonicalStateHash(game), before);
});

test('adaptation displays inherited hardware while leaving paid focus and response choices editable', () => {
  const game = createInitialState(), base = savedModel();
  game.slices.models.versions[base.id] = base;
  const html = renderToStaticMarkup(<ModelDesigner game={game} baseModelId={base.id} packetIds={[]}
    value={getModelDesignForBase(base)} onChange={noAction} canAct showForecast={false} />);
  for (const field of ['attention', 'contextWindow', 'precision'] as const) {
    for (const option of MODEL_CUSTOMIZATION_OPTIONS[field]) assert.ok(!html.includes(`aria-label="${option.name}`), 'Inherited hardware is a readable profile, not disabled choices.');
    const inherited = MODEL_CUSTOMIZATION_OPTIONS[field].find(option => option.value === base.modelDesign!.spec.customization![field])!;
    assert.ok(html.includes(inherited.name));
  }
  for (const field of ['objective', 'behavior'] as const) for (const option of MODEL_CUSTOMIZATION_OPTIONS[field])
    assert.doesNotMatch(buttonFor(html, option.name)[1], /\bdisabled=/);
  assert.match(html, /model-design-inherited-profile/);
  assert.match(html, /Choose Build a new foundation above to change the hardware/);
});

test('rebasing a draft preserves its name, budget, data priorities and editable profile without mutating either input', () => {
  const base = savedModel(), initial: ModelDesignSpec = { ...draft(), computeBudgetCUw: 71e9,
    dataMix: { conversation: 5, documents: 15, coding: 20, tools: 10, reasoning: 40, longContext: 10, multimodal: 0 },
    customization: { ...DEFAULT_MODEL_CUSTOMIZATION, objective: 'reasoning', behavior: 'careful' } };
  const before = canonicalStateHash({ initial, base });
  const next = inheritModelDesignDraft(initial, base);
  assert.equal(next.name, initial.name);
  assert.equal(next.computeBudgetCUw, initial.computeBudgetCUw);
  assert.deepEqual(next.dataMix, initial.dataMix);
  assert.equal(next.customization!.objective, 'reasoning');
  assert.equal(next.customization!.behavior, 'careful');
  for (const key of ['attention', 'contextWindow', 'precision'] as const) assert.equal(next.customization![key], base.modelDesign!.spec.customization![key]);
  assert.equal(next.parameterMillions, 6000);
  assert.notEqual(next.dataMix, initial.dataMix);
  assert.notEqual(next.customization, initial.customization);
  assert.equal(canonicalStateHash({ initial, base }), before);
  const foundation = { ...initial, mode: 'foundation' as const };
  assert.deepEqual(inheritModelDesignDraft(foundation, base), foundation, 'A new foundation does not inherit unrelated reference hardware.');
  assert.equal(inheritModelDesignDraft(draft(), CONTENT.seedModel).customization, undefined, 'Opening an old draft does not upgrade its historical protocol.');
  assert.deepEqual(inheritModelDesignDraft(draft(), base).customization, base.modelDesign!.spec.customization, 'A custom starting model supplies its complete profile to an untouched draft.');
});

test('purpose presets keep the inherited hardware, make independent editable copies and preserve the named draft', () => {
  const base = savedModel(), original = getModelDesignForBase(base), before = canonicalStateHash(original);
  const purpose = MODEL_DESIGN_PURPOSES.find(item => item.id === 'analyst')!;
  const adaptation = applyModelDesignPurpose(original, purpose, base);
  assert.equal(adaptation.name, original.name);
  assert.equal(adaptation.mode, 'adaptation');
  assert.equal(adaptation.customization!.objective, 'reasoning');
  assert.equal(adaptation.customization!.behavior, 'careful');
  for (const key of ['attention', 'contextWindow', 'precision'] as const) assert.equal(adaptation.customization![key], original.customization![key]);
  const foundation = applyModelDesignPurpose({ ...original, mode: 'foundation' }, purpose, base);
  assert.equal(foundation.customization!.attention, 'hybrid');
  assert.equal(foundation.customization!.contextWindow, 'ultra');
  assert.notEqual(foundation.dataMix, purpose.dataMix);
  assert.notEqual(foundation.customization, purpose.customization);
  assert.equal(canonicalStateHash(original), before);
});

test('every research application opens the matching custom choice without dropping data priorities or renaming the draft', () => {
  const game = createInitialState();
  let intentId = 20;
  for (const field of MODEL_CUSTOMIZATION_KEYS) for (const option of MODEL_CUSTOMIZATION_OPTIONS[field]) {
    if (!option.requiredResearch) continue;
    const original = draft(), next = applyModelDesignResearch(original, option.requiredResearch)!;
    assert.ok(next, option.requiredResearch);
    assert.equal(next.customization![field], option.value);
    assert.equal(next.name, original.name);
    assert.deepEqual(next.dataMix, original.dataMix);
    assert.equal(next.computeBudgetCUw, original.computeBudgetCUw);
    assert.equal(next.mode, ['attention', 'contextWindow', 'precision'].includes(field) ? 'foundation' : 'adaptation');
    const selection = createResearchTrainingSelection('lab-projects', option.requiredResearch, intentId++);
    assert.ok(selection, 'The shell must carry this invention into the training form.');
    const html = renderToStaticMarkup(<StudioTrainingSelectionProvider value={selection}>
      <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
    </StudioTrainingSelectionProvider>);
    assert.match(html, /class="model-designer"/);
    assert.match(buttonFor(html, option.name)[1], /aria-pressed="true"/);
    assert.doesNotMatch(html, /id="training-recipe"/);
  }
});

test('research bridge retains existing design links and leaves unrelated navigation alone', () => {
  const game = createInitialState();
  for (const id of DESIGN_RESEARCH_IDS) assert.deepEqual(createResearchTrainingSelection('lab-projects', id, 9), { intentId: 9, designResearchId: id });
  for (const [panel, id] of [['models', 'M1'], ['applied-research', 'M6'], ['lab-projects', 'R1'], ['lab-projects', 'M14']] as const)
    assert.equal(createResearchTrainingSelection(panel, id, 9), null);
  assert.equal(createResearchTrainingSelection('lab-projects', undefined, 9), null);
  const html = renderToStaticMarkup(<StudioTrainingSelectionProvider value={createResearchTrainingSelection('lab-projects', DESIGN_RESEARCH_IDS[0], 10)}>
    <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </StudioTrainingSelectionProvider>);
  assert.match(html, /id="training-recipe"/);
  assert.doesNotMatch(html, /class="model-designer"/);
});

test('a selected model profile stays visible in evaluation and version history rather than inside collapsed history', () => {
  const game = createInitialState(), model = savedModel();
  game.slices.models.versions[model.id] = model;
  const before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioTaskModeProvider value="evaluate-model"><StudioModelSelectionProvider value={{ intentId: 4, modelId: model.id }}>
    <ModelsPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </StudioModelSelectionProvider></StudioTaskModeProvider>);
  const profileIndex = html.indexOf('aria-label="Model profile for Saved specialized model"');
  assert.ok(profileIndex >= 0);
  assert.ok(profileIndex < html.indexOf('<summary>Model details and training history</summary>'));
  for (const field of MODEL_CUSTOMIZATION_KEYS) {
    const label = MODEL_CUSTOMIZATION_OPTIONS[field].find(option => option.value === model.modelDesign!.spec.customization![field])!.name;
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /<th scope="col">Profile<\/th>/);
  assert.equal(canonicalStateHash(game), before);
});
