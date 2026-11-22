import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, isValidElement, type MouseEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { SYNTHETIC_RULES } from '../src/content/wave26-synthetic';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash, createInitialState, getGameView } from '../src/core/index';
import { getModelDesignForBase } from '../src/modules/model-design';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { previewCommand } from '../src/core/engine';
import { LabPanel } from '../src/ui/lab-panels';
import { DevelopmentPlansPanel } from '../src/ui/development-plans-panel';
import { ModelDesigner, ModelDesignResearchRequirement } from '../src/ui/model-designer';
import { ModelDesignComparison } from '../src/ui/model-design-comparison';
import { copyModelDesignCandidate, forecastSkill, getComputeBenefitHint, getDesignCandidateForecast, humanizeDesignRequirement, rememberModelDesign } from '../src/ui/model-design-insights';
import { MODEL_DESIGN_PURPOSES, applyModelDesignPurpose } from '../src/ui/model-design-draft';
import { StudioResearchDesignerShortcut, StudioResearchTree } from '../src/ui/studio-research-tree';
import { StudioDevelopmentSelectionProvider, StudioTaskActionsProvider, StudioTrainingSelectionProvider, type StudioTaskActions } from '../src/ui/studio-interaction-context';
import { ModelWorkspaceProvider, type ModelWorkspace } from '../src/ui/model-workspace-context';
import type { ManualTrainingDraft, ModelBlueprint } from '../src/persistence/model-workspace';
import { getCustomizationReadyFixture } from './fixtures/model-customization';
import { getSyntheticFixture } from './fixtures/wave26-synthetic';
import { buildDevelopmentTrainingOrder } from '../src/ui/development-plan-draft';

const noAction = () => assert.fail('Rendering and comparing must not queue a command.');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const actions: StudioTaskActions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction,
  reviewResources: noAction, hireStaff: noAction, assignStaff: noAction, openResearch: noAction };
const savedManual = (packetId: string): ManualTrainingDraft => ({
  recipeId: CONTENT.firstTraining.id, designRoute: 'custom', designDraft: { ...getModelDesignForBase(CONTENT.seedModel), name: 'Saved analyst from browser', computeBudgetCUw: 137 * U,
    dataMix: { conversation: 5, documents: 15, coding: 10, tools: 0, reasoning: 60, longContext: 10, multimodal: 0 } },
  baseId: CONTENT.seedModel.id, packetId, explicitPacket: true, extraPackets: [], profile: 'reference', workspace: '', automated: false,
  asAdapter: false, retentionMode: 'none', replayChoice: { domain: 'coding', shareBps: 5000, packetIds: [] },
  curriculumChoice: { shareBps: 5000, tracks: [{ domain: 'documents', packetIds: [] }, { domain: 'coding', packetIds: [] }] },
  architecture: 'dense', teacherId: '', teacherDomain: 'conversation', trainingView: 'guided', designOpen: false,
});
const storedWorkspace = (manual: ManualTrainingDraft, ready = true): ModelWorkspace => ({ manual, delegated: null, blueprints: [], ready,
  epoch: 17, notice: '', persistent: true, setDraft: noAction, saveBlueprint: noAction, setDevelopmentGoal: noAction });

test('the research shortcut uses the custom intent, and a fresh lab opens the actual custom form', () => {
  let opened = 0;
  const button = StudioResearchDesignerShortcut({ onOpenDesigner: () => { opened++; }, onOpenPanel: noAction });
  button.props.onClick();
  assert.equal(opened, 1, 'The shortcut must not fall back to the guided panel destination.');
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioTrainingSelectionProvider value={{ intentId: 91, designer: 'custom' }}>
    <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </StudioTrainingSelectionProvider>);
  assert.match(html, /class="model-designer"/);
  assert.doesNotMatch(html, /id="training-recipe"/);
  assert.match(html, /data-persistent-summary="true"/);
  assert.equal((html.match(/aria-label="Current decision summary"/g) ?? []).length, 1);
  assert.equal((html.match(/id="training-base"/g) ?? []).length, 1);
  assert.equal((html.match(/id="training-data"/g) ?? []).length, 1);
});

