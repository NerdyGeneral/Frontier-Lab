import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { createInitialState, getGameView, previewCommand, serializeState, submitCommand, advanceWeek } from '../src/core/index';
import { createStudioTaskSession, getActiveStudioTask, studioTaskReducer } from '../src/core/studio-tasks';
import { STUDIO_MENU_GROUPS } from '../src/core/studio-menu-catalog';
import { getGameSectionVisibility } from '../src/ui/guide-links';
import { getStudioPanelLock } from '../src/ui/studio-navigation';
import { getResearchMethodNavigation } from '../src/ui/research-method-navigation';
import { StudioResearchTree } from '../src/ui/studio-research-tree';
import { StudioMenuDirectory } from '../src/ui/studio-menu-directory';

const noAction = () => assert.fail('Inspecting a requirement must not schedule or navigate during rendering.');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('Week 0 M8 requirement opens its exact tree details without opening the gated paid catalog', () => {
  const game = createInitialState(), before = serializeState(game);
  const sections = getGameSectionVisibility(game, getGameView(game));
  assert.equal(game.week, 0);
  assert.equal(game.slices.data.packets[CONTENT.starterData.id].prepared, false);
  assert.equal(sections.research, false);
  const target = getResearchMethodNavigation(game, sections, 'M8');
  assert.equal(target.kind, 'tree');
  if (target.kind !== 'tree') assert.fail('The exact requirement must be inspectable outside the locked catalog.');
  assert.equal(target.researchId, 'M8');
  assert.equal(target.focusId, 'research-tree-details');
  assert.equal(target.catalogLock, getStudioPanelLock('research', sections));
  const html = renderToStaticMarkup(<StudioResearchTree game={game} canAct onQueue={noAction} onOpenPanel={noAction}
    onOpenMethod={noAction} catalogLock={target.catalogLock} selection={{ intentId: 1, researchId: target.researchId }} />);
  const selected = html.match(/<aside[^>]*data-research-method="M8"[\s\S]*?<\/aside>/)?.[0];
  assert.ok(selected, 'The mounted visible detail must represent M8, not the first available discovery.');
  assert.match(textOnly(selected), /Reasoning curriculum/);
  for (const id of CONTENT.research.find(item => item.id === 'M8')!.requires) assert.ok(textOnly(selected).includes(CONTENT.research.find(item => item.id === id)!.name));
  assert.match(textOnly(selected), /Before funding research Prepare your starter data/);
  assert.doesNotMatch(selected, /research-tree-open-method|data-studio-review="start_research"/);
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'M8' }).accepted, false);
  assert.equal(serializeState(game), before);
});

test('an early requirement detour returns to the same retained training task and exact draft intent', () => {
  const game = createInitialState(), target = getResearchMethodNavigation(game, getGameSectionVisibility(game, getGameView(game)), 'M8');
  assert.equal(target.kind, 'tree');
  let session = studioTaskReducer(createStudioTaskSession(), { type: 'open', task: 'train-model',
    intent: { kind: 'training-data', packetId: CONTENT.starterData.id }, returnTo: { screen: 'projects', panel: 'lab-projects' } });
  const parent = getActiveStudioTask(session)!;
  session = studioTaskReducer(session, { type: 'detour', destination: { screen: 'research', panel: null, focusId: 'studio-research-tree' } });
  assert.equal(getActiveStudioTask(session), null);
  assert.equal(session.detour?.owner, 'lab-projects');
  assert.equal(session.tasks['lab-projects']!.draftGeneration, parent.draftGeneration);
  session = studioTaskReducer(session, { type: 'return' });
  assert.equal(getActiveStudioTask(session)!.instanceId, parent.instanceId);
  assert.deepEqual(getActiveStudioTask(session)!.intent, parent.intent);
  assert.equal(session.detour, null);
});

test('prepared starter data restores the ordinary method task route while research prerequisites still apply', () => {
  let game = createInitialState();
  const queued = submitCommand(game, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'requirement-test-prepare');
  assert.ok(queued.accepted, queued.reason?.message); game = queued.state;
  for (let n = 0; n < 12 && !game.slices.data.packets[CONTENT.starterData.id].prepared; n++) {
    const step = advanceWeek(game); assert.ok(step.accepted, step.reason?.message); game = step.state;
  }
  assert.equal(game.slices.data.packets[CONTENT.starterData.id].prepared, true);
  const sections = getGameSectionVisibility(game, getGameView(game));
  assert.deepEqual(getResearchMethodNavigation(game, sections, 'M8'), { kind: 'task', researchId: 'M8' });
  assert.equal(previewCommand(game, { kind: 'start_research', researchId: 'M8' }).accepted, false);
  assert.equal(getResearchMethodNavigation(game, sections, 'missing-method').kind, 'unavailable');
});

test('short viewport keeps an explicitly named, scrollable All menus path to every destination group', () => {
  const css = readFileSync(new URL('../app/studio-desktop-chrome.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-studio-short-viewport="true"\] \.studio-sidebar \.studio-nav \{ display: none; \}/);
  const host = css.match(/\[data-studio-short-viewport="true"\] \.studio-menu-host \{([^}]+)\}/)?.[1];
  assert.ok(host);
  assert.match(host, /position: fixed/);
  assert.match(host, /overflow-y: auto/);
  for (const variable of ['--studio-visual-viewport-top', '--studio-measured-header-height', '--studio-visual-viewport-bottom', '--studio-measured-sidebar-height']) assert.ok(host.includes(variable));
  const game = createInitialState(), sections = getGameSectionVisibility(game, getGameView(game));
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={sections} onNavigate={noAction} onClose={noAction} />);
  assert.match(html, /aria-label="Find a menu or task"/);
  assert.match(textOnly(html), /All menus/);
  for (const group of STUDIO_MENU_GROUPS) assert.ok(textOnly(html).includes(group.label), group.label);
});
