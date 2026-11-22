import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import type { GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { createInitialState, deserializeState, getGameView, serializeState } from '../src/core/index';
import type { StudioTaskId } from '../src/core/studio-tasks';
import { ComputePanel, PeoplePanel } from '../src/ui/panels';
import { createStaffingDraft, StudioStaffingForm } from '../src/ui/studio-staffing';
import type { StaffingDraft } from '../src/ui/studio-staffing';
import {
  StudioCommandReviewProvider, StudioStaffingSelectionProvider, StudioTaskActionsProvider, StudioTaskModeProvider,
} from '../src/ui/studio-interaction-context';
import type { StudioStaffingSelection } from '../src/ui/studio-interaction-context';

// Rendered forms prove named task scope, exact selections and observer controls.
// Mounted edit/switch/return retention and keyboard navigation remain browser gates.
const noAction = () => assert.fail('Rendering a menu or draft must not dispatch or edit anything');
const actions = {
  prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction,
  reviewResources: noAction, hireStaff: noAction, assignStaff: noAction, openTask: noAction,
};
const props = (game: GameState, canAct = true) => ({ game, view: getGameView(game), canAct, onQueue: noAction });
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const attribute = (tag: string, name: string) => tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1];
const buttonTags = (html: string) => [...html.matchAll(/<button\b([^>]*)>/g)].map(match => match[1]);
const namedControls = (html: string, action: string) => buttonTags(html).filter(tag => attribute(tag, 'data-studio-primary-for') === action);

function selectedValue(html: string, id: string): string | undefined {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
    .find(match => attribute(match[1], 'id') === id);
  assert.ok(select, 'Missing select: ' + id);
  const selected = [...select[2].matchAll(/<option\b([^>]*)>/g)].find(match => /\bselected=""/.test(match[1]));
  return selected ? attribute(selected[1], 'value') : undefined;
}

function renderTask(task: StudioTaskId | null, children: ReactNode) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}>
    <StudioTaskModeProvider value={task}><StudioCommandReviewProvider value={noAction}>
      {children}
    </StudioCommandReviewProvider></StudioTaskModeProvider>
  </StudioTaskActionsProvider>);
}

function renderPeople(game: GameState, task: 'hire-staff' | 'assign-staff', selection: StudioStaffingSelection, canAct = true) {
  return renderTask(task, <StudioStaffingSelectionProvider value={selection}>
    <PeoplePanel {...props(game, canAct)} />
  </StudioStaffingSelectionProvider>);
}

function renderStaffingDraft(game: GameState, task: 'hire-staff' | 'assign-staff', draft: StaffingDraft, canAct = true) {
  return renderTask(task, <StudioStaffingForm {...props(game, canAct)} draft={draft} onChange={noAction} />);
}

function studioFixture(): GameState {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave24-browser.json', import.meta.url), 'utf8'));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.state;
}

function computeSection(html: string, label: 'Compute allocation' | 'Cloud capacity') {
  const section = html.match(new RegExp('<section\\b([^>]*\\baria-label="' + label + '"[^>]*)>([\\s\\S]*?)<\\/section>'));
  assert.ok(section, 'Missing named compute section: ' + label);
  return { attributes: section[1], body: section[2] };
}

function inputTag(html: string, id: string) {
  const tag = [...html.matchAll(/<input\b([^>]*)>/g)].find(match => attribute(match[1], 'id') === id)?.[1];
  assert.ok(tag, 'Missing input: ' + id);
  return tag;
}

test('W31B-M01: the named hire entry exposes the chosen role and its own disabled review when recruitment is locked', () => {
  const game = createInitialState(), before = serializeState(game);
  const html = renderPeople(game, 'hire-staff', { intentId: 1, mode: 'hire', role: 'hardware' });
  assert.equal(selectedValue(html, 'hire-role'), 'hardware');
  assert.match(html, /data-staffing-mode="hire"/);
  assert.match(html, />Hire staff<\/button>/);
  assert.match(html, />Team output<\/button>/);
  assert.match(html, /aria-label="Hiring cost and start date"/);
  assert.match(textOnly(html), /Start Chip feasibility research before recruiting this specialist/);
  const controls = namedControls(html, 'hire-staff');
  assert.equal(controls.length, 1);
  assert.equal(attribute(controls[0], 'data-studio-review'), 'hire_staff');
  assert.match(controls[0], /disabled=""/);
  assert.equal(namedControls(html, 'assign-staff').length, 0);
  assert.doesNotMatch(html, /id="staffing-person"|id="founder-ml"/);
  assert.equal(serializeState(game), before);
});

