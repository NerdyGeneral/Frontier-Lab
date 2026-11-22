import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { CommandPayload, GameState, StaffRole } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, getGameView, serializeState, submitCommand } from '../src/core/index';
import { getPayrollCents, withPassiveWorkforce } from '../src/modules/workforce';
import { PeoplePanel } from '../src/ui/panels';
import { createStaffingDraft, StudioStaffingForm, type StaffingDraft } from '../src/ui/studio-staffing';
import { StudioCommandReviewProvider, StudioStaffingSelectionProvider, StudioTaskActionsProvider, StudioTaskModeProvider, type StudioStaffingSelection } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';

// These rendering checks assert the numerical contract at engine-produced
// boundaries. Mounted browser checks own editing, focus and retained drafts.
const noAction = () => assert.fail('Rendering point information must not change the company or draft');
const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction,
  reviewResources: noAction, hireStaff: noAction, assignStaff: noAction, openTask: noAction };
const props = (game: GameState, canAct = true) => ({ game, view: getGameView(game), canAct, onQueue: noAction });
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const LABELS: Record<StaffRole, string> = { research: 'Research', ml: 'Design', data: 'Data', infrastructure: 'Operations', commercial: 'Business', hardware: 'Hardware' };
const PROFILES: Record<StaffRole, Partial<Record<StaffRole, number>>> = {
  research: { research: 30, ml: 10, data: 5 }, ml: { ml: 30, research: 10, data: 5 },
  data: { data: 30, ml: 10, research: 5 }, infrastructure: { infrastructure: 30, ml: 10, data: 5 },
  commercial: { commercial: 30, ml: 10, research: 5 }, hardware: { hardware: 30, ml: 10, research: 5 },
};

