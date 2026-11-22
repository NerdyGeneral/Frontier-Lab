import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { advanceWeek, createInitialState, submitCommand } from '../src/core/engine';
import { SnapshotTooLargeError, serializeState } from '../src/core/snapshot';
import { canonicalStateHash } from '../src/core/canonical';
import type { GameState } from '../src/contracts/types';
import { CONTENT } from '../src/content/catalog';
import { DEFAULT_DECISION_CLOCK_POLICY, decisionStartGuard } from '../src/core/decision-clock';
import type { DecisionClockPolicy, DecisionStop } from '../src/core/decision-clock';
import { readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes, browserRecoveryOptions, browserSnapshotMatches, readBrowserRecovery, RecoveryArchiveError } from '../src/persistence/wave0-browser';
import { deserializePortableSave } from '../src/persistence/portable-save';
import { MODEL_WORKSPACE_KEY, ModelWorkspaceController, modelWorkspaceDataForExport, parseModelWorkspace } from '../src/persistence/model-workspace';
import type { ModelWorkspaceData } from '../src/persistence/model-workspace';
import { hashSavedSnapshotSync } from '../src/persistence/saved-snapshot-hash';
import { DEFAULT_MODEL_DESIGN } from '../src/modules/model-design';
import { withPassiveWorkforce } from '../src/modules/workforce';

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

test('Next decision adopts guarded stop rules during continuous play and its stop control pauses the run', t => {
  const s = session(t);
  const decisionRunRef: { current: { policy: DecisionClockPolicy; startedWeek: number } | null } = { current: null };
  let active = false;
  let stop: DecisionStop | null = null;
  const closure = {
    ...s.closure, CONTENT, decisionPolicy: { ...DEFAULT_DECISION_CLOCK_POLICY }, decisionStartGuard,
    decisionRunRef, setDecisionRunActive: (value: boolean) => { active = value; },
    setDecisionStop: (value: DecisionStop | null) => { stop = value; },
    toggleRunning: s.toggle,
  };
  const pause = bindCallback('pause', closure);
  const run = bindCallback('runToDecision', { ...closure, pause });
  s.toggle();
  assert.equal(s.closure.runningRef.current, true);
  assert.equal(active, false);
  run();
  assert.equal(s.closure.runningRef.current, true, 'Continuous play must stay running when adopting stop rules.');
  assert.equal(s.paused(), false);
  assert.equal(active, true);
  assert.deepEqual(decisionRunRef.current, { policy: closure.decisionPolicy, startedWeek: s.closure.gameRef.current.week });
  assert.equal(stop, null);
  assert.equal(s.closure.gameRef.current.week, 0, 'Changing clock mode does not itself advance the simulation.');
  run();
  assert.equal(active, false);
  assert.equal(decisionRunRef.current, null);
  assert.equal(s.closure.runningRef.current, false);
  assert.equal(s.paused(), true);

  s.toggle();
  closure.decisionPolicy.cashReserveCents = s.closure.gameRef.current.slices.company.companies[s.closure.gameRef.current.playerCompanyId].cashCents;
  run();
  assert.equal(s.closure.runningRef.current, false, 'An unsafe decision run must still stop continuous play.');
  assert.equal(active, false);
  assert.ok(stop);
});

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
    modelWorkspace: { ready: false }, persistCurrentGame: s.persist,
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
    modelWorkspace: { ready: false }, persistCurrentGame: s.persist,
    setTransferBusy: () => {}, replaceResultsTimeline: () => {}, replaceModelWorkspace: () => {}, restoreModelWorkspace: () => wait,
    commit: () => assert.fail('A cleaned-up session cannot commit an imported company'),
  });
  const pending = replace(next, 'Imported', undefined, { manual: null, delegated: null, blueprints: [] });
  s.closure.readyRef.current = false;
  finish(true); await pending;
  assert.notEqual(s.closure.gameRef.current, next);
  assert.equal(s.closure.transferRef.current, false);
});

