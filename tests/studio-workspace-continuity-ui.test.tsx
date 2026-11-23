import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { CONTENT } from '../src/content/catalog';
import { canonicalStateHash, createInitialState, getGameView } from '../src/core/index';
import { getStudioView } from '../src/core/studio';
import { getStudioDestinationForPanel, getStudioScreenTarget } from '../src/core/studio-navigation';
import type { StudioScreen } from '../src/core/studio-navigation';
import { createStudioTaskSession, getActiveStudioTask, getStudioTaskForPanel, isStudioPanelId,
  resolveStudioIntent, STUDIO_TASKS, studioTaskReducer } from '../src/core/studio-tasks';
import type { StudioPanelId, StudioReturnTarget, StudioTaskEvent } from '../src/core/studio-tasks';
import { getGameSectionVisibility } from '../src/ui/guide-links';
import { developmentPlanCounts } from '../src/ui/development-plans-panel';
import { getStudioPanelLock } from '../src/ui/studio-navigation';
import { StudioShell } from '../src/ui/studio-shell';

const source = readFileSync(new URL('../src/ui/studio-shell.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('studio-shell.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compiled = new Map<string, string>();
const noGameAction = () => assert.fail('Workspace navigation must not queue work, advance time or apply a resource plan');

function callbackSource(name: string): string {
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expression = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(tree);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `Missing production callback ${name}`);
  return expression;
}

function jsxSource(tag: string, prop: string, matches: (node: ts.JsxOpeningLikeElement) => boolean = () => true): string {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === tag && matches(node)) {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === prop);
      if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
        found.push(attribute.initializer.expression.getText(tree));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(found.length, 1, `Expected one production ${tag}.${prop} binding`);
  return found[0];
}

