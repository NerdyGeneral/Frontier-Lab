import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInitialState } from '../src/core/engine';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { ModelDesigner, ModelDesignForecast } from '../src/ui/model-designer';
import { LabPanel, ModelsPanel, ResearchPanel } from '../src/ui/lab-panels';
import { ResearchProgramsWorkspace } from '../src/ui/research-programs-workspace';
import { canonicalStateHash, deserializeState, getGameView } from '../src/core/index';
import { StudioModelSelectionProvider } from '../src/ui/studio-interaction-context';

const draft = () => structuredClone(DEFAULT_MODEL_DESIGN);

test('custom design does not present scores as earned when no prepared data is selected', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<ModelDesignForecast game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]} value={draft()} />);
  assert.match(html, /Choose prepared data to calculate expected skills/);
  assert.equal((html.match(/<strong>—<\/strong>/g) ?? []).length, 7);
  for (const label of ['Conversation', 'Documents', 'Coding', 'Tool use', 'Reasoning', 'Long context', 'Multimodal']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test('adaptation explains inherited architecture while new foundations expose research requirements', () => {
  const game = createInitialState();
  const props = { game, baseModelId: CONTENT.seedModel.id, packetIds: [], canAct: true, onChange: () => undefined, showForecast: false };
  const adaptation = renderToStaticMarkup(<ModelDesigner {...props} value={draft()} />);
  assert.match(adaptation, /keeps its compact architecture/);
  assert.doesNotMatch(adaptation, /Model size in billions of parameters/);
  assert.match(adaptation, /model-design-inherited-profile/);
  assert.equal((adaptation.match(/aria-label="[^"]+ priority"/g) ?? []).length, 7);
  assert.match(adaptation, /No matching prepared data selected/);
  const foundation = renderToStaticMarkup(<ModelDesigner {...props} value={{ ...draft(), mode: 'foundation' }} />);
  assert.match(foundation, /Research level 1/);
  assert.match(foundation, /Research level 3/);
  assert.match(foundation, /Model family/);
  assert.doesNotMatch(foundation, /Model size in billions of parameters[^>]*disabled/);
});

test('model priority shares stay coherent and a read-only task disables all draft controls', () => {
  const game = createInitialState();
  const spec = draft();
  for (const key of Object.keys(spec.dataMix) as (keyof typeof spec.dataMix)[]) spec.dataMix[key] = 1;
  const html = renderToStaticMarkup(<ModelDesigner game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]} value={spec} onChange={() => undefined} canAct={false} showForecast={false} />);
  assert.match(html, /<fieldset[^>]*disabled/);
  const shares = [...html.matchAll(/<output[^>]*>(\d+)% <span>of mix<\/span>/g)].map(match => Number(match[1]));
  assert.equal(shares.length, 7);
  assert.equal(shares.reduce((sum, share) => sum + share, 0), 100);
});

function establishedLab() {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave27-canary-published.json', import.meta.url), 'utf8'));
  assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  return loaded.state;
}

test('the integrated lab keeps first training guided and presents the designer for an established company', () => {
  const onQueue = () => assert.fail('Rendering cannot commit a training command');
  const fresh = createInitialState();
  const opening = renderToStaticMarkup(<LabPanel game={fresh} view={getGameView(fresh)} canAct onQueue={onQueue} />);
  assert.match(opening, /Design your own/);
  assert.match(opening, /Training methods/);
  assert.match(opening, /id="training-recipe"/);
  assert.doesNotMatch(opening, /class="model-designer"/);

  const game = establishedLab(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<LabPanel game={game} view={getGameView(game)} canAct onQueue={onQueue} />);
  assert.match(html, /class="model-designer"/);
  assert.match(html, /class="model-design-forecast"/);
  assert.equal((html.match(/aria-label="[^"]+ priority"/g) ?? []).length, 7);
  for (const id of ['training-base', 'training-data']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
  assert.doesNotMatch(html, /id="training-(recipe|profile|workspace|retention)"/);
  assert.equal(canonicalStateHash(game), before);
});

test('advanced report cases have readable labels and remain separate from a release capability report', () => {
  const game = establishedLab(), owner = game.playerCompanyId;
  const model = Object.values(game.slices.models.versions).find(item => item.companyId === owner && item.trainingRunId)!;
  model.advancedCapabilities = { reasoning: 4000, longContext: 3000, multimodal: 2000 };
  const id = 'advanced-ui-report';
  game.slices.models.reports[id] = {
    id, companyId: owner, modelId: model.id, week: game.week, suiteId: 'advanced-capabilities-1', heldOut: true,
    capabilityBps: { ...model.capabilityBps }, advancedCapabilities: { ...model.advancedCapabilities }, reliabilityBps: model.reliabilityBps,
    basicChatEligible: false, passedCases: 1,
    cases: [
      { id: 'reason', domain: 'reasoning', difficultyBps: 2000, passed: true },
      { id: 'context', domain: 'longContext', difficultyBps: 2000, passed: false },
      { id: 'image', domain: 'multimodal', difficultyBps: 2000, passed: false },
    ],
  };
  const html = renderToStaticMarkup(<StudioModelSelectionProvider value={{ intentId: 1, modelId: model.id, reportId: id }}>
    <ModelsPanel game={game} view={getGameView(game)} canAct onQueue={() => assert.fail('Rendering cannot submit a command')} />
  </StudioModelSelectionProvider>);
  for (const [index, label] of ['Reasoning', 'Long context', 'Multimodal'].entries()) assert.ok(html.includes(`${index + 1}. ${label}`));
  assert.match(html, /Held-out advanced skills/);
  assert.match(html, /Capability report required/);
  assert.doesNotMatch(html, /undefined/);
});

test('Classic research links to the canonical programs workspace instead of mounting another architecture draft', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<ResearchPanel game={game} view={getGameView(game)} canAct onQueue={() => assert.fail('Rendering cannot submit a command')} />);
  assert.match(html, /href="#research-programs">Open Research programs/);
  assert.doesNotMatch(html, /aria-label="Architecture research"|Fund architecture level/);
  const programs = renderToStaticMarkup(<ResearchProgramsWorkspace game={game} canAct onQueue={() => assert.fail('Rendering cannot submit a command')} />);
  assert.match(programs, /Architecture research/);
  assert.match(programs, /Unlocks at level 1/);
  assert.match(programs, /Unlocks at level 3/);
  assert.match(programs, /Fund architecture level 1/);
});
