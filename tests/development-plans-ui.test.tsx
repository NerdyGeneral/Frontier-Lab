import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { DevelopmentPlansPanel } from '../src/ui/development-plans-panel';
import { ModelChallengesPanel } from '../src/ui/model-challenges-panel';
import { StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';
import { withPassiveWorkforce } from '../src/modules/workforce';

const noAction = () => assert.fail('Rendering must not start work or advance time');
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attributes: match[1], text: match[2].replace(/<[^>]*>/g, '') }));
function planScenario(deadline: number, target: 'running' | 'blocked' | 'review'): GameState {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  const queued = submitCommand(game, { kind: 'start_development_plan', name: 'Measured candidate',
    training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
    suiteId: 'basic-conversation-1', feeBudgetCents: 500_000, cashReserveCents: 0, deadlineWeek: deadline }, CONTENT, 'ui-plan');
  assert.ok(queued.accepted, queued.reason?.message); game = queued.state;
  for (let index = 0; index < 40 && game.slices.models.developmentPlans?.['development-ui-plan']?.status !== target; index++) {
    const advanced = advanceWeek(game); assert.ok(advanced.accepted, advanced.reason?.message); game = advanced.state;
  }
  assert.equal(game.slices.models.developmentPlans?.['development-ui-plan']?.status, target, game.slices.models.developmentPlans?.['development-ui-plan']?.message);
  assert.deepEqual(validateState(game), []); return game;
}

test('development plan builder exposes data, model, method, evaluation and budget choices with a stable workspace target', () => {
  const game = createPlayerOnlyState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<DevelopmentPlansPanel game={game} canAct onQueue={noAction} />);
  assert.match(html, /id="development-plans"/);
  for (const label of ['Project name', 'Starting model', 'Training sources', 'Training method', 'Final evaluation', 'Finish within', 'Project-fee budget', 'Keep cash reserve']) assert.ok(html.includes(label), label);
  assert.match(html, /Needs preparation/); assert.match(html, /Design a custom model/);
  const start = buttons(html).find(button => button.text === 'Schedule development plan'); assert.ok(start);
  assert.doesNotMatch(start.attributes, /disabled/);
  assert.match(html, /data-studio-primary-for="development-plan"/);
  assert.match(html, /Expected setup fees/); assert.match(html, /Current base bills/);
  assert.equal(canonicalStateHash(game), before);
});

test('running plan exposes one Run until a decision control and keeps paid stages visible without starting the clock during render', () => {
  const game = planScenario(32, 'running'), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<DevelopmentPlansPanel game={game} canAct onQueue={noAction} onRun={noAction} paused />);
  assert.match(html, /aria-label="Development stages"/); assert.match(html, /aria-current="step"/);
  const controls = buttons(html);
  assert.equal(controls.filter(button => button.text === 'Run until a decision').length, 1);
  assert.ok(controls.some(button => button.text === 'Pause plan'));
  assert.ok(controls.some(button => button.text === 'Edit limits' && button.attributes.includes('aria-expanded="false"')));
  assert.ok(controls.some(button => button.text === 'Stop plan · keep outputs'));
  assert.doesNotMatch(html, /development-plan-builder/);
  assert.equal(canonicalStateHash(game), before);
});

test('a real deadline-blocked plan surfaces its reason and edit limits, while ordinary resume stays unavailable until extended', () => {
  const game = planScenario(3, 'blocked'), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<DevelopmentPlansPanel game={game} canAct onQueue={noAction} onRun={noAction} paused />);
  assert.match(html, /class="callout warning" role="status"/); assert.match(html, /deadline/i);
  const controls = buttons(html), resume = controls.find(button => button.text === 'Resume plan');
  assert.ok(resume); assert.match(resume.attributes, /disabled=""/);
  assert.match(html, /Extend the deadline before resuming the plan/);
  assert.ok(controls.some(button => button.text === 'Edit limits'));
  assert.ok(controls.some(button => button.text === 'Stop plan · keep outputs' && !button.attributes.includes('disabled')));
  assert.ok(!controls.some(button => button.text === 'Run until a decision'));
  assert.equal(canonicalStateHash(game), before);
});

test('finished plan displays its actual evaluation and explicit release link without a claim dialog or automatic launch', () => {
  const game = planScenario(32, 'review'), plan = game.slices.models.developmentPlans!['development-ui-plan'];
  const report = game.slices.models.reports[plan.reportId!], before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<DevelopmentPlansPanel game={game} canAct onQueue={noAction} onRun={noAction} paused />);
  assert.match(html, /READY FOR YOUR DECISION/);
  assert.ok(html.indexOf('READY FOR YOUR DECISION') < html.indexOf('development-plan-builder'), 'The latest completed result must precede the next-plan form.');
  assert.match(html, /Plan another model/);
  assert.ok(html.includes(`${report.passedCases} / ${report.cases.length} held-out cases passed`));
  assert.match(html, /href="#models">Review model and report/);
  assert.match(html, /href="#product">Choose a release/);
  const studioHtml = renderToStaticMarkup(<StudioTaskActionsProvider value={{ prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction,
    reviewReport: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction }}>
    <DevelopmentPlansPanel game={game} canAct onQueue={noAction} onRun={noAction} paused />
  </StudioTaskActionsProvider>);
  assert.ok(buttons(studioHtml).some(button => button.text === 'Review model and report'));
  assert.ok(buttons(studioHtml).some(button => button.text === 'Choose a release'));
  assert.doesNotMatch(studioHtml, /href="#models">Review model and report|href="#product">Choose a release/);
  assert.ok(!buttons(html).some(button => ['Resume plan', 'Pause plan', 'Run until a decision', 'Claim result'].includes(button.text)));
  assert.deepEqual(game.slices.products.offers, {});
  assert.equal(canonicalStateHash(game), before);
});

test('challenge workbench keeps its stable panel id and exposes locked tiers with prerequisites before any paid evidence', () => {
  const game = createPlayerOnlyState(), html = renderToStaticMarkup(<ModelChallengesPanel game={game} canAct onQueue={noAction} />);
  assert.equal((html.match(/id="model-challenges"/g) ?? []).length, 1);
  assert.match(html, /No titles earned yet/); assert.match(html, /paid capability test/);
  const evaluations = buttons(html).filter(button => button.attributes.includes('data-studio-review="evaluate_model"'));
  assert.equal(evaluations.length, 7); assert.ok(evaluations.every(button => button.attributes.includes('disabled')));
});