function bind(expression: string, closure: Record<string, unknown>): (...args: unknown[]) => unknown {
  let js = compiled.get(expression);
  if (!js) {
    js = ts.transpileModule('const callback = ' + expression + ';', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    compiled.set(expression, js);
  }
  return new Function(...Object.keys(closure), js + '\nreturn callback;')(...Object.values(closure));
}

// Execute production callbacks and JSX event bindings with the real task reducer.
// Explicit remember() calls model the navigation effect after a committed render;
// this does not mount React, test browser focus, or verify retained form field DOM.
function navigationHarness() {
  const game = createInitialState();
  const before = canonicalStateHash(game);
  const state = {
    screen: 'studio' as StudioScreen, panel: null as StudioPanelId | null, projectTab: 'work' as 'work' | 'plan',
    plannerEpoch: 4, taskSession: createStudioTaskSession(4), menusOpen: false, resultsOpen: false,
    forceSaveOpen: false, busy: false, pauses: 0,
  };
  const workspaceVisits = { current: { epoch: state.plannerEpoch, targets: {} as Partial<Record<StudioScreen, StudioReturnTarget>> } };
  const refs: Record<string, { current: unknown }> = Object.fromEntries([
    'inFlight', 'menuReturnFocusRef', 'returnFocusRef', 'taskReturnFocusRef', 'inspectorRef', 'shellRef',
  ].map(name => [name, { current: null }]));
  const focusRequested = { current: false }, nextIntentId = { current: 1 };
  const focused: string[] = [];
  class FocusTarget {
    isConnected = true;
    getClientRects() { return [1]; }
    focus() { focused.push('menu-origin'); }
  }
  const activeElement = new FocusTarget();
  const document = {
    activeElement,
    querySelector: (selector: string) => ({ focus: () => focused.push(selector) }),
    getElementById: (id: string) => ({ focus: () => focused.push('#' + id) }),
  };
  const dispatch = (event: StudioTaskEvent) => { state.taskSession = studioTaskReducer(state.taskSession, event); };
  const methods = ['rememberWorkspaceSection', 'selectWorkspace', 'selectScreen', 'openPanel', 'openMenus', 'closeMenus',
    'navigateMenuTarget', 'openPlannerWithContext', 'openTask', 'openNamedTask', 'openResultTask', 'revealClassicPanel',
    'taskForPanel', 'applyReturnTarget', 'closeTask'];
  const functions = Object.fromEntries(methods.map(name => [name, (...args: unknown[]) => invoke(name, ...args)]));
  const ignore = () => {};
  const setters = Object.fromEntries(['ResultActionError', 'CommandError', 'InspectedProjectId', 'NavigationMessage', 'ProjectFilter',
    'PlannerContext', 'ProgramSelection', 'ResearchSelection', 'StaffingSelection', 'DataSelection', 'TrainingSelection',
    'ModelSelection', 'LaunchSelection', 'JourneyFocus'].map(name => ['set' + name, ignore]));
  function closure(extra: Record<string, unknown> = {}) {
    return {
      ...state, ...refs, ...functions, ...setters, game, mode: 'studio', CONTENT, STUDIO_TASKS,
      task: state.taskSession.companyEpoch === state.plannerEpoch ? getActiveStudioTask(state.taskSession) : null,
      sections: getGameSectionVisibility(game, getGameView(game, CONTENT)), workspaceVisits, focusRequested, nextIntentId,
      dispatchTask: dispatch, getStudioScreenTarget, getStudioDestinationForPanel, isStudioPanelId, getStudioPanelLock,
      getStudioTaskForPanel, resolveStudioIntent, developmentPlanCounts, document, HTMLElement: FocusTarget,
      requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, window: { scrollTo: ignore },
      setScreen: (value: StudioScreen) => { state.screen = value; },
      setPanel: (value: StudioPanelId | null) => { state.panel = value; },
      setProjectTab: (value: 'work' | 'plan') => { state.projectTab = value; },
      setMenusOpen: (value: boolean) => { state.menusOpen = value; },
      setResultsOpen: (value: boolean) => { state.resultsOpen = value; },
      onPause: () => { state.pauses++; }, onQueue: noGameAction, onStep: noGameAction, onApplyPlan: noGameAction,
      showUnavailableTarget: (reason: string) => assert.fail(reason), ...extra,
    };
  }
  function invoke(name: string, ...args: unknown[]) { return bind(callbackSource(name), closure())(...args); }
  const remember = () => invoke('rememberWorkspaceSection');
  const jsx = (tag: string, prop: string, args: unknown[], matches?: (node: ts.JsxOpeningLikeElement) => boolean, extra?: Record<string, unknown>) =>
    bind(jsxSource(tag, prop, matches), closure(extra))(...args);
  const sidebar = (screen: StudioScreen) => jsx('StudioNavigation', 'onSelect', [screen]);
  const route = () => ({ screen: state.screen, panel: state.panel, projectTab: state.projectTab });
  const unchanged = () => assert.equal(canonicalStateHash(game), before);
  return { game, state, workspaceVisits, focused, activeElement, invoke, remember, sidebar, jsx, route, dispatch, unchanged };
}

test('sidebar round trips restore independent regular sections, including canonical screen aliases', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  ui.sidebar('company'); ui.invoke('openPanel', 'company-log'); ui.remember();
  ui.sidebar('research'); ui.invoke('openPanel', 'research-programs'); ui.remember();
  ui.sidebar('projects');
  assert.deepEqual(ui.route(), { screen: 'projects', panel: 'data', projectTab: 'work' });
  ui.sidebar('finance');
  assert.deepEqual(ui.route(), { screen: 'company', panel: 'company-log', projectTab: 'work' });
  ui.sidebar('research');
  assert.deepEqual(ui.route(), { screen: 'research', panel: 'research-programs', projectTab: 'work' });
  assert.equal(ui.state.pauses, 0);
  assert.equal(getActiveStudioTask(ui.state.taskSession), null);
  ui.unchanged();
});

test('named editing and review surfaces never replace a workspace return target or reopen automatically', () => {
  for (const review of [false, true]) {
    const ui = navigationHarness();
    ui.invoke('openPanel', 'data'); ui.remember();
    ui.invoke('openTask', 'train-model');
    const draft = getActiveStudioTask(ui.state.taskSession)!;
    if (review) ui.dispatch({ type: 'review', sourceRevision: 1, payload: { kind: 'set_cloud_capacity', cu: 0 } });
    ui.remember();
    assert.equal(ui.workspaceVisits.current.targets.projects?.panel, 'data');
    ui.sidebar('company'); ui.remember(); ui.sidebar('projects'); ui.remember();
    assert.equal(ui.state.panel, 'data');
    assert.equal(getActiveStudioTask(ui.state.taskSession), null);
    const retained = ui.state.taskSession.tasks['lab-projects']!;
    assert.equal(retained.instanceId, draft.instanceId);
    assert.equal(retained.draftGeneration, draft.draftGeneration);
    assert.equal(retained.review, null, 'Leaving a review retires its captured submission.');
    assert.equal(ui.state.pauses, 1, 'A workspace return does not re-enter the named task.');
    ui.invoke('openTask', 'train-model');
    assert.equal(getActiveStudioTask(ui.state.taskSession)?.instanceId, draft.instanceId);
    assert.equal(ui.state.pauses, 2, 'Explicit Continue retains its ordinary pause behavior.');
    ui.unchanged();
  }
});

