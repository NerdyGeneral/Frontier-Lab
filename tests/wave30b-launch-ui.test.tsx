import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash, createInitialState, getGameView } from '../src/core/index';
import { createProductsModule } from '../src/modules/products';
import { DeveloperApiPanel, ProductPanel } from '../src/ui/product-panels';
import { StudioLaunchSelectionProvider, StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';
import type { StudioModelSelection } from '../src/ui/studio-interaction-context';

const noAction = () => assert.fail('Rendering must not invoke a player action');

function candidates(): GameState {
  const game = createInitialState(), companyId = game.playerCompanyId;
  for (const [id, name] of [['candidate-older', 'Older candidate'], ['candidate-newer', 'Newer candidate']]) {
    const trainingRunId = 'training-' + id;
    const model = { ...structuredClone(game.slices.models.versions[CONTENT.seedModel.id]), id, name, companyId,
      trainingRunId, parentModelId: CONTENT.seedModel.id, status: 'evaluated' as const,
      capabilityBps: { conversation: 5000, documents: 5000, coding: 6000, tools: 3000 }, reliabilityBps: 9000 };
    game.slices.models.versions[id] = model;
    game.slices.models.trainingRuns[trainingRunId] = { id: trainingRunId, companyId, baseModelId: CONTENT.seedModel.id,
      packetId: CONTENT.starterData.id, outputModelId: id, recipeId: CONTENT.firstTraining.id, startedWeek: game.week,
      requiredWork: CONTENT.firstTraining.workCUw, completedWork: CONTENT.firstTraining.workCUw,
      physicalWork: CONTENT.firstTraining.workCUw, requiredMemory: CONTENT.firstSale.trainingMemory, status: 'complete',
      checkpointWork: CONTENT.firstTraining.workCUw, checkpointModelId: null,
      anchorScores: { ...CONTENT.seedModel.capabilityBps }, anchorReliabilityBps: CONTENT.seedModel.reliabilityBps,
      evidence: structuredClone(CONTENT.starterData), lastProgress: CONTENT.firstTraining.workCUw, lastBottleneck: '' };
    const reportId = 'report-' + id;
    game.slices.models.reports[reportId] = { id: reportId, companyId, modelId: id, week: game.week,
      suiteId: 'basic-conversation-1', heldOut: true, capabilityBps: { ...model.capabilityBps },
      reliabilityBps: model.reliabilityBps, cases: [], passedCases: 0, basicChatEligible: true };
  }
  return game;
}

function render(game: GameState, selection: StudioModelSelection | null, isApi = false) {
  const Panel = isApi ? DeveloperApiPanel : ProductPanel;
  return renderToStaticMarkup(<StudioLaunchSelectionProvider value={selection}>
    <StudioTaskActionsProvider value={{ prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction }}>
      <Panel game={game} view={getGameView(game)} canAct onQueue={noAction} />
    </StudioTaskActionsProvider>
  </StudioLaunchSelectionProvider>);
}

function selectedValue(html: string, id = 'basic-chat-deploy-model') {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
    .find(match => match[1].includes('id="' + id + '"'));
  assert.ok(select, 'Expected model selection: ' + id);
  return [...select[2].matchAll(/<option\b([^>]*)>/g)].find(match => match[1].includes('selected=""'))?.[1].match(/value="([^"]*)"/)?.[1];
}

function launchButton(html: string, label = 'Deploy Basic Chat') {
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find(match => match[2].replace(/<[^>]*>/g, '').trim() === label);
  assert.ok(button, 'Expected launch action');
  return button[1];
}

test('W30B-L01: first launch carries the older candidate and its exact report while leaving game state intact', () => {
  const game = candidates(), before = canonicalStateHash(game);
  const html = render(game, { intentId: 1, modelId: 'candidate-older', reportId: 'report-candidate-older' });
  assert.equal(selectedValue(html), 'candidate-older');
  assert.doesNotMatch(launchButton(html), /disabled/);
  assert.match(html, /Basic Chat capability requirements met/);
  assert.match(html, /Price \/ account \/ week/);
  assert.match(html, /Included exchanges/);
  assert.match(html, /Deployment effort/);
  assert.match(html, /Model memory/);
  assert.match(html, /Review people and compute/);
  assert.match(html, /You earn your first sale when a customer moves from a trial to paid service/);
  assert.equal((html.match(/id="basic-chat-price"/g) ?? []).length, 1);
  assert.equal(canonicalStateHash(game), before);
});