async function recoverySession(t: TestContext) {
  const s = session(t), noAction = () => {};
  const queued = submitCommand(s.closure.gameRef.current, { kind: 'prepare_data', packetId: CONTENT.starterData.id }, CONTENT, 'recovery-paid-data');
  assert.ok(queued.accepted, queued.reason?.message);
  const advanced = advanceWeek(queued.state); assert.ok(advanced.accepted, advanced.reason?.message);
  const hire = submitCommand(advanced.state, { kind: 'hire_staff', role: 'ml' }, CONTENT, 'recovery-queued-hire');
  assert.ok(hire.accepted, hire.reason?.message);
  const original = hire.state;
  s.closure.gameRef.current = original;
  s.closure.choosingOriginRef.current = false;
  const written = writeBrowserSnapshotWithBytes(original); assert.ok(written.ok, written.ok ? undefined : written.error);
  let token = 0;
  const controller = new ModelWorkspaceController({
    read: () => s.storage.getItem(MODEL_WORKSPACE_KEY), write: bytes => s.storage.setItem(MODEL_WORKSPACE_KEY, bytes), remove: () => s.storage.removeItem(MODEL_WORKSPACE_KEY),
    snapshotMatches: browserSnapshotMatches, hash: async bytes => hashSavedSnapshotSync(bytes), hashSync: hashSavedSnapshotSync,
    token: () => (++token).toString(16).padStart(32, '0'),
  });
  const training = { kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id, recipeId: CONTENT.firstTraining.id, profile: 'balanced' as const };
  const workspace: ModelWorkspaceData = {
    manual: { recipeId: CONTENT.firstTraining.id, designRoute: 'methods', designDraft: null,
      baseId: CONTENT.seedModel.id, packetId: CONTENT.starterData.id, explicitPacket: true, extraPackets: [], profile: 'balanced', workspace: '',
      automated: false, asAdapter: false, retentionMode: 'none', replayChoice: { domain: 'coding', shareBps: 5000, packetIds: [] },
      curriculumChoice: { shareBps: 5000, tracks: [{ domain: 'documents', packetIds: [] }, { domain: 'coding', packetIds: [] }] },
      architecture: 'dense', teacherId: '', teacherDomain: 'conversation', trainingView: 'advanced', designOpen: true },
    delegated: { name: 'Saved project draft', baseId: CONTENT.seedModel.id, selected: [CONTENT.starterData.id], method: CONTENT.firstTraining.id, profile: 'balanced',
      teacherId: '', teacherDomain: 'conversation', design: structuredClone(DEFAULT_MODEL_DESIGN), suiteId: 'basic-conversation-1',
      budget: '5000.', reserve: '', duration: '32', importedTraining: training, leadStaffId: 'founder', capacityShareBps: 10000 },
    blueprints: [{ id: 'recovery-blueprint', name: 'Saved coding design', training, suiteId: 'basic-conversation-1', objective: { kind: 'purpose', id: 'coding' } }],
    developmentGoal: { kind: 'purpose', id: 'coding' },
  };
  controller.open({ playerId: original.playerCompanyId, mode: 'owner', savedBytes: written.savedBytes });
  assert.equal(await controller.restoreData(workspace), true);
  assert.equal(controller.getSnapshot().persistent, true);
  const persist = bindCallback('persistCurrentGame', { ...s.closure, saveModelWorkspace: controller.saved });
  let pending: { state: GameState; workspace?: ModelWorkspaceData; migratedFrom?: number; recovery?: boolean } | null = null;
  let error = '', resets = 0, commits = 0;
  const callbacks = {
    ...s.closure, CONTENT, isController: true, readBrowserRecovery, deserializePortableSave, withPassiveWorkforce, RecoveryArchiveError,
    setTransferBusy: noAction, replaceResultsTimeline: noAction,
    replaceModelWorkspace: ({ game, mode, savedBytes }: { game: GameState; mode: 'owner' | 'memory'; savedBytes?: string }) => {
      resets++; controller.replace({ playerId: game.playerCompanyId, mode, savedBytes });
    },
    restoreModelWorkspace: controller.restoreData,
    commit: (game: GameState) => { commits++; s.closure.gameRef.current = game; },
    setPanelEpoch: noAction, setWriteBlocked: noAction, setChoosingOrigin: noAction,
    setPendingImport: (value: typeof pending) => { pending = value; }, setResetOpen: noAction,
    setDecisionStop: noAction, setMigrationNotice: noAction, setError: (value: string) => { error = value; },
  };
  return { ...s, original, workspace, controller,
    replace: (...args: unknown[]) => bindCallback('replaceRun', { ...callbacks, modelWorkspace: controller.getSnapshot(), persistCurrentGame: persist })(...args),
    review: bindCallback('reviewRecovery', callbacks),
    pending: () => pending, error: () => error, resets: () => resets, commits: () => commits,
  };
}

