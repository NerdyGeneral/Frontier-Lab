import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GameState, StaffMember, StaffRole } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { canonicalStateHash, getGameView } from '../src/core/index';
import { PeoplePanel } from '../src/ui/panels';
import { applyStudioStaffingSelection, createStaffingDraft, getStudioStaffingHelpTarget, STAFFING_FOUNDER_ROLES, StudioStaffingForm } from '../src/ui/studio-staffing';
import { StudioCommandReviewProvider, StudioStaffingSelectionProvider, StudioTaskActionsProvider } from '../src/ui/studio-interaction-context';
import type { StudioStaffingSelection } from '../src/ui/studio-interaction-context';
import { createPlayerOnlyState } from './fixtures/player-only';

const noAction = () => assert.fail('A staffing shortcut must not make a game decision');
const actions = { prepareData: noAction, evaluateModel: noAction, launchBasicChat: noAction, reviewResources: noAction, hireStaff: noAction, assignStaff: noAction };

function member(game: GameState, id: string, role: StaffRole, readyWeek: number, companyId = game.playerCompanyId): StaffMember {
  return { id, companyId, role, hiredWeek: 0, readyWeek, assignedFte: U };
}

function selectedValue(html: string, id: string) {
  const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)].find(match => match[1].includes('id="' + id + '"'));
  assert.ok(select, 'Missing select: ' + id);
  return [...select[2].matchAll(/<option\b([^>]*)>/g)].find(match => match[1].includes('selected=""'))?.[1].match(/\bvalue="([^"]*)"/)?.[1];
}

function renderPeople(game: GameState, selection: StudioStaffingSelection) {
  return renderToStaticMarkup(<StudioTaskActionsProvider value={actions}><StudioCommandReviewProvider value={noAction}>
    <StudioStaffingSelectionProvider value={selection}><PeoplePanel game={game} view={getGameView(game)} canAct onQueue={noAction} /></StudioStaffingSelectionProvider>
  </StudioCommandReviewProvider></StudioTaskActionsProvider>);
}

test('W30E-SH01: a role shortcut chooses a ready owned specialist before an onboarding one', () => {
  const game = createPlayerOnlyState(); game.week = 5;
  game.slices.company.staff = {
    'onboarding-researcher': member(game, 'onboarding-researcher', 'research', 8),
    'ready-researcher': member(game, 'ready-researcher', 'research', 3),
    'foreign-researcher': member(game, 'foreign-researcher', 'research', 1, 'another-company'),
    'ready-engineer': member(game, 'ready-engineer', 'ml', 1),
  };
  const before = canonicalStateHash(game);
  assert.deepEqual(getStudioStaffingHelpTarget(game, 'research'), { mode: 'assign', role: 'research', staffId: 'ready-researcher' });
  assert.equal(canonicalStateHash(game), before);
  const html = renderPeople(game, { intentId: 1, ...getStudioStaffingHelpTarget(game, 'research') });
  assert.equal(selectedValue(html, 'staffing-person'), 'ready-researcher');
  assert.match(html, /data-selected-staff-output="ready-researcher"/);
});

test('W30E-SH02: a missing role opens recruitment while onboarding staff keep their exact readiness', () => {
  const game = createPlayerOnlyState();
  game.slices.company.staff['foreign-hardware'] = member(game, 'foreign-hardware', 'hardware', 0, 'another-company');
  game.slices.company.staff['onboarding-researcher'] = member(game, 'onboarding-researcher', 'research', 4);
  const before = canonicalStateHash(game);
  for (const role of STAFFING_FOUNDER_ROLES.filter(role => role !== 'research')) assert.deepEqual(getStudioStaffingHelpTarget(game, role), { mode: 'hire', role });
  assert.deepEqual(getStudioStaffingHelpTarget(game, 'research'), { mode: 'assign', role: 'research', staffId: 'onboarding-researcher' });
  const target = getStudioStaffingHelpTarget(game, 'hardware');
  assert.deepEqual(target, { mode: 'hire', role: 'hardware' });
  const html = renderPeople(game, { intentId: 2, ...target });
  assert.match(html, /data-staffing-mode="hire"/);
  assert.equal(selectedValue(html, 'hire-role'), 'hardware');
  assert.doesNotMatch(html, /Founder points: current and proposed/);
  assert.equal(canonicalStateHash(game), before);
});

test('W30E-SH03: a role-only assignment replaces an incompatible retained person while preserving the original selection', () => {
  const game = createPlayerOnlyState();
  game.slices.company.staff['old-engineer'] = member(game, 'old-engineer', 'ml', 0);
  const retained = { ...createStaffingDraft(), mode: 'assign' as const, target: 'old-engineer' };
  const before = JSON.stringify(retained);
  const next = applyStudioStaffingSelection(retained, { intentId: 3, mode: 'assign', role: 'research' });
  assert.equal(next.target, 'founder');
  assert.equal(JSON.stringify(retained), before);
  const html = renderToStaticMarkup(<StudioStaffingForm game={game} view={getGameView(game)} canAct onQueue={noAction} draft={next} onChange={noAction} />);
  assert.equal(selectedValue(html, 'staffing-person'), 'founder');
  assert.doesNotMatch(html, /id="founder-|Review assignment/);
  assert.doesNotMatch(html, /data-selected-staff-output="old-engineer"/);
});

test('W30E-SH04: an exact missing or foreign person stays unavailable even when a role is supplied', () => {
  const game = createPlayerOnlyState();
  game.slices.company.staff['foreign-researcher'] = member(game, 'foreign-researcher', 'research', 0, 'another-company');
  for (const staffId of ['missing-person', 'foreign-researcher', null]) {
    const selection: StudioStaffingSelection = { intentId: 4, mode: 'assign', role: 'research', staffId };
    const draft = applyStudioStaffingSelection(createStaffingDraft(), selection);
    assert.equal(draft.target, staffId ?? '');
    const html = renderPeople(game, selection);
    assert.equal(selectedValue(html, 'staffing-person'), '');
    assert.doesNotMatch(html, /Founder points: current and proposed|data-selected-staff-output=/);
  }
});

test('W30E-SH05: an existing hardware hire stays selected with its real onboarding delay', () => {
  const game = createPlayerOnlyState();
  game.slices.company.staff['hardware-hire'] = member(game, 'hardware-hire', 'hardware', 4);
  const target = getStudioStaffingHelpTarget(game, 'hardware');
  assert.deepEqual(target, { mode: 'assign', role: 'hardware', staffId: 'hardware-hire' });
  const html = renderPeople(game, { intentId: 5, ...target });
  assert.equal(selectedValue(html, 'staffing-person'), 'hardware-hire');
  assert.match(html, /Onboarding · ready Week 4/);
  assert.match(html, /From Week 4:/);
  const unsupported = applyStudioStaffingSelection(createStaffingDraft(), { intentId: 6, mode: 'assign', role: 'hardware' });
  assert.equal(unsupported.target, '');
  assert.match(unsupported.unavailableReason, /Hardware work needs a specialist/);
});
