import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { advanceWeek, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { DevelopmentPlanLimitEditor, DevelopmentPlanList, DevelopmentPlansPanel, developmentPlanCounts } from '../src/ui/development-plans-panel';
import { ModelChallengesPanel } from '../src/ui/model-challenges-panel';
import { StudioDevelopmentSelectionProvider, StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';
import type { DevelopmentProjectDraft } from '../src/persistence/model-workspace';
import { createPlayerOnlyState } from './fixtures/player-only';
import { withPassiveWorkforce } from '../src/modules/workforce';
import { DevelopmentProjectResult } from '../src/ui/development-project-result';
import { ModelWorkspaceProvider } from '../src/ui/model-workspace-context';

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

test('returning from manual editing restores explicit project metadata instead of a new name, recommended test or defaults', () => {
  const game = createPlayerOnlyState();
  const project: DevelopmentProjectDraft = { name: 'Customer pilot project', suiteId: 'behavior-cases-1', budget: '7234.50',
    reserve: '8400.', duration: '19', leadStaffId: 'founder', capacityShareBps: 4500, objective: { kind: 'purpose', id: 'coding' } };
  const html = renderToStaticMarkup(<StudioDevelopmentSelectionProvider value={{ intentId: 1, project, blueprint: {
    id: 'current-design', name: 'New model name', suiteId: 'basic-conversation-1',
    training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
  } }}><DevelopmentPlansPanel game={game} canAct onQueue={noAction} /></StudioDevelopmentSelectionProvider>);
  assert.match(html, /Project name<input[^>]*value="Customer pilot project"/);
  assert.match(html, /<option[^>]*value="behavior-cases-1"[^>]*selected=""/);
  assert.match(html, /Project-fee budget \(\$\)<input[^>]*value="7234\.50"/);
  assert.match(html, /Keep cash reserve \(\$\)<input[^>]*value="8400\."/);
  assert.match(html, /Finish within \(weeks\)<input[^>]*value="19"/);
  assert.match(html, /<option[^>]*value="4500"[^>]*selected=""/);
});

test('editing limits shows the exact saved deadline and saves without an implied resume', () => {
  const game = planScenario(3, 'blocked'), plan = game.slices.models.developmentPlans!['development-ui-plan'];
  const html = renderToStaticMarkup(<DevelopmentPlanLimitEditor game={game} plan={plan} canAct onQueue={noAction} />);
  assert.match(html, new RegExp('Deadline week<input[^>]*value="' + plan.deadlineWeek + '"'));
  assert.match(html, /Saving limits keeps this plan stopped/);
  const save = buttons(html).find(button => button.text === 'Save limits'); assert.ok(save);
  assert.doesNotMatch(save.attributes, /disabled/, 'An unchanged expired deadline does not force a hidden extension to save other limits.');
  assert.doesNotMatch(html, /Save limits and resume/);
});

test('plan controls distinguish continuous play from an actual decision run', () => {
  const game = planScenario(32, 'running');
  const continuous = renderToStaticMarkup(<DevelopmentPlanList game={game} canAct onQueue={noAction} onRun={noAction} paused={false} decisionRunActive={false} />);
  assert.match(continuous, /Continuous play is running/); assert.doesNotMatch(continuous, /Running until a decision/);
  const decision = renderToStaticMarkup(<DevelopmentPlanList game={game} canAct onQueue={noAction} onRun={noAction} paused={false} decisionRunActive />);
  assert.match(decision, /Running until a decision/); assert.doesNotMatch(decision, /Continuous play is running/);
});

test('a running development plan with a blocked stage appears in both Active and Blocked without changing its engine status', () => {
  const game = planScenario(32, 'running'), plan = game.slices.models.developmentPlans!['development-ui-plan'];
  const blockedPlanIds = new Set([plan.id]);
  assert.deepEqual(developmentPlanCounts(game, blockedPlanIds), { active: 1, blocked: 1, complete: 0 });
  for (const filter of ['active', 'blocked'] as const) {
    const html = renderToStaticMarkup(<DevelopmentPlanList game={game} canAct onQueue={noAction} filter={filter} blockedPlanIds={blockedPlanIds} />);
    assert.match(html, /Measured candidate/);
  }
  assert.equal(plan.status, 'running');
  const complete = planScenario(32, 'review');
  assert.deepEqual(developmentPlanCounts(complete, blockedPlanIds), { active: 0, blocked: 0, complete: 1 });
  const completed = renderToStaticMarkup(<DevelopmentPlanList game={complete} canAct onQueue={noAction} filter="blocked" blockedPlanIds={blockedPlanIds} />);
  assert.doesNotMatch(completed, /Measured candidate/);
});

test('the project list includes queued and completed plans in their filters without a second builder', () => {
  const initial = createPlayerOnlyState();
  const queued = submitCommand(initial, { kind: 'start_development_plan', name: 'Scheduled candidate',
    training: { kind: 'start_training', baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id },
    suiteId: 'basic-conversation-1', feeBudgetCents: 500_000, cashReserveCents: 0, deadlineWeek: 32 }, CONTENT, 'queued-ui-plan');
  assert.ok(queued.accepted, queued.reason?.message);
  assert.deepEqual(developmentPlanCounts(queued.state), { active: 1, blocked: 0, complete: 0 });
  const scheduled = renderToStaticMarkup(<DevelopmentPlanList game={queued.state} canAct onQueue={noAction} filter="active" />);
  assert.match(scheduled, /Scheduled candidate/); assert.match(scheduled, /DEVELOPMENT PLAN · SCHEDULED/);
  assert.doesNotMatch(scheduled, /development-plan-builder|Schedule development plan/);
  const complete = planScenario(32, 'review');
  assert.deepEqual(developmentPlanCounts(complete), { active: 0, blocked: 0, complete: 1 });
  const completed = renderToStaticMarkup(<DevelopmentPlanList game={complete} canAct onQueue={noAction} filter="complete" renderStages={plan => <details data-plan={plan.id}><summary>Stage jobs</summary></details>} />);
  assert.match(completed, /READY FOR YOUR DECISION/); assert.match(completed, /data-plan="development-ui-plan"/); assert.match(completed, /Stage jobs/);
  assert.doesNotMatch(completed, /development-plan-builder|Schedule development plan/);
  const blocked = planScenario(3, 'blocked');
  assert.deepEqual(developmentPlanCounts(blocked), { active: 1, blocked: 1, complete: 0 });
  for (const filter of ['active', 'blocked'] as const) {
    const html = renderToStaticMarkup(<DevelopmentPlanList game={blocked} canAct onQueue={noAction} filter={filter} />);
    assert.match(html, /Measured candidate/); assert.match(html, /status-blocked/);
  }
});

test('archived projects offer their saved evaluation, fall back to their exact model, and keep ordinary links without task actions', () => {
  const game = planScenario(32, 'review'), plan = game.slices.models.developmentPlans!['development-ui-plan'];
  game.slices.models.developmentPlanArchive = { [plan.id]: { id: plan.id, companyId: plan.companyId, name: plan.name,
    createdWeek: plan.createdWeek, endedWeek: plan.completedWeek!, archivedWeek: game.week, status: 'review',
    feeSpentCents: plan.steps.reduce((sum, step) => sum + step.feeCents, 0), stageCommandIds: plan.steps.map(step => step.commandId),
    modelId: plan.modelId, reportId: plan.reportId, challengeReportId: 'unavailable-challenge-report' } };
  delete game.slices.models.developmentPlans![plan.id];
  const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction,
    reviewReport: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction };
  const render = () => renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><DevelopmentPlanList game={game} canAct onQueue={noAction} filter="complete" /></StudioTaskActionsProvider>);
  const report = render();
  assert.match(report, /Archived project history \(1\)/); assert.match(report, /Review saved evaluation/);
  assert.doesNotMatch(report, /href="#models"|Review saved challenge report/);
  delete game.slices.models.reports[plan.reportId!];
  const model = render(); assert.match(model, /Review saved model/); assert.doesNotMatch(model, /Review saved evaluation|href="#models"/);
  const classic = renderToStaticMarkup(<DevelopmentPlanList game={game} canAct onQueue={noAction} filter="complete" />);
  assert.match(classic, /href="#models">Review models and reports/);
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

test('completed projects retain their own goal and route specialist releases without reading the current draft goal', () => {
  const game = planScenario(32, 'review'), saved = game.slices.models.developmentPlans!['development-ui-plan'];
  const workspace = { manual: null, delegated: null, blueprints: [], ready: true, epoch: 1, notice: '', persistent: false,
    developmentGoal: { kind: 'system-challenge' as const, id: 'systems-retention-1' as const }, setDraft: noAction, saveBlueprint: () => null, setDevelopmentGoal: noAction };
  const html = renderToStaticMarkup(<ModelWorkspaceProvider value={workspace}><DevelopmentProjectResult game={game} plan={{ ...saved, objective: { kind: 'purpose', id: 'coding' } }} canAct onQueue={noAction} /></ModelWorkspaceProvider>);
  assert.match(html, /Plan the developer release/); assert.doesNotMatch(html, /Choose a release|Case retention|Continuity Systems/);
  const legacy = renderToStaticMarkup(<ModelWorkspaceProvider value={workspace}><DevelopmentProjectResult game={game} plan={saved} canAct onQueue={noAction} /></ModelWorkspaceProvider>);
  assert.doesNotMatch(legacy, /Development objective and requirements/, 'An old project without a goal must not inherit a new workbench goal.');
});