test('previous-run review and restore retain paid work, queued decisions and the exact planning workspace', async t => {
  const s = await recoverySession(t), hash = canonicalStateHash(s.original);
  const replacement = createInitialState(CONTENT, 'release', 'consultancy');
  await s.replace(replacement, 'New campaign');
  const copy = readBrowserRecovery('previous'); assert.ok(copy);
  const portable = deserializePortableSave(copy.text); assert.ok(portable.ok, portable.ok ? undefined : portable.error);
  assert.deepEqual(portable.workspace, s.workspace);
  assert.equal(canonicalStateHash(portable.state), hash);
  s.review('previous');
  const reviewed = s.pending(); assert.ok(reviewed);
  assert.equal(reviewed.recovery, true);
  assert.deepEqual(reviewed.workspace, s.workspace);
  assert.equal(s.closure.gameRef.current, replacement, 'Reviewing a backup does not replace the running company.');
  await s.replace(reviewed.state, 'Previous run restored', reviewed.migratedFrom, reviewed.workspace);
  assert.equal(canonicalStateHash(s.closure.gameRef.current), hash);
  assert.deepEqual(s.closure.gameRef.current.queuedCommands, s.original.queuedCommands);
  assert.deepEqual(modelWorkspaceDataForExport(s.controller.getSnapshot()), s.workspace);
  const restored = readBrowserSnapshotWithBytes(); assert.equal(restored.kind, 'loaded');
  if (restored.kind !== 'loaded') return;
  assert.deepEqual(parseModelWorkspace(s.storage.getItem(MODEL_WORKSPACE_KEY))?.binding, hashSavedSnapshotSync(restored.savedBytes));
  assert.equal(s.error(), ''); assert.equal(s.commits(), 2);
});

test('previous-run review accepts historical engine-only backups without borrowing current drafts', async t => {
  const s = await recoverySession(t);
  s.storage.setItem('frontier-lab.previous.snapshot', serializeState(s.original));
  s.review('previous');
  const reviewed = s.pending(); assert.ok(reviewed);
  assert.equal(reviewed.workspace, undefined);
  await s.replace(reviewed.state, 'Historical backup restored', reviewed.migratedFrom, reviewed.workspace);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(canonicalStateHash(s.closure.gameRef.current), canonicalStateHash(s.original));
  assert.equal(s.controller.getSnapshot().manual, null);
  assert.equal(s.controller.getSnapshot().delegated, null);
  assert.deepEqual(s.controller.getSnapshot().blueprints, []);
  assert.equal(s.error(), '');
});

test('replacement backs up the latest live planning edits even when their browser sidecar cannot be written', async t => {
  const s = await recoverySession(t), write = s.storage.setItem;
  const storedWorkspace = s.storage.getItem(MODEL_WORKSPACE_KEY);
  s.storage.setItem = (key, value) => {
    if (key === MODEL_WORKSPACE_KEY) throw new Error('Planning sidecar storage is unavailable');
    write(key, value);
  };
  s.controller.setDraft('delegated', { ...s.workspace.delegated!, name: 'Immediate unsaved project', budget: '7300.' });
  s.controller.setDevelopmentGoal({ kind: 'purpose', id: 'analyst' });
  const latest = modelWorkspaceDataForExport(s.controller.getSnapshot());
  assert.equal(s.controller.getSnapshot().persistent, false);
  assert.equal(s.storage.getItem(MODEL_WORKSPACE_KEY), storedWorkspace, 'The browser still has the older planning sidecar.');
  await s.replace(createInitialState(CONTENT, 'release', 'consultancy'), 'New campaign');
  assert.equal(s.commits(), 1);
  const copy = readBrowserRecovery('previous'); assert.ok(copy);
  const backedUp = deserializePortableSave(copy.text); assert.ok(backedUp.ok);
  assert.deepEqual(backedUp.workspace, latest);
  assert.equal(canonicalStateHash(backedUp.state), canonicalStateHash(s.original));
  s.storage.setItem = write;
  s.review('previous');
  const reviewed = s.pending(); assert.ok(reviewed);
  await s.replace(reviewed.state, 'Restored latest edits', reviewed.migratedFrom, reviewed.workspace);
  assert.deepEqual(modelWorkspaceDataForExport(s.controller.getSnapshot()), latest);
  assert.equal(s.controller.getSnapshot().persistent, true);
  assert.equal(s.error(), '');
});

