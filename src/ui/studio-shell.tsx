'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Activity, ArrowUpRight, Building2, Check, CheckCircle2, ChevronRight, Circle, ClipboardCheck, Database, FlaskConical, Inbox, LayoutGrid, ListTodo, LockKeyhole, Pause, Pin, Play, Rocket, Save, Server, SlidersHorizontal, Sparkles, Settings, Terminal, Users, Volume2, VolumeX, Wallet, X } from 'lucide-react';
import { CONTENT } from '../content/catalog';
import type { CommandPayload, GameState, StaffRole } from '../contracts/types';
import type { DevelopmentTrainingOrder } from '../contracts/development-plans';
import type { DevelopmentProjectDraft, ModelBlueprint } from '../persistence/model-workspace';
import { useModelWorkspace } from './model-workspace-context';
import { recommendedDesignEvaluation } from '../core/model-evaluation-goal';
import { RESOURCE_SCALE } from '../contracts/types';
import { formatMoney } from '../core/index';
import { getStudioView } from '../core/studio';
import { getStudioWorkQueue } from '../core/studio-work-queue';
import type { StudioProject, StudioStationId, StudioStatus } from '../core/studio';
import { getStudioJourney } from '../core/studio-journey';
import type { StudioJourneyAction, StudioJourneyFocus } from '../core/studio-journey';
import { getGameSectionVisibility } from './guide-links';
import { getGameView } from '../core/selectors';
import { actionCostLabel, commandLabel, isQueued, ROLE_LABELS } from './components';
import { StudioPlanner } from './studio-planner';
import { DevelopmentPlanList, developmentPlanCounts } from './development-plans-panel';
import { ResearchProgramsWorkspace } from './research-programs-workspace';
import type { ResearchProgramsSelection } from './research-programs-workspace';
import { StudioResearchTree } from './studio-research-tree';
import { createResearchTrainingSelection } from './research-training-intent';
import { StudioResearchMethod } from './studio-research-method';
import { getResearchMethodNavigation } from './research-method-navigation';
import { getStudioDestinationForPanel, getStudioScreenTarget, resolveStudioHash } from '../core/studio-navigation';
import { StudioNavigation, StudioResearchNavigation, StudioWorkspaceHeader, StudioCapacityNavigation, StudioLockedWorkbench, getStudioPanelLock } from './studio-navigation';
import { StudioMenuDirectory } from './studio-menu-directory';
import type { StudioMenuTarget } from '../core/studio-menu-catalog';
import { StudioReleaseDesk } from './studio-release-desk';
import { StudioCampus } from './studio-campus';
import { StudioWorkbenchPanel, StudioWorkbenchProvider } from './studio-workbench-context';
import type { StudioWorkbenchVisibility } from './studio-workbench-context';
import type { StudioPlanDraft } from '../contracts/wave25-studio';
import { createStudioEditorSubmission, createStudioTaskSession, getActiveStudioTask, getStudioSubmissionContext, getStudioTaskForPanel, isStudioPanelId, isStudioTaskReviewCurrent, resolveStudioIntent, STUDIO_PANEL_TITLES, STUDIO_TASKS, studioTaskReducer, trainingBaseUnavailableReason } from '../core/studio-tasks';
import type { StudioCommandAcknowledgement, StudioIntent, StudioPanelId, StudioReturnTarget, StudioScreen, StudioSubmissionContext, StudioTaskEvent, StudioTaskId, StudioTaskOwner } from '../core/studio-tasks';
import { StudioContextMenu, StudioInspector, StudioResultCard, StudioTaskSurface } from './studio-surfaces';
import { DevelopmentNavigationProvider, StudioDevelopmentSelectionProvider, StudioCommandReviewProvider, StudioDataSelectionProvider, StudioLaunchSelectionProvider, StudioModelSelectionProvider, StudioStaffingSelectionProvider, StudioTaskActionsProvider, StudioTaskModeProvider, StudioTrainingSelectionProvider } from './studio-interaction-context';
import type { StudioDataSelection, StudioDevelopmentSelection, StudioTrainingSelection, StudioModelSelection, StudioLaunchSelection, StudioStaffingSelection, StudioTaskActions } from './studio-interaction-context';
import { StudioCommandReview } from './studio-command-review';
import { getStudioCommandReviewReason } from './studio-command-flow';
import { StudioCompanySummary } from './studio-company-summary';
import { getStudioStaffingHelpTarget } from './studio-staffing';
import { getUiCommandPreview } from './command-preview';
import { activeDevelopmentPlan } from '../modules/development-plans';
import { getCustomerBriefSpotlight } from '../modules/customer-briefs';
import { StudioOpeningJourney } from './studio-opening-journey';
import { StudioDeskContribution, StudioWeeklyWork } from './studio-weekly-work';
import { selectStudioAttention, selectStudioResults } from '../core/studio-results';
import type { StudioAttention, StudioResultTarget } from '../core/studio-results';
import { StudioResultsPanel } from './studio-results';
import type { StudioResultsInbox } from './use-studio-results';

type Screen = StudioScreen;
type ViewMode = 'studio' | 'classic';
type ProjectFilter = 'active' | 'blocked' | 'complete';
const PREFERENCE_KEY = 'frontier-lab:studio-preferences:v1';
const PANEL_TITLES = STUDIO_PANEL_TITLES;
const STATION_ART: Record<StudioStationId, { x: number; y: number; label: string; icon: typeof Database }> = {
  data: { x: 28, y: 61, label: 'Data', icon: Database },
  lab: { x: 50, y: 35, label: 'Training', icon: FlaskConical },
  models: { x: 29, y: 29, label: 'Evaluation', icon: ClipboardCheck },
  people: { x: 69, y: 72, label: 'Team', icon: Users },
  compute: { x: 72, y: 44, label: 'Compute', icon: Server },
  product: { x: 84, y: 60, label: 'Release', icon: Rocket },
};
const STUDIO_STATION_POSITIONS: Record<StudioStationId, { x: number; y: number }> = {
  data: { x: 27, y: 57 }, lab: { x: 45, y: 29 }, models: { x: 52, y: 47 },
  people: { x: 62, y: 75 }, compute: { x: 66, y: 39 }, product: { x: 77, y: 46 },
};
const CAMPUS_STATION_POSITIONS: Record<StudioStationId, { x: number; y: number }> = {
  data: { x: 23, y: 65 }, lab: { x: 34, y: 29 }, models: { x: 47, y: 51 },
  people: { x: 52, y: 80 }, compute: { x: 80, y: 39 }, product: { x: 79, y: 65 },
};
const STATUS_LABELS: Record<StudioStatus, string> = { idle: 'Ready', working: 'Working', waiting: 'Waiting', blocked: 'Blocked', complete: 'Complete' };
const TASK_PRIMARY_ACTIONS: Partial<Record<StudioTaskId, string>> = {
  'development-plan': 'development-plan', 'model-challenge': 'evaluate-model',
  'prepare-data': 'prepare-data',
  'train-model': 'train-model',
  'evaluate-model': 'evaluate-model',
  'launch-basic-chat': 'launch-basic-chat',
  'research-method': 'research-method',
  'hire-staff': 'hire-staff',
  'assign-staff': 'assign-staff',
  'allocate-compute': 'allocate-compute',
  'rent-compute': 'rent-compute',
};
const units = (n: number) => Number((n / RESOURCE_SCALE).toFixed(2)).toLocaleString();

interface StudioShellProps {
  game: GameState; paused: boolean; speed: 1 | 2 | 5; canAct: boolean; isController: boolean;
  notice: string; saveMessage: string; forceSaveOpen: boolean;
  busyMessage?: string; errorMessage?: string;
  saveKind?: 'waiting' | 'dirty' | 'saving' | 'saved' | 'failed' | 'memory';
  onToggleRunning: () => void; onStep: () => void; onSpeed: (speed: 1 | 2 | 5) => void;
  plannerEpoch: number; onPause: () => void;
  onQueue: (payload: CommandPayload) => void;
  onSubmitTask?: (payload: CommandPayload, expectedState?: GameState) => Promise<StudioCommandAcknowledgement>;
  onApplyPlan: (draft: StudioPlanDraft, sourceHash: string) => { accepted: boolean; message?: string };
  results?: StudioResultsInbox;
  children: ReactNode;
  decisionControls?: ReactNode;
  decisionRunActive?: boolean;
  onRunToDecision?: () => void;
  migrationNotice?: ReactNode;
}

function Status({ status }: { status: StudioStatus }) {
  const Icon = status === 'complete' ? CheckCircle2 : status === 'blocked' ? LockKeyhole : status === 'working' ? Activity : Circle;
  return <span className={'studio-status status-' + status}><Icon size={12} aria-hidden="true" />{STATUS_LABELS[status]}</span>;
}