test('W31B-M02: the Team output task inspects each person without queuing point assignments', () => {
  const game = studioFixture(), before = serializeState(game);
  const member = Object.values(game.slices.company.staff).find(person => person.companyId === game.playerCompanyId);
  assert.ok(member);
  for (const target of ['founder', member.id]) {
    const draft = createStaffingDraft();
    draft.mode = 'assign'; draft.target = target;
    const html = renderStaffingDraft(game, 'assign-staff', draft);
    assert.equal(selectedValue(html, 'staffing-person'), target);
    assert.match(html, /aria-label="Team contributions"/);
    assert.equal(namedControls(html, 'assign-staff').length, 0);
    assert.equal(namedControls(html, 'hire-staff').length, 0);
    assert.doesNotMatch(html, /id="hire-role"|id="founder-|set_staff_allocation|assign_founder/);
    if (target === 'founder') assert.match(html, /data-staff-output="founder"/);
    else assert.ok(html.includes('data-selected-staff-output="' + member.id + '"'));
  }
  assert.equal(serializeState(game), before);
});

test('W31B-M04: a missing selected employee stays unavailable in the named assignment task', () => {
  const game = studioFixture(), before = serializeState(game);
  const html = renderPeople(game, 'assign-staff', { intentId: 4, mode: 'assign', staffId: 'missing-exact-employee' });
  assert.equal(selectedValue(html, 'staffing-person'), '');
  assert.match(textOnly(html), /Choose an available person/);
  assert.equal(namedControls(html, 'assign-staff').length, 0, 'An unavailable exact target cannot become a founder command');
  assert.equal(namedControls(html, 'hire-staff').length, 0);
  assert.doesNotMatch(html, /data-assignment-staff=|id="founder-ml"/);
  assert.equal(serializeState(game), before);
});

test('W31B-M05: named hire and assignment remain readable but disabled for an observer', () => {
  const game = createInitialState(), before = serializeState(game);
  for (const mode of ['hire', 'assign'] as const) {
    const task = mode === 'hire' ? 'hire-staff' : 'assign-staff';
    const html = renderPeople(game, task, { intentId: 5, mode }, false);
    const controls = namedControls(html, task);
    if (mode === 'hire') {
      assert.equal(controls.length, 1);
      assert.match(controls[0], /disabled=""/);
      assert.match(html, /<select id="hire-role" disabled=""/);
      assert.match(textOnly(html), /Recruitment cost/);
    } else {
      assert.equal(controls.length, 0);
      assert.equal(selectedValue(html, 'staffing-person'), 'founder');
      assert.match(textOnly(html), /founder automatically helps/);
    }
  }
  assert.equal(serializeState(game), before);
});

test('W31B-M06: the compute workbench offers two named entries backed by the original allocation and rental fields', () => {
  const game = createInitialState(), before = serializeState(game);
  const html = renderTask(null, <ComputePanel {...props(game)} />);
  assert.match(html, /aria-label="Compute decision"/);
  assert.match(html, />Allocate compute<\/button>/);
  assert.match(html, />Rent or release compute<\/button>/);
  const allocate = computeSection(html, 'Compute allocation'), rent = computeSection(html, 'Cloud capacity');
  assert.doesNotMatch(allocate.attributes, /hidden=/);
  assert.doesNotMatch(rent.attributes, /hidden=/);
  const allocationControl = namedControls(allocate.body, 'allocate-compute');
  const rentalControl = namedControls(rent.body, 'rent-compute');
  assert.equal(allocationControl.length, 1);
  assert.equal(rentalControl.length, 1);
  assert.equal(attribute(allocationControl[0], 'data-studio-review'), 'allocate_compute');
  assert.equal(attribute(rentalControl[0], 'data-studio-review'), 'set_cloud_capacity');
  for (const id of ['allocate-serving', 'allocate-development', 'allocate-research', 'cloud-total']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, 'One retained field per compute input');
  }
  assert.equal(attribute(inputTag(rent.body, 'cloud-total'), 'max'), String(CONTENT.firstSale.maxCloudCU / U));
  assert.equal(serializeState(game), before);
});

