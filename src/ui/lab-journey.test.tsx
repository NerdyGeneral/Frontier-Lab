import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { canonicalStateHash, createInitialState, deserializeState, getGameView } from '../core/index';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { eligibleModel } from '../modules/product-models';
import { DataPanel, LabPanel, ModelsPanel } from './lab-panels';
import { DevelopmentNavigationProvider, StudioDataSelectionProvider, StudioModelSelectionProvider, StudioTaskActionsProvider, StudioTrainingSelectionProvider } from './studio-interaction-context';

// These are rendered-contract checks. Mounted acceptance covers one-shot hook
// consumption, Guided/Advanced edits, focus, and navigation back to a live draft.
const noAction = () => assert.fail('Rendering must not invoke a player action');
const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction };
const props = (game: GameState) => ({ game, view: getGameView(game), canAct: true, onQueue: noAction });

function advancedCompany(): GameState {
  const loaded = deserializeState(readFileSync(new URL('../../tests/fixtures/wave27-canary-published.json', import.meta.url), 'utf8'));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.state;
}

function selectedValue(html: string, id: string): string | undefined {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match => match[1].includes('id="' + id + '"'));
  assert.ok(select, 'Missing select: ' + id);
  return [...select[2].matchAll(/<option\b([^>]*)>/g)].find(match => match[1].includes('selected=""'))?.[1].match(/\bvalue="([^"]*)"/)?.[1];
}

function twoDatasets() {
  const game = createInitialState();
  const exactId = 'selected-second-dataset';
  game.slices.data.packets[exactId] = { ...structuredClone(CONTENT.starterData), id: exactId, name: 'Second exact dataset', companyId: game.playerCompanyId };
  return { game, exactId };
}

function reportHtml(game: GameState, modelId: string, reportId: string) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <StudioModelSelectionProvider value={{ intentId: 30, modelId, reportId }}>
      <ModelsPanel {...props(game)} />
    </StudioModelSelectionProvider>
  </StudioTaskActionsProvider>);
}

function qualifyingReport(game: GameState) {
  const report = Object.values(game.slices.models.reports).find(item => item.companyId === game.playerCompanyId
    && isCapabilitySuite(item.suiteId) && item.basicChatEligible && eligibleModel(game, item.modelId, game.playerCompanyId, 'basic-chat'));
  assert.ok(report, 'The advanced fixture contains a commercially eligible capability report');
  return report;
}

test('W30B-L01: exact data intent selects the requested packet on the first render without changing the company', () => {
  const { game, exactId } = twoDatasets(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <StudioDataSelectionProvider value={{ intentId: 1, packetId: exactId }}><DataPanel {...props(game)} /></StudioDataSelectionProvider>
  </StudioTaskActionsProvider>);
  assert.equal(selectedValue(html, 'inspect-data'), exactId);
  assert.match(html, /data-selected-packet="selected-second-dataset"/);
  assert.match(html, /Second exact dataset<\/h4>/);
  assert.match(html, /Needs preparation/);
  assert.match(html, /data-studio-primary-for="prepare-data">Prepare data<span[^>]*> · \$1,000<\/span><\/button>/);
  assert.equal(canonicalStateHash(game), before);
});

test('W30B-L02: missing, foreign, and unavailable data intents expose recovery without preparing another packet', () => {
  const { game } = twoDatasets();
  game.slices.data.packets['foreign-data'] = { ...structuredClone(CONTENT.starterData), id: 'foreign-data', name: 'Foreign dataset', companyId: 'another-company' };
  for (const packetId of ['missing-data', 'foreign-data', null]) {
    const html = renderToStaticMarkup(<StudioDataSelectionProvider value={{ intentId: 2, packetId,
      unavailableReason: packetId === null ? 'The requested preparation target is unavailable.' : undefined }}><DataPanel {...props(game)} /></StudioDataSelectionProvider>);
    assert.equal(selectedValue(html, 'inspect-data'), '');
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /data-studio-primary-for="prepare-data"|Training-ready data|Foreign dataset/);
    if (packetId === null) assert.match(html, /The requested preparation target is unavailable\./);
  }
});

