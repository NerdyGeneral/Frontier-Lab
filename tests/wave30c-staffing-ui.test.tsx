import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, StaffRole } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, getGameView, previewCommand, serializeState, submitCommand } from '../src/core/index';
import { getWorkforce, getPayrollCents } from '../src/modules/workforce';
import { PeoplePanel } from '../src/ui/panels';
import { StudioPlanner } from '../src/ui/studio-planner';
import { createStaffingDraft, StudioStaffingForm, type StaffingDraft } from '../src/ui/studio-staffing';
import { StudioCommandReviewProvider, StudioStaffingSelectionProvider, StudioTaskActionsProvider, type StudioStaffingSelection } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';

// SSR checks prove displayed contracts and exact selection. The mounted browser
// gate separately checks mode switches, edits, helper return and focus retention.
const noAction = () => assert.fail('Rendering must never change the company');
const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction };
const props = (game: GameState, canAct = true) => ({ game, view: getGameView(game), canAct, onQueue: noAction });
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

function renderPeople(game: GameState, selection?: StudioStaffingSelection, canAct = true) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><StudioCommandReviewProvider value={noAction}>
    <StudioStaffingSelectionProvider value={selection ?? null}><PeoplePanel {...props(game, canAct)} /></StudioStaffingSelectionProvider>
  </StudioCommandReviewProvider></StudioTaskActionsProvider>);
}

function renderDraft(game: GameState, draft: StaffingDraft, canAct = true) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><StudioCommandReviewProvider value={noAction}>
    <StudioStaffingForm {...props(game, canAct)} draft={draft} onChange={noAction} />
  </StudioCommandReviewProvider></StudioTaskActionsProvider>);
}

function selectedValue(html: string, id: string): string | undefined {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match => match[1].includes('id="' + id + '"'));
  assert.ok(select, 'Missing select: ' + id);
  return [...select[2].matchAll(/<option\b([^>]*)>/g)].find(match => match[1].includes('selected=""'))?.[1].match(/\bvalue="([^"]*)"/)?.[1];
}

function queue(game: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}

function step(game: GameState) {
  const result = advanceWeek(game, CONTENT);
  assert.equal(result.accepted, true, result.reason?.message);
  return result.state;
}

function hire(game: GameState, role: StaffRole, id: string) {
  return step(queue(game, { kind: 'hire_staff', role }, id));
}

test('W30C-S01: focused hire shows the actual quote, payroll start and engine readiness week', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderPeople(game, { intentId: 1, mode: 'hire', role: 'ml' });
  const quote = previewCommand(game, { kind: 'hire_staff', role: 'ml' });
  assert.equal(quote.upfrontCostCents, 150_000); assert.equal(quote.weeklyCostDeltaCents, 30_000);
  assert.match(textOnly(html), /Recruitment cost \$1,500.*Weekly pay \$300 \/ week.*Hiring and payroll begin Week 1.*Ready to work Week 3/);
  assert.match(textOnly(html), /New hires generate their full weekly output automatically after onboarding/);
  assert.match(textOnly(html), /Their points are shared across active projects in each category/);
  assert.equal(serializeState(game), before);
  const actual = hire(game, 'ml', 'staffing-readiness');
  const member = actual.slices.company.staff['staff:staffing-readiness'];
  assert.equal(member.hiredWeek, 1); assert.equal(member.readyWeek, 3); assert.equal(member.assignedFte, U);
  assert.equal(getWorkforce(actual, actual.playerCompanyId).capacity.ml, 0);
  assert.equal(getPayrollCents(actual, actual.playerCompanyId, CONTENT), 30_000);
});

test('W30C-S02: contextual hire retains the selected role and names the actual constraint', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderPeople(game, { intentId: 2, mode: 'hire', role: 'data', reason: 'Starter preparation is waiting for Data effort.' });
  assert.equal(selectedValue(html, 'hire-role'), 'data');
  assert.match(textOnly(html), /Starter preparation is waiting for Data effort/);
  assert.match(textOnly(html), /Recruitment cost \$1,250.*Weekly pay \$250 \/ week/);
  assert.equal(serializeState(game), before);
});

