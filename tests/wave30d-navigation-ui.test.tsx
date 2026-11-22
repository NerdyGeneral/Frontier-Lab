import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONTENT } from '../src/content/catalog';
import { createInitialState, canonicalStateHash, getGameView, deserializeState } from '../src/core/index';
import { STUDIO_DESTINATIONS, getStudioDestinationForPanel } from '../src/core/studio-navigation';
import type { StudioScreen } from '../src/core/studio-navigation';
import { STUDIO_TASKS } from '../src/core/studio-tasks';
import type { StudioPanelId } from '../src/core/studio-tasks';
import { getGameSectionVisibility } from '../src/ui/guide-links';
import type { GameSectionVisibility } from '../src/ui/guide-links';
import { StudioNavigation, StudioWorkspaceHeader, StudioLockedWorkbench, getStudioWorkspaceSections, getStudioPanelLock } from '../src/ui/studio-navigation';
import { StudioShell } from '../src/ui/studio-shell';

const noAction = () => assert.fail('Rendering navigation must not invoke an action');
const textOnly = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attributes: match[1], text: textOnly(match[2]) }));
const advanced = () => {
  const loaded = deserializeState(readFileSync(new URL('./fixtures/wave16-snapshot.json', import.meta.url), 'utf8'));
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.state;
};

test('W30D-NU01: all six named destinations stay directly visible while utilities remain separate', () => {
  const html = renderToStaticMarkup(<StudioNavigation screen="studio" disabled={false} projectCount={3} onSelect={noAction} />);
  const items = buttons(html);
  assert.deepEqual(items.slice(0, 6).map(item => item.text.replace(/3$/, '')), STUDIO_DESTINATIONS.map(item => item.label));
  assert.equal(items.length, 6);
  assert.doesNotMatch(html, /studio-nav-secondary|studio-nav-more|More destinations|aria-haspopup="menu"/);
  assert.equal(items.filter(item => item.attributes.includes('aria-current="page"')).length, 1);
  assert.doesNotMatch(textOnly(html), /Save|Settings|Release Desk|Campus/);
});

test('W30D-NU02: legacy screens highlight their canonical destination and pending import disables navigation', () => {
  const cases: [StudioScreen, string][] = [['release', 'Products'], ['market', 'Products'], ['campus', 'Operations'], ['finance', 'Company']];
  for (const [screen, current] of cases) {
    const html = renderToStaticMarkup(<StudioNavigation screen={screen} disabled projectCount={0} onSelect={noAction} />);
    const items = buttons(html);
    assert.equal(items.every(item => item.attributes.includes('disabled=""')), true);
    assert.match(items.find(item => item.text === current)!.attributes, /aria-current="page"/);
  }
  const save = renderToStaticMarkup(<StudioNavigation screen="save" disabled={false} projectCount={0} onSelect={noAction} />);
  assert.doesNotMatch(save, /aria-current="page"/);
});

test('W30D-NU03: workspace sections expose every management owner in its advertised destination', () => {
  const all = STUDIO_DESTINATIONS.flatMap(destination => getStudioWorkspaceSections(destination.id).map(section => ({ destination: destination.id, section })));
  for (const { destination, section } of all) {
    assert.ok(section.label.trim());
    if (section.id !== 'work' && section.id !== 'plan') assert.equal(getStudioDestinationForPanel(section.id), destination);
  }
  const ids = all.map(item => item.section.id);
  assert.equal(new Set(ids).size, ids.length, 'A workbench has one canonical section');
  for (const task of Object.values(STUDIO_TASKS)) {
    if (task.owner === 'planner') assert.ok(ids.includes('plan'));
    else if (getStudioDestinationForPanel(task.owner) !== 'research') assert.ok(ids.includes(task.owner), task.owner);
  }
  assert.deepEqual(getStudioWorkspaceSections('save'), []);
  assert.ok(getStudioWorkspaceSections('projects').some(section => section.id === 'development-plans' && section.label === 'Development plans'));
  assert.ok(getStudioWorkspaceSections('company').some(section => section.id === 'campaign' && section.label === 'Chapters & ambitions'));
});