test('W30B-L02: missing and foreign explicit candidates require selection instead of falling back to the newer candidate', () => {
  for (const modelId of ['missing-candidate', 'rival-candidate']) {
    const game = candidates();
    game.slices.models.versions['rival-candidate'] = { ...game.slices.models.versions['candidate-newer'], id: 'rival-candidate', companyId: 'another-company' };
    const html = render(game, { intentId: 2, modelId });
    assert.equal(selectedValue(html), '');
    assert.match(launchButton(html), /disabled/);
    assert.match(html, /Choose another model for launch/);
  }
});

test('W30B-L03: unavailable and mismatched reports cannot be replaced by another candidate’s qualifying evidence', () => {
  for (const reportId of ['missing-report', 'report-candidate-newer']) {
    const game = candidates();
    const html = render(game, { intentId: 3, modelId: 'candidate-older', reportId });
    assert.equal(selectedValue(html), '');
    assert.match(launchButton(html), /disabled/);
    assert.match(html, /This capability report is missing or belongs to another model/);
  }
});

test('W30B-L04: a non-capability report never enables a launch even when that model has a separate qualifying report', () => {
  const game = candidates();
  game.slices.models.reports.diagnostic = { ...game.slices.models.reports['report-candidate-older'], id: 'diagnostic', suiteId: 'independent-holdouts-1', basicChatEligible: true };
  const html = render(game, { intentId: 4, modelId: 'candidate-older', reportId: 'diagnostic' });
  assert.equal(selectedValue(html), '');
  assert.match(launchButton(html), /disabled/);
  assert.doesNotMatch(html, /Basic Chat capability requirements met/);
});

test('W30B-L05: an explicit nonqualifying capability report stays nonqualifying', () => {
  const game = candidates();
  game.slices.models.reports.nonqualifying = { ...game.slices.models.reports['report-candidate-older'], id: 'nonqualifying', basicChatEligible: false };
  const html = render(game, { intentId: 5, modelId: 'candidate-older', reportId: 'nonqualifying' });
  assert.equal(selectedValue(html), '');
  assert.match(launchButton(html), /disabled/);
  assert.match(html, /This report does not meet the Basic Chat launch requirements/);
});

test('W30B-L06: an unavailable launch intent is visible even before the company has an evaluated candidate', () => {
  const game = createInitialState();
  const html = render(game, { intentId: 6, modelId: null, unavailableReason: 'This exact result is no longer available.' });
  assert.match(html, /This exact result is no longer available/);
  assert.match(launchButton(html), /disabled/);
  assert.equal(selectedValue(html), '');
});

test('W30B-L07: Basic Chat launch intentions do not override the separate Developer API form', () => {
  const game = candidates();
  const html = render(game, { intentId: 7, modelId: 'candidate-older', reportId: 'missing-report' }, true);
  assert.equal(selectedValue(html, 'developer-api-deploy-model'), 'candidate-newer');
  assert.doesNotMatch(launchButton(html, 'Deploy Developer API'), /disabled/);
  assert.doesNotMatch(html, /Choose a model to launch|This capability report is missing/);
});

test('W30B-L08: an existing Basic Chat stays in its product workspace without a second first-launch form', () => {
  const game = candidates();
  const result = createProductsModule(CONTENT).applyCommand!(game, { id: 'existing-chat', companyId: game.playerCompanyId, issuedForWeek: game.week + 1,
    payload: { kind: 'deploy_product', productKind: 'basic-chat', modelId: 'candidate-newer', priceCents: 1200, allowance: 100 } }, CONTENT);
  Object.assign(game.slices, result.updates);
  const before = canonicalStateHash(game);
  const html = render(game, { intentId: 8, modelId: 'candidate-older', reportId: 'report-candidate-older' });
  assert.doesNotMatch(html, /id="basic-chat-deploy-model"/);
  assert.doesNotMatch(html, />Deploy Basic Chat<|Launch model/);
  assert.match(html, /Update price and allowance/);
  assert.match(html, /Newer candidate/);
  assert.equal(canonicalStateHash(game), before);
});