test('a first visit made through a named task falls back to the ordinary workspace instead of the task', () => {
  const ui = navigationHarness();
  ui.invoke('openTask', 'train-model'); ui.remember();
  assert.equal(ui.workspaceVisits.current.targets.projects, undefined);
  ui.sidebar('company'); ui.remember(); ui.sidebar('projects');
  assert.deepEqual(ui.route(), { screen: 'projects', panel: null, projectTab: 'work' });
  assert.equal(getActiveStudioTask(ui.state.taskSession), null);
  ui.unchanged();
});

test('workspace history is usable in the same company epoch and rejected immediately in a new epoch', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  ui.invoke('openPanel', 'research-programs'); ui.remember();
  ui.sidebar('projects');
  assert.equal(ui.state.panel, 'data');
  ui.state.plannerEpoch++;
  ui.sidebar('research');
  assert.equal(ui.state.panel, null, 'The sidebar rejects prior-company history even before the effect runs.');
  ui.remember();
  assert.equal(ui.workspaceVisits.current.epoch, ui.state.plannerEpoch);
  assert.deepEqual(ui.workspaceVisits.current.targets, {});
  ui.sidebar('projects');
  assert.equal(ui.state.panel, null);
  ui.invoke('openPanel', 'models'); ui.remember();
  ui.sidebar('company'); ui.remember(); ui.sidebar('projects');
  assert.equal(ui.state.panel, 'models', 'The new company can establish its own independent history.');
  ui.unchanged();
});

test('explicit All menus screens, Work queue and brand remain exact despite remembered sections', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  ui.invoke('openPanel', 'research-programs'); ui.remember();
  ui.invoke('openMenus');
  ui.jsx('StudioMenuDirectory', 'onNavigate', [{ kind: 'screen', screen: 'projects' }]);
  assert.deepEqual(ui.route(), { screen: 'projects', panel: null, projectTab: 'work' });
  assert.equal(ui.state.menusOpen, false);
  ui.jsx('StudioMenuDirectory', 'onNavigate', [{ kind: 'screen', screen: 'research' }]);
  assert.deepEqual(ui.route(), { screen: 'research', panel: null, projectTab: 'work' });
  ui.jsx('StudioMenuDirectory', 'onNavigate', [{ kind: 'panel', panel: 'models' }]);
  assert.equal(ui.state.panel, 'models');
  ui.jsx('StudioWorkspaceHeader', 'onSelect', ['work']);
  assert.deepEqual(ui.route(), { screen: 'projects', panel: null, projectTab: 'work' });
  ui.jsx('button', 'onClick', [], node => node.getText(tree).includes('className="studio-brand"'));
  assert.deepEqual(ui.route(), { screen: 'studio', panel: null, projectTab: 'work' });
  assert.equal(ui.state.pauses, 0);
  assert.equal(getActiveStudioTask(ui.state.taskSession), null);
  ui.unchanged();
});

test('capacity returns as its retained resource page with pause, draft identity and planner focus', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  ui.invoke('openPlannerWithContext'); ui.remember();
  ui.dispatch({ type: 'resetDraft', owner: 'planner' });
  const planner = getActiveStudioTask(ui.state.taskSession)!;
  ui.sidebar('company'); ui.remember();
  ui.sidebar('operations');
  assert.deepEqual(ui.route(), { screen: 'operations', panel: 'capacity', projectTab: 'work' });
  const returned = getActiveStudioTask(ui.state.taskSession)!;
  assert.equal(returned.task, 'plan-week');
  assert.equal(returned.owner, 'planner');
  assert.equal(returned.instanceId, planner.instanceId);
  assert.equal(returned.draftGeneration, planner.draftGeneration);
  assert.deepEqual(returned.returnTo, { screen: 'operations', panel: 'people' });
  assert.equal(ui.state.taskSession.detour, null);
  assert.equal(ui.state.pauses, 2);
  assert.equal(ui.focused.at(-1), '#studio-plan-workbench');
  ui.unchanged();
});

