import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { STUDIO_MENU_ENTRIES, STUDIO_MENU_GROUPS } from '../src/core/studio-menu-catalog';
import type { StudioMenuTarget } from '../src/core/studio-menu-catalog';
import { StudioMenuDirectory } from '../src/ui/studio-menu-directory';
import type { StudioMenuDirectoryProps } from '../src/ui/studio-menu-directory';
import { StudioResearchNavigation, getStudioPanelLock, getStudioWorkspaceSections } from '../src/ui/studio-navigation';
import { getStudioDestinationForPanel } from '../src/core/studio-navigation';
import type { GameSectionVisibility } from '../src/ui/guide-links';

const locked: GameSectionVisibility = {
  market: false, campaign: false, agents: false, research: false, appliedResearch: false,
  developerApi: false, businessCommitments: false, infrastructure: false, chips: false, capacityForecast: false,
};
const noAction = () => assert.fail('Rendering a navigation entry must not open or schedule it');
const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
const buttons = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match => ({ attributes: match[1], text: text(match[2]) }));

test('All menus keeps every feature and shortcut inside compact native workspace groups', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} onNavigate={noAction} onClose={noAction} />);
  assert.match(html, /role="search" aria-label="Find a feature or action"/);
  assert.match(html, /<label[^>]*>Search features and actions<\/label>/);
  const entries = buttons(html).filter(item => item.attributes.includes('class="studio-menu-item"'));
  assert.equal(entries.length, STUDIO_MENU_ENTRIES.length);
  assert.equal(entries.some(item => item.attributes.includes('disabled')), false, 'Locked features remain inspectable');
  const api = entries.find(item => item.text.startsWith('Developer API'))!;
  assert.match(api.text, /Locked/);
  assert.doesNotMatch(api.text, /Make your first sale/);
  assert.match(api.attributes, /aria-description="Make your first sale/);
  assert.match(api.attributes, /title="Make your first sale/);
  assert.ok(entries.some(item => item.text.startsWith('Research programs')));
  assert.equal(entries.filter(item => item.text.startsWith('Develop a model')).length, 1);
  assert.equal(entries.filter(item => item.text.startsWith('Capacity')).length, 1);
  assert.doesNotMatch(html, /Menus and tasks|value="task"|data-menu-kind/);
  const shortcuts = buttons(html).filter(item => item.attributes.includes('class="studio-menu-shortcut"'));
  assert.ok(shortcuts.some(item => item.text.startsWith('Architecture research')));
  assert.ok(shortcuts.some(item => item.text.startsWith('Systems experiment')));
  for (const label of ['Forecast', 'Costs']) {
    const shortcut = shortcuts.find(item => item.text.startsWith(label))!;
    assert.match(shortcut.text, /Locked/);
    assert.doesNotMatch(shortcut.text, /Research Enterprise operations/);
    assert.match(shortcut.attributes, /aria-description="Research Enterprise operations/);
  }
  assert.equal(shortcuts.some(item => item.attributes.includes('disabled')), false, 'Locked shortcuts remain inspectable');
  assert.match(html, /class="studio-menu-lock"/);
  const groups = [...html.matchAll(/<details\b([^>]*)>/g)];
  assert.equal(groups.length, STUDIO_MENU_GROUPS.length);
  assert.ok(groups.every(group => !group[1].includes('open=""')));
  assert.equal([...html.matchAll(/<summary>/g)].length, STUDIO_MENU_GROUPS.length);
  assert.equal(shortcuts.length, STUDIO_MENU_ENTRIES.reduce((count, entry) => count + entry.actions.length, 0));
  assert.doesNotMatch(html, /role="dialog"|aria-modal/);
});

test('the current workspace alone starts expanded, including the separate Save utility', () => {
  for (const currentWorkspace of STUDIO_MENU_GROUPS.map(group => group.id)) {
    const html = renderToStaticMarkup(<StudioMenuDirectory currentWorkspace={currentWorkspace} sections={locked} onNavigate={noAction} />);
    const openGroups = [...html.matchAll(/<details\b([^>]*)>/g)].filter(group => group[1].includes('open=""'));
    assert.equal(openGroups.length, 1);
    assert.ok(openGroups[0][1].includes(`data-menu-workspace="${currentWorkspace}"`));
  }
});

test('pending operations disable directory navigation while leaving search and return available', () => {
  const html = renderToStaticMarkup(<StudioMenuDirectory sections={locked} disabled onNavigate={noAction} onClose={noAction} />);
  const entries = buttons(html).filter(item => /class="studio-menu-(?:item|shortcut)"/.test(item.attributes));
  assert.ok(entries.every(item => item.attributes.includes('disabled=""')));
  const close = buttons(html).find(item => item.text === 'Back to work');
  assert.ok(close);
  assert.doesNotMatch(close.attributes, /disabled/);
  assert.doesNotMatch(html.match(/<input[^>]+>/)?.[0] ?? '', /disabled/);
});

test('Research navigation groups architecture under Programs and keeps locked applications inspectable', () => {
  const html = renderToStaticMarkup(<StudioResearchNavigation panel="research" activeTask="architecture-research" sections={locked} disabled={false} onNavigate={noAction} />);
  const entries = buttons(html);
  assert.deepEqual(entries.map(item => item.text.replace(/ — locked$/, '')), ['Discoveries', 'Programs', 'Challenges', 'Applications', 'Synthetic data']);
  assert.equal(getStudioWorkspaceSections('projects').filter(item => item.id === 'model-corpus-compare').length, 1);
  assert.equal(getStudioDestinationForPanel('model-corpus-compare'), 'projects');
  assert.deepEqual(entries.filter(item => item.attributes.includes('aria-pressed="true"')).map(item => item.text), ['Programs']);
  const applications = entries.find(item => item.text.startsWith('Applications'))!;
  assert.match(applications.attributes, /aria-description="Finish a discovery/);
  assert.doesNotMatch(applications.attributes, /disabled/);
  const selected = renderToStaticMarkup(<StudioResearchNavigation panel="applied-research" sections={locked} disabled={false} onNavigate={noAction} />);
  assert.match(text(selected), /Finish a discovery with an upgrade you can build/);
});

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  return React.Children.toArray(node).flatMap(child => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}

// Run the production component's input callbacks and render the resulting tree.
// Browser focus and native disclosure interaction remain part of the live UI check.
function directoryHarness(currentWorkspace: StudioMenuDirectoryProps['currentWorkspace'] = 'operations') {
  const source = new URL('../src/ui/studio-menu-directory.tsx', import.meta.url);
  const requireSource = createRequire(source);
  const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state: unknown[] = [];
  let cursor = 0;
  const hookReact = { ...React, useId: () => 'menu-test', useEffect: () => {}, useRef: () => ({ current: null }),
    useMemo: (factory: () => unknown) => factory(),
    useState: (initial: unknown) => {
      const slot = cursor++;
      if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
      return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    },
  };
  const module = { exports: {} as { StudioMenuDirectory: typeof StudioMenuDirectory } };
  new Function('require', 'module', 'exports', compiled)(
    (name: string) => name === 'react' ? hookReact : requireSource(name), module, module.exports,
  );
  const navigations: StudioMenuTarget[] = [];
  const render = () => {
    cursor = 0;
    return module.exports.StudioMenuDirectory({ currentWorkspace, sections: locked, onNavigate: target => navigations.push(target) });
  };
  const change = (tag: 'input' | 'select', value: string) => {
    const control = elements(render()).find(element => element.type === tag)!;
    (control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  };
  return { render, change, navigations };
}

test('search expands matching groups and preserves exact locked action navigation, then clear restores compact browsing', () => {
  const directory = directoryHarness();
  directory.change('input', 'compute costs');
  let tree = directory.render(), html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /<details\b/);
  const features = elements(tree).filter(element => element.props['data-menu-feature']);
  assert.deepEqual(features.map(element => element.props['data-menu-feature']), ['panel:capacity']);
  const costs = elements(tree).find(element => element.props['data-menu-action'] === 'panel:compute-costs')!;
  assert.equal(costs.props['aria-description'], getStudioPanelLock('compute-costs', locked));
  (costs.props.onClick as () => void)();
  assert.deepEqual(directory.navigations, [{ kind: 'panel', panel: 'compute-costs' }]);
  const clear = elements(tree).find(element => element.props['aria-label'] === 'Clear menu search')!;
  (clear.props.onClick as () => void)();
  tree = directory.render(); html = renderToStaticMarkup(tree);
  assert.equal([...html.matchAll(/<details\b/g)].length, STUDIO_MENU_GROUPS.length);
  assert.equal(elements(tree).filter(element => element.props['data-menu-feature']).length, STUDIO_MENU_ENTRIES.length);
  assert.match(html, /<details[^>]*open=""[^>]*data-menu-workspace="operations"/);
  assert.equal(directory.navigations.length, 1, 'Searching and clearing never navigate or queue anything.');
});

test('workspace filtering exposes its whole group and empty-result recovery restores every destination', () => {
  const directory = directoryHarness('projects');
  directory.change('select', 'research');
  let tree = directory.render(), html = renderToStaticMarkup(tree);
  assert.doesNotMatch(html, /<details\b/);
  assert.deepEqual(elements(tree).filter(element => element.props['data-menu-feature']).map(element => element.props['data-menu-feature']),
    STUDIO_MENU_ENTRIES.filter(entry => entry.workspace === 'research').map(entry => entry.id));
  const architecture = elements(tree).find(element => element.props['data-menu-action'] === 'task:architecture-research')!;
  (architecture.props.onClick as () => void)();
  assert.deepEqual(directory.navigations, [{ kind: 'task', task: 'architecture-research' }]);
  directory.change('input', 'no-such-feature-39751');
  tree = directory.render(); html = renderToStaticMarkup(tree);
  assert.match(text(html), /No matching feature/);
  const reset = elements(tree).find(element => element.type === 'button' && element.props.children === 'Show every feature')!;
  (reset.props.onClick as () => void)();
  tree = directory.render(); html = renderToStaticMarkup(tree);
  assert.equal(elements(tree).filter(element => element.props['data-menu-feature']).length, STUDIO_MENU_ENTRIES.length);
  assert.equal([...html.matchAll(/<details\b/g)].length, STUDIO_MENU_GROUPS.length);
  assert.match(html, /<details[^>]*open=""[^>]*data-menu-workspace="projects"/);
});