test('replacement flushes queued engine changes before binding their previous-run planning backup', async t => {
  const s = await recoverySession(t);
  const advanced = advanceWeek(s.original); assert.ok(advanced.accepted, advanced.reason?.message);
  s.closure.gameRef.current = advanced.state;
  const stored = readBrowserSnapshotWithBytes(); assert.equal(stored.kind, 'loaded');
  if (stored.kind !== 'loaded') return;
  assert.notEqual(canonicalStateHash(stored.state), canonicalStateHash(advanced.state), 'The latest week has not autosaved yet.');
  await s.replace(createInitialState(CONTENT, 'release', 'consultancy'), 'New campaign');
  const copy = readBrowserRecovery('previous'); assert.ok(copy);
  const backedUp = deserializePortableSave(copy.text); assert.ok(backedUp.ok);
  assert.equal(canonicalStateHash(backedUp.state), canonicalStateHash(advanced.state));
  assert.deepEqual(backedUp.workspace, s.workspace);
  assert.equal(s.error(), '');
});

test('a failed pre-replacement save preserves the current company, previous backup and all live drafts', async t => {
  const s = await recoverySession(t);
  const advanced = advanceWeek(s.original); assert.ok(advanced.accepted, advanced.reason?.message);
  s.closure.gameRef.current = advanced.state;
  const primary = s.storage.getItem('frontier-lab.wave0.snapshot'), metadata = s.storage.getItem(MODEL_WORKSPACE_KEY);
  const previous = serializeState(createInitialState(CONTENT, 'release', 'university'));
  s.storage.setItem('frontier-lab.previous.snapshot', previous);
  s.unavailable(true);
  await s.replace(createInitialState(CONTENT, 'release', 'consultancy'), 'Must remain current');
  assert.equal(s.closure.gameRef.current, advanced.state);
  assert.equal(s.storage.getItem('frontier-lab.wave0.snapshot'), primary);
  assert.equal(s.storage.getItem('frontier-lab.previous.snapshot'), previous);
  assert.equal(s.storage.getItem(MODEL_WORKSPACE_KEY), metadata);
  assert.deepEqual(modelWorkspaceDataForExport(s.controller.getSnapshot()), s.workspace);
  assert.equal(s.resets(), 0); assert.equal(s.commits(), 0);
  assert.equal(s.closure.transferRef.current, false);
  assert.equal(s.closure.saveFailedRef.current, true);
  assert.equal(s.paused(), true);
  assert.match(s.error(), /current lab could not be saved for recovery.*still open/);
});

test('starting the first origin saves it without requiring a previous-run save receipt', async t => {
  const s = await recoverySession(t), replacement = createInitialState(CONTENT, 'release', 'consultancy');
  s.storage.removeItem('frontier-lab.wave0.snapshot');
  s.controller.open({ playerId: replacement.playerCompanyId, mode: 'owner' });
  s.closure.choosingOriginRef.current = true;
  await s.replace(replacement, 'First campaign');
  assert.equal(s.closure.gameRef.current, replacement);
  assert.equal(readBrowserRecovery('previous'), null);
  const saved = readBrowserSnapshotWithBytes(); assert.equal(saved.kind, 'loaded');
  if (saved.kind === 'loaded') assert.deepEqual(saved.state, replacement);
  assert.equal(s.error(), ''); assert.equal(s.commits(), 1);
});

test('confirmed replacement of a blocked original preserves its exact bytes without attaching the displayed drafts', async t => {
  const s = await recoverySession(t), corrupt = '{unreadable original\r\n';
  s.storage.setItem('frontier-lab.wave0.snapshot', corrupt);
  s.closure.writeBlockedRef.current = true;
  const replacement = createInitialState(CONTENT, 'release', 'consultancy');
  await s.replace(replacement, 'New campaign after blocked save');
  assert.equal(s.closure.gameRef.current, replacement);
  assert.equal(readBrowserRecovery('previous')?.text, corrupt);
  assert.equal(s.closure.writeBlockedRef.current, false);
  assert.equal(s.error(), ''); assert.equal(s.commits(), 1);
});