test('returning to capacity after a task detour does not revive the parent review or its return link', () => {
  const ui = navigationHarness();
  ui.invoke('openTask', 'train-model');
  ui.dispatch({ type: 'review', sourceRevision: 1, payload: { kind: 'set_cloud_capacity', cu: 0 } });
  ui.invoke('openPlannerWithContext'); ui.remember();
  assert.equal(ui.state.taskSession.detour?.owner, 'lab-projects');
  ui.sidebar('company'); ui.remember(); ui.sidebar('operations');
  assert.equal(getActiveStudioTask(ui.state.taskSession)?.owner, 'planner');
  assert.equal(ui.state.taskSession.detour, null);
  assert.equal(ui.state.taskSession.tasks['lab-projects']?.phase, 'editing');
  assert.equal(ui.state.taskSession.tasks['lab-projects']?.review, null);
  assert.equal(ui.state.panel, 'capacity');
  ui.unchanged();
});

test('opening and closing read-only All menus leaves the clock and current regular section alone', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  const visits = structuredClone(ui.workspaceVisits.current);
  ui.state.resultsOpen = true;
  ui.invoke('openMenus'); ui.remember();
  assert.equal(ui.state.menusOpen, true);
  assert.equal(ui.state.resultsOpen, false);
  assert.equal(ui.state.panel, 'data');
  assert.deepEqual(ui.workspaceVisits.current, visits);
  ui.invoke('closeMenus'); ui.remember();
  assert.equal(ui.state.menusOpen, false);
  assert.equal(ui.state.pauses, 0);
  assert.equal(ui.focused.at(-1), 'menu-origin');
  assert.deepEqual(ui.workspaceVisits.current, visits);
  ui.unchanged();
});

test('forced save and submitting task guards still prevent sidebar restoration or menu opening', () => {
  const ui = navigationHarness();
  ui.invoke('openPanel', 'data'); ui.remember();
  ui.invoke('openTask', 'train-model');
  const active = getActiveStudioTask(ui.state.taskSession)!;
  ui.state.taskSession = { ...ui.state.taskSession, tasks: { ...ui.state.taskSession.tasks,
    [active.owner]: { ...active, phase: 'submitting' } } };
  const route = ui.route(), session = ui.state.taskSession;
  ui.sidebar('projects'); ui.invoke('openMenus');
  assert.deepEqual(ui.route(), route);
  assert.equal(ui.state.taskSession, session);
  assert.equal(ui.state.menusOpen, false);
  ui.state.taskSession = createStudioTaskSession(ui.state.plannerEpoch);
  ui.state.forceSaveOpen = true;
  ui.sidebar('projects'); ui.invoke('openMenus');
  assert.deepEqual(ui.route(), route);
  assert.equal(ui.state.menusOpen, false);
  ui.unchanged();
});

test('room workstation controls render as direct buttons and open their exact ordinary workbench', () => {
  const ui = navigationHarness();
  const html = renderToStaticMarkup(<StudioShell game={ui.game} paused={false} speed={1} canAct isController
    notice="" saveMessage="" forceSaveOpen={false} plannerEpoch={4} onToggleRunning={noGameAction}
    onStep={noGameAction} onSpeed={noGameAction} onPause={noGameAction} onQueue={noGameAction}
    onApplyPlan={noGameAction}><p>Retained workbenches</p></StudioShell>);
  const stationButtons = [...html.matchAll(/<button\b([^>]*class="studio-hotspot[^>]*)>/g)];
  const stations = getStudioView(ui.game, CONTENT).stations;
  assert.equal(stationButtons.length, stations.length);
  assert.ok(stationButtons.every(match => /aria-label="Open /.test(match[1])));
  assert.ok(stationButtons.every(match => !/aria-haspopup|aria-expanded/.test(match[1])));
  assert.doesNotMatch(html, /role="dialog"/);
  for (const item of stations) {
    ui.jsx('button', 'onClick', [], node => node.getText(tree).includes("'studio-hotspot status-'"), { item });
    assert.equal(ui.state.panel, item.targetPanel);
    assert.equal(ui.state.screen, getStudioDestinationForPanel(item.targetPanel));
    assert.equal(getActiveStudioTask(ui.state.taskSession), null);
  }
  assert.equal(ui.state.pauses, 0);
  ui.unchanged();
});