test('a research intent applies after durable restoration and preserves the saved name, priorities and budget', () => {
  const game = createInitialState(), manual = savedManual(CONTENT.starterData.id);
  const render = (ready: boolean) => renderToStaticMarkup(<ModelWorkspaceProvider value={storedWorkspace(manual, ready)}>
    <StudioTrainingSelectionProvider value={{ intentId: 22, designResearchId: 'M1' }}>
      <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
    </StudioTrainingSelectionProvider>
  </ModelWorkspaceProvider>);
  const waiting = render(false);
  assert.doesNotMatch(waiting, /class="model-designer"/, 'An intent waits while browser draft restoration is pending.');
  const restored = render(true);
  assert.match(restored, /value="Saved analyst from browser"/);
  assert.match(restored, /aria-label="Grouped-query[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Grouped-query/);
  assert.match(restored, /value="137"/);
  assert.match(restored, /aria-valuetext="60 priority, 60% of training mix"/);
});

test('a requested dataset wins after browser restoration instead of being consumed and overwritten', () => {
  const { state: game, packetId } = getCustomizationReadyFixture();
  const other = Object.values(game.slices.data.packets).find(packet => packet.prepared && packet.id !== packetId && (packet.companyId ?? game.playerCompanyId) === game.playerCompanyId);
  assert.ok(other);
  const html = renderToStaticMarkup(<ModelWorkspaceProvider value={storedWorkspace(savedManual(other.id))}>
    <StudioTrainingSelectionProvider value={{ intentId: 23, packetId }}>
      <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
    </StudioTrainingSelectionProvider>
  </ModelWorkspaceProvider>);
  const data = html.match(/<select id="training-data"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(data);
  const selected = [...data.matchAll(/<option([^>]*)>/g)].find(match => match[1].includes('selected=""'))?.[1];
  assert.ok(selected?.includes(`value="${packetId}"`), 'The explicit navigation data selection wins over the older stored draft.');
  assert.match(html, /value="Saved analyst from browser"/);
});

test('delegated handoffs wait for restoration and then keep the incoming exact design above the older plan', () => {
  const game = createInitialState(), manual = savedManual(CONTENT.starterData.id);
  const blueprint: ModelBlueprint = { id: 'incoming-design', name: 'Incoming delegated project', training: { kind: 'start_training',
    baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id, packetIds: [CONTENT.starterData.id], recipeId: 'custom-model-adaptation',
    modelDesign: { ...manual.designDraft!, name: 'Incoming exact candidate' } }, suiteId: 'advanced-capabilities-1' };
  const render = (ready: boolean) => renderToStaticMarkup(<ModelWorkspaceProvider value={{ ...storedWorkspace(manual, ready), delegated: {
    name: 'Old stored project', baseId: CONTENT.seedModel.id, selected: [CONTENT.starterData.id], method: CONTENT.firstTraining.id,
    profile: 'stable', teacherId: '', teacherDomain: 'conversation', design: getModelDesignForBase(CONTENT.seedModel),
    suiteId: 'basic-conversation-1', budget: '6789', reserve: '1234', duration: '47', importedTraining: null,
  } }}><StudioDevelopmentSelectionProvider value={{ intentId: 24, blueprint }}>
    <DevelopmentPlansPanel game={game} canAct onQueue={noAction} />
  </StudioDevelopmentSelectionProvider></ModelWorkspaceProvider>);
  assert.doesNotMatch(render(false), /Training design from workbench|Incoming exact candidate/);
  const html = render(true);
  assert.match(html, /aria-label="Training design from workbench"/);
  assert.match(html, /Incoming exact candidate/);
  assert.match(html, /value="Incoming delegated project"/);
  for (const limit of ['6789', '1234', '47']) assert.ok(html.includes(`value="${limit}"`), 'Incoming design retains restored project limits.');
  assert.doesNotMatch(html, /value="Old stored project"/);
});

test('an audited synthetic order stays admissible across manual and delegated forms without leaking old profile or checkpoint settings', () => {
  const fixture = getSyntheticFixture(), game = fixture.accepted;
  const before = canonicalStateHash(game), base = game.slices.models.versions[CONTENT.seedModel.id];
  const training = buildDevelopmentTrainingOrder({ base, packetIds: [fixture.packetId], method: SYNTHETIC_RULES.recipeId,
    profile: 'ambitious', design: getModelDesignForBase(base), teacherModelId: fixture.teacherModelId, teacherDomain: 'documents' })!;
  assert.ok(previewCommand(game, training).accepted);
  assert.equal(previewCommand(game, { ...training, profile: 'ambitious', automatedCheckpoints: true }).accepted, false,
    'The fixture exercises the actual fixed-curriculum restriction.');
  const stale = { ...savedManual(fixture.packetId), recipeId: SYNTHETIC_RULES.recipeId, designRoute: 'methods' as const,
    profile: 'ambitious' as const, automated: true };
  const manual = renderToStaticMarkup(<ModelWorkspaceProvider value={storedWorkspace(stale)}>
    <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </ModelWorkspaceProvider>);
  const primary = (html: string, key: string) => [...html.matchAll(/<button\b[^>]*>/g)].find(match => match[0].includes(`data-studio-primary-for="${key}"`))?.[0];
  const initialAction = primary(manual, 'train-model');
  assert.ok(initialAction);
  assert.doesNotMatch(initialAction, /disabled=""|data-studio-blocked-reason=/, 'The manual payload passes its ordinary quote despite older stored method controls.');
  assert.doesNotMatch(manual, /id="training-profile"|>Automated checkpoints /);
  const blueprint: ModelBlueprint = { id: 'audited-order', name: 'Audited targeted curriculum', training, suiteId: 'basic-conversation-1' };
  const delegated = renderToStaticMarkup(<StudioDevelopmentSelectionProvider value={{ intentId: 31, blueprint }}>
    <DevelopmentPlansPanel game={game} canAct onQueue={noAction} />
  </StudioDevelopmentSelectionProvider>);
  assert.match(delegated, /Training design from workbench/);
  const delegatedAction = primary(delegated, 'development-plan');
  assert.ok(delegatedAction);
  assert.doesNotMatch(delegatedAction, /disabled=""|data-studio-blocked-reason=/);
  const returned = renderToStaticMarkup(<StudioTrainingSelectionProvider value={{ intentId: 32, blueprint }}>
    <LabPanel game={game} view={getGameView(game)} canAct onQueue={noAction} />
  </StudioTrainingSelectionProvider>);
  const finalAction = primary(returned, 'train-model');
  assert.ok(finalAction);
  assert.doesNotMatch(finalAction, /disabled=""|data-studio-blocked-reason=/, 'Returning to the manual workbench does not add a forbidden profile.');
  assert.doesNotMatch(returned, /id="training-profile"|>Automated checkpoints /);
  assert.equal(canonicalStateHash(game), before);
});

test('research requirements route the exact invention and explain named prerequisites without raw IDs', () => {
  const game = createInitialState(), opened: string[] = [];
  const requirement = ModelDesignResearchRequirement({ game, id: 'M6', onOpenResearch: id => opened.push(id) });
  const link = Children.toArray(requirement.props.children)[0];
  assert.ok(isValidElement<{ href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void }>(link));
  assert.equal(link.props.href, '#research-method-M6', 'A unique hash bypasses ordinary panel-link capture.');
  let prevented = false;
  link.props.onClick({ preventDefault: () => { prevented = true; } } as MouseEvent<HTMLAnchorElement>);
  assert.equal(prevented, true);
  assert.deepEqual(opened, ['M6']);
  const labels = textOnly(renderToStaticMarkup(requirement));
  assert.match(labels, /8-bit weights/);
  assert.match(labels, /First:/);
  for (const id of CONTENT.research.find(item => item.id === 'M6')!.requires) assert.ok(labels.includes(CONTENT.research.find(item => item.id === id)!.name));
  assert.doesNotMatch(labels, /\b(?:M6|R7|D5)\b/);

  const spec = applyModelDesignPurpose({ ...getModelDesignForBase(CONTENT.seedModel), mode: 'foundation' }, MODEL_DESIGN_PURPOSES.find(item => item.id === 'support')!, CONTENT.seedModel);
  const html = renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <ModelDesigner game={game} baseModelId={CONTENT.seedModel.id} packetIds={[]} value={spec} onChange={noAction} canAct />
  </StudioTaskActionsProvider>);
  assert.match(html, /href="#research-method-M/);
  assert.match(html, /Research needed for this design/);
  assert.doesNotMatch(textOnly(html), /Requires M\d|Research needed: M\d|M1, M/);
  assert.equal(humanizeDesignRequirement('Research M1, M10 and M12 first.'), 'Research Grouped-query attention, Grounded curriculum and Careful responses first.');
});

test('research offers one programs destination while keeping all discovery methods inspectable', () => {
  const game = createInitialState();
  const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction} onOpenDesigner={noAction} />);
  assert.match(textOnly(html), /Repeatable architecture research and paid systems experiments are available in Programs/);
  assert.match(textOnly(html), /Open research programs/);
  assert.doesNotMatch(html, /research-tree-architecture-program|Fund architecture level/);
  for (const id of ['M1', 'M6', 'M13']) assert.ok(html.includes(`aria-label="${id}:`));
  assert.match(html, /aria-label="Review /);
  assert.doesNotMatch(textOnly(html), /Research M\d/);
});

test('undo and pinned comparisons hold independent complete specs, including pre-customization drafts', () => {
  const initial = getModelDesignForBase(CONTENT.seedModel), original = canonicalStateHash(initial);
  const candidate = { spec: initial, baseModelId: CONTENT.seedModel.id, packetIds: ['selected-data'] };
  const saved = copyModelDesignCandidate(candidate);
  let history = rememberModelDesign([], initial);
  const edited = applyModelDesignPurpose(initial, MODEL_DESIGN_PURPOSES.find(item => item.id === 'analyst')!, CONTENT.seedModel);
  history = rememberModelDesign(history, edited);
  edited.dataMix.reasoning = 99;
  edited.customization!.behavior = 'expressive';
  candidate.packetIds.push('later-data');
  assert.equal(canonicalStateHash(history[0]), original);
  assert.equal(history[0].customization, undefined, 'Undoing a first preset restores the historical uncustomized protocol.');
  assert.notEqual(history[1].dataMix.reasoning, 99);
  assert.notEqual(history[1].customization!.behavior, 'expressive');
  assert.deepEqual(saved.packetIds, ['selected-data']);
  assert.equal(canonicalStateHash(saved.spec), original);
  for (let n = 0; n < 20; n++) history = rememberModelDesign(history, { ...initial, name: 'Candidate ' + n });
  assert.equal(history.length, 10, 'Undo retains a bounded local history.');
});

test('candidate comparisons use ordinary training outcomes and preserve each candidate’s original data', () => {
  const { state: game, packetId } = getCustomizationReadyFixture();
  const before = canonicalStateHash(game);
  const spec = { ...getModelDesignForBase(CONTENT.seedModel), mode: 'foundation' as const, parameterMillions: 5000, computeBudgetCUw: 80 * U };
  const saved = copyModelDesignCandidate({ spec, baseModelId: CONTENT.seedModel.id, packetIds: [packetId] });
  const current = { ...saved, spec: { ...spec, computeBudgetCUw: 400 * U } };
  const actual = getTrainingPreview(game, game.playerCompanyId, { baseModelId: saved.baseModelId, packetId, packetIds: [packetId], recipeId: 'custom-model-foundation', modelDesign: current.spec });
  const forecast = getDesignCandidateForecast(game, current);
  assert.deepEqual(forecast.preview, actual, 'The comparison uses admission’s calculator, not a score proxy.');
  assert.ok(forecast.preview);
  const previous = getDesignCandidateForecast(game, saved);
  assert.ok(previous.preview);
  assert.ok(forecastSkill(actual, 'conversation') > forecastSkill(previous.preview, 'conversation'), 'The two paid work budgets have a real quality difference.');
  const html = renderToStaticMarkup(<ModelDesignComparison game={game} saved={saved} current={current} canAct onRestore={noAction} onClear={noAction} />);
  assert.match(html, /outcomes change/);
  assert.match(html, /80 CUw/);
  assert.match(html, /400 CUw/);
  assert.match(html, /data-change="gain"/);
  const otherData = getDesignCandidateForecast(game, { ...current, packetIds: [] });
  assert.equal(otherData.preview, null);
  assert.ok(getDesignCandidateForecast(game, saved).preview, 'Changing the current data does not rewrite the saved candidate.');
  const changedInputs = renderToStaticMarkup(<ModelDesignComparison game={game} saved={saved} current={{ ...current, packetIds: [] }} canAct onRestore={noAction} onClear={noAction} />);
  assert.match(changedInputs, /disabled="">Restore saved settings/);
  assert.match(changedInputs, /Skills need prepared data/);
  assert.equal(canonicalStateHash(game), before);
});

test('cross-family serving multipliers are not misreported as resource savings, and capped compute gets a conditional warning', () => {
  const { state: game, packetId } = getCustomizationReadyFixture();
  const spec = { ...getModelDesignForBase(CONTENT.seedModel), mode: 'foundation' as const, computeBudgetCUw: 25000 * U };
  const saved = { spec, baseModelId: CONTENT.seedModel.id, packetIds: [packetId] };
  const current = { ...saved, spec: { ...spec, family: 'medium' as const, parameterMillions: 8000 } };
  const html = renderToStaticMarkup(<ModelDesignComparison game={game} saved={saved} current={current} canAct onRestore={noAction} onClear={noAction} />);
  assert.match(html, /Different family references/);
  assert.match(html, /Relative to each family/);
  const warning = getComputeBenefitHint(game, saved);
  assert.ok(warning);
  assert.match(warning, /same data and architecture, 50,000 CUw adds no predicted gain/);
  assert.equal(getComputeBenefitHint(game, { ...saved, packetIds: [] }), null, 'No unsupported benefit claim is made before data is chosen.');
});