test('W30B-L03: guided training uses the exact dataset and keeps one copy of every draft control', () => {
  const { game, exactId } = twoDatasets(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <StudioTrainingSelectionProvider value={{ intentId: 3, packetId: exactId }}><LabPanel {...props(game)} /></StudioTrainingSelectionProvider>
  </StudioTaskActionsProvider>);
  assert.equal(selectedValue(html, 'training-data'), exactId);
  assert.match(html, /data-training-packet="selected-second-dataset"/);
  assert.match(html, /Second exact dataset needs preparation first/);
  assert.match(html, />Prepare this dataset<\/button>/);
  assert.match(html, /aria-pressed="true">Guided<\/button>/);
  assert.match(html, /aria-label="Training purpose"/);
  assert.match(html, /Compare training experiments/);
  assert.doesNotMatch(html, /studio-training-experiments" hidden=""/);
  for (const id of ['training-recipe', 'training-base', 'training-data', 'training-profile']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, 'Retain one control: ' + id);
  }
  assert.equal(canonicalStateHash(game), before);
});

test('W30B-L04: training never replaces a missing or foreign explicit dataset with starter data', () => {
  const { game } = twoDatasets();
  game.slices.data.packets['foreign-data'] = { ...structuredClone(CONTENT.starterData), id: 'foreign-data', name: 'Foreign dataset', companyId: 'another-company' };
  for (const packetId of ['missing-data', 'foreign-data', null]) {
    const html = renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
      <StudioTrainingSelectionProvider value={{ intentId: 4, packetId }}><LabPanel {...props(game)} /></StudioTrainingSelectionProvider>
    </StudioTaskActionsProvider>);
    assert.equal(selectedValue(html, 'training-data'), '');
    assert.match(html, /This dataset is unavailable. Choose another to continue/);
    assert.doesNotMatch(html, /data-training-packet=|>Prepare this dataset<\/button>|Foreign dataset/);
    const start = html.match(/<button\b[^>]*>Start training<\/button>/)?.[0];
    assert.ok(start && start.includes('disabled=""'), 'A missing dataset cannot produce a training commitment');
  }
});

