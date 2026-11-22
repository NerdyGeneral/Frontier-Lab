import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import { freezeDeep } from '../src/core/canonical';
import { getStudioDestinationForPanel, getStudioScreenTarget, resolveStudioHash } from '../src/core/studio-navigation';
import { STUDIO_PANEL_TITLES, STUDIO_TASKS, resolveStudioIntent } from '../src/core/studio-tasks';
import type { StudioPanelId, StudioTaskId } from '../src/core/studio-tasks';
import { STUDIO_MENU_ENTRIES, STUDIO_MENU_GROUPS, findStudioMenuEntries } from '../src/core/studio-menu-catalog';

test('menu directory retains exactly one entry for every registered panel and named task', () => {
  assert.equal(new Set(STUDIO_MENU_ENTRIES.map(entry => entry.id)).size, STUDIO_MENU_ENTRIES.length);
  for (const panel of Object.keys(STUDIO_PANEL_TITLES) as StudioPanelId[]) {
    const entries = STUDIO_MENU_ENTRIES.filter(entry => entry.target.kind === 'panel' && entry.target.panel === panel);
    assert.equal(entries.length, 1, panel + ' has one direct directory entry');
    assert.equal(entries[0].workspace, getStudioDestinationForPanel(panel));
    assert.equal(entries[0].panel, panel);
  }
  for (const task of Object.keys(STUDIO_TASKS) as StudioTaskId[]) {
    const entries = STUDIO_MENU_ENTRIES.filter(entry => entry.target.kind === 'task' && entry.target.task === task);
    assert.equal(entries.length, 1, task + ' has one direct task entry');
    const owner = STUDIO_TASKS[task].owner;
    assert.equal(entries[0].workspace, owner === 'planner' ? 'projects' : getStudioDestinationForPanel(owner));
  }
  assert.ok(STUDIO_MENU_ENTRIES.every(entry => entry.label.trim() && entry.description.trim() && entry.keywords.trim()));
  assert.ok(STUDIO_MENU_ENTRIES.every(entry => STUDIO_MENU_GROUPS.some(group => group.id === entry.workspace)));
});

test('menu navigation preserves exact owners and cannot schedule work or change a company', () => {
  const game = createInitialState(), before = serializeState(game);
  freezeDeep(game);
  for (const entry of STUDIO_MENU_ENTRIES) {
    const target = entry.target;
    if (target.kind === 'task') {
      assert.deepEqual(resolveStudioIntent(game, target), { ok: true, panel: STUDIO_TASKS[target.task].owner, task: target.task }, entry.id);
    } else if (target.kind === 'panel') {
      assert.deepEqual(resolveStudioHash('#' + target.panel), { screen: entry.workspace, panel: target.panel }, entry.id);
    } else {
      assert.equal(getStudioScreenTarget(target.screen).screen, entry.workspace);
    }
    assert.equal(Object.keys(target).length, 2, 'Directory entries contain navigation only');
  }
  assert.equal(serializeState(game), before);
});

test('search finds ordinary language for data acquisition, custom models, advanced skills, hiring, and rollback', () => {
  const cases = [
    ['buy data', 'panel:data'],
    ['custom model', 'panel:lab-projects'],
    ['training bench', 'panel:lab-projects'],
    ['test station', 'panel:models'],
    ['long-context', 'panel:models'],
    ['multimodal', 'panel:models'],
    ['hire specialist', 'task:hire-staff'],
    ['rollback', 'panel:release-desk'],
    ['frontier', 'task:architecture-research'],
    ['save backup', 'panel:save'],
  ];
  for (const [query, id] of cases) assert.ok(findStudioMenuEntries({ query }).some(entry => entry.id === id), query);
  assert.deepEqual(findStudioMenuEntries({ query: '  MODEL   custom ' }), findStudioMenuEntries({ query: 'custom model' }));
  assert.deepEqual(findStudioMenuEntries({ query: 'no-such-feature-39751' }), []);
});

test('workspace and task filters compose without dropping matching unavailable features', () => {
  const all = findStudioMenuEntries();
  assert.deepEqual(all, STUDIO_MENU_ENTRIES);
  const researchTasks = findStudioMenuEntries({ workspace: 'research', kind: 'task' });
  assert.deepEqual(researchTasks.map(entry => entry.id).sort(), [
    'task:apply-research', 'task:architecture-research', 'task:model-challenge', 'task:research-method', 'task:synthetic-data',
  ]);
  const panels = findStudioMenuEntries({ workspace: 'research', kind: 'menu' });
  assert.ok(panels.some(entry => entry.id === 'screen:research'), 'Pathways keeps its own destination');
  assert.ok(panels.some(entry => entry.id === 'panel:research'), 'The legacy catalog remains separately addressable');
  assert.ok(panels.some(entry => entry.id === 'panel:applied-research'));
  assert.ok(panels.some(entry => entry.id === 'panel:synthetic-data'));
  assert.ok(panels.some(entry => entry.id === 'panel:model-challenges'));
  assert.ok(findStudioMenuEntries({ workspace: 'projects', kind: 'task' }).some(entry => entry.id === 'task:development-plan'));
  assert.deepEqual(findStudioMenuEntries({ workspace: 'research', kind: 'task', query: 'frontier' }).map(entry => entry.id), ['task:model-challenge', 'task:architecture-research']);
  assert.equal(findStudioMenuEntries().length, all.length, 'Searching does not mutate the catalog');
});
