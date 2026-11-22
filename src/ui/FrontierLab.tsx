'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withPassiveWorkforce } from '../modules/workforce';
import type { ChangeEvent } from 'react';
import { CAMPAIGN_ORIGINS } from '../content/campaign-origins';
import type { CampaignOrigin } from '../contracts/wave4-campaign';
import { CampaignOriginPicker } from './campaign-origin-picker';
import { CONTENT } from '../content/catalog';
import type { CommandPayload, DiagnosticResult, GameState } from '../contracts/types';
import {
  advanceWeek, BrowserClock, canonicalStateHash, createInitialState,
  deserializeState, formatMoney, getGameView, runDiagnostics,
  serializeState, submitCommand, MAX_SNAPSHOT_BYTES, SnapshotTooLargeError, assertSnapshotCapacity,
} from '../core/index';
import {
  browserRecoveryOptions, openBrowserSession, readBrowserRecovery,
  readBrowserSnapshotWithBytes, writeBrowserSnapshotWithBytes, RecoveryArchiveError,
} from '../persistence/wave0-browser';
import type { RecoveryKind, RecoveryOption, SessionMode } from '../persistence/wave0-browser';
import { afterBrowserPaint, BrowserTaskGate } from '../persistence/browser-task';
import { commandLabel, Metric, Metrics, Section } from './components';
import { BusinessPanel, ComputePanel, DataPanel, DeveloperApiPanel, InfrastructurePanel, LabPanel, MarketPanel, ModelsPanel, PeoplePanel, ProductPanel, ResearchPanel } from './panels';
import { AgentsPanel } from './agent-panels';
import { DevelopmentPlansPanel } from './development-plans-panel';
import { ModelChallengesPanel } from './model-challenges-panel';
import { CustomerBriefsPanel } from './customer-briefs-panel';
import { BusinessCommitmentsPanel } from './business-panels';
import { CampaignPanel } from './campaign-panel';
import { AppliedResearchPanel } from './applied-research-panel';
import { ChipsPanel } from './chips-panel';
import { CapacityForecastPanel } from './capacity-forecast-panel';
import { ComputeCostsPanel } from './compute-costs-panel';
import { getCampaignView } from '../modules/campaign';
import { getGameSectionVisibility, milestoneLink } from './guide-links';
import { CompanyNavigation, PlayerGuide } from './player-guide';
import { StudioShell } from './studio-shell';
import { SyntheticDataPanel, ModelCorpusComparison } from './synthetic-data-panel';
import { submitStudioPlan } from '../core/studio-planning';
import type { StudioPlanDraft } from '../contracts/wave25-studio';
import type { SnapshotResult } from '../core/snapshot';
import { StudioWorkbenchPanel } from './studio-workbench-context';
import { useStudioResults } from './use-studio-results';
import { ModelWorkspaceProvider, useModelWorkspaceController } from './model-workspace-context';

type MigrationSource = NonNullable<Extract<SnapshotResult, { ok: true }>['migratedFrom']>;