test('W30B-L05: Classic training keeps its full recipe list and original controls', () => {
  const game = createInitialState(), html = renderToStaticMarkup(<LabPanel {...props(game)} />);
  assert.match(html, /value="medium-foundation"/);
  assert.match(html, /value="behavior-reliability"/);
  assert.match(html, /Model design and training method/);
  assert.doesNotMatch(html, /aria-label="Training view"|aria-label="Training purpose"|studio-training-experiments" hidden/);
  assert.equal(selectedValue(html, 'training-data'), CONTENT.starterData.id);
});

test('W30B-L06: qualifying report handoff names the exact older candidate and report', () => {
  const game = advancedCompany(), report = qualifyingReport(game);
  for (const offer of Object.values(game.slices.products.offers)) {
    if (offer.companyId === game.playerCompanyId && offer.kind === 'basic-chat') delete game.slices.products.offers[offer.id];
  }
  const before = canonicalStateHash(game), html = reportHtml(game, report.modelId, report.id);
  const owned = Object.values(game.slices.models.versions).filter(model => model.companyId === game.playerCompanyId);
  assert.notEqual(report.modelId, owned[owned.length - 1].id, 'This report belongs to an older candidate');
  assert.equal(selectedValue(html, 'inspect-model'), report.modelId);
  assert.ok(html.includes('data-launch-model="' + report.modelId + '"'));
  assert.ok(html.includes('data-launch-report="' + report.id + '"'));
  assert.match(html, />Review Basic Chat launch<\/button>/);
  assert.equal(canonicalStateHash(game), before);
});

test('W30B-L07: a nonqualifying exact report cannot borrow eligibility from another report on the same model', () => {
  const game = advancedCompany(), passing = qualifyingReport(game);
  const failing = { ...structuredClone(passing), id: 'exact-failing-report', basicChatEligible: false };
  game.slices.models.reports[failing.id] = failing;
  assert.equal(eligibleModel(game, passing.modelId, game.playerCompanyId, 'basic-chat'), true, 'Another report still qualifies this candidate');
  const html = reportHtml(game, failing.modelId, failing.id);
  assert.match(html, /Requirements not met/);
  assert.doesNotMatch(html, /data-launch-report=|>Review Basic Chat launch<\/button>|>Open Basic Chat<\/button>/);
});

test('W30B-L08: diagnostic evidence never becomes a capability handoff even if a passing flag or another report exists', () => {
  const game = advancedCompany(), passing = qualifyingReport(game);
  const diagnostic = { ...structuredClone(passing), id: 'exact-diagnostic-report', suiteId: 'behavior-cases-1' as const, basicChatEligible: true };
  game.slices.models.reports[diagnostic.id] = diagnostic;
  const html = reportHtml(game, diagnostic.modelId, diagnostic.id);
  assert.equal(selectedValue(html, 'evaluation-suite'), diagnostic.suiteId);
  assert.match(html, /Capability report required/);
  assert.match(html, /This behavior cases report does not qualify a Basic Chat release/);
  assert.match(html, />Review Basic conversation<\/button>/);
  assert.doesNotMatch(html, /data-launch-report=/);
});

test('W30B-L09: policy admission remains a real gate after qualifying capability evidence', () => {
  const game = advancedCompany();
  const policyModel = Object.values(game.slices.models.versions).find(model => model.companyId === game.playerCompanyId && model.policy && model.status === 'evaluated');
  assert.ok(policyModel, 'The fixture has a policy-trained candidate');
  const passing = qualifyingReport(game);
  const capability = { ...structuredClone(passing), id: 'policy-capability-report', modelId: policyModel.id, basicChatEligible: true };
  game.slices.models.reports[capability.id] = capability;
  for (const report of Object.values(game.slices.models.reports)) {
    if (report.modelId === policyModel.id && report.policy) delete game.slices.models.reports[report.id];
  }
  assert.equal(eligibleModel(game, policyModel.id, game.playerCompanyId, 'basic-chat'), false);
  const html = reportHtml(game, policyModel.id, capability.id);
  assert.match(html, /needs its exact paid policy boundary report before commercial use/);
  assert.doesNotMatch(html, /data-launch-report=/);
});

test('W30B-L10: an existing Basic Chat product is opened rather than presented as another first launch', () => {
  const game = advancedCompany(), report = qualifyingReport(game);
  const html = reportHtml(game, report.modelId, report.id);
  assert.match(html, />Open Basic Chat<\/button>/);
  assert.match(html, /Open Basic Chat to check the model it currently uses/);
  assert.doesNotMatch(html, />Review Basic Chat launch<\/button>/);
});


test('Models opens the latest finished version from a saved company, and exposes continued training', () => {
  const game = advancedCompany();
  const ownedOutputs = Object.values(game.slices.models.trainingRuns)
    .filter(run => run.companyId === game.playerCompanyId && run.status === 'complete')
    .map(run => game.slices.models.versions[run.outputModelId]);
  const latestWeek = Math.max(...ownedOutputs.map(model => model.createdWeek ?? 0));
  assert.ok(latestWeek > 0);
  const html = renderToStaticMarkup(<DevelopmentNavigationProvider value={{ continueTraining: noAction, openDataLibrary: noAction }}>
    <ModelsPanel {...props(game)} />
  </DevelopmentNavigationProvider>);
  const selectedId = selectedValue(html, 'inspect-model');
  assert.ok(ownedOutputs.some(model => model.id === selectedId && model.createdWeek === latestWeek));
  assert.match(html, />Version history</);
  assert.match(html, />Continue training this model</);
});

test('training setup separates the starting scores from a usable forecast and identifies the next step', () => {
  const game = createInitialState();
  const render = () => renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><LabPanel {...props(game)} /></StudioTaskActionsProvider>);
  const fresh = render();
  const titles = ['Choose a starting version', 'Choose a training goal', 'Choose training data', 'Preview this run'];
  assert.deepEqual(titles.map(title => fresh.indexOf(title)).sort((a, b) => a - b), titles.map(title => fresh.indexOf(title)));
  for (const name of titles) assert.ok(fresh.includes(name));
  assert.match(fresh, /Starting scores/);
  assert.doesNotMatch(fresh, /Expected skill changes/);
  assert.match(fresh, /Prepare this dataset/);
  const data = game.slices.data.packets[CONTENT.starterData.id];
  data.prepared = true;
  data.readyUnits = data.rawUnits;
  assert.match(render(), /Expected skill changes/);
});

test('the training plan starts with a completed version, honors an explicit parent, and leaves an unavailable parent empty', () => {
  const game = advancedCompany();
  const render = (baseModelId?: string) => renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <StudioTrainingSelectionProvider value={baseModelId === undefined ? null : { intentId: 1, baseModelId }}>
      <LabPanel {...props(game)} />
    </StudioTrainingSelectionProvider>
  </StudioTaskActionsProvider>);
  const newest = selectedValue(render(), 'training-base');
  assert.ok(newest && newest !== CONTENT.seedModel.id);
  const run = game.slices.models.trainingRuns[game.slices.models.versions[newest].trainingRunId!];
  assert.equal(run.outputModelId, newest);
  assert.equal(selectedValue(render(CONTENT.seedModel.id), 'training-base'), CONTENT.seedModel.id);
  const missing = render('missing-parent');
  assert.equal(selectedValue(missing, 'training-base'), '');
  assert.match(missing, /This model is unavailable for further training/);
  assert.match(missing, /<button\b[^>]*disabled=""[^>]*>Start training<\/button>/);
});
