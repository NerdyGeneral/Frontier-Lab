import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { DevelopmentPlanLimitEditor, DevelopmentPlanList, DevelopmentPlansPanel, developmentPlanCounts } from '../src/ui/development-plans-panel';
import { ModelChallengesPanel } from '../src/ui/model-challenges-panel';
import { StudioDevelopmentSelectionProvider, StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';
import type { DevelopmentProjectDraft } from '../src/persistence/model-workspace';
import { createPlayerOnlyState } from './fixtures/player-only';
import { withPassiveWorkforce } from '../src/modules/workforce';
import { DevelopmentProjectResult } from '../src/ui/development-project-result';
import { ModelWorkspaceProvider } from '../src/ui/model-workspace-context';
import { ActionControl, isQueued } from '../src/ui/components';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { CAREER_RANKS } from '../src/modules/staff-careers';
import type { DevelopmentPlan } from '../src/contracts/development-plans';

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

function parallelPlanScenario() {
  let game = withPassiveWorkforce(createPlayerOnlyState());
  for (let index = 0; index < 6; index++) { const next = advanceWeek(game); assert.ok(next.accepted); game = next.state; }
  const preparation = submitCommand(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'parallel-ui-data');
  assert.ok(preparation.accepted, preparation.reason?.message); game = preparation.state;
  for (let index = 0; index < 2; index++) { const next = advanceWeek(game); assert.ok(next.accepted); game = next.state; }
  assert.equal(game.slices.data.packets[CONTENT.starterData.id].prepared, true);
  const owner = game.playerCompanyId;
  // A validated senior-lead fixture isolates portfolio controls; both plans
  // below are still admitted and advanced through the ordinary paid engine.
  game.slices.company.staff['senior-reviewer'] = { id: 'senior-reviewer', companyId: owner, role: 'research', hiredWeek: 0, readyWeek: 2, assignedFte: U,
    career: { experience: CAREER_RANKS[1].threshold, lastEarned: U / 100, earnedWeek: game.week } };
  game.slices.company.companies[owner].activeStaff++;
  assert.deepEqual(validateState(game), []);
  const start = (name: string, work: number, leadStaffId?: string) => ({ kind: 'start_development_plan' as const, name,
    training: { kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id,
      recipeId: 'custom-model-adaptation', modelDesign: { ...structuredClone(DEFAULT_MODEL_DESIGN), name, computeBudgetCUw: work } },
    suiteId: 'basic-conversation-1' as const, feeBudgetCents: 500_000, cashReserveCents: 0, deadlineWeek: game.week + 40,
    capacityShareBps: 5000, ...(leadStaffId ? { leadStaffId } : {}) });
  return { game, first: start('Founder model line', 160 * U), second: start('Senior model line', 120 * U, 'senior-reviewer') };
}

test('distinct responsible leads keep a second admissible project actionable while the Founder duplicate stays scheduled', () => {
  const { game, first, second } = parallelPlanScenario();
  const queued = submitCommand(game, first, CONTENT, 'parallel-ui-first'); assert.ok(queued.accepted, queued.reason?.message);
  const next = queued.state, before = canonicalStateHash(next);
  assert.ok(previewCommand(next, second).accepted);
  assert.ok(submitCommand(next, second, CONTENT, 'parallel-ui-second').accepted);
  const project: DevelopmentProjectDraft = { name: second.name, suiteId: second.suiteId, budget: '5000', reserve: '0', duration: '40', leadStaffId: 'senior-reviewer', capacityShareBps: 5000 };
  const html = renderToStaticMarkup(<StudioDevelopmentSelectionProvider value={{ intentId: 2, project,
    blueprint: { id: 'second-project', name: second.name, training: second.training, suiteId: second.suiteId } }}>
    <DevelopmentPlansPanel game={next} canAct onQueue={noAction} />
  </StudioDevelopmentSelectionProvider>);
  const start = buttons(html).find(button => button.text === 'Schedule development plan'); assert.ok(start);
  assert.doesNotMatch(start.attributes, /disabled/);
  assert.match(start.attributes, /data-studio-action-flow="direct"/);
  assert.equal(isQueued(next, second), false);
  for (const duplicate of [first, { ...first, leadStaffId: 'founder' }]) {
    assert.equal(isQueued(next, duplicate), true, 'Implicit and explicit Founder refer to the same scheduled lead.');
    const duplicateHtml = renderToStaticMarkup(<ActionControl game={next} payload={duplicate} label="Schedule development plan" canAct onQueue={noAction} />);
    assert.match(duplicateHtml, /disabled=""[^>]*>Scheduled for Week 9/);
  }
  assert.equal(canonicalStateHash(next), before, 'Rendering the next plan must not change its quote or submit it.');
});

for (const action of ['pause', 'resume', 'revise', 'cancel'] as const) test(`queued ${action} applies only to its exact development plan in the rendered controls`, () => {
  const scenario = parallelPlanScenario(); let game = scenario.game;
  for (const [payload, id] of [[scenario.first, 'parallel-ui-first'], [scenario.second, 'parallel-ui-second']] as const) {
    const queued = submitCommand(game, payload, CONTENT, id); assert.ok(queued.accepted, queued.reason?.message); game = queued.state;
  }
  const advance = () => { const next = advanceWeek(game); assert.ok(next.accepted, next.reason?.message); game = next.state; };
  advance();
  if (action === 'resume') {
    for (const planId of ['development-parallel-ui-first', 'development-parallel-ui-second']) {
      const paused = submitCommand(game, { kind: 'set_development_plan_paused', planId, paused: true }, CONTENT, 'pause-' + planId);
      assert.ok(paused.accepted, paused.reason?.message); game = paused.state;
    }
    advance();
  }
  const plans = ['development-parallel-ui-first', 'development-parallel-ui-second'].map(id => game.slices.models.developmentPlans![id]);
  assert.ok(plans.every(plan => plan.status === (action === 'resume' ? 'paused' : 'running')));
  const payload = (plan: DevelopmentPlan): CommandPayload => action === 'cancel' ? { kind: 'cancel_development_plan', planId: plan.id }
    : action === 'revise' ? { kind: 'revise_development_plan', planId: plan.id, feeBudgetCents: plan.feeBudgetCents, cashReserveCents: plan.cashReserveCents,
      deadlineWeek: plan.deadlineWeek, resume: false, leadStaffId: plan.leadStaffId ?? 'founder', capacityShareBps: plan.capacityShareBps ?? 10000 }
    : { kind: 'set_development_plan_paused', planId: plan.id, paused: action === 'pause' };
  const first = payload(plans[0]), second = payload(plans[1]);
  const queued = submitCommand(game, first, CONTENT, action + '-first'); assert.ok(queued.accepted, queued.reason?.message); game = queued.state;
  const before = canonicalStateHash(game);
  assert.ok(previewCommand(game, second).accepted);
  assert.ok(submitCommand(game, second, CONTENT, action + '-second').accepted);
  const html = action === 'revise' ? renderToStaticMarkup(<DevelopmentPlanLimitEditor game={game} plan={plans[1]} canAct onQueue={noAction} />)
    : renderToStaticMarkup(<DevelopmentPlanList game={game} canAct onQueue={noAction} filter="active" />);
  const label = { pause: 'Pause plan', resume: 'Resume plan', revise: 'Save limits', cancel: 'Stop plan · keep outputs' }[action];
  const available = buttons(html).filter(button => button.text === label);
  assert.equal(available.length, 1, 'Only the unscheduled plan keeps its action label.');
  assert.doesNotMatch(available[0].attributes, /disabled/);
  assert.match(available[0].attributes, /data-studio-action-flow="direct"/);
  assert.equal(isQueued(game, second), false);
  const duplicate = renderToStaticMarkup(<ActionControl game={game} payload={first} label={label} canAct onQueue={noAction} />);
  assert.match(duplicate, new RegExp('disabled=""[^>]*>Scheduled for Week ' + (game.week + 1)));
  assert.equal(canonicalStateHash(game), before);
});

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