type SaveStatus = { kind: 'waiting' | 'saved' | 'failed' | 'memory'; message: string };
type PendingImport = { state: GameState; recovery?: true; migratedFrom?: MigrationSource };
type OperationKind = 'week' | 'command' | 'diagnostics';
const MILESTONES = [['dataReady', 'Prepare'], ['trained', 'Train'], ['evaluated', 'Evaluate'], ['deployed', 'Deploy'], ['firstSale', 'First sale']] as const;

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FrontierLab() {
  const [game, setGame] = useState<GameState>(() => createInitialState(CONTENT, 'release'));
  const gameRef = useRef(game);
  const { inbox: resultsInbox, openSession: openResultsSession, observe: observeResults,
    saved: saveResultsBinding, replace: replaceResultsTimeline, suspend: suspendResults } = useStudioResults();
  const { workspace: modelWorkspace, open: openModelWorkspace, saved: saveModelWorkspace,
    replace: replaceModelWorkspace, suspend: suspendModelWorkspace } = useModelWorkspaceController();
  const [panelEpoch, setPanelEpoch] = useState(0);
  const [paused, setPaused] = useState(true);
  const runningRef = useRef(false);
  const [speed, setSpeed] = useState<1 | 2 | 5>(1);
  const clockRef = useRef<BrowserClock | null>(null);
  const [sessionMode, setSessionMode] = useState<SessionMode>('acquiring');
  const sessionRef = useRef<SessionMode>('acquiring');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const readyRef = useRef(false);
  const [writeBlocked, setWriteBlocked] = useState(false);
  const writeBlockedRef = useRef(false);
  const saveFailedRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: 'waiting', message: 'Opening this lab…' });
  const [recoveries, setRecoveries] = useState<RecoveryOption[]>([]);
  const [migrationNotice, setMigrationNotice] = useState<MigrationSource | null>(null);
  const [notice, setNotice] = useState('The lab is paused. Prepare your data and plan the first training run.');
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<DiagnosticResult | null>(null);
  const [choosingOrigin, setChoosingOrigin] = useState(false);
  const choosingOriginRef = useRef(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const transferRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<(manual?: boolean) => void>(() => undefined);
  const taskGateRef = useRef(new BrowserTaskGate());
  const operationKindRef = useRef<OperationKind | null>(null);
  const [busyMessage, setBusyMessage] = useState('');

  const company = game.slices.company.companies[game.playerCompanyId];
  const view = useMemo(() => getGameView(game, CONTENT), [game]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const fingerprint = useMemo(() => buildOpen ? canonicalStateHash(game) : null, [game, buildOpen]);
  const isController = hydrated && (sessionMode === 'owner' || sessionMode === 'memory');
  const canAct = isController && modelWorkspace.ready && !choosingOrigin && !writeBlocked && company.arrearsCents === 0 && !pendingImport && !resetOpen && !transferBusy && !busyMessage;

  const commit = useCallback((next: GameState) => {
    const sameWeek = next.week === gameRef.current.week;
    gameRef.current = next;
    observeResults(next);
    setGame(next);
    setDiagnostics(null);
    if (sessionRef.current === 'owner' && !writeBlockedRef.current && !saveFailedRef.current) {
      setSaveStatus({ kind: 'waiting', message: sameWeek ? 'Saving your plan · Week ' + next.week + '…' : 'Saving Week ' + next.week + '…' });
    }
  }, [observeResults]);

  const pause = useCallback((message?: string) => {
    if (operationKindRef.current === 'week' && taskGateRef.current.cancel()) {
      operationKindRef.current = null;
      setBusyMessage('');
    }
    runningRef.current = false;
    clockRef.current?.setPaused(true);
    setPaused(true);
    if (message) setNotice(message);
  }, []);

  const persistCurrentGame = useCallback((expected?: GameState) => {
    if (!readyRef.current || sessionRef.current !== 'owner' || writeBlockedRef.current
      || choosingOriginRef.current || transferRef.current || taskGateRef.current.busy
      || expected && expected !== gameRef.current) return;
    const current = gameRef.current;
    const result = writeBrowserSnapshotWithBytes(current);
    saveFailedRef.current = !result.ok;
    if (result.ok) {
      void saveResultsBinding(result.savedBytes);
      void saveModelWorkspace(result.savedBytes);
    } else {
      pause('Autosave could not finish, so the lab is paused. Download your save or retry saving before resuming.');
    }
    setSaveStatus(result.ok ? { kind: 'saved', message: 'Saved in this browser · Week ' + current.week } : { kind: 'failed', message: result.error });
    setRecoveries(browserRecoveryOptions(!result.ok));
    return result;
  }, [pause, saveResultsBinding, saveModelWorkspace]);

  const runPaintTask = useCallback((kind: OperationKind, message: string, operation: (state: GameState) => void, controllerRequired = true, onAborted?: (reason: string) => void) => {
    if (!readyRef.current || taskGateRef.current.busy || transferRef.current
      || (controllerRequired && (!['owner', 'memory'].includes(sessionRef.current) || writeBlockedRef.current))) return false;
    const expected = gameRef.current;
    operationKindRef.current = kind;
    setBusyMessage(message);
    clockRef.current?.setPaused(true);
    const finish = (resume = true) => {
      operationKindRef.current = null;
      setBusyMessage('');
      if (resume && readyRef.current && runningRef.current && !document.hidden) {
        if (kind === 'week') clockRef.current?.reset(performance.now());
        clockRef.current?.setPaused(false);
      }
    };
    try {
      return taskGateRef.current.start(afterBrowserPaint, () => {
        try {
          if (!readyRef.current || document.hidden || transferRef.current || gameRef.current !== expected
            || (controllerRequired && (!['owner', 'memory'].includes(sessionRef.current) || writeBlockedRef.current))) {
            const reason = 'This action was cancelled. Check your lab and try again.';
            setNotice(reason); onAborted?.(reason);
            return;
          }
          operation(expected);
        } catch {
          pause();
          const reason = 'This action could not finish. Check your lab and try again.';
          setError(reason); onAborted?.(reason);
        } finally { finish(); }
      }, () => {
        onAborted?.('This action was cancelled. Your choices are still here.');
        finish(false);
      });
    } catch {
      finish();
      const reason = 'This action could not start. You can keep playing your current lab.';
      setError(reason); onAborted?.(reason);
      return false;
    }
  }, [pause]);

  useEffect(() => {
    suspendResults();
    suspendModelWorkspace();
    sessionRef.current = 'acquiring';
    readyRef.current = false;
    const close = openBrowserSession((mode) => {
      pause();
      const saved = readBrowserSnapshotWithBytes();
      saveFailedRef.current = false;
      const effectiveMode = mode === 'owner' && saved.kind === 'unavailable' ? 'memory' : mode;
      const opened = saved.kind === 'loaded' ? withPassiveWorkforce(saved.state) : gameRef.current;
      openResultsSession({ game: opened, mode: effectiveMode,
        ...(saved.kind === 'loaded' ? { savedBytes: saved.savedBytes } : {}) });
      openModelWorkspace({ game: opened, mode: effectiveMode,
        ...(saved.kind === 'loaded' ? { savedBytes: saved.savedBytes } : {}) });
      if (saved.kind === 'loaded') {
        commit(opened);
        setPanelEpoch(epoch => epoch + 1);
        setMigrationNotice(saved.migratedFrom ?? null);
        setNotice('Your saved lab is open and paused. No time passed while you were away.');
      }
      choosingOriginRef.current = (saved.kind === 'empty' || saved.kind === 'unavailable') && effectiveMode !== 'observer';
      setChoosingOrigin(choosingOriginRef.current);
      const blocked = saved.kind === 'invalid';
      writeBlockedRef.current = blocked;
      setWriteBlocked(blocked);
      sessionRef.current = effectiveMode;
      setSessionMode(effectiveMode);
      if (effectiveMode === 'observer') {
        setSaveStatus({ kind: 'memory', message: 'Another tab is running this lab.' });
      } else if (blocked) {
        setSaveStatus({ kind: 'failed', message: saved.message + ' Your original save is safe.' });
      } else if (effectiveMode === 'memory') {
        setSaveStatus({ kind: 'memory', message: 'Autosave is unavailable. Download your save before leaving.' });
        setNotice(saved.kind === 'unavailable' ? 'This browser cannot autosave right now. You can still play and download a save.' : 'This browser cannot check for other open tabs, so autosave is off. Download your save before leaving.');
      } else {
        setSaveStatus({ kind: 'saved', message: saved.kind === 'loaded' ? 'Save loaded · Week ' + saved.state.week : 'Autosave is ready.' });
      }
      setRecoveries(browserRecoveryOptions(blocked));
      readyRef.current = true;
      setHydrated(true);
    });
    return () => {
      suspendResults();
      suspendModelWorkspace();
      readyRef.current = false;
      taskGateRef.current.cancel();
      operationKindRef.current = null;
      runningRef.current = false;
      clockRef.current?.setPaused(true);
      close();
    };
  }, [commit, pause, sessionAttempt, openResultsSession, suspendResults, openModelWorkspace, suspendModelWorkspace]);

  useEffect(() => {
    if (!hydrated || sessionMode !== 'owner' || writeBlocked || choosingOrigin || busyMessage) return;
    const timer = window.setTimeout(() => {
      persistCurrentGame(game);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [game, hydrated, sessionMode, writeBlocked, choosingOrigin, busyMessage, persistCurrentGame]);

  const step = useCallback((manual = false) => {
    if (!readyRef.current || !['owner', 'memory'].includes(sessionRef.current) || writeBlockedRef.current || transferRef.current || taskGateRef.current.busy) return;
    if (sessionRef.current === 'owner' && saveFailedRef.current && !persistCurrentGame()?.ok) return;
    const previous = gameRef.current;
    if (previous.slices.company.companies[previous.playerCompanyId].arrearsCents > 0) {
      pause('Time is stopped because the company has unpaid bills.');
      return;
    }
    if (manual) { pause(); clockRef.current?.reset(performance.now()); }
    runPaintTask('week', 'Playing Week ' + (previous.week + 1) + '…', (current) => {
      const result = advanceWeek(current, CONTENT);
      if (!result.accepted) {
        pause();
        setError(result.reason?.message ?? 'This week could not finish. Your lab is still at the start of the week.');
        return;
      }
      try { assertSnapshotCapacity(result.state, CONTENT); }
      catch (error) {
        pause();
        setError(error instanceof SnapshotTooLargeError
          ? 'The next week would exceed the supported save capacity. Your lab remains at Week ' + current.week + '; download this save before changing the plan.'
          : 'The next week could not be checked for saving. Your current lab is unchanged.');
        return;
      }
      const firstSale = !getGameView(current, CONTENT).progress.firstSale && getGameView(result.state, CONTENT).progress.firstSale;
      const newEndings = getCampaignView(result.state, CONTENT).routes.filter(route => route.achievedWeek !== null && !current.slices.campaign.endings[route.id]);
      commit(result.state);
      setError('');
      if (newEndings.length) setNotice(newEndings.map(route => route.name).join(' and ') + ' achieved in Week ' + result.state.week + '. Your company keeps running; the ending is saved with this run.');
      else if (firstSale) setNotice('Your first sale! A customer has paid to use your product.');
      else if (manual) setNotice('Week ' + result.state.week + ' finished. The game is paused.');
      const planDecision = Object.values(result.state.slices.models.developmentPlans ?? {}).find(plan => ['review', 'blocked'].includes(plan.status) && current.slices.models.developmentPlans?.[plan.id]?.status !== plan.status);
      if (planDecision) pause(planDecision.name + ': ' + planDecision.message);
      if (result.state.slices.company.companies[result.state.playerCompanyId].arrearsCents > 0) {
        pause('Your company ran out of money to pay its bills. You can review this run, download its save, or start a new lab.');
      }
    });
  }, [commit, pause, runPaintTask, persistCurrentGame]);

  useEffect(() => { stepRef.current = step; }, [step]);

  useEffect(() => {
    const clock = new BrowserClock({ onWeek: () => stepRef.current(false), onVisibilityPause: () => pause('The lab paused when this page was hidden. Resume when you are ready.') });
    clockRef.current = clock;
    clock.setPaused(true);
    clock.reset(performance.now());
    const timer = window.setInterval(() => clock.pulse(performance.now(), !document.hidden), 125);
    const onVisibility = () => {
      if (document.hidden) {
        const cancelled = taskGateRef.current.cancel();
        if (cancelled) { operationKindRef.current = null; setBusyMessage(''); }
        pause(cancelled ? 'The pending action was cancelled when this page was hidden. Review the lab before resuming.' : runningRef.current ? 'The lab paused when this page was hidden. Resume when you are ready.' : undefined);
        persistCurrentGame();
      }
      clock.reset(performance.now());
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      clock.dispose();
      clockRef.current = null;
    };
  }, [pause, persistCurrentGame]);

  function toggleRunning() {
    if (!canAct || taskGateRef.current.busy) return;
    if (runningRef.current) { pause('The lab is paused.'); return; }
    if (sessionRef.current === 'owner' && saveFailedRef.current && !persistCurrentGame()?.ok) return;
    setError('');
    runningRef.current = true;
    clockRef.current?.reset(performance.now());
    clockRef.current?.setPaused(false);
    setPaused(false);
    setNotice('The game is running. Cloud rent and staff wages are charged each week.');
  }

  function changeSpeed(next: 1 | 2 | 5) { if (taskGateRef.current.busy) return; setSpeed(next); clockRef.current?.setSpeed(next); }

  function retrySession() {
    if (taskGateRef.current.busy || transferRef.current) return;
    pause(); suspendResults(); readyRef.current = false; sessionRef.current = 'acquiring';
    setSessionMode('acquiring'); setHydrated(false); setSessionAttempt(attempt => attempt + 1);
  }

  function submitTaskCommand(payload: CommandPayload, expectedState?: GameState): Promise<import('../core/studio-tasks').StudioCommandAcknowledgement> {
    if (!canAct || transferRef.current || taskGateRef.current.busy) {
      return Promise.resolve({ status: 'rejected', reason: 'You cannot make changes yet. Check for an action in progress, a save problem, or another tab running this lab.' });
    }
    if (expectedState && gameRef.current !== expectedState) {
      return Promise.resolve({ status: 'rejected', reason: 'Your lab changed while you were planning. Check the updated costs and requirements.' });
    }
    const submittedPayload = structuredClone(payload);
    return new Promise(resolve => {
      const started = runPaintTask('command', 'Checking: ' + commandLabel(submittedPayload) + '…', (current) => {
        const result = submitCommand(current, submittedPayload, CONTENT);
        if (!result.accepted || !result.commandId) {
          const reason = result.reason?.message ?? 'This action could not be scheduled.';
          setError(reason); resolve({ status: 'rejected', reason }); return;
        }
        commit(result.state); setError('');
        const effectiveWeek = result.state.week + 1;
        setNotice('Queued for Week ' + effectiveWeek + ': ' + commandLabel(submittedPayload) + '.');
        resolve({ status: 'accepted', commandId: result.commandId, effectiveWeek });
      }, true, reason => resolve({ status: 'cancelled', reason }));
      if (!started) resolve({ status: 'rejected', reason: 'Wait for the current action to finish, then try again. This action was not scheduled.' });
    });
  }

  function queue(payload: CommandPayload) { void submitTaskCommand(payload); }

  function applyStudioPlan(draft: StudioPlanDraft, sourceHash: string) {
    if (!canAct || transferRef.current || runningRef.current || taskGateRef.current.busy) {
      return { accepted: false, message: 'Pause the game in the tab running your lab before confirming this plan.' };
    }
    const result = submitStudioPlan(gameRef.current, draft, sourceHash, CONTENT);
    if (!result.accepted) {
      const message = result.reason?.message ?? 'This plan could not be scheduled. Fix the highlighted problem and preview it again.';
      setError(message);
      return { accepted: false, message };
    }
    commit(result.state); setError('');
    const message = 'Your staff and compute plan is scheduled for Week ' + (result.state.week + 1) + '.';
    setNotice(message);
    return { accepted: true, message };
  }

  function exportSnapshot() {
    if (taskGateRef.current.busy || transferRef.current) return;
    try {
      downloadText(serializeState(gameRef.current, CONTENT), 'frontier-lab-week-' + String(gameRef.current.week).padStart(4, '0') + '.json');
      setNotice('Save downloaded, including your planned actions.');
    } catch (error) { setError(error instanceof SnapshotTooLargeError ? error.message : 'The save could not be downloaded. Your current lab is still open.'); }
  }

  function exportRecovery(kind: RecoveryKind) {
    if (taskGateRef.current.busy || transferRef.current) return;
    try {
      const result = readBrowserRecovery(kind);
      if (!result) { setError('That recovery copy is unavailable. Existing saves were not changed.'); return; }
      downloadText(result.text, result.filename);
      setNotice('Backup downloaded. Your current lab is still open.');
    } catch (error) { setError(error instanceof RecoveryArchiveError ? error.message : 'Recovery export failed. Existing saves were not changed.'); }
  }

  function reviewRecovery(kind: RecoveryKind) {
    if (!isController || transferRef.current || taskGateRef.current.busy) return;
    pause('The lab is paused while you review a recovery copy.');
    try {
      const copy = readBrowserRecovery(kind);
      if (!copy) { setError('That recovery copy is unavailable.'); return; }
      const result = deserializeState(copy.text, CONTENT);
      if (!result.ok) { setError('Recovery could not open: ' + result.error); return; }
      setError(''); setResetOpen(false);
      setPendingImport({ state: withPassiveWorkforce(result.state), migratedFrom: result.migratedFrom, recovery: true });
    } catch (error) { setError(error instanceof RecoveryArchiveError ? error.message : 'Recovery could not be read. Existing saves were not changed.'); }
  }

  function openImport() {
    if (!isController || transferRef.current || taskGateRef.current.busy) return;
    pause('The game is paused while you choose a save file.');
    clockRef.current?.reset(performance.now());
    fileInputRef.current?.click();
  }

  async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !isController || transferRef.current || taskGateRef.current.busy) return;
    pause('The game is paused while you review this save.');
    clockRef.current?.reset(performance.now());
    transferRef.current = true; setTransferBusy(true);
    try {
      if (file.size > MAX_SNAPSHOT_BYTES) { setError('That save file is larger than the 2 MB import limit. Large campaigns use compressed save files. Your current lab is safe.'); return; }
      const result = deserializeState(await file.text(), CONTENT);
      if (!result.ok) { setError('Import rejected: ' + result.error + ' Your current lab is unchanged.'); return; }
      setError(''); setResetOpen(false);
      setPendingImport({ state: withPassiveWorkforce(result.state), ...(result.migratedFrom ? { migratedFrom: result.migratedFrom } : {}) });
    } catch { setError('That save file could not be read. Your current lab is safe.'); }
    finally { transferRef.current = false; setTransferBusy(false); }
  }

  function replaceRun(next: GameState, message: string, migratedFrom?: MigrationSource) {
    if (!isController || transferRef.current || taskGateRef.current.busy) return;
    pause(); clockRef.current?.reset(performance.now());
    let savedBytes: string | undefined;
    if (sessionRef.current === 'owner') {
      const result = writeBrowserSnapshotWithBytes(next, { replace: true });
      if (!result.ok) {
        saveFailedRef.current = true;
        setSaveStatus({ kind: 'failed', message: result.error });
        setError('The new save could not be stored, so your current lab is still open. Download a backup and try again when browser storage works.');
        setRecoveries(browserRecoveryOptions(true));
        return;
      }
      savedBytes = result.savedBytes;
    }
    replaceResultsTimeline({ game: next, mode: sessionRef.current, savedBytes });
    replaceModelWorkspace({ game: next, mode: sessionRef.current, savedBytes });
    saveFailedRef.current = false;
    commit(next); setPanelEpoch(epoch => epoch + 1);
    if (sessionRef.current === 'owner') setSaveStatus({ kind: 'saved', message: 'Saved in this browser · Week ' + next.week });
    writeBlockedRef.current = false; setWriteBlocked(false);
    choosingOriginRef.current = false;
    setChoosingOrigin(false); setPendingImport(null); setResetOpen(false); setError(''); setNotice(message);
    setMigrationNotice(migratedFrom ?? null); setRecoveries(browserRecoveryOptions());
  }

  function startOrigin(origin: CampaignOrigin) {
    const seed = 'campaign-' + Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
    replaceRun(createInitialState({ ...CONTENT, opening: { ...CONTENT.opening, seed } }, 'release', origin), CAMPAIGN_ORIGINS[origin].openingNotice);
  }

  function retrySave() {
    persistCurrentGame();
  }

  function checkSimulation() {
    runPaintTask('diagnostics', 'Checking the simulation…', (current) => {
      try {
      const result = runDiagnostics(current, CONTENT);
      setDiagnostics(result);
      setNotice(result.ok ? 'All simulation checks passed. Your company was not changed.' : 'Some simulation checks need attention. Your company was not changed.');
      } catch { setError('Simulation checks could not finish. Your company was not changed.'); }
    }, false);
  }

  const panelProps = { game, view, canAct, onQueue: queue };
  const sections = getGameSectionVisibility(game, view);
  const nextLink = milestoneLink(view, Object.keys(game.slices.campaign.endings).length > 0);
  const currentWave = CONTENT.roadmap.find(wave => wave.status === 'current');
  const playerCommands = game.queuedCommands.filter(command => command.companyId === game.playerCompanyId);
  const latestWeek = game.slices.campaign.history.at(-1);
  if (choosingOrigin && !pendingImport) return <main className="campaign-opening">
    <CampaignOriginPicker onStart={startOrigin} onLoad={openImport} status={sessionMode === 'memory' ? saveStatus.message : undefined}>
      {error && <p className="error-message" role="alert">{error}</p>}
      <input className="visually-hidden" ref={fileInputRef} type="file" accept=".json,application/json" aria-label="Choose a lab save file" tabIndex={-1} onChange={chooseImport} />
    </CampaignOriginPicker>
  </main>;
  return <ModelWorkspaceProvider value={modelWorkspace}><StudioShell key={panelEpoch} results={resultsInbox} game={game} paused={paused} speed={speed} canAct={canAct} isController={isController} notice={notice} busyMessage={busyMessage} errorMessage={error} saveKind={saveStatus.kind} saveMessage={saveStatus.message} forceSaveOpen={!!pendingImport || resetOpen || writeBlocked} onToggleRunning={toggleRunning} onStep={() => step(true)} onSpeed={changeSpeed} plannerEpoch={panelEpoch} onPause={() => pause('The lab is paused while you plan next week.')} onApplyPlan={applyStudioPlan} onQueue={queue} onSubmitTask={submitTaskCommand}>
    <a className="skip-link" href="#business">Skip to company</a>
    <header className="lab-header">
      <div className="identity"><h1>Frontier Lab</h1><span className="build-tag">{currentWave ? 'Wave ' + currentWave.wave + ' · ' + currentWave.title : 'Company simulation'}</span></div>
      <div className="clock" aria-label="Simulation clock" aria-busy={!!busyMessage}><span className="week-number">Week {game.week}</span><span className="clock-status">{busyMessage || (paused ? 'Paused' : 'Running')}</span><button type="button" onClick={toggleRunning} disabled={!canAct}>{paused ? 'Resume' : 'Pause'}</button><span className="speed-controls" role="group" aria-label="Simulation speed">{([1, 2, 5] as const).map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => changeSpeed(value)} disabled={!isController || !!busyMessage}>{value}×</button>)}</span><button type="button" onClick={() => step(true)} disabled={!canAct}>Next week</button></div>
    </header>
    <section className="milestone-bar" aria-label="Next milestone"><div><strong>{view.nextMilestone.title}</strong><p>{view.nextMilestone.detail} <a href={nextLink.href}>{nextLink.label}</a>.</p></div><ol className="milestone-steps">{MILESTONES.map(([key, label]) => <li key={key} className={view.progress[key] ? 'done' : ''}><span aria-hidden="true">{view.progress[key] ? '✓' : '·'}</span> {label}<span className="visually-hidden">{view.progress[key] ? ', complete' : ', incomplete'}</span></li>)}</ol></section>
    <div className="notice" role="status" aria-live="polite">{busyMessage || notice}</div>
    {error && <p className="error-message classic-operation-error" role="alert">{error}</p>}
    {migrationNotice && <div className="migration-note"><p>Your save is ready in this version. Your company and history are here, and the game is paused.</p><button type="button" onClick={() => setMigrationNotice(null)} aria-label="Dismiss migration notice">Dismiss</button></div>}
    {writeBlocked && <div className="error-message"><strong>The stored lab could not be opened.</strong> Your original save is safe. Download a backup under Your lab, then load a working save or start a new lab. The game and autosave are paused until you choose.</div>}
    {sessionMode === 'observer' && <div className="session-message"><strong>This is a read-only copy.</strong> Close the other Frontier Lab tab, then <button type="button" onClick={retrySession}>Use this tab</button>. Only one tab can run and save the game at a time.</div>}
    {company.arrearsCents > 0 && <p className="error-message">Unpaid bills: <strong>{formatMoney(company.arrearsCents)}</strong>. Time and company changes are stopped. Inspect this run, export it, or start a new lab below.</p>}
    <CompanyNavigation sections={sections} />
    <PlayerGuide sections={sections} />
    {view.progress.firstSale && latestWeek && <section className="operating-brief" aria-label="Weekly operating summary">
      <h2>Week {latestWeek.week} at a glance</h2>
      <Metrics>
        <Metric label="Operating surplus">{formatMoney(latestWeek.revenueCents - latestWeek.operatingExpenseCents)}</Metric>
        <Metric label="Cash runway">{view.runwayWeeks === null ? 'Cash flow covers base costs' : `About ${view.runwayWeeks} weeks`}</Metric>
        <Metric label="Weakest paid service">{latestWeek.paidProductKinds ? (latestWeek.serviceBps / 100).toFixed(1) + '%' : 'No paid service yet'}</Metric>
        <Metric label="Planned actions">{playerCommands.length || 'None'}</Metric>
      </Metrics>
    </section>}
    <div className="main-columns" key={panelEpoch}>
      <div className="lab-column"><StudioWorkbenchPanel panelId="business"><BusinessPanel {...panelProps} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="people"><PeoplePanel {...panelProps} /></StudioWorkbenchPanel>{sections.market && <StudioWorkbenchPanel panelId="market"><MarketPanel {...panelProps} /></StudioWorkbenchPanel>}{sections.campaign && <StudioWorkbenchPanel panelId="campaign"><CampaignPanel {...panelProps} /></StudioWorkbenchPanel>}{sections.agents && <StudioWorkbenchPanel panelId="agents"><AgentsPanel {...panelProps} /></StudioWorkbenchPanel>}</div>
      <div className="lab-column"><StudioWorkbenchPanel panelId="data"><DataPanel {...panelProps} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="development-plans"><DevelopmentPlansPanel game={game} canAct={canAct} onQueue={queue} paused={paused} onRun={() => { if (paused) toggleRunning(); }} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="model-challenges"><ModelChallengesPanel game={game} canAct={canAct} onQueue={queue} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="lab-projects"><LabPanel {...panelProps} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="models"><ModelsPanel {...panelProps} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="synthetic-data"><SyntheticDataPanel game={game} canAct={canAct} onQueue={queue} /></StudioWorkbenchPanel><StudioWorkbenchPanel panelId="model-corpus-compare"><ModelCorpusComparison game={game} /></StudioWorkbenchPanel>{sections.research && <StudioWorkbenchPanel panelId="research"><ResearchPanel {...panelProps} /></StudioWorkbenchPanel>}{sections.appliedResearch && <StudioWorkbenchPanel panelId="applied-research"><AppliedResearchPanel {...panelProps} /></StudioWorkbenchPanel>}</div>
      <div className="lab-column compute-column"><StudioWorkbenchPanel panelId="compute"><ComputePanel {...panelProps} /></StudioWorkbenchPanel>{sections.capacityForecast && <StudioWorkbenchPanel panelId="compute-costs"><ComputeCostsPanel {...panelProps} /></StudioWorkbenchPanel>}{sections.capacityForecast && <StudioWorkbenchPanel panelId="capacity-forecast"><CapacityForecastPanel {...panelProps} /></StudioWorkbenchPanel>}<StudioWorkbenchPanel panelId="product"><ProductPanel {...panelProps} /></StudioWorkbenchPanel>{sections.developerApi && <StudioWorkbenchPanel panelId="developer-api"><DeveloperApiPanel {...panelProps} /></StudioWorkbenchPanel>}<StudioWorkbenchPanel panelId="customer-briefs"><CustomerBriefsPanel {...panelProps} /></StudioWorkbenchPanel>{sections.businessCommitments && <StudioWorkbenchPanel panelId="business-commitments"><BusinessCommitmentsPanel {...panelProps} /></StudioWorkbenchPanel>}{sections.infrastructure && <StudioWorkbenchPanel panelId="infrastructure"><InfrastructurePanel {...panelProps} /></StudioWorkbenchPanel>}{sections.chips && <StudioWorkbenchPanel panelId="chips"><ChipsPanel {...panelProps} /></StudioWorkbenchPanel>}</div>
    </div>
    <Section title="Company log" id="company-log" className="log-section">
      {playerCommands.length > 0 && <div className="queued-actions"><strong>Queued for Week {game.week + 1}</strong><ul>{playerCommands.map(command => <li key={command.id}>{commandLabel(command.payload)}{(command.reservedCents ?? 0) > 0 ? ' · ' + formatMoney(command.reservedCents!) + ' reserved' : ''}</li>)}</ul></div>}
      <ol className="journal">{game.journal.slice(-6).reverse().map(entry => <li key={entry.id}><span>Week {entry.week}</span><span>{entry.message}</span></li>)}</ol>
      <details className="inline-details" onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>Full history and last week’s details</summary>{historyOpen && <ol className="journal full-journal">{game.journal.slice().reverse().map(entry => <li key={entry.id}><span>Week {entry.week}</span><span>{entry.message}</span></li>)}</ol>}{game.lastTick ? <p className="small-note phase-trace">Week {game.lastTick.week}: {game.lastTick.phases.map(phase => phase.phase + ' (' + phase.facts + ' facts, ' + phase.events + ' events)').join(' → ')}</p> : <p className="small-note">Your first week has not started yet.</p>}</details>
    </Section>
    <Section title="Your lab" id="save" className="save-section">
      <div className="save-toolbar"><span className={saveStatus.kind === 'failed' ? 'save-failed' : 'save-status'} role={saveStatus.kind === 'failed' ? 'alert' : undefined}>{transferBusy ? 'Reading save…' : busyMessage || saveStatus.message}</span><div className="save-buttons"><button type="button" onClick={exportSnapshot} disabled={!hydrated || transferBusy || !!busyMessage}>Download save</button><button type="button" onClick={openImport} disabled={!isController || transferBusy || !!busyMessage}>Load save</button>{saveStatus.kind === 'failed' && !writeBlocked && sessionMode === 'owner' && <button type="button" onClick={retrySave} disabled={!!busyMessage || transferBusy}>Retry save</button>}<button type="button" disabled={!isController || transferBusy || !!busyMessage} onClick={() => { if (taskGateRef.current.busy) return; pause('The lab is paused while you review a reset.'); setPendingImport(null); setResetOpen(true); }}>New lab</button></div></div>
      <input className="visually-hidden" ref={fileInputRef} type="file" accept=".json,application/json" aria-label="Choose a lab save file" tabIndex={-1} disabled={!isController || transferBusy || !!busyMessage} onClick={() => { pause('The game is paused while you choose a save file.'); clockRef.current?.reset(performance.now()); }} onChange={chooseImport} />
      <p className="small-note"><a href="#campus">Open Campus upgrades and next-generation chips</a>.</p>
      <p className="small-note">Your game saves in this browser. Download a save to back it up or move it to another device. The game pauses when you leave this tab, so no time passes while you’re away.</p>
      {recoveries.length > 0 && <details className="inline-details" open={writeBlocked || undefined}><summary>Recovery copies</summary><div className="recovery-options">{recoveries.some(option => option.kind === 'previous') && <button type="button" disabled={!isController || transferBusy || !!busyMessage} onClick={() => reviewRecovery('previous')}>Review previous save</button>}{recoveries.map(option => <button type="button" key={option.kind} onClick={() => exportRecovery(option.kind)} disabled={!!busyMessage || transferBusy}>{option.label}</button>)}</div><p className="small-note">Loading another save or starting a new lab keeps one backup of your previous game. You can download or restore that backup here.</p></details>}
      {pendingImport && <div className="confirmation" role="group" aria-label={pendingImport.recovery ? 'Confirm previous save restoration' : 'Confirm loading this save'}><p>Replace this run with <strong>{pendingImport.state.slices.company.companies[pendingImport.state.playerCompanyId].name}</strong> at Week {pendingImport.state.week}? Download your current save first if you want a backup.{pendingImport.migratedFrom && ' This file will be upgraded to the current build after you confirm.'}</p><button type="button" onClick={() => replaceRun(pendingImport.state, pendingImport.recovery ? 'Previous save restored. The lab is paused.' : 'Save loaded. The game is paused.', pendingImport.migratedFrom)}>{pendingImport.recovery ? 'Restore previous save' : 'Load this lab'}</button><button type="button" onClick={() => { setPendingImport(null); setNotice(pendingImport.recovery ? 'Restoration cancelled. Your current lab is unchanged.' : 'Import cancelled. Your current lab is unchanged.'); }}>{pendingImport.recovery ? 'Keep current lab' : 'Cancel import'}</button></div>}
      {resetOpen && <CampaignOriginPicker replacing retainsBackup={sessionMode === 'owner'} onStart={startOrigin} onCancel={() => { setResetOpen(false); setNotice('Your current lab is open and paused.'); }} />}
    </Section>
    <details className="build-details" onToggle={event => setBuildOpen(event.currentTarget.open)}><summary>About this version</summary>{buildOpen && <>
      <div className="build-columns"><div><h3>What you can do</h3><p className="small-note">Start with a small lab and build an AI company. Prepare data, train models, test their skills and launch products. Hire a team, share your compute between projects and keep enough cash to pay the bills. Compete with rival labs and work toward three company goals.</p><p className="small-note">Grow from Basic Chat into an API, business services, support agents and coding jobs. Choose what agents may do and check their results before delivery. Collect customer feedback with permission, review it and use it in later training. Compare models, practice older skills during new training, and test behavior and safety before release. Try a new model on a small share of live traffic before switching your whole product.</p><p className="small-note">Explore research methods and repeat Architecture research to develop new custom designs. Generate and check synthetic training data, improve model efficiency and plan future capacity. Build data centers, move racks, improve their networks and specialize sites for training or serving. Design chips, test prototypes and choose a foundry; install the finished hardware or sell it to customers. Every project needs time, money and resources. The menus show its requirements before you confirm.</p><p className="small-note">Design your own models with parameter count, sparsity, a seven-skill data mix and a compute budget. The forecast calculates their potential, and prepared data determines what training can earn. Develop reasoning, long-context and multimodal skills, then measure them in a paid test. Architecture research unlocks Edge models at level 1 and Frontier models at level 3; later iterations raise future design potential with diminishing returns. Existing campaigns can continue with their earned models and progress.</p><p className="version-line">Build {CONTENT.buildVersion} · Content {game.contentVersion} · Schema {game.schemaVersion}<br />State <code>{fingerprint}</code></p><button type="button" onClick={checkSimulation} disabled={!hydrated || !!busyMessage || transferBusy}>Run simulation checks</button>{diagnostics && <div className="diagnostic-results"><p><strong>{diagnostics.ok ? 'All checks passed.' : 'Checks need attention.'}</strong> Tested on isolated copies.</p><ul>{diagnostics.checks.map(check => <li key={check.name}><span className="check-result">{check.passed ? 'PASS' : 'FAIL'}</span> <strong>{check.name}</strong><span className="small-note">{check.detail}</span></li>)}</ul></div>}</div><div><h3>Build sequence</h3><ol className="roadmap">{CONTENT.roadmap.map(wave => <li key={wave.wave}><span>Wave {wave.wave}</span><div><strong>{wave.title}</strong> <span className="muted">/ {wave.status === 'current' ? 'this build' : wave.status}</span><p className="small-note">{wave.description}</p></div></li>)}</ol></div></div>
    </>}
    </details>
    <footer className="lab-footer"><span>The computers are expensive. The ambition is yours.</span><span>1 game week = {CONTENT.clock.secondsPerWeek} seconds at 1×</span></footer>
  </StudioShell></ModelWorkspaceProvider>;
}
