import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { advanceWeek, createInitialState } from '../src/core/engine';
import { SnapshotTooLargeError } from '../src/core/snapshot';
import { CONTENT } from '../src/content/catalog';
import { readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes, browserRecoveryOptions } from '../src/persistence/wave0-browser';

// Execute the component's real lifecycle callbacks with browser storage and live
// refs. This catches missing wiring/guards without replacing the save logic with
// a second implementation in a test fixture.
const source = readFileSync(new URL('../src/ui/FrontierLab.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('FrontierLab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function bindCallback(name: string, closure: Record<string, unknown>): (...args: unknown[]) => unknown {
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expression = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(tree);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.ok(expression, `Missing production callback ${name}`);
  const js = ts.transpileModule('const callback = ' + expression + ';', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return new Function(...Object.keys(closure), js + '\nreturn callback;')(...Object.values(closure));
}

function session(t: TestContext) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  let unavailable = false;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (unavailable) throw new DOMException('Storage unavailable', 'SecurityError');
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const bindings: string[] = [], notices: string[] = [];
  const status = { kind: 'saved', message: '' };
  const runningRef = { current: false };
  let paused = true;
  const closure = {
    readyRef: { current: true }, sessionRef: { current: 'owner' }, writeBlockedRef: { current: false }, saveFailedRef: { current: false },
    choosingOriginRef: { current: true }, transferRef: { current: false }, decisionRunRef: { current: null },
    taskGateRef: { current: { busy: false, cancel: () => false } },
    gameRef: { current: createInitialState(CONTENT, 'release') },
    writeBrowserSnapshotWithBytes, browserRecoveryOptions,
    saveResultsBinding: (bytes: string) => bindings.push(bytes),
    saveModelWorkspace: (bytes: string) => bindings.push(bytes),
    setSaveStatus: (next: typeof status) => Object.assign(status, next),
    setRecoveries: () => {},
    pause: (notice?: string) => { runningRef.current = false; paused = true; if (notice) notices.push(notice); },
    runningRef, document: { hidden: true }, operationKindRef: { current: null },
    setBusyMessage: () => {}, clock: { reset: () => {} }, performance,
    canAct: true, saveStatus: status, setError: () => {},
    clockRef: { current: { reset: () => {}, setPaused: (value: boolean) => { paused = value; } } },
    setPaused: (value: boolean) => { paused = value; }, setNotice: (notice: string) => notices.push(notice),
  };
  const persist = bindCallback('persistCurrentGame', closure);
  return {
    closure, storage, bindings, status, notices, persist,
    commit: bindCallback('commit', { ...closure, observeResults: () => {}, setGame: () => {}, setDiagnostics: () => {} }),
    hide: bindCallback('onVisibility', { ...closure, persistCurrentGame: persist }),
    toggle: bindCallback('toggleRunning', { ...closure, persistCurrentGame: persist }),
    unavailable: (value: boolean) => { unavailable = value; },
    paused: () => paused,
  };
}

test('an unstarted origin picker stays unsaved when the page is hidden; a started origin can persist', t => {
  const s = session(t);
  assert.equal(readBrowserSnapshotWithBytes().kind, 'empty');
  s.hide();
  assert.equal(readBrowserSnapshotWithBytes().kind, 'empty');
  assert.equal(s.bindings.length, 0);
  s.closure.gameRef.current = createInitialState(CONTENT, 'release', 'consultancy');
  s.closure.choosingOriginRef.current = false;
  s.hide();
  const loaded = readBrowserSnapshotWithBytes();
  assert.equal(loaded.kind, 'loaded');
  if (loaded.kind === 'loaded') assert.deepEqual(loaded.state, s.closure.gameRef.current);
  assert.equal(s.bindings.length, 2);
  assert.equal(s.bindings[0], s.storage.getItem('frontier-lab.wave0.snapshot'));
  assert.equal(s.bindings[1], s.bindings[0]);
});

test('failed autosave pauses play, cannot resume through a failed retry, and can resume after saving recovers', t => {
  const s = session(t);
  s.closure.choosingOriginRef.current = false;
  s.persist();
  const previous = s.storage.getItem('frontier-lab.wave0.snapshot');
  const advanced = advanceWeek(s.closure.gameRef.current);
  assert.equal(advanced.accepted, true);
  s.closure.gameRef.current = advanced.state;
  s.closure.runningRef.current = true;
  s.unavailable(true);
  s.persist();
  assert.equal(s.paused(), true);
  assert.equal(s.closure.runningRef.current, false);
  assert.equal(s.status.kind, 'failed');
  assert.match(s.notices.at(-1)!, /paused.*Download your save/);
  assert.equal(s.storage.getItem('frontier-lab.wave0.snapshot'), previous);
  assert.equal(s.bindings.length, 2, 'failed writes must not bind sidecars to unsaved bytes');
  s.commit(advanced.state);
  assert.equal(s.status.kind, 'failed', 'Queueing a plan must not clear the failed-save warning.');
  s.toggle();
  assert.equal(s.closure.runningRef.current, false);
  const step = bindCallback('step', { ...s.closure, persistCurrentGame: s.persist,
    runPaintTask: () => assert.fail('Manual stepping cannot bypass a failed save.'),
    advanceWeek: () => assert.fail('Unsaved progress must remain paused until saving succeeds.') });
  step(true);
  assert.equal(s.closure.runningRef.current, false);
  s.unavailable(false);
  s.toggle();
  assert.equal(s.status.kind, 'saved');
  assert.equal(s.closure.runningRef.current, true);
  assert.equal(s.paused(), false);
});

test('lifecycle saves cannot overwrite another session, a blocked original, or a busy transfer', t => {
  const s = session(t);
  s.closure.choosingOriginRef.current = false;
  for (const mode of ['observer', 'memory', 'acquiring']) {
    s.closure.sessionRef.current = mode;
    s.persist();
    assert.equal(readBrowserSnapshotWithBytes().kind, 'empty');
  }
  s.closure.sessionRef.current = 'owner';
  s.closure.writeBlockedRef.current = true;
  s.persist();
  assert.equal(s.storage.length, 0);
  s.closure.writeBlockedRef.current = false;
  s.closure.transferRef.current = true;
  s.persist();
  assert.equal(s.storage.length, 0);
  s.closure.transferRef.current = false;
  s.closure.taskGateRef.current.busy = true;
  s.persist();
  assert.equal(s.storage.length, 0);
});

test('a delayed autosave from a replaced campaign cannot write or rebind stale state', t => {
  const s = session(t);
  s.closure.choosingOriginRef.current = false;
  const old = s.closure.gameRef.current;
  s.closure.gameRef.current = createInitialState(CONTENT, 'release', 'consultancy');
  s.persist(old);
  assert.equal(s.storage.length, 0);
  assert.equal(s.bindings.length, 0);
  s.persist(s.closure.gameRef.current);
  assert.equal(readBrowserSnapshotWithBytes().kind, 'loaded');
});

test('a weekly result outside supported save capacity is not committed', t => {
  const s = session(t);
  s.closure.choosingOriginRef.current = false;
  s.closure.runningRef.current = true;
  const previous = s.closure.gameRef.current;
  let message = '';
  const step = bindCallback('step', {
    ...s.closure, CONTENT, advanceWeek, SnapshotTooLargeError, persistCurrentGame: s.persist,
    assertSnapshotCapacity: () => { throw new SnapshotTooLargeError(); },
    setError: (value: string) => { message = value; },
    commit: () => assert.fail('The unsaveable weekly result must not replace the current game.'),
    runPaintTask: (_kind: string, _message: string, operation: (state: typeof previous) => void) => operation(previous),
  });
  step();
  assert.equal(s.closure.gameRef.current, previous);
  assert.equal(s.closure.runningRef.current, false);
  assert.match(message, /remains at Week 0.*download this save/);
});

test('portable replacement blocks competing replacements while workspace binding is pending', async t => {
  const s = session(t), next = createInitialState(CONTENT, 'release', 'consultancy');
  let finish!: (result: boolean) => void, committed = 0;
  const wait = new Promise<boolean>(resolve => { finish = resolve; });
  const replace = bindCallback('replaceRun', { ...s.closure, isController: true,
    setTransferBusy: () => {}, replaceResultsTimeline: () => {}, replaceModelWorkspace: () => {},
    restoreModelWorkspace: () => wait,
    commit: (value: typeof next) => { committed++; s.closure.gameRef.current = value; },
    setPanelEpoch: () => {}, setWriteBlocked: () => {}, setChoosingOrigin: () => {}, setPendingImport: () => {},
    setResetOpen: () => {}, setDecisionStop: () => {}, setMigrationNotice: () => {},
  });
  const pending = replace(next, 'Imported', undefined, { manual: null, delegated: null, blueprints: [] });
  assert.equal(s.closure.transferRef.current, true);
  await replace(createInitialState(), 'Must not replace');
  assert.equal(committed, 0);
  finish(true); await pending;
  assert.equal(committed, 1); assert.equal(s.closure.gameRef.current, next);
  assert.equal(s.closure.transferRef.current, false);
});

test('a delayed imported workspace cannot complete after its session is cleaned up', async t => {
  const s = session(t), next = createInitialState(CONTENT, 'release', 'consultancy');
  let finish!: (result: boolean) => void;
  const wait = new Promise<boolean>(resolve => { finish = resolve; });
  const replace = bindCallback('replaceRun', { ...s.closure, isController: true,
    setTransferBusy: () => {}, replaceResultsTimeline: () => {}, replaceModelWorkspace: () => {}, restoreModelWorkspace: () => wait,
    commit: () => assert.fail('A cleaned-up session cannot commit an imported company'),
  });
  const pending = replace(next, 'Imported', undefined, { manual: null, delegated: null, blueprints: [] });
  s.closure.readyRef.current = false;
  finish(true); await pending;
  assert.notEqual(s.closure.gameRef.current, next);
  assert.equal(s.closure.transferRef.current, false);
});