test('memory-only replacement restores imported drafts without writing browser primary or recovery data', async t => {
  const s = await recoverySession(t);
  const primary = s.storage.getItem('frontier-lab.wave0.snapshot'), metadata = s.storage.getItem(MODEL_WORKSPACE_KEY);
  s.closure.sessionRef.current = 'memory';
  s.controller.open({ playerId: s.original.playerCompanyId, mode: 'memory' });
  s.unavailable(true);
  const replacement = createInitialState(CONTENT, 'release', 'consultancy');
  await s.replace(replacement, 'In-memory import', undefined, s.workspace);
  assert.equal(s.closure.gameRef.current, replacement);
  assert.deepEqual(modelWorkspaceDataForExport(s.controller.getSnapshot()), s.workspace);
  assert.equal(s.storage.getItem('frontier-lab.wave0.snapshot'), primary);
  assert.equal(s.storage.getItem(MODEL_WORKSPACE_KEY), metadata);
  assert.equal(readBrowserRecovery('previous'), null);
  assert.equal(s.error(), ''); assert.equal(s.commits(), 1);
});

test('a stale callback from an observer, stopped session or busy operation cannot replace the saved lab', async t => {
  const s = await recoverySession(t), replacement = createInitialState(CONTENT, 'release', 'consultancy');
  const primary = s.storage.getItem('frontier-lab.wave0.snapshot'), metadata = s.storage.getItem(MODEL_WORKSPACE_KEY);
  for (const mode of ['observer', 'acquiring']) {
    s.closure.sessionRef.current = mode;
    await s.replace(replacement, 'Must remain current');
  }
  s.closure.sessionRef.current = 'owner';
  s.closure.readyRef.current = false;
  await s.replace(replacement, 'Must remain current');
  s.closure.readyRef.current = true;
  s.closure.taskGateRef.current.busy = true;
  await s.replace(replacement, 'Must remain current');
  s.closure.taskGateRef.current.busy = false;
  s.closure.transferRef.current = true;
  await s.replace(replacement, 'Must remain current');
  assert.equal(s.closure.gameRef.current, s.original);
  assert.equal(s.storage.getItem('frontier-lab.wave0.snapshot'), primary);
  assert.equal(s.storage.getItem(MODEL_WORKSPACE_KEY), metadata);
  assert.equal(readBrowserRecovery('previous'), null);
  assert.equal(s.resets(), 0); assert.equal(s.commits(), 0);
});

for (const failure of ['archive', 'primary'] as const) test(`failed ${failure} write preserves the current company and planning workspace during replacement`, async t => {
  const s = await recoverySession(t);
  const primary = s.storage.getItem('frontier-lab.wave0.snapshot'), metadata = s.storage.getItem(MODEL_WORKSPACE_KEY);
  const write = s.storage.setItem;
  s.storage.setItem = (key, value) => {
    if (failure === 'archive' && key === 'frontier-lab.previous.snapshot'
      || failure === 'primary' && key === 'frontier-lab.wave0.snapshot' && value !== primary) throw new Error('Test storage failure');
    write(key, value);
  };
  await s.replace(createInitialState(CONTENT, 'release', 'university'), 'Must remain current');
  assert.equal(s.closure.gameRef.current, s.original);
  assert.equal(s.storage.getItem('frontier-lab.wave0.snapshot'), primary);
  assert.equal(s.storage.getItem(MODEL_WORKSPACE_KEY), metadata);
  assert.deepEqual(modelWorkspaceDataForExport(s.controller.getSnapshot()), s.workspace);
  assert.equal(s.resets(), 0); assert.equal(s.commits(), 0);
  assert.match(s.error(), /current lab is still open/);
  if (failure === 'primary') {
    const copy = readBrowserRecovery('previous'); assert.ok(copy);
    const decoded = deserializePortableSave(copy.text); assert.ok(decoded.ok);
    assert.deepEqual(decoded.workspace, s.workspace, 'A successfully written recovery remains complete even if the primary write fails.');
  }
});