test('W30C-S03: a locked explicit role stays selected and cannot borrow another role’s eligibility', () => {
  const game = createPlayerOnlyState();
  const html = renderPeople(game, { intentId: 3, mode: 'hire', role: 'hardware' });
  assert.equal(selectedValue(html, 'hire-role'), 'hardware');
  assert.match(textOnly(html), /Start Chip feasibility research before recruiting this specialist/);
  assert.match(textOnly(html), /Recruitment cost \$3,000.*Weekly pay \$600 \/ week/);
  const review = html.match(/<button\b[^>]*data-studio-review="hire_staff"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(review?.includes('disabled=""'));
});

test('W30C-S04: assignment selects the exact older employee, not the newest hire', () => {
  const game = hire(hire(createPlayerOnlyState(), 'ml', 'older-person'), 'data', 'newer-person');
  const before = serializeState(game);
  const html = renderPeople(game, { intentId: 4, mode: 'assign', staffId: 'staff:older-person' });
  assert.equal(selectedValue(html, 'staffing-person'), 'staff:older-person');
  assert.match(html, /data-selected-staff-output="staff:older-person"/);
  assert.doesNotMatch(html, /id="staff-staff:older-person"/);
  assert.match(html, /Dismiss this employee/);
  assert.match(html, /data-studio-review="dismiss_staff" data-studio-action-flow="review"/);
  assert.match(textOnly(html), /Review: Dismiss employee/);
  assert.doesNotMatch(html, /data-selected-staff-output="staff:newer-person"/);
  assert.equal(serializeState(game), before);
});

test('W30C-S05: missing, foreign and unavailable staff do not silently become a founder assignment', () => {
  const game = hire(createPlayerOnlyState(), 'ml', 'owned-person');
  game.slices.company.staff['foreign-person'] = { ...game.slices.company.staff['staff:owned-person'], id: 'foreign-person', companyId: 'another-company' };
  for (const staffId of ['missing-person', 'foreign-person', null]) {
    const html = renderPeople(game, { intentId: 5, mode: 'assign', staffId, unavailableReason: staffId === null ? 'Requested employee unavailable.' : undefined });
    assert.equal(selectedValue(html, 'staffing-person'), '');
    assert.match(html, /Choose an available person/);
    assert.doesNotMatch(html, /data-selected-staff-output=|>Review assignment<\/button>|Founder points: current and proposed/);
  }
});

test('W30C-S06: onboarding shows the actual ready week, full future points and salary', () => {
  const game = hire(createPlayerOnlyState(), 'ml', 'onboard-person');
  const draft = createStaffingDraft();
  draft.mode = 'assign'; draft.target = 'staff:onboard-person';
  const html = renderDraft(game, draft);
  assert.match(textOnly(html), /Onboarding · ready Week 3/);
  assert.match(textOnly(html), /0 points now. From Week 3: 10 Research · 30 Design · 5 Data/);
  assert.equal(getPayrollCents(game, game.playerCompanyId, CONTENT), 30_000);
});

test('W30C-S07: opening the founder view makes no assignment and explains the weekly limit', () => {
  const game = createPlayerOnlyState(), before = serializeState(game), draft = createStaffingDraft();
  draft.mode = 'assign';
  const html = renderDraft(game, draft);
  assert.doesNotMatch(html, /id="founder-|Review assignment|Set your schedule/);
  assert.match(textOnly(html), /Up to 20 points per week/);
  assert.match(textOnly(html), /Hardware work needs a specialist/);
  assert.equal(serializeState(game), before);
});

test('W30C-S09: Classic shares the passive staff experience and keeps recruitment accessible', () => {
  const game = hire(createPlayerOnlyState(), 'ml', 'classic-person');
  const html = renderToStaticMarkup(<PeoplePanel {...props(game)} />);
  assert.equal(html.split('id="hire-role"').length - 1, 1);
  assert.match(html, /data-staff-output="staff:classic-person"/);
  assert.match(html, /aria-label="Staffing decision"/);
  assert.doesNotMatch(html, /Quick assignments|set_staff_allocation|Review assignment/);
});

test('W30C-S10: observer staffing controls remain disabled while records remain readable', () => {
  const game = createPlayerOnlyState();
  const html = renderPeople(game, { intentId: 10, mode: 'hire', role: 'research' }, false);
  assert.match(html, /<select id="hire-role" disabled=""/);
  const review = html.match(/<button\b[^>]*data-studio-review="hire_staff"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(review?.includes('disabled=""'));
  assert.match(textOnly(html), /Weekly pay \$450 \/ week/);
});

test('W30C-S11: the contextual planner explains the selected blocker without altering its draft or company', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderToStaticMarkup(<StudioPlanner game={game} canAct paused onApplyPlan={noAction} context={{ title: 'Training Conversation 1', reason: 'Waiting for assigned ML supervision.' }} />);
  assert.match(html, /aria-label="Selected resource constraint"/);
  assert.match(textOnly(html), /Training Conversation 1.*Waiting for assigned ML supervision/);
  assert.match(textOnly(html), /Your earlier choices are kept while you plan. Review the costs before confirming hires or compute changes/);
  assert.doesNotMatch(html, /id="studio-plan-founder-|id="studio-plan-staff-/);
  assert.match(textOnly(html), /Current rented capacity 4 CU/);
  assert.match(textOnly(html), /Training, testing, and installing upgrades/);
  assert.equal(serializeState(game), before);
});

test('W30C-S12: queued recruitment remains a next-week decision, not an already employed person', () => {
  const game = queue(createPlayerOnlyState(), { kind: 'hire_staff', role: 'ml' }, 'pending-person');
  const html = renderPeople(game, { intentId: 12, mode: 'hire', role: 'ml' });
  assert.match(textOnly(html), /Queued for Week 1/);
  assert.equal(Object.keys(game.slices.company.staff).length, 0);
  assert.match(textOnly(html), /Ready employees 0 Onboarding 0/);
  assert.match(textOnly(html), /Team capacity by category/);
});