function renderPeople(game: GameState, selection: StudioStaffingSelection, canAct = true) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><StudioCommandReviewProvider value={noAction}>
    <StudioTaskModeProvider value={selection.mode === 'hire' ? 'hire-staff' : 'assign-staff'}>
      <StudioStaffingSelectionProvider value={selection}><PeoplePanel {...props(game, canAct)} /></StudioStaffingSelectionProvider>
    </StudioTaskModeProvider>
  </StudioCommandReviewProvider></StudioTaskActionsProvider>);
}
function renderDraft(game: GameState, draft: StaffingDraft, canAct = true) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><StudioCommandReviewProvider value={noAction}>
    <StudioTaskModeProvider value={draft.mode === 'hire' ? 'hire-staff' : 'assign-staff'}>
      <StudioStaffingForm {...props(game, canAct)} draft={draft} onChange={noAction} />
    </StudioTaskModeProvider>
  </StudioCommandReviewProvider></StudioTaskActionsProvider>);
}
function elementByData(html: string, attribute: string, value: string): string {
  const marker = attribute + '="' + value + '"';
  const opening = [...html.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/g)].find(match => match[0].includes(marker));
  assert.ok(opening, 'Missing point element: ' + marker);
  const start = opening.index!, tags = new RegExp('<\\/?' + opening[1] + '\\b[^>]*>', 'g');
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  assert.fail('Unclosed point element: ' + marker);
}
function pointValues(card: string): Partial<Record<StaffRole, number>> {
  const result: Partial<Record<StaffRole, number>> = {};
  for (const match of card.matchAll(/<div\b[^>]*data-point-role="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const role = match[1] as StaffRole;
    assert.equal(result[role], undefined, 'A card must show each category only once');
    assert.ok(textOnly(match[2].match(/<dt>([\s\S]*?)<\/dt>/)![1]).startsWith(LABELS[role]));
    result[role] = Number(textOnly(match[2].match(/<dd>([\s\S]*?)<\/dd>/)![1]).replace(' points', ''));
  }
  return result;
}
function select(html: string, id: string) {
  const found = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match => match[1].includes('id="' + id + '"'));
  assert.ok(found, 'Missing select: ' + id);
  const options = [...found[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(match => ({
    value: match[1].match(/\bvalue="([^"]*)"/)![1], label: textOnly(match[2]), selected: match[1].includes('selected=""'),
  }));
  return { attributes: found[1], options, selected: options.find(option => option.selected)?.value };
}
function primary(html: string, task: string) {
  const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(button => button.includes('data-studio-primary-for="' + task + '"'));
  assert.equal(buttons.length, 1, 'Exactly one canonical review button must retain this task binding');
  return buttons[0];
}
function queue(game: GameState, payload: CommandPayload, id: string) {
  const result = submitCommand(game, payload, CONTENT, id);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function step(game: GameState) {
  const result = advanceWeek(game, CONTENT);
  assert.equal(result.accepted, true, result.reason?.message); return result.state;
}
function hired(role: Exclude<StaffRole, 'hardware'> = 'ml', id = 'points-ui-hire') {
  return step(queue(withPassiveWorkforce(createPlayerOnlyState()), { kind: 'hire_staff', role }, id));
}
function ready() { return step(step(hired())); }
function assignmentDraft(game: GameState, staffId = 'staff:points-ui-hire') {
  const draft = createStaffingDraft(); draft.mode = 'assign'; draft.target = staffId; return draft;
}

test('W32-U01: every hire card displays its actual specialty and two secondary weekly outputs', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  for (const role of Object.keys(PROFILES) as StaffRole[]) {
    const html = renderPeople(game, { intentId: 1, mode: 'hire', role });
    const card = elementByData(html, 'data-hire-output', role);
    assert.deepEqual(pointValues(card), PROFILES[role]);
    assert.equal((card.match(/data-specialty="true"/g) ?? []).length, 1);
    assert.match(elementByData(card, 'data-point-role', role), /data-specialty="true"/);
    assert.equal(select(html, 'hire-role').selected, role);
    assert.match(textOnly(card), /0 points during onboarding/);
    assert.ok(primary(html, 'hire-staff').includes('disabled=""') === (role === 'hardware'));
  }
  assert.equal(serializeState(game), before);
});

test('W32-U02: the founder explains automatic support without offering allocation controls', () => {
  const game = createPlayerOnlyState(), before = serializeState(game);
  const html = renderDraft(game, assignmentDraft(game, 'founder'));
  assert.match(textOnly(html), /Up to 20 points per week/);
  assert.match(textOnly(html), /founder automatically helps/);
  assert.doesNotMatch(html, /id="founder-|assign_founder|split founder|Review assignment/);
  assert.equal(serializeState(game), before);
});

test('W32-U03: real paid onboarding displays zero current output until the actual ready week', () => {
  const onboarding = hired(), active = step(step(onboarding));
  for (const [game, expected] of [[onboarding, { ml: 0, research: 0, data: 0 }], [active, PROFILES.ml]] as const) {
    const before = serializeState(game), html = renderPeople(game, { intentId: 3, mode: 'assign', staffId: 'staff:points-ui-hire' });
    const card = elementByData(html, 'data-staff-output', 'staff:points-ui-hire');
    assert.deepEqual(pointValues(card), expected);
    assert.equal((html.match(/data-staff-output="staff:points-ui-hire"/g) ?? []).length, 1);
    assert.match(textOnly(card), /\$300 \/ week/);
    assert.match(textOnly(card), game.week === 1 ? /Onboarding · ready Week 3/ : /Ready · automatic output/);
    assert.equal(getPayrollCents(game, game.playerCompanyId, CONTENT), 30_000);
    assert.equal(serializeState(game), before);
  }
});

test('W32-U04: an employee from a reduced-output save displays their full ready profile', () => {
  const saved = ready();
  const id = 'staff:points-ui-hire';
  delete saved.slices.company.passiveWorkforce;
  saved.slices.company.staff[id].assignedFte = U / 4;
  const game = withPassiveWorkforce(saved);
  const before = serializeState(game), html = renderDraft(game, assignmentDraft(game));
  assert.deepEqual(pointValues(elementByData(html, 'data-selected-staff-output', id)), PROFILES.ml);
  assert.doesNotMatch(html, /set_staff_allocation|id="staff-staff:|output level/);
  assert.equal(getPayrollCents(game, game.playerCompanyId, CONTENT), 30_000);
  assert.equal(serializeState(game), before);
});

test('W32-U05: an onboarding employee has a visible start date and future profile', () => {
  const game = hired();
  const card = elementByData(renderDraft(game, assignmentDraft(game)), 'data-selected-staff-output', 'staff:points-ui-hire');
  assert.deepEqual(pointValues(card), { ml: 0, research: 0, data: 0 });
  assert.match(textOnly(card), /From Week 3.*10 Research.*30 Design.*5 Data/);
});

test('W32-U06: selecting an older employee keeps that person’s point profile and one review summary', () => {
  let game = hired('ml', 'points-ui-older');
  game = step(queue(game, { kind: 'hire_staff', role: 'data' }, 'points-ui-newer'));
  game = step(step(game));
  const before = serializeState(game), oldId = 'staff:points-ui-older', newId = 'staff:points-ui-newer';
  const html = renderPeople(game, { intentId: 6, mode: 'assign', staffId: oldId });
  assert.equal(select(html, 'staffing-person').selected, oldId);
  assert.deepEqual(pointValues(elementByData(html, 'data-selected-staff-output', oldId)), PROFILES.ml);
  assert.deepEqual(pointValues(elementByData(html, 'data-staff-output', newId)), PROFILES.data);
  assert.equal((html.match(/data-selected-staff-output=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /data-selected-staff-output="staff:points-ui-newer"/);
  assert.equal(serializeState(game), before);
});

test('W32-U07: real project work reports the points actually supplied this week', () => {
  const game = step(queue(ready(), { kind: 'prepare_data', packetId: CONTENT.starterData.id }, 'ui-preparation'));
  const html = renderDraft(game, assignmentDraft(game));
  const granted = getGameView(game).workforce.granted.data;
  assert.ok(granted > 0);
  assert.match(textOnly(html), /Points supplied to projects/);
  const summary = html.match(/<section aria-label="Team contributions">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(summary);
  assert.equal(pointValues(summary).data, granted / U * 20);
});

test('W32-U08: observers can read employee output but cannot submit a point change or hire', () => {
  const game = ready(), before = serializeState(game), draft = assignmentDraft(game);
  const html = renderDraft(game, draft, false);
  assert.deepEqual(pointValues(elementByData(html, 'data-staff-output', draft.target)), PROFILES.ml);
  assert.ok(!select(html, 'staffing-person').attributes.includes('disabled=""'));
  assert.doesNotMatch(html, /data-studio-primary-for="assign-staff"/);
  const hireHtml = renderPeople(game, { intentId: 8, mode: 'hire', role: 'research' }, false);
  assert.deepEqual(pointValues(elementByData(hireHtml, 'data-hire-output', 'research')), PROFILES.research);
  assert.ok(select(hireHtml, 'hire-role').attributes.includes('disabled=""'));
  assert.ok(primary(hireHtml, 'hire-staff').includes('disabled=""'));
  assert.equal(serializeState(game), before);
});

test('W32-U09: the team table displays generated and supplied points separately', () => {
  const game = ready(), html = renderDraft(game, assignmentDraft(game));
  const table = html.match(/<summary>Team capacity by category<\/summary>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(table);
  const rows = Object.fromEntries([...table.matchAll(/<tr><th[^>]*>(.*?)<\/th><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)]
    .map(row => [textOnly(row[1]), [textOnly(row[2]), textOnly(row[3])]]));
  assert.deepEqual(rows.Design, ['30 points', '0 points']);
  assert.deepEqual(rows.Research, ['10 points', '0 points']);
  assert.deepEqual(rows.Data, [String(getGameView(game).workforce.capacity.data / U * 20) + ' points', '0 points']);
  assert.match(textOnly(html), /Unused points do not carry forward/);
  assert.match(textOnly(html), /Project progress also depends on compute/);
});

test('career choices show the trade-off before unlocking and the permanent bonus and pay after selection', () => {
  let game = ready();
  const employee = game.slices.company.staff['staff:points-ui-hire'];
  const render = () => textOnly(renderDraft(game, assignmentDraft(game)));
  assert.match(render(), /At 120 XP, choose one permanent specialty/);
  const paths = { research: ['Methods lead', 'Evaluation designer'], ml: ['Model architect', 'Training scientist'], data: ['Data curator', 'Pipeline engineer'],
    infrastructure: ['Reliability lead', 'Performance engineer'], commercial: ['Account director', 'Solutions engineer'], hardware: ['Silicon architect', 'Systems engineer'] }[employee.role];
  assert.ok(paths.every(path => render().includes(path)));
  for (let i = 0; i < 4; i++) game = step(game);
  game.slices.company.staff[employee.id].career = { experience: 6 * U, lastEarned: U, earnedWeek: game.week };
  const senior = render();
  assert.match(senior, /Senior · Specialty available/);
  assert.ok(paths.every(path => senior.includes('Choose ' + path)));
  game = step(queue(game, { kind: 'specialize_staff', staffId: employee.id, specialty: 'depth' }, 'pick-career'));
  const specialized = render();
  assert.ok(specialized.includes('Senior · ' + paths[0]));
  assert.doesNotMatch(specialized, /Choose one permanent specialty/);
  assert.match(specialized, /38 points/);
});