test('strategy workbenches expose the chapter and market briefing from the opening, with stable visible panel hosts', () => {
  const game = createInitialState(), sections = getGameSectionVisibility(game, getGameView(game, CONTENT));
  for (const panel of ['campaign', 'market', 'development-plans', 'model-challenges'] as const) assert.equal(getStudioPanelLock(panel, sections), null, panel);
  assert.equal(sections.market, true); assert.equal(sections.campaign, true);
  const css = readFileSync(new URL('../app/studio.css', import.meta.url), 'utf8');
  for (const panel of ['development-plans', 'model-challenges']) assert.ok(css.includes(`.studio-mode[data-studio-panel="${panel}"] .studio-content #${panel}`), `${panel} must be visible when selected`);
});

test('W30D-NU04: unavailable workspaces remain labelled and explain the authoritative visibility gate', () => {
  const gates: [StudioPanelId, keyof GameSectionVisibility][] = [
    ['research', 'research'], ['applied-research', 'appliedResearch'], ['developer-api', 'developerApi'],
    ['business-commitments', 'businessCommitments'], ['agents', 'agents'], ['market', 'market'],
    ['infrastructure', 'infrastructure'], ['chips', 'chips'], ['compute-costs', 'capacityForecast'],
    ['capacity-forecast', 'capacityForecast'], ['campaign', 'campaign'],
  ];
  for (const game of [createInitialState(), advanced()]) {
    const before = canonicalStateHash(game);
    const sections = getGameSectionVisibility(game, getGameView(game, CONTENT));
    for (const [panel, gate] of gates) assert.equal(getStudioPanelLock(panel, sections) === null, sections[gate], panel);
    assert.equal(canonicalStateHash(game), before);
  }
  const game = createInitialState(), sections = getGameSectionVisibility(game, getGameView(game, CONTENT));
  const html = renderToStaticMarkup(<StudioWorkspaceHeader screen="products" panel="developer-api" projectTab="work" sections={sections} disabled={false} onSelect={noAction} />);
  const api = buttons(html).find(item => item.text.startsWith('Developer API'))!;
  assert.match(api.text, /locked/);
  assert.match(api.attributes, /aria-pressed="true"/);
  assert.doesNotMatch(api.attributes, /disabled/);
  const locked = renderToStaticMarkup(<StudioLockedWorkbench title="Developer API" reason={getStudioPanelLock('developer-api', sections)!} onResearch={noAction} onStudio={noAction} />);
  assert.match(textOnly(locked), /first sale/);
  assert.deepEqual(buttons(locked).map(item => item.text), ['Explore research', 'Return to your current goal']);
});

test('W30D-NU05: cold shell exposes Results, Save, settings and status without opening a decision or changing time', () => {
  const game = createInitialState(), before = canonicalStateHash(game);
  const html = renderToStaticMarkup(<StudioShell game={game} paused={false} speed={1} canAct isController
    notice="The lab is running." saveMessage="Saved in this browser." forceSaveOpen={false} plannerEpoch={0}
    onToggleRunning={noAction} onStep={noAction} onSpeed={noAction} onPause={noAction} onQueue={noAction}
    onApplyPlan={() => assert.fail('No resource commitment during navigation render')}><p>Retained workbenches</p></StudioShell>);
  assert.match(html, /aria-label="Lab utilities"/);
  assert.match(html, /aria-label="Settings and utilities"/);
  assert.match(html, /aria-label="Open Results, 0 unreviewed"/);
  assert.ok(buttons(html).some(item => item.text === 'Save'));
  assert.match(html, /Company cash/);
  assert.match(html, /The lab is running/);
  assert.match(html, /Saved in this browser/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.equal(canonicalStateHash(game), before);
});

test('the consultancy sees its signed brief and deadline in Studio before its first sale', () => {
  const game = createInitialState(CONTENT, 'release', 'consultancy');
  const html = renderToStaticMarkup(<StudioShell game={game} paused speed={1} canAct isController
    notice="" saveMessage="" forceSaveOpen={false} plannerEpoch={0}
    onToggleRunning={noAction} onStep={noAction} onSpeed={noAction} onPause={noAction} onQueue={noAction}
    onApplyPlan={() => assert.fail('Viewing a client brief must not submit a plan')}><p>Workbenches</p></StudioShell>);
  assert.equal(game.week, 0);
  assert.match(textOnly(html), /Due week 8/);
  assert.match(textOnly(html), /Deliver the chat pilot/);
  assert.ok(buttons(html).some(item => item.text === 'Review delivery'));
  const sections = getGameSectionVisibility(game, getGameView(game, CONTENT));
  assert.equal(getStudioPanelLock('customer-briefs', sections), null);
  assert.ok(getStudioWorkspaceSections('products').some(section => section.id === 'customer-briefs'));
});