test('W31B-M07: a named compute task scopes visibility while retaining both original sections and all draft fields', () => {
  for (const game of [createInitialState(), studioFixture()]) {
    const before = serializeState(game), fleet = game.slices.compute.fleets[game.playerCompanyId];
    for (const task of ['allocate-compute', 'rent-compute'] as const) {
      const html = renderTask(task, <ComputePanel {...props(game)} />);
      const allocate = computeSection(html, 'Compute allocation'), rent = computeSection(html, 'Cloud capacity');
      assert.equal(/hidden=""/.test(allocate.attributes), task === 'rent-compute');
      assert.equal(/hidden=""/.test(rent.attributes), task === 'allocate-compute');
      assert.equal(namedControls(allocate.body, 'allocate-compute').length, 1);
      assert.equal(namedControls(rent.body, 'rent-compute').length, 1);
      for (const category of ['serving', 'development', 'research'] as const) {
        const id = 'allocate-' + category;
        assert.equal(attribute(inputTag(allocate.body, id), 'value'), String(fleet.allocation[category] / U));
        assert.equal(html.split('id="' + id + '"').length - 1, 1);
      }
      assert.equal(attribute(inputTag(rent.body, 'cloud-total'), 'value'), String(fleet.cloudCU / U));
      assert.equal(html.split('id="cloud-total"').length - 1, 1);
      assert.equal(html.split('id="compute"').length - 1, 1);
    }
    assert.equal(serializeState(game), before, 'Task mode changes no fleet allocation, rental, clock or queued commands');
  }
});

test('W31B-M08: an unchanged rental remains the disabled named rental command while allocation stays in its hidden section', () => {
  const game = createInitialState();
  const html = renderTask('rent-compute', <ComputePanel {...props(game)} />);
  const rent = computeSection(html, 'Cloud capacity'), allocate = computeSection(html, 'Compute allocation');
  const rentalControls = namedControls(rent.body, 'rent-compute');
  assert.equal(rentalControls.length, 1);
  assert.match(rentalControls[0], /disabled=""/);
  assert.equal(attribute(rentalControls[0], 'data-studio-review'), 'set_cloud_capacity');
  assert.equal(namedControls(rent.body, 'allocate-compute').length, 0);
  assert.match(allocate.attributes, /hidden=""/);
  assert.match(textOnly(rent.body), /Rent is a weekly commitment/);
});

test('W31B-M09: observer compute tasks disable every retained editable field and both authoritative controls', () => {
  const game = studioFixture(), before = serializeState(game);
  for (const task of ['allocate-compute', 'rent-compute'] as const) {
    const html = renderTask(task, <ComputePanel {...props(game, false)} />);
    for (const id of ['allocate-serving', 'allocate-development', 'allocate-research', 'cloud-total']) {
      assert.match(inputTag(html, id), /disabled=""/);
    }
    for (const key of ['allocate-compute', 'rent-compute']) {
      const controls = namedControls(html, key);
      assert.equal(controls.length, 1);
      assert.match(controls[0], /disabled=""/);
    }
    assert.match(textOnly(html), /Weekly cloud bill/);
  }
  assert.equal(serializeState(game), before);
});

test('W31B-M10: Classic compute keeps both original command forms without adding named Studio navigation', () => {
  const game = createInitialState(), before = serializeState(game);
  const html = renderToStaticMarkup(<ComputePanel {...props(game)} />);
  const allocate = computeSection(html, 'Compute allocation'), rent = computeSection(html, 'Cloud capacity');
  assert.doesNotMatch(allocate.attributes, /hidden=/);
  assert.doesNotMatch(rent.attributes, /hidden=/);
  assert.doesNotMatch(html, /aria-label="Compute decision"/);
  assert.equal(namedControls(allocate.body, 'allocate-compute').length, 1);
  assert.equal(namedControls(rent.body, 'rent-compute').length, 1);
  assert.equal(html.split('id="allocate-development"').length - 1, 1);
  assert.equal(html.split('id="cloud-total"').length - 1, 1);
  assert.equal(serializeState(game), before);
});
