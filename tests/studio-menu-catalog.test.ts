import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core/engine';
import { serializeState } from '../src/core/snapshot';
import { freezeDeep } from '../src/core/canonical';
import { getStudioDestinationForPanel, getStudioScreenTarget, resolveStudioHash } from '../src/core/studio-navigation';
import { STUDIO_PANEL_TITLES, STUDIO_TASKS, resolveStudioIntent } from '../src/core/studio-tasks';
import { STUDIO_MENU_ENTRIES, STUDIO_MENU_GROUPS, findStudioMenuEntries } from '../src/core/studio-menu-catalog';

test('directory has one canonical row per feature while every panel and task name remains searchable', () => {
  assert.equal(new Set(STUDIO_MENU_ENTRIES.map(entry => entry.id)).size, STUDIO_MENU_ENTRIES.length);
  assert.equal(new Set(STUDIO_MENU_ENTRIES.map(entry => entry.label)).size, STUDIO_MENU_ENTRIES.length);
  assert.ok(STUDIO_MENU_ENTRIES.every(entry => entry.target.kind !== 'task'), 'Task shortcuts do not repeat destination rows');
  for (const id of ['task:train-model', 'panel:development-plans', 'panel:research', 'panel:compute', 'panel:compute-costs', 'panel:capacity-forecast']) {
    assert.equal(STUDIO_MENU_ENTRIES.some(entry => entry.id === id), false, id + ' belongs to a canonical feature');
  }
  for (const label of Object.values(STUDIO_PANEL_TITLES)) assert.ok(findStudioMenuEntries({ query: label }).length, label);
  for (const task of Object.values(STUDIO_TASKS)) assert.ok(findStudioMenuEntries({ query: task.title }).length, task.title);
  assert.ok(STUDIO_MENU_ENTRIES.every(entry => entry.label.trim() && entry.description.trim() && entry.keywords.trim()));
  assert.ok(STUDIO_MENU_ENTRIES.every(entry => STUDIO_MENU_GROUPS.some(group => group.id === entry.workspace)));
});

test('feature links and contextual shortcuts preserve their exact owners without scheduling work', () => {
  const game = createInitialState(), before = serializeState(game);
  freezeDeep(game);
  for (const entry of STUDIO_MENU_ENTRIES) {
    for (const target of [entry.target, ...entry.actions.map(action => action.target)]) {
      if (target.kind === 'task') {
        assert.deepEqual(resolveStudioIntent(game, target), { ok: true, panel: STUDIO_TASKS[target.task].owner, task: target.task }, entry.id);
      } else if (target.kind === 'panel') {
        assert.deepEqual(resolveStudioHash('#' + target.panel), { screen: getStudioDestinationForPanel(target.panel), panel: target.panel }, entry.id);
      } else {
        assert.equal(getStudioScreenTarget(target.screen).screen, entry.workspace);
      }
      assert.equal(Object.keys(target).length, 2, 'Directory targets contain navigation only');
    }
  }
  assert.equal(serializeState(game), before);
});

test('ordinary action phrases find the canonical feature rather than duplicate menu and task results', () => {
  const cases = [
    ['buy data', 'panel:data'], ['custom model', 'panel:lab-projects'], ['training bench', 'panel:lab-projects'],
    ['test station', 'panel:models'], ['long-context', 'panel:models'], ['multimodal', 'panel:models'],
    ['hire specialist', 'panel:people'], ['rollback', 'panel:release-desk'], ['save backup', 'panel:save'],
    ['development plans', 'screen:projects'], ['research pathways', 'screen:research'], ['research catalog', 'screen:research'],
  ];
  for (const [query, id] of cases) assert.ok(findStudioMenuEntries({ query }).some(entry => entry.id === id), query);
  for (const query of ['allocate compute', 'rent or release compute', 'plan people and compute', 'compute costs', 'capacity forecast', 'compute rack']) {
    assert.deepEqual(findStudioMenuEntries({ query }).map(entry => entry.id), ['panel:capacity'], query);
  }
  for (const query of ['research programs', 'manage research programs', 'systems experiment', 'experiments', 'efficient systems', 'persistent systems', 'verified systems', 'architecture research']) {
    assert.ok(findStudioMenuEntries({ query }).some(entry => entry.id === 'panel:research-programs'), query);
  }
  assert.deepEqual(findStudioMenuEntries({ query: 'experiments' }).map(entry => entry.id), ['panel:research-programs']);
  assert.deepEqual(findStudioMenuEntries({ query: '  MODEL   custom ' }), findStudioMenuEntries({ query: 'custom model' }));
  assert.deepEqual(findStudioMenuEntries({ query: 'no-such-feature-39751' }), []);
});

test('workspace filtering keeps programs and locked report shortcuts discoverable in their canonical home', () => {
  const before = JSON.stringify(STUDIO_MENU_ENTRIES);
  assert.deepEqual(findStudioMenuEntries(), STUDIO_MENU_ENTRIES);
  const research = findStudioMenuEntries({ workspace: 'research' });
  for (const id of ['screen:research', 'panel:research-programs', 'panel:applied-research', 'panel:synthetic-data', 'panel:model-challenges']) {
    assert.ok(research.some(entry => entry.id === id), id);
  }
  const programs = research.find(entry => entry.id === 'panel:research-programs')!;
  assert.ok(programs.actions.some(action => action.target.kind === 'task' && action.target.task === 'research-program'));
  assert.ok(programs.actions.some(action => action.target.kind === 'task' && action.target.task === 'architecture-research'));
  const capacity = findStudioMenuEntries({ workspace: 'operations', query: 'compute costs' });
  assert.deepEqual(capacity.map(entry => entry.id), ['panel:capacity']);
  assert.deepEqual(capacity[0].actions.map(action => action.panel), ['compute', 'capacity-forecast', 'compute-costs']);
  assert.deepEqual(findStudioMenuEntries({ workspace: 'company', query: 'compute costs' }), []);
  assert.equal(JSON.stringify(STUDIO_MENU_ENTRIES), before, 'Searching does not mutate the catalog');
});