/** The scene owns only presentation preferences. All commands, forms and saves remain in FrontierLab. */
export function StudioShell({ game, paused, speed, canAct, isController, notice, saveMessage, forceSaveOpen, busyMessage, errorMessage, saveKind, onToggleRunning, onStep, onSpeed, plannerEpoch, onPause, onQueue, onApplyPlan, onSubmitTask, results, children, decisionControls, decisionRunActive = false, onRunToDecision, migrationNotice }: StudioShellProps) {
  const studio = useMemo(() => getStudioView(game, CONTENT), [game]);
  const resultEntries = useMemo(() => selectStudioResults(game), [game]);
  const resultAttention = useMemo(() => {
    const issues: StudioAttention[] = [];
    if (saveKind === 'failed') issues.push({ key: 'save:failed', title: 'Save needs attention', detail: saveMessage, tone: 'warning', action: { label: 'Open save and recovery', target: { kind: 'save' } } });
    if (!isController && results?.ready) issues.push({ key: 'session:observer', title: 'Another tab controls this lab', detail: 'You can look around, but another tab is running the lab. Open Save to take control here.', tone: 'info', action: { label: 'Open session controls', target: { kind: 'save' } } });
    return selectStudioAttention(game, studio.projects, issues);
  }, [game, studio.projects, saveKind, saveMessage, isController, results?.ready]);
  const developmentPlan = useMemo(() => activeDevelopmentPlan(game) ?? Object.values(game.slices.models.developmentPlans ?? {}).filter(plan => plan.status === 'review').at(-1), [game]);
  const brief = useMemo(() => getCustomerBriefSpotlight(game), [game]);
  const sections = useMemo(() => getGameSectionVisibility(game, getGameView(game, CONTENT)), [game]);
  const [mode, setMode] = useState<ViewMode>('studio');
  const [screen, setScreen] = useState<Screen>('studio');
  const [panel, setPanel] = useState<StudioPanelId | null>(null);
  const [taskSession, dispatchTask] = useReducer(studioTaskReducer, plannerEpoch, createStudioTaskSession);
  const task = taskSession.companyEpoch === plannerEpoch ? getActiveStudioTask(taskSession) : null;
  const [resultsOpen, setResultsOpen] = useState(false);
  const [menusOpen, setMenusOpen] = useState(false);
  const [resultActionError, setResultActionError] = useState('');
  const [commandError, setCommandError] = useState('');
  const taskModal = mode === 'studio' && !!task && task.owner !== 'planner' && !forceSaveOpen && !resultsOpen && !menusOpen;
  const surfaceModal = taskModal || resultsOpen;
  const commandReviewVisible = !!task?.review && (task.phase === 'review'
    || task.phase === 'submitting' && !!getStudioCommandReviewReason(task.review.payload));
  const [modelSelection, setModelSelection] = useState<StudioModelSelection | null>(null);
  const [dataSelection, setDataSelection] = useState<StudioDataSelection | null>(null);
  const [trainingSelection, setTrainingSelection] = useState<StudioTrainingSelection | null>(null);
  const [developmentSelection, setDevelopmentSelection] = useState<StudioDevelopmentSelection | null>(null);
  const modelWorkspace = useModelWorkspace();
  const [modelDraftEpoch, setModelDraftEpoch] = useState(0);
  const [launchSelection, setLaunchSelection] = useState<StudioLaunchSelection | null>(null);
  const [staffingSelection, setStaffingSelection] = useState<StudioStaffingSelection | null>(null);
  const [plannerContext, setPlannerContext] = useState<{ title: string; reason: string }>();
  const [researchSelection, setResearchSelection] = useState<{ intentId: number; researchId: string } | null>(null);
  const [programSelection, setProgramSelection] = useState<ResearchProgramsSelection>();
  const resultsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [journeyFocus, setJourneyFocus] = useState<StudioJourneyFocus>({});
  const journey = useMemo(() => getStudioJourney(game, journeyFocus, studio.projects), [game, journeyFocus, studio.projects]);
  const [inspectedProjectId, setInspectedProjectId] = useState<string | null>(null);
  const [navigationMessage, setNavigationMessage] = useState('');
  const nextIntentId = useRef(1);
  const taskReturnFocusRef = useRef<HTMLElement | null>(null);
  const reviewedStates = useRef<Partial<Record<StudioTaskOwner, GameState>>>({});
  const inFlight = useRef<object | null>(null);
  const revision = useRef({ game, value: 0 });
  if (revision.current.game !== game) revision.current = { game, value: revision.current.value + 1 };
  const draftGenerations = useMemo<Record<string, number>>(() => ({
    ...Object.fromEntries(Object.entries(taskSession.tasks).map(([owner, record]) => [owner, record.draftGeneration])),
    'lab-projects': (taskSession.tasks['lab-projects']?.draftGeneration ?? 0) + modelDraftEpoch,
    'development-plans': (taskSession.tasks['development-plans']?.draftGeneration ?? 0) + modelDraftEpoch,
  }), [taskSession.tasks, modelDraftEpoch]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [sound, setSound] = useState(false);
  const [sceneVisible, setSceneVisible] = useState(true);
  const [prefsReady, setPrefsReady] = useState(false);
  const initialCapacityRoute = useRef(false);
  const initialNavigationIntent = useRef<StudioIntent | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('active');
  const [projectTab, setProjectTab] = useState<'work' | 'plan'>('work');
  const [completion, setCompletion] = useState('');
  const inspectorRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusRequested = useRef(false);
  const previousAnnouncement = useRef<number | null>(null);
  const soundRef = useRef<AudioContext | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const busy = !!busyMessage;
  const workbenchVisibility = useMemo<StudioWorkbenchVisibility>(() => ({
    mode, panel: resultsOpen || menusOpen || (taskModal && (commandReviewVisible || task.owner === 'research')) ? null : panel, epoch: plannerEpoch, draftGenerations,
    standalone: resultsOpen || menusOpen ? null : panel === null && screen === 'research' ? 'research-tree'
      : panel === 'capacity' || panel === null && screen === 'projects' && projectTab === 'plan' ? 'planner' : null,
  }), [mode, panel, screen, projectTab, plannerEpoch, draftGenerations, taskModal, commandReviewVisible, task?.owner, resultsOpen, menusOpen]);

  // Keep the sidebar below the real header even when a mature company's large
  // balances or enlarged text make a metric wrap. This is presentation only.
  useEffect(() => {
    const header = headerRef.current;
    const shell = shellRef.current;
    const sidebar = sidebarRef.current;
    const chrome = chromeRef.current;
    const documentRoot = document.documentElement;
    if (!header || !shell || !sidebar || typeof ResizeObserver === 'undefined') return;
    const syncHeader = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      if (height > 0) {
        shell.style.setProperty('--studio-measured-header-height', `${height}px`);
        documentRoot.style.setProperty('--studio-measured-header-height', `${height}px`);
      }
      // Compact headers are fixed and therefore absent from the chrome's flow
      // height. Keep both the header and decision feedback above a docked page.
      const fixedHeaderHeight = window.getComputedStyle(header).position === 'fixed' ? height : 0;
      const chromeHeight = chrome ? Math.ceil(chrome.getBoundingClientRect().height) + fixedHeaderHeight : height;
      if (chromeHeight > 0) {
        shell.style.setProperty('--studio-measured-chrome-height', `${chromeHeight}px`);
        documentRoot.style.setProperty('--studio-measured-chrome-height', `${chromeHeight}px`);
      }
      const sidebarHeight = Math.ceil(sidebar.getBoundingClientRect().height);
      if (sidebarHeight > 0) {
        shell.style.setProperty('--studio-measured-sidebar-height', `${sidebarHeight}px`);
        documentRoot.style.setProperty('--studio-measured-sidebar-height', `${sidebarHeight}px`);
      }
      const viewport = window.visualViewport;
      shell.style.setProperty('--studio-visual-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      shell.style.setProperty('--studio-visual-viewport-bottom', `${Math.max(0, window.innerHeight - (viewport?.offsetTop ?? 0) - (viewport?.height ?? window.innerHeight))}px`);
      shell.dataset.studioShortViewport = String((viewport?.height ?? window.innerHeight) < 480);
    };
    syncHeader();
    const observer = new ResizeObserver(syncHeader);
    observer.observe(header);
    observer.observe(sidebar);
    if (chrome) observer.observe(chrome);
    window.addEventListener('resize', syncHeader);
    window.visualViewport?.addEventListener('resize', syncHeader);
    window.visualViewport?.addEventListener('scroll', syncHeader);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncHeader);
      window.visualViewport?.removeEventListener('resize', syncHeader);
      window.visualViewport?.removeEventListener('scroll', syncHeader);
      documentRoot.style.removeProperty('--studio-measured-header-height');
      documentRoot.style.removeProperty('--studio-measured-chrome-height');
      documentRoot.style.removeProperty('--studio-measured-sidebar-height');
    };
  }, [mode]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let stored: Record<string, unknown> = {};
    try { stored = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? '{}') ?? {}; } catch { /* Visual preferences are optional. */ }
    setMode(stored.mode === 'classic' ? 'classic' : 'studio');
    setReducedMotion(typeof stored.reducedMotion === 'boolean' ? stored.reducedMotion : media.matches);
    setSound(stored.sound === true);
    setSceneVisible(stored.sceneVisible !== false);
    setPinned(Array.isArray(stored.pinned) ? stored.pinned.filter((id): id is string => typeof id === 'string').slice(0, 4) : []);
    const initialTarget = resolveStudioHash(window.location.hash);
    if (initialTarget) { setPanel(initialTarget.panel); setScreen(initialTarget.screen); initialCapacityRoute.current = initialTarget.panel === 'capacity'; initialNavigationIntent.current = initialTarget.intent ?? null; }
    setPrefsReady(true);
    const onPreferenceChange = (event: MediaQueryListEvent) => { if (event.matches) setReducedMotion(true); };
    media.addEventListener('change', onPreferenceChange);
    return () => media.removeEventListener('change', onPreferenceChange);
  }, []);

  useEffect(() => {
    dispatchTask({ type: 'resetCompany', companyEpoch: plannerEpoch });
    reviewedStates.current = {}; inFlight.current = null;
    setModelSelection(null); setDataSelection(null); setTrainingSelection(null); setDevelopmentSelection(null); setLaunchSelection(null);
    setStaffingSelection(null); setPlannerContext(undefined); setResultsOpen(false); setMenusOpen(false); setResearchSelection(null); setProgramSelection(undefined);
    setResultActionError(''); setCommandError(''); setCompletion(''); previousAnnouncement.current = null;
    setJourneyFocus({}); setInspectedProjectId(null); setNavigationMessage('');
  }, [plannerEpoch]);

  useEffect(() => {
    if (!prefsReady) return;
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify({ mode, reducedMotion, sound, sceneVisible, pinned })); } catch { /* Playing still works without preference storage. */ }
  }, [mode, reducedMotion, sound, sceneVisible, pinned, prefsReady]);

  const openPlannerWithContext = useCallback((context?: { title: string; reason: string }) => {
    if (forceSaveOpen || busy || inFlight.current || task?.phase === 'submitting') return;
    setPlannerContext(context); setMenusOpen(false); setResultsOpen(false); setResultActionError('');
    setInspectedProjectId(null); setNavigationMessage(''); setCommandError('');
    if (taskSession.detour?.owner === 'planner') {
      dispatchTask({ type: 'return' });
    } else if (task?.owner === 'planner') {
      // All Capacity entry points refer to this same retained resource plan.
    } else if (task && !taskSession.detour) {
      dispatchTask({ type: 'detour', destination: { screen: 'operations', panel: 'capacity', focusId: 'studio-plan-workbench' } });
    } else if (taskSession.detour && task) {
      dispatchTask({ type: 'close' });
    } else if (!taskSession.detour) {
      dispatchTask({ type: 'open', task: 'plan-week', returnTo: { screen, panel, projectTab } });
    }
    onPause(); setScreen('operations'); setPanel('capacity');
    requestAnimationFrame(() => { document.getElementById('studio-plan-workbench')?.focus({ preventScroll: true }); shellRef.current?.querySelector<HTMLElement>('.studio-play-area')?.scrollTo({ top: 0, behavior: 'auto' }); window.scrollTo({ top: 0, behavior: 'auto' }); });
  }, [forceSaveOpen, busy, task, taskSession.detour, screen, panel, projectTab, onPause]);

  useEffect(() => {
    if (!prefsReady || !initialCapacityRoute.current) return;
    initialCapacityRoute.current = false;
    if (forceSaveOpen) return;
    dispatchTask({ type: 'open', task: 'plan-week', returnTo: { screen: 'operations', panel: 'people' } });
    onPause();
  }, [prefsReady, forceSaveOpen, onPause]);

  useEffect(() => {
    if (!prefsReady || !initialNavigationIntent.current || forceSaveOpen || busy) return;
    const intent = initialNavigationIntent.current;
    initialNavigationIntent.current = null;
    openNavigationIntent(intent);
  }, [prefsReady, forceSaveOpen, busy]);

  const openPanel = useCallback((id: string, _legacyScreen?: Screen) => {
    if (!isStudioPanelId(id) || task?.phase === 'submitting') return;
    if (forceSaveOpen && id !== 'save') return;
    if (id === 'capacity') { openPlannerWithContext(); return; }
    const destination: StudioReturnTarget = id === 'development-plans'
      ? { screen: 'projects', panel: null, projectTab: 'work' }
      : { screen: getStudioDestinationForPanel(id), panel: id, projectTab };
    if (task && task.owner !== id && !taskSession.detour) dispatchTask({ type: 'detour', destination });
    else if (task) dispatchTask({ type: 'close' });
    setInspectedProjectId(null); setNavigationMessage('');
    setMenusOpen(false); setResultsOpen(false); setResultActionError(''); setCommandError('');
    if (!panel || !inspectorRef.current?.contains(document.activeElement)) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    focusRequested.current = true;
    setScreen(destination.screen);
    setPanel(destination.panel);
    if (id === 'development-plans') {
      setProjectTab('work');
      const plans = developmentPlanCounts(game);
      setProjectFilter(plans.active > 0 || plans.complete === 0 ? 'active' : 'complete');
    }
  }, [panel, forceSaveOpen, task, taskSession.detour, screen, projectTab, openPlannerWithContext, game]);

  function openResearchPanel(panelId: string, researchId?: string) {
    const selection = createResearchTrainingSelection(panelId, researchId, nextIntentId.current);
    if (selection) { nextIntentId.current++; setTrainingSelection(selection); }
    openPanel(panelId, 'research');
  }

  useEffect(() => {
    const followHash = () => {
      const target = resolveStudioHash(window.location.hash);
      if (!target || forceSaveOpen || task?.phase === 'submitting') return;
      if (target.intent) openNavigationIntent(target.intent);
      else if (window.location.hash === '#development-plans') openPanel('development-plans');
      else if (target.panel) openPanel(target.panel);
      else { dispatchTask({ type: 'close' }); setScreen(target.screen); setPanel(null); if (target.screen === 'projects') setProjectTab('work'); }
    };
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, [openPanel, forceSaveOpen, task?.phase]);

  const closePanel = useCallback(() => {
    if (forceSaveOpen) return;
    setPanel(null);
    setInspectedProjectId(null); setNavigationMessage('');
    if (screen !== 'studio' && screen !== 'projects' && screen !== 'research') setScreen('studio');
    requestAnimationFrame(() => {
      const target = returnFocusRef.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else if (screen === 'research') document.getElementById('studio-research-tree')?.focus();
      else document.querySelector<HTMLButtonElement>('.studio-brand')?.focus();
    });
  }, [screen, forceSaveOpen]);

  useEffect(() => {
    if ((panel || inspectedProjectId) && mode === 'studio' && !taskModal && focusRequested.current) {
      focusRequested.current = false;
      const id = requestAnimationFrame(() => {
        if (panel === 'capacity') document.getElementById('studio-plan-workbench')?.focus({ preventScroll: true });
        else inspectorRef.current?.focus({ preventScroll: true });
        if (window.matchMedia('(max-width: 899px)').matches) inspectorRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [panel, mode, screen, inspectedProjectId, taskModal]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && mode === 'studio' && !surfaceModal && (panel || inspectedProjectId)) { event.preventDefault(); closePanel(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, panel, closePanel, surfaceModal, inspectedProjectId]);

  useEffect(() => { if (forceSaveOpen) { dispatchTask({ type: 'close' }); setResultsOpen(false); setPanel('save'); setScreen('save'); } }, [forceSaveOpen]);

  useEffect(() => {
    const announcement = results?.announcement;
    if (results?.ready && announcement && previousAnnouncement.current !== announcement.id) {
      previousAnnouncement.current = announcement.id;
      const completed = resultEntries.filter(result => announcement.keys.includes(result.key));
      if (completed.length) {
        setCompletion(completed.length === 1 ? completed[0].title : completed.length + ' new outcomes');
        if (sound && soundRef.current?.state === 'running') {
          const context = soundRef.current, gain = context.createGain(), oscillator = context.createOscillator();
          oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, context.currentTime);
          oscillator.frequency.setValueAtTime(880, context.currentTime + 0.08);
          gain.gain.setValueAtTime(0.025, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.24);
          oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.25);
        }
      }
    }
  }, [results?.announcement, results?.ready, resultEntries, sound]);

  useEffect(() => { if (completion) { const timer = window.setTimeout(() => setCompletion(''), 4000); return () => window.clearTimeout(timer); } }, [completion]);
  useEffect(() => () => { void soundRef.current?.close(); }, []);

  function toggleSound() {
    if (!sound) {
      try { soundRef.current ??= new AudioContext(); void soundRef.current.resume(); } catch { return; }
    }
    setSound(!sound);
  }

  function activateSound() {
    if (!sound) return;
    try { soundRef.current ??= new AudioContext(); void soundRef.current.resume(); } catch { /* Sound never gates simulation. */ }
  }

  function openResults() {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    resultsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenusOpen(false); setResultActionError(''); setResultsOpen(true);
  }

  function closeResults() { setResultsOpen(false); setResultActionError(''); }

  function openMenus() {
    if (forceSaveOpen || busy || inFlight.current || task?.phase === 'submitting') return;
    menuReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setResultsOpen(false); setResultActionError(''); setMenusOpen(true); onPause();
  }

  function closeMenus() {
    setMenusOpen(false);
    requestAnimationFrame(() => {
      const target = menuReturnFocusRef.current;
      if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
    });
  }

  function navigateMenuTarget(target: StudioMenuTarget) {
    if (forceSaveOpen || busy || inFlight.current) return;
    setMenusOpen(false);
    if (target.kind === 'screen') selectScreen(target.screen);
    else if (target.kind === 'panel') openPanel(target.panel);
    else openNamedTask(target.task);
  }

  useEffect(() => {
    if (forceSaveOpen) setMenusOpen(false);
    const navigate = (event: KeyboardEvent) => {
      if (mode !== 'studio' || event.defaultPrevented || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (menusOpen) closeMenus(); else openMenus();
      } else if (menusOpen && event.key === 'Escape') {
        event.preventDefault(); closeMenus();
      }
    };
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [mode, menusOpen, forceSaveOpen, busy, task?.phase]);

  function resultUnavailable() {
    setResultActionError('This result is no longer available. Choose another result from the list.');
  }

  function revealClassicPanel(id: string) {
    if (mode !== 'classic') return;
    requestAnimationFrame(() => {
      const element = document.getElementById(id);
      element?.scrollIntoView({ block: 'start', behavior: 'auto' });
      element?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function openResultTask(taskId: StudioTaskId, intent: StudioIntent) {
    const owner = STUDIO_TASKS[taskId].owner;
    const keepParent = !!taskSession.detour || (!!task && task.owner !== owner);
    if (task && task.owner !== owner && !taskSession.detour) dispatchTask({ type: 'detour', destination: { screen, panel: owner === 'planner' ? null : owner, projectTab } });
    openTask(taskId, intent, keepParent);
    revealClassicPanel(owner);
  }

  function openNavigationIntent(intent: StudioIntent) {
    if (busy || forceSaveOpen || task?.phase === 'submitting' || inFlight.current) return;
    const resolved = resolveStudioIntent(game, intent);
    if (!resolved.ok) { showUnavailableTarget(resolved.reason, intent); return; }
    if (resolved.task) openResultTask(resolved.task, intent);
  }

  function followResult(target: StudioResultTarget) {
    if (busy || forceSaveOpen || task?.phase === 'submitting' || inFlight.current) return;
    if (target.kind === 'intent') {
      const resolved = resolveStudioIntent(game, target.intent);
      if (!resolved.ok) { setResultActionError(resolved.reason); return; }
      closeResults();
      if (target.intent.kind === 'training-result' || target.intent.kind === 'model') openResultTask('evaluate-model', target.intent);
      else if (target.intent.kind === 'report') { openEntity(target.intent); revealClassicPanel('models'); }
      else if (resolved.task) openResultTask(resolved.task, target.intent);
      else if (resolved.panel !== 'planner') { openPanel(resolved.panel); revealClassicPanel(resolved.panel); }
      return;
    }
    if (target.kind === 'research') {
      const project = game.slices.research.projects[target.projectId];
      if (project?.companyId !== game.playerCompanyId || project.researchId !== target.researchId || !CONTENT.research.some(item => item.id === target.researchId)) { resultUnavailable(); return; }
      setResearchSelection({ intentId: nextIntentId.current++, researchId: target.researchId });
      closeResults();
      // Research's exact detail lives in the Studio tree, which is also the
      // named destination for a Classic inbox follow-up.
      if (mode === 'classic') setMode('studio');
      openResearchTree();
      return;
    }
    if (target.kind === 'staff') {
      if (target.staffId && game.slices.company.staff[target.staffId]?.companyId !== game.playerCompanyId) { resultUnavailable(); return; }
      if (mode === 'classic') setMode('studio');
      closeResults(); assignStaff(target.staffId); return;
    }
    if (target.kind === 'save') { closeResults(); openPanel('save', 'save'); revealClassicPanel('save'); return; }
    const projectId = target.kind === 'product' ? target.deploymentId : target.projectId;
    const project = projectId ? studio.projects.find(item => item.id === projectId) : undefined;
    if (projectId && !project) { resultUnavailable(); return; }
    if (target.kind === 'product') {
      const deployment = game.slices.products.deployments[target.deploymentId], product = game.slices.products.offers[target.productId];
      if (deployment?.companyId !== game.playerCompanyId || deployment.productId !== target.productId || deployment.modelId !== target.modelId
        || product?.companyId !== game.playerCompanyId || product.deploymentId !== deployment.id) { resultUnavailable(); return; }
    }
    closeResults();
    if (target.kind === 'resources') {
      openPlannerWithContext(project ? { title: project.title, reason: project.bottleneck || project.detail } : undefined);
      if (mode === 'classic') setMode('studio');
    } else if (project) {
      if (task && !taskSession.detour) dispatchTask({ type: 'detour', destination: { screen: 'projects', panel: null, projectTab: 'work' } });
      inspectProject(project); setScreen('projects'); setProjectTab('work');
      if (mode === 'classic') setMode('studio');
    }
  }

  function selectScreen(next: Screen) {
    if (forceSaveOpen && next !== 'save' || task?.phase === 'submitting') return;
    const target = getStudioScreenTarget(next);
    dispatchTask({ type: 'close' }); dispatchTask({ type: 'clearDetour' });
    setMenusOpen(false); setResultsOpen(false); setResultActionError(''); setCommandError(''); setInspectedProjectId(null); setNavigationMessage(''); setScreen(target.screen); setPanel(target.panel);
    if (target.screen === 'projects') setProjectTab('work');
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(target.panel ? '#studio-inspector' : target.screen === 'research' ? '#studio-research-tree' : target.screen === 'projects' ? '#studio-project-board' : '.studio-brand')?.focus({ preventScroll: true });
      shellRef.current?.querySelector<HTMLElement>('.studio-play-area')?.scrollTo({ top: 0, behavior: 'auto' });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }

  function openResearchMethod(researchId: string) {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    const target = getResearchMethodNavigation(game, sections, researchId);
    if (target.kind === 'unavailable') { setNavigationMessage(target.reason); return; }
    setResearchSelection({ intentId: nextIntentId.current++, researchId });
    if (target.kind === 'tree') {
      if (mode === 'classic') setMode('studio');
      openResearchTree(target.focusId);
      return;
    }
    openResultTask('research-method', { kind: 'research-method', researchId });
  }

  function openModelDesigner() {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    setTrainingSelection({ intentId: nextIntentId.current++, designer: 'custom' });
    openResultTask('train-model', { kind: 'task', task: 'train-model' });
  }

  function delegateTraining(training: DevelopmentTrainingOrder, project?: DevelopmentProjectDraft) {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    setDevelopmentSelection({ intentId: nextIntentId.current++, blueprint: {
      id: 'current-design', name: project?.name ?? training.modelDesign?.name ?? 'Delegated training',
      training: structuredClone(training), suiteId: project?.suiteId ?? recommendedDesignEvaluation(training).suiteId,
    }, ...(project ? { project: structuredClone(project) } : {}) });
    openResultTask('development-plan', { kind: 'task', task: 'development-plan' });
  }

  function editTraining(blueprint: ModelBlueprint, project?: DevelopmentProjectDraft) {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    setTrainingSelection({ intentId: nextIntentId.current++, blueprint: structuredClone(blueprint), ...(project ? { project: structuredClone(project) } : {}) });
    openResultTask('train-model', { kind: 'task', task: 'train-model' });
  }

  function resetTaskDraft() {
    if (task?.owner === 'lab-projects' || task?.owner === 'development-plans') {
      modelWorkspace?.setDraft('manual', null); modelWorkspace?.setDraft('delegated', null);
      modelWorkspace?.setDevelopmentGoal(null); setTrainingSelection(null); setDevelopmentSelection(null);
      setModelDraftEpoch(value => value + 1);
      dispatchTask({ type: 'resetDraft', owner: 'lab-projects' });
      dispatchTask({ type: 'resetDraft', owner: 'development-plans' });
      return;
    }
    dispatchTask({ type: 'resetDraft' });
  }

  function openResearchTree(focusId?: 'research-tree-details') {
    if (forceSaveOpen || task?.phase === 'submitting') return;
    if (task && !taskSession.detour) dispatchTask({ type: 'detour', destination: { screen: 'research', panel: null, focusId: 'studio-research-tree' } });
    else if (taskSession.detour && task) dispatchTask({ type: 'close' });
    setMenusOpen(false); setResultsOpen(false); setResultActionError(''); setNavigationMessage(''); setScreen('research'); setPanel(null);
    requestAnimationFrame(() => {
      const target = document.getElementById(focusId ?? 'studio-research-tree');
      target?.focus({ preventScroll: true });
      if (focusId) target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      else { shellRef.current?.querySelector<HTMLElement>('.studio-play-area')?.scrollTo({ top: 0, behavior: 'auto' }); window.scrollTo({ top: 0, behavior: 'auto' }); }
    });
  }

  function openPlanner() {
    const currentProject = studio.projects.find(project => project.id === inspectedProjectId);
    openPlannerWithContext(currentProject ? { title: currentProject.title, reason: currentProject.bottleneck || currentProject.detail }
      : task && task.owner !== 'planner' ? { title: STUDIO_TASKS[task.task].title, reason: 'Check your staff and compute, then return to your choices.' } : undefined);
  }


  function applyReturnTarget(target: StudioReturnTarget) {
    setScreen(target.panel ? getStudioDestinationForPanel(target.panel) : getStudioScreenTarget(target.screen).screen); setPanel(target.panel);
    if (target.projectTab) setProjectTab(target.projectTab);
  }

  function closeTask() {
    if (!task || task.phase === 'submitting' || inFlight.current) return;
    if (taskSession.detour && task.owner !== taskSession.detour.owner) { returnFromDetour(); return; }
    dispatchTask({ type: 'close' }); applyReturnTarget(task.returnTo);
  }

  function taskForPanel(id: string): StudioTaskId | null {
    if (id === 'product' && Object.values(game.slices.products.offers).some(product => product.companyId === game.playerCompanyId && product.kind === 'basic-chat')) return 'manage-basic-chat';
    return getStudioTaskForPanel(id);
  }

  function openTask(taskId: StudioTaskId, intent?: StudioIntent, keepParent = false) {
    if (forceSaveOpen || busy || inFlight.current) return;
    setMenusOpen(false); setCommandError('');
    if (taskId === 'plan-week') { openPlanner(); return; }
    const owner = STUDIO_TASKS[taskId].owner;
    if (getStudioPanelLock(owner, sections)) { openPanel(owner); return; }
    if (taskId === 'launch-basic-chat' && taskForPanel('product') === 'manage-basic-chat') { openPanel('product'); return; }
    const resolved = resolveStudioIntent(game, intent ?? { kind: 'task', task: taskId });
    if (!resolved.ok) { showUnavailableTarget(resolved.reason, intent); return; }
    if (taskId === 'architecture-research' || taskId === 'research-program') {
      setProgramSelection({ intentId: nextIntentId.current++, programType: taskId === 'architecture-research' ? 'architecture' : 'systems',
        ...(resolved.target?.kind === 'research-experiment' ? { experimentId: resolved.target.experimentId } : {}) });
    }
    if (resolved.target?.kind === 'research-method') {
      setResearchSelection({ intentId: nextIntentId.current++, researchId: resolved.target.researchId });
    } else if (resolved.target?.kind === 'staffing') {
      setStaffingSelection({ ...resolved.target, intentId: nextIntentId.current++ });
    } else if (resolved.target?.kind === 'data' || resolved.target?.kind === 'training-data') {
      const selection = { intentId: nextIntentId.current++, packetId: resolved.target.packetId };
      if (resolved.target.kind === 'data') setDataSelection(selection);
      else setTrainingSelection(selection);
      setJourneyFocus({ packetId: resolved.target.packetId });
    } else if (resolved.target?.kind === 'training-base') {
      setTrainingSelection({ intentId: nextIntentId.current++, baseModelId: resolved.target.baseModelId });
    } else if (resolved.target?.kind === 'first-launch') {
      setLaunchSelection({ intentId: nextIntentId.current++, modelId: resolved.target.modelId, reportId: resolved.target.reportId });
      setJourneyFocus({ candidateId: resolved.target.modelId, reportId: resolved.target.reportId });
    } else if (resolved.target && 'modelId' in resolved.target) {
      setModelSelection({ intentId: nextIntentId.current++, modelId: resolved.target.modelId,
        ...(resolved.target.kind === 'report' ? { reportId: resolved.target.reportId } : {}) });
      setJourneyFocus({ candidateId: resolved.target.modelId,
        ...(resolved.target.kind === 'training-result' ? { trainingRunId: resolved.target.runId } : {}),
        ...(resolved.target.kind === 'report' ? { reportId: resolved.target.reportId } : {}) });
    }
    const returningParent = taskSession.detour?.owner === STUDIO_TASKS[taskId].owner
      ? taskSession.tasks[taskSession.detour.owner] : null;
    if (!keepParent && !returningParent) taskReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A helper that targets the parent owner resumes that same form. Keeping
    // its old detour identity would create a stale self-return link.
    if (returningParent) dispatchTask({ type: 'return' });
    else if (taskSession.detour && !keepParent) dispatchTask({ type: 'clearDetour' });
    dispatchTask({ type: 'open', task: taskId, ...(intent ? { intent } : {}), returnTo: returningParent?.returnTo
      ?? (task?.owner === STUDIO_TASKS[taskId].owner ? task.returnTo : { screen, panel, projectTab }) });
    setPanel(STUDIO_TASKS[taskId].owner as StudioPanelId); setScreen(getStudioDestinationForPanel(STUDIO_TASKS[taskId].owner as StudioPanelId)); setNavigationMessage('');
    if (!intent) setInspectedProjectId(null);
    onPause();
  }

  function showUnavailableTarget(reason: string, intent?: StudioIntent) {
    const intentId = nextIntentId.current++;
    if (intent?.kind === 'research-method') {
      setResearchSelection({ intentId, researchId: intent.researchId });
      openTask('research-method');
    } else if (intent?.kind === 'research-experiment') {
      setProgramSelection({ intentId, programType: 'systems', experimentId: intent.experimentId });
      openPanel('research-programs');
    } else if (intent?.kind === 'staffing') {
      setStaffingSelection({ intentId, mode: intent.mode, staffId: null, unavailableReason: reason });
      openPanel('people', 'studio');
    } else if (intent?.kind === 'data' || intent?.kind === 'training-data') {
      const selection = { intentId, packetId: null, unavailableReason: reason };
      if (intent.kind === 'data') setDataSelection(selection); else setTrainingSelection(selection);
      openPanel(intent.kind === 'data' ? 'data' : 'lab-projects', 'projects');
    } else if (intent?.kind === 'training-base') {
      setTrainingSelection({ intentId, baseModelId: null, unavailableReason: reason }); openPanel('lab-projects', 'projects');
    } else if (intent?.kind === 'first-launch') {
      setLaunchSelection({ intentId, modelId: null, unavailableReason: reason }); openPanel('product', 'market');
    } else {
      setModelSelection({ intentId, modelId: null, unavailableReason: reason }); openPanel('models', 'projects');
    }
    setNavigationMessage(reason);
  }

  function openEntity(intent: StudioIntent, asTask = false) {
    const resolved = resolveStudioIntent(game, intent);
    if (!resolved.ok) { showUnavailableTarget(resolved.reason, intent); return; }
    if (resolved.target && 'modelId' in resolved.target) {
      if (asTask) { openTask('evaluate-model', intent); return; }
      setModelSelection({ intentId: nextIntentId.current++, modelId: resolved.target.modelId,
        ...(resolved.target.kind === 'report' ? { reportId: resolved.target.reportId } : {}) });
      setJourneyFocus({ candidateId: resolved.target.modelId,
        ...(resolved.target.kind === 'training-result' ? { trainingRunId: resolved.target.runId } : {}),
        ...(resolved.target.kind === 'report' ? { reportId: resolved.target.reportId } : {}) });
      openPanel('models', 'projects');
    }
  }

  function returnFromDetour() {
    const parent = taskSession.detour && taskSession.tasks[taskSession.detour.owner];
    if (!parent || forceSaveOpen || busy || inFlight.current) return;
    dispatchTask({ type: 'return' }); onPause();
    if (parent.owner === 'planner') { setScreen('operations'); setPanel('capacity'); }
    else { setPanel(parent.owner); setScreen(getStudioDestinationForPanel(parent.owner)); }
  }

  function prepareSelectedData(packetId: string) {
    if (forceSaveOpen || busy || inFlight.current) return;
    const fromTraining = task?.owner === 'lab-projects' || (!task && panel === 'lab-projects');
    if (fromTraining && !taskSession.detour) {
      if (!task) {
        taskReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dispatchTask({ type: 'open', task: 'train-model', returnTo: { screen, panel, projectTab } });
      }
      dispatchTask({ type: 'detour', destination: { screen, panel: 'data', projectTab } });
      openTask('prepare-data', { kind: 'data', packetId }, true);
    } else openTask('prepare-data', { kind: 'data', packetId });
  }

  function openStaffing(mode: 'hire' | 'assign', role?: StaffRole, staffId?: string, reason?: string) {
    if (forceSaveOpen || busy || inFlight.current || task?.phase === 'submitting') return;
    const keepParent = !!taskSession.detour || (!!task && task.owner !== 'people');
    if (task && task.owner !== 'people' && !taskSession.detour) {
      dispatchTask({ type: 'detour', destination: { screen, panel: 'people', projectTab } });
    }
    openTask(mode === 'hire' ? 'hire-staff' : 'assign-staff', { kind: 'staffing', mode, ...(role ? { role } : {}), ...(staffId ? { staffId } : {}), ...(reason ? { reason } : {}) }, keepParent);
  }

  function hireStaff(role?: StaffRole, reason?: string) { openStaffing('hire', role, undefined, reason); }
  function assignStaff(staffId?: string, reason?: string) { openStaffing('assign', undefined, staffId, reason); }

  function continueTraining(baseModelId: string) {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    openResultTask('train-model', { kind: 'training-base', baseModelId });
  }

  function openTrainingDataLibrary() {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    setDataSelection({ intentId: nextIntentId.current++, view: 'catalog' });
    onPause(); openPanel('data'); revealClassicPanel('data');
  }

  function openNamedTask(taskId: StudioTaskId) {
    if (taskId === 'hire-staff') { hireStaff(); return; }
    if (taskId === 'assign-staff') { assignStaff(); return; }
    openResultTask(taskId, { kind: 'task', task: taskId });
  }

  function reviewResearchStaff(role: StaffRole) {
    const target = getStudioStaffingHelpTarget(game, role);
    openStaffing(target.mode, target.role, target.staffId,
      target.mode === 'hire' ? 'Hire a ' + ROLE_LABELS[role].toLowerCase() + ' specialist for this research.'
        : 'See who contributes to ' + ROLE_LABELS[role].toLowerCase() + ' work each week.');
  }

  function launchBasicChat(modelId: string, reportId?: string) {
    if (forceSaveOpen || busy || inFlight.current) return;
    if (taskForPanel('product') === 'manage-basic-chat') {
      setLaunchSelection({ intentId: nextIntentId.current++, modelId, reportId });
      setJourneyFocus({ candidateId: modelId, reportId });
      dispatchTask({ type: 'close' });
      if (taskSession.detour) dispatchTask({ type: 'clearDetour' });
      openPanel('product', 'market');
      setNavigationMessage('Basic Chat is already open. Manage it or choose a new model below.');
      return;
    }
    openTask('launch-basic-chat', { kind: 'first-launch', candidateId: modelId, ...(reportId ? { reportId } : {}) });
  }

  function openProductForModel(kind: 'developer-api' | 'business-docs', modelId: string, reportId?: string) {
    if (forceSaveOpen || busy || inFlight.current || task?.phase === 'submitting') return;
    const ownModel = game.slices.models.versions[modelId]?.companyId === game.playerCompanyId;
    setLaunchSelection({ intentId: nextIntentId.current++, productKind: kind, modelId: ownModel ? modelId : null,
      ...(reportId ? { reportId } : {}), ...(!ownModel ? { unavailableReason: 'This project model is unavailable. Choose another model explicitly.' } : {}) });
    onPause(); dispatchTask({ type: 'close' });
    if (taskSession.detour) dispatchTask({ type: 'clearDetour' });
    const destination = kind === 'developer-api' ? 'developer-api' : 'business-commitments';
    openPanel(destination); revealClassicPanel(destination);
  }

  function followJourney(action: StudioJourneyAction) {
    switch (action.kind) {
      case 'prepare': prepareSelectedData(action.packetId); break;
      case 'train': openTask('train-model', action.packetId ? { kind: 'training-data', packetId: action.packetId } : undefined); break;
      case 'continue-training': continueTraining(action.baseModelId); break;
      case 'evaluate': openTask('evaluate-model', { kind: 'model', modelId: action.modelId }); break;
      case 'report': openEntity({ kind: 'report', reportId: action.reportId }); break;
      case 'launch': launchBasicChat(action.modelId, action.reportId); break;
      case 'project': {
        const project = studio.projects.find(item => item.id === action.projectId);
        if (project) inspectProject(project);
        else setNavigationMessage('This project is no longer available. Choose another project.');
        break;
      }
      case 'resources': openPlanner(); break;
      case 'product': openPanel('product', 'market'); break;
      case 'choose': document.getElementById('studio-journey-candidate')?.focus(); break;
    }
  }

  function viewQueuedDecision() {
    if (forceSaveOpen || busy || task?.phase === 'submitting' || inFlight.current) return;
    dispatchTask({ type: 'close' }); setScreen('projects'); setProjectTab('work'); setProjectFilter('active'); setPanel(null); setInspectedProjectId(null);
    if (taskSession.detour) dispatchTask({ type: 'clearDetour' });
    requestAnimationFrame(() => {
      const queue = document.getElementById('studio-work-queue');
      const target = queue ?? document.getElementById('studio-project-board');
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }

  function advanceScheduledWeek() {
    const acknowledgement = task?.acknowledgement;
    if (!canAct || !paused || busy || forceSaveOpen || inFlight.current || task?.phase !== 'queued'
      || acknowledgement?.status !== 'accepted'
      || !game.queuedCommands.some(command => command.id === acknowledgement.commandId)) return;
    viewQueuedDecision(); activateSound(); onStep();
  }

  function refreshReview() {
    if (!task?.review || busy) return;
    reviewedStates.current[task.owner] = game;
    dispatchTask({ type: 'review', sourceRevision: revision.current.value, payload: task.review.payload });
  }

  async function submitCapturedCommand(payload: CommandPayload, context: StudioSubmissionContext, expectedState: GameState, event: StudioTaskEvent) {
    if (!onSubmitTask || !canAct || busy || forceSaveOpen || inFlight.current) return;
    if (expectedState !== game) {
      setCommandError('Your lab changed. Check the updated costs and choose again.');
      return;
    }
    const preview = getUiCommandPreview(game, payload, CONTENT);
    if (!preview.accepted || isQueued(game, payload)) {
      setCommandError(isQueued(game, payload) ? 'This action is already scheduled for Week ' + (game.week + 1) + '.'
        : preview.reason?.message ?? 'Check the requirements before scheduling this action.');
      return;
    }
    const next = getActiveStudioTask(studioTaskReducer(taskSession, event));
    if (next?.phase !== 'submitting' || next.requestId !== context.requestId) return;
    setCommandError('');
    const request = {}; inFlight.current = request;
    dispatchTask(event);
    try {
      const acknowledgement = await onSubmitTask(payload, expectedState);
      dispatchTask({ type: 'acknowledge', context, acknowledgement });
      if (acknowledgement.status === 'accepted' && inFlight.current === request) {
        const command = { id: acknowledgement.commandId, effectiveWeek: acknowledgement.effectiveWeek, payload };
        if (payload.kind === 'prepare_data') setJourneyFocus({ packetId: payload.packetId, command });
        if (payload.kind === 'start_training') setJourneyFocus({ packetId: payload.packetId, trainingRunId: 'training-' + acknowledgement.commandId, command });
        if (payload.kind === 'evaluate_model') setJourneyFocus({ candidateId: payload.modelId, command });
        if (payload.kind === 'deploy_product' && (!payload.productKind || payload.productKind === 'basic-chat')) setJourneyFocus({ candidateId: payload.modelId, command });
      }
    } catch {
      dispatchTask({ type: 'acknowledge', context, acknowledgement: { status: 'rejected', reason: 'Couldn’t schedule this action. Check the requirements and try again.' } });
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }

  function confirmTask() {
    const context = getStudioSubmissionContext(taskSession);
    if (!context || !task?.review || !paused || !isStudioTaskReviewCurrent(task, revision.current.value)) return;
    const expectedState = reviewedStates.current[task.owner];
    if (!expectedState) return;
    void submitCapturedCommand(task.review.payload, context, expectedState, { type: 'submit', context, payload: task.review.payload });
  }

  // A stable context dispatcher avoids bypassing the retained-workbench memo
  // policy when another task opens, the clock changes or a hidden form is kept.
  const reviewHandler = useRef<(payload: CommandPayload, label: string, quotedState?: GameState) => boolean>(() => false);
  reviewHandler.current = (payload, _label, quotedState) => {
    const ownerTask = payload.kind === 'start_research_experiment' ? 'research-program'
      : payload.kind === 'start_model_research' || payload.kind === 'set_model_research_paused' ? 'research-program'
      : task?.task ?? (panel ? taskForPanel(panel) : screen === 'research' ? 'research-method' : null);
    if (mode !== 'studio' || !ownerTask || ownerTask === 'plan-week') return false;
    if (forceSaveOpen || busy || !canAct || inFlight.current || task?.phase === 'submitting') return true;
    if (quotedState && quotedState !== game) {
      setCommandError('Your lab changed. Check the updated costs and choose again.');
      return true;
    }
    setCommandError('');
    const requiresReview = !!getStudioCommandReviewReason(payload);
    if (!task || task.task !== ownerTask) {
      taskReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (requiresReview) dispatchTask({ type: 'open', task: ownerTask, returnTo: { screen, panel, projectTab } });
    }
    if (STUDIO_TASKS[ownerTask].owner === 'research') {
      const researchId = payload.kind === 'start_research' ? payload.researchId
        : payload.kind === 'set_research_paused' ? game.slices.research.projects[payload.projectId]?.researchId : undefined;
      if (researchId) setResearchSelection({ intentId: nextIntentId.current++, researchId });
    }
    setPanel(STUDIO_TASKS[ownerTask].owner as StudioPanelId);
    setScreen(getStudioDestinationForPanel(STUDIO_TASKS[ownerTask].owner as StudioPanelId));
    onPause();
    if (requiresReview) {
      reviewedStates.current[STUDIO_TASKS[ownerTask].owner] = game;
      dispatchTask({ type: 'review', sourceRevision: revision.current.value, payload });
    } else {
      const submission = createStudioEditorSubmission(taskSession, {
        task: ownerTask, returnTo: { screen, panel, projectTab }, sourceRevision: revision.current.value, payload,
      });
      if (submission) void submitCapturedCommand(submission.payload, submission.context, game, submission);
    }
    return true;
  };
  const reviewCommand = useCallback((payload: CommandPayload, label: string, quotedState?: GameState) => reviewHandler.current(payload, label, quotedState), []);

  const developmentHandlers = useRef({ continueTraining, openDataLibrary: openTrainingDataLibrary });
  developmentHandlers.current = { continueTraining, openDataLibrary: openTrainingDataLibrary };
  const developmentNavigation = useMemo(() => ({
    continueTraining: (baseModelId: string) => developmentHandlers.current.continueTraining(baseModelId),
    openDataLibrary: () => developmentHandlers.current.openDataLibrary(),
  }), []);

  const actionHandlers = useRef<StudioTaskActions>({ prepareData: prepareSelectedData, evaluateModel: modelId => openTask('evaluate-model', { kind: 'model', modelId }), launchBasicChat, openProductForModel, reviewReport: reportId => openEntity({ kind: 'report', reportId }), reviewResources: openPlanner, hireStaff, assignStaff, openTask: openNamedTask, openResearch: openResearchMethod, openModelDesigner, delegateTraining, editTraining });
  actionHandlers.current = { prepareData: prepareSelectedData, evaluateModel: modelId => openTask('evaluate-model', { kind: 'model', modelId }), launchBasicChat, openProductForModel, reviewReport: reportId => openEntity({ kind: 'report', reportId }), reviewResources: openPlanner, hireStaff, assignStaff, openTask: openNamedTask, openResearch: openResearchMethod, openModelDesigner, delegateTraining, editTraining };
  const taskActions = useMemo<StudioTaskActions>(() => ({
    prepareData: packetId => actionHandlers.current.prepareData(packetId),
    evaluateModel: modelId => actionHandlers.current.evaluateModel(modelId),
    launchBasicChat: (modelId, reportId) => actionHandlers.current.launchBasicChat(modelId, reportId),
    openProductForModel: (kind, modelId, reportId) => actionHandlers.current.openProductForModel?.(kind, modelId, reportId),
    reviewReport: reportId => actionHandlers.current.reviewReport?.(reportId),
    reviewResources: () => actionHandlers.current.reviewResources(),
    hireStaff: (role, reason) => actionHandlers.current.hireStaff(role, reason),
    assignStaff: (staffId, reason) => actionHandlers.current.assignStaff(staffId, reason),
    openTask: taskId => actionHandlers.current.openTask?.(taskId),
    openResearch: researchId => actionHandlers.current.openResearch?.(researchId),
    openModelDesigner: () => actionHandlers.current.openModelDesigner?.(),
    delegateTraining: (training, project) => actionHandlers.current.delegateTraining?.(training, project),
    editTraining: (blueprint, project) => actionHandlers.current.editTraining?.(blueprint, project),
  }), []);

  function inspectProject(project: StudioProject) {
    if (forceSaveOpen || task?.phase === 'submitting') return;
    dispatchTask({ type: 'close' });
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusRequested.current = true;
    setPanel(null); setInspectedProjectId(project.id); setNavigationMessage('');
  }

  function stationActions(target: StudioPanelId) {
    const registered = taskForPanel(target);
    return [
      { id: 'inspect', label: 'Inspect ' + PANEL_TITLES[target].toLowerCase(), description: 'See progress and available actions.', onSelect: () => openPanel(target) },
      ...(target === 'people' ? [
        { id: 'hire', label: 'Hire staff', description: 'Check hiring costs, weekly pay and start dates.', onSelect: () => hireStaff() },
        { id: 'assign', label: 'Team output', description: 'See which points your team generates each week.', onSelect: () => assignStaff() },
      ] : target === 'compute' ? [
        { id: 'allocate', label: 'Allocate compute', description: 'Split capacity between serving, development and research.', onSelect: () => openNamedTask('allocate-compute') },
        { id: 'rent', label: 'Rent or release compute', description: 'Review the cloud capacity and weekly bill.', onSelect: () => openNamedTask('rent-compute') },
      ] : registered ? [{ id: 'task', label: STUDIO_TASKS[registered].title, description: 'Choose settings and review the cost.', onSelect: () => openTask(registered) }] : []),
      { id: 'resources', label: 'Plan people and compute', description: 'Plan next week’s staff and compute.', onSelect: openPlanner },
    ];
  }

  function followLink(event: MouseEvent<HTMLElement>) {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!anchor) return;
    const id = anchor.getAttribute('href')?.slice(1) ?? '';
    const target = resolveStudioHash(id);
    if (target?.intent) { event.preventDefault(); openNavigationIntent(target.intent); return; }
    if (mode !== 'studio') return;
    if (id === 'lab') { event.preventDefault(); if (taskModal) closeTask(); else closePanel(); return; }
    if (id === 'planner' || id === 'studio-plan-workbench') { event.preventDefault(); openPlanner(); return; }
    if (id === 'development-plans') { event.preventDefault(); openPanel(id); return; }
    if (target) { event.preventDefault(); if (target.panel) openPanel(target.panel); else selectScreen(target.screen); }
  }

  function togglePin(id: string) {
    setPinned(current => current.includes(id) ? current.filter(item => item !== id) : [...current.slice(-3), id]);
  }

  const s = studio.summary;
  const ownDevelopmentPlans = Object.values(game.slices.models.developmentPlans ?? {}).filter(plan => plan.companyId === game.playerCompanyId);
  const { individualProjects, planStageJobs, blockedPlanIds } = getStudioWorkQueue(game, studio.projects);
  const planCounts = developmentPlanCounts(game, blockedPlanIds);
  const projectMatches = (project: StudioProject, filter: ProjectFilter) => filter === 'complete' ? project.status === 'complete' : filter === 'blocked' ? project.status === 'blocked' : project.status !== 'complete';
  const projectCounts = Object.fromEntries((['active', 'blocked', 'complete'] as const).map(filter => [filter, individualProjects.filter(project => projectMatches(project, filter)).length + planCounts[filter]])) as Record<ProjectFilter, number>;
  const activeProjects = individualProjects.filter(project => project.status !== 'complete');
  const pinnedProjects = pinned.map(id => studio.projects.find(project => project.id === id)).filter((item): item is StudioProject => !!item).slice(0, 4);
  const skipTarget = menusOpen ? 'studio-menu-directory' : surfaceModal ? 'studio-decision-title' : panel === 'capacity' ? 'studio-plan-workbench' : !panel && screen === 'studio' ? 'studio-workstations' : !panel && screen === 'projects' ? projectTab === 'plan' ? 'studio-plan-workbench' : 'studio-project-board' : !panel && screen === 'research' ? 'studio-research-tree' : 'studio-inspector';
  const expandedStudio = studio.roomTier !== 'garage';
  const campusStudio = studio.roomTier === 'campus';
  const pendingCommands = game.queuedCommands.filter(command => command.companyId === game.playerCompanyId);
  const queuedChanges = pendingCommands.filter(command => command.payload.kind !== 'start_development_plan');
  const filteredProjects = individualProjects.filter(project => projectMatches(project, projectFilter));
  const inspectedProject = inspectedProjectId ? studio.projects.find(project => project.id === inspectedProjectId) : null;
  const resultIntent: StudioIntent | null = inspectedProject?.status === 'complete' && inspectedProject.kind === 'training'
    ? { kind: 'training-result', runId: inspectedProject.id }
    : inspectedProject?.status === 'complete' && inspectedProject.kind === 'evaluation' && game.slices.models.evaluationRuns[inspectedProject.id]?.reportId
      ? { kind: 'report', reportId: game.slices.models.evaluationRuns[inspectedProject.id].reportId! } : null;
  const finishedModelId = resultIntent?.kind === 'training-result' ? game.slices.models.trainingRuns[resultIntent.runId]?.outputModelId : undefined;
  const acceptedCommand = task?.acknowledgement?.status === 'accepted' ? task.acknowledgement : null;
  const acceptancePending = !!acceptedCommand && pendingCommands.some(command => command.id === acceptedCommand.commandId);
  const receiptJourney = acceptedCommand && task?.review && (['prepare_data', 'start_training', 'evaluate_model'].includes(task.review.payload.kind)
    || task.review.payload.kind === 'deploy_product' && (!task.review.payload.productKind || task.review.payload.productKind === 'basic-chat'))
    ? getStudioJourney(game, { command: { id: acceptedCommand.commandId, effectiveWeek: acceptedCommand.effectiveWeek, payload: task.review.payload } }, studio.projects) : null;
  const detourParent = taskSession.detour ? taskSession.tasks[taskSession.detour.owner] : null;
  const returnLabel = detourParent?.task === 'train-model' ? 'Return to training'
    : detourParent?.task === 'launch-basic-chat' ? 'Return to launch'
      : detourParent?.task === 'evaluate-model' ? 'Return to evaluation'
        : detourParent?.task === 'prepare-data' ? 'Return to data'
          : detourParent?.owner === 'people' ? 'Return to staffing'
            : detourParent?.task === 'plan-week' ? 'Return to resource plan'
              : detourParent ? 'Back to your choices' : 'Return to task';
  const taskTitle = commandReviewVisible ? 'Review: ' + commandLabel(task!.review!.payload)
    : task?.owner === 'research-programs' ? 'Manage research programs' : task ? STUDIO_TASKS[task.task].title : 'Company workbench';
  const taskBusy = busy || task?.phase === 'submitting';
  const staleReview = !!task?.review && !isStudioTaskReviewCurrent(task, revision.current.value);
  const reviewAccepted = !!task?.review && (task.phase === 'review' || task.phase === 'submitting') && getUiCommandPreview(game, task.review.payload, CONTENT).accepted;
  const reviewCost = task?.review ? actionCostLabel(getUiCommandPreview(game, task.review.payload, CONTENT)) : '';
  const resumeDrafts = Object.values(taskSession.tasks).filter(record => record.owner !== 'planner' && record.owner !== taskSession.activeOwner && record.phase !== 'queued');
  const station = studio.stations.find(item => item.targetPanel === panel);
  // The engineering bench reflects shared team activity. Individual grants are not tracked.
  const hasEngineer = Object.values(game.slices.company.staff).some(member => member.companyId === game.playerCompanyId && member.role === 'ml' && member.readyWeek <= game.week);
  const engineerWorking = !paused && game.slices.company.lastStaff[game.playerCompanyId]?.granted.ml > 0
    && studio.stations.some(item => item.id === 'lab' && item.status === 'working');
  const panelLock = panel ? getStudioPanelLock(panel, sections) : null;
  const methodTask = taskModal && task?.owner === 'research';
  const preferenceItems = [
    { id: 'results', label: 'Results', description: `${results?.unreadCount ?? 0} unreviewed outcomes`, disabled: forceSaveOpen || busy, onSelect: openResults },
    { id: 'save', label: 'Save & load', description: saveMessage, onSelect: () => openPanel('save') },
    { id: 'view', label: mode === 'studio' ? 'Switch to Classic' : 'Switch to Studio', description: 'Choose the layout you prefer.', disabled: forceSaveOpen || taskBusy, onSelect: () => { dispatchTask({ type: 'close' }); setMode(mode === 'studio' ? 'classic' : 'studio'); } },
    { id: 'scene', label: sceneVisible ? 'Use workstation list' : 'Show studio room', description: sceneVisible ? 'The studio room is visible.' : 'Workstations are shown as a list.', onSelect: () => setSceneVisible(!sceneVisible) },
    { id: 'motion', label: reducedMotion ? 'Allow motion' : 'Reduce motion', description: reducedMotion ? 'Reduced motion is on.' : 'Reduced motion is off.', onSelect: () => setReducedMotion(!reducedMotion) },
    { id: 'sound', label: sound ? 'Mute completion sounds' : 'Enable completion sounds', description: sound ? 'Completion sounds are on.' : 'Completion sounds are off.', onSelect: toggleSound },
  ];

  const projectCard = (project: StudioProject, compact = false) => <article className={'studio-project-card ' + (compact ? 'compact' : '')} key={project.id}>
    <button className="studio-project-open" type="button" onClick={() => inspectProject(project)}>
      <span className="studio-project-kicker">{project.kind}<Status status={project.status} /></span>
      <strong>{project.title}</strong>
      <progress value={project.progressBps} max={10000} aria-label={project.title + ' progress'} />
      <span className="studio-project-detail">{project.bottleneck || project.detail}</span>
      <span className="studio-project-percent">{Math.floor(project.progressBps / 100)}% <ChevronRight size={14} aria-hidden="true" /></span>
    </button>
    <button type="button" className="studio-pin" aria-label={(pinned.includes(project.id) ? 'Unpin ' : 'Pin ') + project.title} aria-pressed={pinned.includes(project.id)} onClick={() => togglePin(project.id)}><Pin size={13} /></button>
  </article>;

  return <StudioWorkbenchProvider value={workbenchVisibility}><StudioCommandReviewProvider value={mode === 'studio' ? reviewCommand : null}><main id="lab" ref={shellRef} className={'lab-shell ' + (mode === 'studio' ? 'studio-mode' : 'classic-mode') + (reducedMotion ? ' reduced-motion' : '')} data-studio-panel={panel ?? ''} data-screen={screen} data-project-tab={projectTab} data-task-modal={surfaceModal || undefined} onClickCapture={followLink}>
    <div className="studio-classic-entry"><button type="button" onClick={() => setMode('studio')}><LayoutGrid size={15} /> Open Studio</button><span>The same company, in a new light.</span><button type="button" className="studio-results-toggle" onClick={openResults} disabled={forceSaveOpen || busy} aria-label={'Open Results, ' + (results?.unreadCount ?? 0) + ' unreviewed'}><Inbox size={16} />Results<strong>{results?.unreadCount ?? 0}</strong></button></div>
    {mode === 'classic' && migrationNotice}
    <div className="studio-only studio-chrome" ref={chromeRef}>
      <a className="skip-link" href={'#' + skipTarget}>{skipTarget === 'studio-workstations' ? 'Skip to workstations' : skipTarget === 'studio-project-board' ? 'Skip to projects' : 'Skip to workbench'}</a>
      <header className="studio-header" ref={headerRef}>
        <button className="studio-brand" type="button" onClick={() => selectScreen('studio')} aria-label="Frontier Lab studio home"><span className="studio-brand-symbol"><FlaskConical size={24} strokeWidth={1.7} /></span><span><strong>Frontier Lab<span className="studio-brand-dot">.</span></strong><small>THE STUDIO ERA</small></span></button>
        <StudioCompanySummary summary={s} disabled={forceSaveOpen || busy} onOpenPanel={openPanel} />
        <div className="studio-clock" aria-busy={busy}><span className="studio-week">Week <strong>{String(game.week).padStart(2, '0')}</strong></span><span className={'studio-clock-label ' + (!busy && !paused ? 'is-running' : '')}><span />{busy ? 'Working' : paused ? 'Paused' : decisionRunActive ? 'Decision run' : 'Continuous play'}</span><button className="studio-play" type="button" onClick={() => { activateSound(); onToggleRunning(); }} disabled={!canAct || busy} aria-label={paused ? 'Resume simulation' : 'Pause simulation'}>{paused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}</button><div className="studio-speeds" role="group" aria-label="Simulation speed">{([1, 2, 5] as const).map(value => <button type="button" key={value} aria-pressed={speed === value} onClick={() => onSpeed(value)} disabled={!isController || busy}>{value}×</button>)}</div><button className="studio-step" type="button" onClick={() => { activateSound(); onStep(); }} disabled={!canAct || busy}>Next week <ChevronRight size={15} /></button></div>
      </header>
      <div className="studio-sidebar" ref={sidebarRef}>
        <StudioNavigation screen={screen} disabled={forceSaveOpen || task?.phase === 'submitting'} projectCount={activeProjects.length + planCounts.active} onSelect={selectScreen} />
        <div className="studio-utilities" aria-label="Lab utilities"><button type="button" className="studio-all-menus-toggle" aria-expanded={menusOpen} aria-controls="studio-menu-directory" aria-keyshortcuts="Control+K Meta+K" onClick={menusOpen ? closeMenus : openMenus} disabled={forceSaveOpen || busy}><LayoutGrid size={17} />All menus</button><button type="button" className="studio-results-toggle" onClick={openResults} disabled={forceSaveOpen || busy} aria-label={'Open Results, ' + (results?.unreadCount ?? 0) + ' unreviewed'}><Inbox size={17} />Results<strong>{results?.unreadCount ?? 0}</strong></button>
          <button type="button" onClick={() => openPanel('save')}><Save size={15} />Save</button>
          <StudioContextMenu label="Settings and utilities" trigger={<button type="button" aria-label="Settings and utilities"><Settings size={15} />Settings</button>} items={preferenceItems} />
        </div>
      </div>
      <div className="studio-status-line" role="status" aria-live="polite" aria-atomic="true"><span><span className="studio-status-dot" />{busyMessage || notice}</span>{s.queuedCount > 0 && <button type="button" onClick={viewQueuedDecision} disabled={forceSaveOpen || busy}>{s.queuedCount} queued for W{game.week + 1}<ChevronRight size={13} /></button>}</div>
      {decisionControls}
      {mode === 'studio' && migrationNotice}
      {(errorMessage || commandError) && <p className="error-message studio-operation-error" role="alert">{commandError || errorMessage}</p>}
      {navigationMessage && <p className="studio-task-navigation-note" role="status">{navigationMessage}</p>}
      {completion && <div className="studio-result-announcement" role="status" aria-live="polite"><CheckCircle2 size={17} aria-hidden="true" /><span>{completion}</span><button type="button" onClick={openResults} disabled={forceSaveOpen || busy}>View results<ChevronRight size={14} /></button></div>}
      {detourParent && !taskModal && <div className="studio-task-return"><span>Your choices will be here when you return.</span><button type="button" onClick={returnFromDetour} disabled={busy || forceSaveOpen}>{returnLabel}<ChevronRight size={15} /></button></div>}
      {!taskModal && !taskSession.detour && resumeDrafts.length > 0 && <div className="studio-task-drafts" aria-label="Task drafts"><span>Drafts</span>{resumeDrafts.map(record => <button key={record.owner} type="button" onClick={() => openTask(record.task)} disabled={forceSaveOpen || busy}>Continue: {STUDIO_TASKS[record.task].title}<ChevronRight size={14} /></button>)}</div>}
    </div>

    {menusOpen && <div className="studio-menu-host studio-only" id="studio-menu-directory" role="region" aria-label="All menus workspace" tabIndex={-1}><StudioMenuDirectory sections={sections} disabled={forceSaveOpen || busy} onNavigate={navigateMenuTarget} onClose={closeMenus} /></div>}
    <div className="studio-play-area" hidden={menusOpen}>
      <StudioWorkspaceHeader screen={screen} panel={panel} projectTab={projectTab} sections={sections} disabled={forceSaveOpen || task?.phase === 'submitting'} onDevelop={openModelDesigner} onSelect={id => {
        if (id === 'plan' || id === 'capacity') openPlanner();
        else if (id === 'work') { setProjectTab('work'); selectScreen('projects'); }
        else openPanel(id);
      }} />
      {screen === 'operations' && <StudioCapacityNavigation panel={panel} sections={sections} disabled={forceSaveOpen || task?.phase === 'submitting'} onSelect={id => id === 'capacity' ? openPlanner() : openPanel(id)} />}
      <section className="studio-research-heading studio-only" hidden={screen !== 'research'} aria-label="Research workspace">
        <span className="studio-eyebrow">THE RESEARCH NOTEBOOK</span>
        <div className="studio-project-heading"><div><h1>Find your next breakthrough.</h1><p>Choose a discovery, check what it needs, and put it to work.</p></div><span className="studio-research-count">{CONTENT.research.length}<small>discoveries</small></span></div>
        <StudioResearchNavigation panel={panel} activeTask={task?.task} sections={sections} disabled={forceSaveOpen || task?.phase === 'submitting'} onNavigate={navigateMenuTarget} />
      </section>
      <div className="studio-world studio-only">
        {screen === 'studio' && <>
          <div className="studio-scene-heading"><div><span className="studio-eyebrow">{campusStudio ? 'CHAPTER 03 / THE CAMPUS' : expandedStudio ? 'CHAPTER 02 / THE STUDIO' : 'CHAPTER 01 / THE GARAGE'}</span><h1>{campusStudio ? 'Your campus' : expandedStudio ? 'Your studio' : 'Your garage'}</h1></div><div className="studio-room-controls"><span className="studio-room-label"><span />{studio.companyName}</span><div className="studio-room-view" role="group" aria-label="Workstation view"><button type="button" aria-pressed={sceneVisible} onClick={() => setSceneVisible(true)}><LayoutGrid size={15} />Room</button><button type="button" aria-pressed={!sceneVisible} onClick={() => setSceneVisible(false)}><ListTodo size={15} />List</button></div></div></div>
          <div className="studio-room-progress"><span><Sparkles size={13} />{campusStudio ? 'Your own data center unlocked the Campus' : expandedStudio ? 'Your first sale unlocked the Studio' : 'Make your first sale to unlock the larger Studio'}</span><button type="button" onClick={openPlanner}>Plan next week<ArrowUpRight size={13} /></button></div>
          <StudioWeeklyWork game={game} projects={studio.projects} onInspect={inspectProject} />
          <div className="studio-room-viewport" id="studio-workstations" tabIndex={-1} aria-label="Workstations">
          {sceneVisible && !sceneFailed && <div className={'studio-scene' + (campusStudio ? ' room-campus' : expandedStudio ? ' room-studio' : '')} aria-label="Interactive isometric studio">
            <img key={studio.roomTier} className="studio-room-art" src={campusStudio ? '/studio/campus-room-night.webp' : expandedStudio ? '/studio/studio-room-night.webp' : '/studio/garage-room-night.webp'} width={1536} height={1024} alt={campusStudio ? 'A night-lit campus with computing benches, a tree-lined courtyard, cooling equipment and a glass server hall. Decorative machinery is not a count of installed racks.' : expandedStudio ? 'A cool blue studio with four workstations, cyan monitors, two server racks and a softly lit meeting corner.' : 'A night-lit isometric garage with two workstations, cyan monitors, slate floors, a test board, a server rack and a team corner.'} loading={expandedStudio ? 'lazy' : 'eager'} fetchPriority={expandedStudio ? 'auto' : 'high'} onError={() => setSceneFailed(true)} />
            <div className={'studio-founder at-data' + (!paused ? ' is-idle' : '')} title="Founder · automatic project support" aria-hidden="true"><img src="/studio/founder.webp" width={1208} height={1302} alt="" /></div>
            {hasEngineer && <div className={'studio-founder at-lab' + (engineerWorking ? ' is-working' : !paused ? ' is-idle' : '')} title="ML engineering desk" aria-hidden="true"><img src="/studio/engineer.webp" width={1208} height={1302} alt="" /></div>}
            {!reducedMotion && <StudioDeskContribution game={game} />}
            {studio.stations.map(item => { const art = { ...STATION_ART[item.id], ...(campusStudio ? CAMPUS_STATION_POSITIONS[item.id] : expandedStudio ? STUDIO_STATION_POSITIONS[item.id] : {}) }; return <StudioContextMenu key={item.id} label={item.title} items={stationActions(item.targetPanel)} trigger={<button type="button" className={'studio-hotspot status-' + item.status + (panel === item.targetPanel ? ' is-selected' : '') + (paused ? ' is-paused' : '')} style={{ '--station-x': art.x + '%', '--station-y': art.y + '%' } as CSSProperties} aria-label={item.title + ' actions, ' + STATUS_LABELS[item.status]}><art.icon size={16} /><span>{art.label}</span><small>{STATUS_LABELS[item.status]}</small></button>} />; })}
          </div>}
          {(!sceneVisible || sceneFailed) && <div className="studio-station-list">
            <p className="studio-list-note">Choose a workstation to see its tasks.</p>
            {studio.stations.map(item => { const Icon = STATION_ART[item.id].icon; return <StudioContextMenu key={item.id} label={item.title} items={stationActions(item.targetPanel)} trigger={<button type="button" aria-label={item.title + ' actions'}><Icon size={20} /><span><strong>{STATION_ART[item.id].label}</strong><small>{item.bottleneck || item.detail}</small></span><Status status={item.status} /><ChevronRight size={16} /></button>} />; })}
          </div>}
          </div>
          {pinnedProjects.length > 0 && <section className="studio-pinned" aria-label="Pinned projects"><div className="studio-block-title"><h2><Pin size={14} />Pinned projects <small>{pinnedProjects.length}/4</small></h2><button type="button" onClick={() => { setProjectTab('work'); selectScreen('projects'); }}>All projects <ArrowUpRight size={14} /></button></div><div className="studio-pinned-grid">{pinnedProjects.map(project => projectCard(project, true))}</div></section>}
        </>}

        {screen === 'projects' && <section className="studio-project-board" id="studio-project-board" tabIndex={-1}>
          <span className="studio-eyebrow">THE WORKBENCH</span>
          <div className="studio-project-heading"><div><h1>{projectTab === 'plan' ? 'Make next week count.' : 'Ideas in motion.'}</h1><p>{projectTab === 'plan' ? 'Put your people and machines behind the work that matters.' : 'See what’s running and what needs your help.'}</p></div><span className="studio-planning-week">W{game.week + 1}<small>next week</small></span></div>
          <div className="studio-project-tabs" role="group" aria-label="Project workbench">
            <button type="button" aria-pressed={projectTab === 'work'} onClick={() => setProjectTab('work')}><ListTodo size={15} />Work queue</button>
            <button type="button" aria-pressed={projectTab === 'plan'} onClick={openPlanner}><SlidersHorizontal size={15} />Plan week</button>
          </div>
          <div hidden={projectTab !== 'work'}>
            {queuedChanges.length > 0 && <section id="studio-work-queue" className="studio-command-queue" tabIndex={-1} aria-label="Changes queued for next week"><div className="studio-block-title"><h2>Queued for Week {game.week + 1}<small>{queuedChanges.length} change{queuedChanges.length === 1 ? '' : 's'}</small></h2><span>{formatMoney(queuedChanges.reduce((total, command) => total + (command.reservedCents ?? 0), 0))} reserved</span></div><ol>{queuedChanges.map((command, index) => <li key={command.id}><span className="studio-queue-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{commandLabel(command.payload)}</strong><small>{command.payload.kind === 'apply_studio_plan' ? command.payload.commands.length + (command.payload.commands.length === 1 ? ' change' : ' changes') + ' · all changes must be possible for this plan to go ahead' : 'Checked when next week starts'}</small></div><span>{command.reservedCents ? formatMoney(command.reservedCents) : 'No upfront fee'}</span></li>)}</ol></section>}
            <div className="studio-project-toolbar"><div className="studio-filter-row" role="group" aria-label="Filter projects">{(['active', 'blocked', 'complete'] as const).map(filter => <button type="button" key={filter} aria-pressed={projectFilter === filter} onClick={() => setProjectFilter(filter)}>{filter === 'active' ? 'Active' : filter === 'blocked' ? 'Blocked' : 'Complete'} <small>{projectCounts[filter]}</small></button>)}</div><button type="button" onClick={openPlanner}>Review capacity</button></div>
            {ownDevelopmentPlans.some(plan => plan.status === 'review') && projectFilter !== 'complete' && <button type="button" className="studio-project-ready" onClick={() => setProjectFilter('complete')}>Review completed development plans ({ownDevelopmentPlans.filter(plan => plan.status === 'review').length})</button>}
            {planCounts[projectFilter] > 0 && <DevelopmentNavigationProvider value={developmentNavigation}><StudioTaskActionsProvider value={taskActions}>
              <DevelopmentPlanList game={game} canAct={canAct} onQueue={onQueue} paused={paused} decisionRunActive={decisionRunActive} onRun={onRunToDecision} filter={projectFilter} blockedPlanIds={blockedPlanIds} renderStages={plan => {
                const jobs = planStageJobs[plan.id] ?? [];
                return jobs.length > 0 ? <details className="studio-plan-stage-jobs"><summary>Stage jobs ({jobs.length})</summary><div className="studio-project-grid">{jobs.map(project => projectCard(project, true))}</div></details> : null;
              }} />
            </StudioTaskActionsProvider></DevelopmentNavigationProvider>}
            <div className="studio-project-grid">{filteredProjects.map(project => projectCard(project))}</div>
            {projectCounts[projectFilter] === 0 && <div className="studio-empty-board"><ListTodo size={30} /><h2>{projectFilter === 'blocked' ? 'No blocked projects' : projectFilter === 'complete' ? 'No finished projects yet' : 'No projects running'}</h2><p>{projectFilter === 'blocked' ? 'Projects with a missing resource will appear here.' : 'Prepare data, develop a model, or begin a discovery. Individual jobs and delegated plans appear together here.'}</p><button className="studio-primary" type="button" onClick={() => { const nextTask = taskForPanel(studio.nextAction.targetPanel); if (nextTask) openTask(nextTask); else openPanel(studio.nextAction.targetPanel); }}>{studio.nextAction.actionLabel}</button></div>}
            <div className="studio-workbench-shortcuts">{studio.stations.map(item => <button type="button" key={item.id} onClick={() => openPanel(item.targetPanel)}>{item.title}<ChevronRight size={13} /></button>)}</div>
          </div>
        </section>}
      </div>

      <div className="studio-planner-host studio-only" id="studio-plan-workbench" tabIndex={-1} hidden={panel !== 'capacity' && (screen !== 'projects' || projectTab !== 'plan' || panel !== null)}>
        {task?.owner === 'planner' && <div className="studio-task-return"><span>Planning keeps the lab paused.</span><button type="button" onClick={closeTask} disabled={busy}>Back and keep plan<ChevronRight size={15} /></button><button type="button" onClick={resetTaskDraft} disabled={busy}>Reset plan</button></div>}
        <div className="studio-workbench-shortcuts" aria-label="Focused staffing decisions"><button type="button" disabled={forceSaveOpen || busy} onClick={() => hireStaff(undefined, plannerContext?.reason)}>Hire staff<ChevronRight size={14} /></button><button type="button" disabled={forceSaveOpen || busy} onClick={() => assignStaff(undefined, plannerContext?.reason)}>Team output<ChevronRight size={14} /></button></div>
        <StudioWorkbenchPanel panelId="planner" studioOnly><StudioPlanner key={plannerEpoch} game={game} paused={paused} canAct={canAct} onApplyPlan={onApplyPlan} context={plannerContext} /></StudioWorkbenchPanel>
      </div>
      <div className="studio-research-host studio-only" id="studio-research-tree" tabIndex={-1} hidden={screen !== 'research' || panel !== null}>
        <StudioWorkbenchPanel panelId="research-tree" studioOnly><StudioResearchTree key={plannerEpoch} game={game} canAct={canAct} onQueue={onQueue} onOpenPanel={openResearchPanel} selection={researchSelection} onOpenMethod={openResearchMethod} onOpenDesigner={openModelDesigner} catalogLock={getStudioPanelLock('research', sections)} /></StudioWorkbenchPanel>
      </div>
      <aside id="studio-inspector" className={'studio-inspector ' + ((panel || inspectedProject) && !taskModal ? 'has-selection' : '')} ref={inspectorRef} tabIndex={-1} aria-label={mode === 'studio' ? panel ? PANEL_TITLES[panel] + ' inspector' : 'Company workbench' : undefined}>
        <div className="studio-only" hidden={surfaceModal}>
          {screen === 'studio' && !panel && !inspectedProject && developmentPlan && <section className="studio-brief-reminder" aria-label="Current development plan"><div className="studio-brief-heading"><FlaskConical size={16} /><strong>{developmentPlan.status === 'review' ? 'Ready for your decision' : 'Delegated development'}</strong><span>Due week {developmentPlan.deadlineWeek}</span></div><h2>{developmentPlan.name}</h2><p>{developmentPlan.message}</p><button type="button" onClick={() => openPanel('development-plans', 'projects')}>Open development plan</button></section>}
          {screen === 'studio' && !panel && !inspectedProject && (brief || expandedStudio) && (
            <section className="studio-brief-reminder" aria-label="Customer briefs">
              <div className="studio-brief-heading"><ClipboardCheck size={16} aria-hidden="true" /><strong>{brief?.status === 'active' ? 'Client delivery' : brief ? 'Latest client delivery' : 'Customer briefs'}</strong>
                {brief?.status === 'active' && <span>Due week {brief.deadlineWeek}</span>}
              </div>
              {brief ? <><h2>{brief.title}</h2><p>{brief.progressText}</p></> : <p>Take on a short client project between company milestones.</p>}
              <button type="button" className="studio-brief-link" onClick={() => openTask('customer-brief')} disabled={forceSaveOpen || busy}>{brief?.status === 'active' ? 'Review delivery' : 'Open brief board'}</button>
            </section>
          )}
          {panel ? <>
            <div className="studio-inspector-top"><span className="studio-eyebrow">{screen === 'studio' || screen === 'projects' ? 'WORKSTATION' : screen.toUpperCase()}</span><button type="button" className="studio-close" disabled={forceSaveOpen} aria-label="Close inspector" onClick={closePanel}><X size={18} /></button></div>
            {forceSaveOpen && <p className="studio-review-note">Finish or cancel loading this save to return to your lab.</p>}
            <div className="studio-inspector-title"><h2>{PANEL_TITLES[panel]}</h2>{station && <Status status={station.status} />}</div>
            {station && <p className={'studio-inspector-subtitle ' + (station.bottleneck ? 'has-blocker' : '')}>{station.bottleneck || station.detail}</p>}
            {taskForPanel(panel) && !panelLock && !['people', 'compute', 'research-programs'].includes(panel) && <div className="studio-task-entry-actions">
              {panel === 'people' ? <><button type="button" className="studio-primary studio-open-task" disabled={forceSaveOpen || busy} onClick={() => hireStaff()}>Hire staff<ArrowUpRight size={15} /></button><button type="button" className="studio-surface-button" disabled={forceSaveOpen || busy} onClick={() => assignStaff()}>Team output<ArrowUpRight size={15} /></button></>
                : panel === 'compute' ? <><button type="button" className="studio-primary studio-open-task" disabled={forceSaveOpen || busy} onClick={() => openNamedTask('allocate-compute')}>Allocate compute<ArrowUpRight size={15} /></button><button type="button" className="studio-surface-button" disabled={forceSaveOpen || busy} onClick={() => openNamedTask('rent-compute')}>Rent or release compute<ArrowUpRight size={15} /></button></>
                : <button type="button" className="studio-primary studio-open-task" disabled={forceSaveOpen || busy} onClick={() => openTask(taskForPanel(panel)!)}>{STUDIO_TASKS[taskForPanel(panel)!].title}<ArrowUpRight size={15} /></button>}
            </div>}
            {panelLock && <StudioLockedWorkbench title={PANEL_TITLES[panel]} reason={panelLock} onResearch={() => openResearchTree()} onStudio={() => selectScreen('studio')} />}

          </> : inspectedProject ? <StudioInspector title={inspectedProject.title} status={<Status status={inspectedProject.status} />} description={inspectedProject.bottleneck || inspectedProject.detail} onClose={closePanel} actions={<><button type="button" className="studio-surface-button" onClick={() => inspectedProject.targetIntent ? openNavigationIntent(inspectedProject.targetIntent) : inspectedProject.targetTask ? openNamedTask(inspectedProject.targetTask) : openPanel(inspectedProject.targetPanel)}>Open project menu<ArrowUpRight size={15} /></button><button type="button" className="studio-surface-button" onClick={openPlanner}>Review people and compute</button>{inspectedProject.status !== 'complete' && <><button type="button" className="studio-surface-button" onClick={() => hireStaff(undefined, inspectedProject.bottleneck || inspectedProject.detail)}>Review hiring</button><button type="button" className="studio-surface-button" onClick={() => assignStaff(undefined, inspectedProject.bottleneck || inspectedProject.detail)}>View team output</button></>}</>}>
            <progress value={inspectedProject.progressBps} max={10000} aria-label={inspectedProject.title + ' progress'} />
            {resultIntent && <StudioResultCard title={inspectedProject.kind === 'training' ? 'Model ready' : 'Test complete'} identity={inspectedProject.title} summary={inspectedProject.kind === 'training' ? 'Your trained model is ready to inspect. Test it before choosing where to launch.' : 'See this model and its test results.'} action={{ label: inspectedProject.kind === 'training' ? 'View this model' : 'View this report', onClick: () => openEntity(resultIntent) }} />}
            {resultIntent?.kind === 'training-result' && <button type="button" className="studio-surface-button studio-surface-primary" onClick={() => openEntity(resultIntent, true)} disabled={busy}>Test this model<ArrowUpRight size={15} /></button>}
            {finishedModelId && !trainingBaseUnavailableReason(game, finishedModelId) && <button type="button" className="studio-surface-button" onClick={() => continueTraining(finishedModelId)} disabled={busy}>Continue training this version</button>}
          </StudioInspector> : studio.nextAction.stage !== 'grow' ? <StudioOpeningJourney journey={journey} milestones={studio.milestones} paused={paused} disabled={forceSaveOpen || busy} weeklyBaseCostCents={s.weeklyBaseCostCents} onAction={followJourney} onChooseCandidate={candidateId => setJourneyFocus({ candidateId })} /> : <section className="studio-next-move"><span className="studio-eyebrow">YOUR NEXT MOVE</span><div className="studio-next-icon"><Sparkles size={24} strokeWidth={1.5} /></div><h2>{studio.nextAction.title}</h2><p>{studio.nextAction.detail}</p><button className="studio-primary" type="button" onClick={() => { const nextTask = taskForPanel(studio.nextAction.targetPanel); if (nextTask) openTask(nextTask); else openPanel(studio.nextAction.targetPanel); }}>{studio.nextAction.actionLabel}<ArrowUpRight size={16} /></button><div className="studio-journey"><h3>{studio.nextAction.stage === 'grow' ? 'Your first launch' : 'The road to your first sale'}</h3><ol>{studio.milestones.map((item, index) => <li key={item.id} className={item.complete ? 'is-done' : ''}><button type="button" onClick={() => openPanel(item.targetPanel)}><span className="studio-journey-step">{item.complete ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span><span>{item.label}</span>{item.complete ? <CheckCircle2 size={14} /> : <ChevronRight size={14} />}</button></li>)}</ol></div><div className="studio-weekly-cost"><Wallet size={17} /><span>Keep the lights on<strong>{formatMoney(s.weeklyBaseCostCents)}<small> / week base costs</small></strong></span></div></section>}
        </div>
        <StudioTaskModeProvider value={taskModal ? task.task : null}><StudioModelSelectionProvider value={modelSelection}>
        <DevelopmentNavigationProvider value={developmentNavigation}><StudioDataSelectionProvider value={dataSelection}><StudioTrainingSelectionProvider value={trainingSelection}><StudioDevelopmentSelectionProvider value={developmentSelection}><StudioLaunchSelectionProvider value={launchSelection}><StudioStaffingSelectionProvider value={staffingSelection}><StudioTaskActionsProvider value={mode === 'studio' ? taskActions : null}>
          <StudioTaskSurface docked={mode === 'studio'} id="studio-decision" className={'studio-desktop-task studio-task-' + (task?.task ?? 'inspect') + ' studio-task-phase-' + (task?.phase ?? 'inspect')} mode={surfaceModal ? 'dialog' : 'inline'} title={resultsOpen ? 'Results' : taskTitle} eyebrow={resultsOpen ? 'Your lab notebook' : commandReviewVisible ? 'Review your choice' : 'Make a plan'} description={resultsOpen ? 'Catch up on finished work and choose what to do next.' : task?.phase === 'editing' && !TASK_PRIMARY_ACTIONS[task.task] ? 'Choose your settings and schedule the action at the quoted cost.' : undefined}
            returnFocusRef={resultsOpen ? resultsReturnFocusRef : taskReturnFocusRef} fallbackFocusRef={inspectorRef} busy={resultsOpen ? false : taskBusy} closeDisabled={resultsOpen ? false : taskBusy || forceSaveOpen} onClose={resultsOpen ? closeResults : closeTask} closeLabel={resultsOpen ? 'Close Results' : 'Close and keep draft'}
            onBack={resultsOpen ? closeResults : task?.phase === 'review' ? () => dispatchTask({ type: 'back' }) : closeTask} backLabel={resultsOpen ? task && task.owner !== 'planner' ? 'Back to ' + STUDIO_TASKS[task.task].title.toLowerCase() : 'Back to lab' : task?.phase === 'review' ? 'Back to setup' : detourParent ? returnLabel : 'Back'}
            status={busyMessage || !isController || errorMessage ? <>{busyMessage && <span role="status" aria-live="polite">{busyMessage}</span>}{!isController && <span className="studio-task-warning">You can look around. To make changes, wait for the lab to load or take control from the other tab.</span>}{errorMessage && errorMessage !== (task?.acknowledgement?.status !== 'accepted' ? task?.acknowledgement?.reason : '') && <span role="alert" className="studio-task-warning">{errorMessage}</span>}</> : undefined}
            editingAction={taskModal && task && !commandReviewVisible ? {
              key: task.owner + ':' + task.instanceId + ':' + task.draftGeneration,
              actionKey: TASK_PRIMARY_ACTIONS[task.task],
            } : undefined}
            footer={resultsOpen ? <><span className="small-note">Catch up here, then return to your work.</span><button type="button" className="studio-surface-button" onClick={closeResults}>{task && task.owner !== 'planner' ? 'Back to ' + STUDIO_TASKS[task.task].title.toLowerCase() : 'Close Results'}</button></> : <>
              {task && !commandReviewVisible && <button type="button" className="studio-surface-button studio-task-reset" onClick={resetTaskDraft} disabled={taskBusy}>Reset choices</button>}
              {commandReviewVisible && task?.review && <button type="button" className="studio-surface-button studio-surface-primary" onClick={confirmTask} disabled={!canAct || !paused || taskBusy || staleReview || !reviewAccepted || !onSubmitTask}>{taskBusy ? 'Scheduling…' : commandLabel(task.review.payload)}{!taskBusy && reviewCost && <span className="action-label-cost"> · {reviewCost}</span>}<ChevronRight size={16} /></button>}
            </>}>
            {taskModal && acceptedCommand && !commandReviewVisible && <section className="studio-task-inline-status" role="status" aria-live="polite">
              <div><strong>{acceptancePending ? 'Scheduled for Week ' + acceptedCommand.effectiveWeek : 'Action processed'}</strong>
                <p>{task?.review ? commandLabel(task.review.payload) : 'Your choice was accepted'}. {acceptancePending ? 'Keep planning, or advance when you’re ready.' : receiptJourney?.detail ?? 'See the outcome in your work queue.'}</p>
                <small>{saveMessage}</small></div>
              <div className="studio-task-inline-actions">
                <button type="button" className="studio-surface-button" onClick={viewQueuedDecision} disabled={taskBusy}>View work queue<ChevronRight size={14} /></button>
                {acceptancePending ? <button type="button" className="studio-surface-button" onClick={advanceScheduledWeek} disabled={!canAct || !paused || taskBusy || forceSaveOpen}>Advance to Week {game.week + 1}<ChevronRight size={14} /></button>
                  : receiptJourney && <button type="button" className="studio-surface-button" onClick={() => followJourney(receiptJourney.primary.action)} disabled={taskBusy}>{receiptJourney.primary.label}<ChevronRight size={14} /></button>}
              </div>
            </section>}
            {taskModal && commandError && <p className="error-message" role="alert">{commandError}</p>}
            <div className="studio-task-setup" hidden={resultsOpen || (taskModal && commandReviewVisible)}>
              <div className="studio-content" hidden={methodTask}>{children}<StudioWorkbenchPanel panelId="research-programs"><ResearchProgramsWorkspace game={game} canAct={canAct} onQueue={onQueue} selection={programSelection} /></StudioWorkbenchPanel><StudioReleaseDesk key={'release-' + plannerEpoch + ':' + (draftGenerations['release-desk'] ?? 0)} game={game} active={mode === 'classic' || workbenchVisibility.panel === 'release-desk'} canAct={canAct} onQueue={onQueue} onOpenPanel={openPanel} /><StudioCampus key={'campus-' + plannerEpoch + ':' + (draftGenerations.campus ?? 0)} game={game} active={mode === 'classic' || workbenchVisibility.panel === 'campus'} canAct={canAct} onQueue={onQueue} onOpenPanel={openPanel} /></div>
              {methodTask && <StudioResearchMethod game={game} canAct={canAct} onQueue={onQueue} researchId={researchSelection?.researchId ?? null} onOpenMethod={openResearchMethod} onOpenPanel={openResearchPanel} onReviewResources={openPlanner} onReviewStaff={reviewResearchStaff} onReviewCompute={() => openNamedTask('allocate-compute')} onBrowse={() => openResearchTree()} />}
            </div>
            <div hidden={!resultsOpen}>{resultsOpen && <>{resultActionError && <p className="error-message" role="alert">{resultActionError}</p>}<StudioResultsPanel results={resultEntries} flags={results?.flags ?? {}} attention={resultAttention} ready={results?.ready ?? false} persistenceNotice={results?.notice} disabled={busy || forceSaveOpen} onReview={keys => results?.markReviewed(keys)} onDismiss={key => results?.dismiss(key)} onRestore={key => results?.restore(key)} onAction={followResult} /></>}</div>
            {taskModal && task?.phase === 'editing' && task.acknowledgement && task.acknowledgement.status !== 'accepted' && <p className="error-message" role="alert">{task.acknowledgement.reason}</p>}
            {taskModal && task?.review && commandReviewVisible && <StudioCommandReview concise showTitle={false} game={game} payload={task.review.payload} label={commandLabel(task.review.payload)} stale={staleReview} onRefresh={refreshReview} canRefresh={!taskBusy && canAct} busy={taskBusy} reportId={task.intent.kind === 'first-launch' && task.review.payload.kind === 'deploy_product' && task.intent.candidateId === task.review.payload.modelId ? task.intent.reportId : undefined} />}

          </StudioTaskSurface>
        </StudioTaskActionsProvider></StudioStaffingSelectionProvider></StudioLaunchSelectionProvider></StudioDevelopmentSelectionProvider></StudioTrainingSelectionProvider></StudioDataSelectionProvider></DevelopmentNavigationProvider>
        </StudioModelSelectionProvider></StudioTaskModeProvider>
        {mode === 'studio' && panel && (screen === 'studio' || screen === 'projects') && <div className="studio-inspector-related"><span>Also in your studio</span>{['data', 'models', 'lab-projects'].includes(panel) && <><button type="button" onClick={() => openPanel('synthetic-data', 'research')}><Sparkles size={14} />Synthetic data<ChevronRight size={13} /></button><button type="button" onClick={() => openPanel('model-corpus-compare', 'research')}><ClipboardCheck size={14} />Compare models & data<ChevronRight size={13} /></button></>}<button type="button" onClick={openPlanner}><SlidersHorizontal size={14} />Plan people & compute<ChevronRight size={13} /></button><button type="button" onClick={() => openPanel(panel === 'people' ? 'compute' : 'people')}>{panel === 'people' ? <Server size={14} /> : <Users size={14} />}{panel === 'people' ? 'Compute allocation' : 'Staff & team output'}<ChevronRight size={13} /></button>{sections.infrastructure && <button type="button" onClick={() => openPanel('infrastructure')}><Server size={14} />Racks & facilities<ChevronRight size={13} /></button>}{sections.chips && <button type="button" onClick={() => openPanel('chips')}><FlaskConical size={14} />Chips & networking<ChevronRight size={13} /></button>}{sections.capacityForecast && <button type="button" onClick={() => openPanel('capacity-forecast')}><Activity size={14} />Capacity forecast<ChevronRight size={13} /></button>}</div>}
      </aside>
    </div>
    <footer className="studio-footer studio-only"><button type="button" data-save-kind={saveKind} aria-label={'Open save controls. ' + saveMessage} onClick={() => openPanel('save', 'save')}>{saveKind === 'waiting' || saveKind === 'dirty' || saveKind === 'saving' ? <Activity size={12} aria-hidden="true" /> : saveKind === 'failed' ? <LockKeyhole size={12} aria-hidden="true" /> : <Save size={12} aria-hidden="true" />}<span role="status" aria-live="polite" aria-atomic="true">{saveMessage}</span></button><span>The computers are expensive. The ambition is yours.</span><span>Studio {CONTENT.buildVersion} · {CONTENT.clock.secondsPerWeek}s / week</span></footer>
  </main></StudioCommandReviewProvider></StudioWorkbenchProvider>;
}
