import type { CommandPayload, EvaluationSuiteId, GameState, StaffRole } from '../contracts/types';
import type { ResearchProgramId } from '../contracts/company-progression';
import { RESEARCH_PROGRAM_IDS } from '../content/company-progression';
import { canonicalStringify } from './canonical';
import { CONTENT } from '../content/catalog';
import { trainingBaseUnavailableReason } from '../modules/lab-planner';
export { trainingBaseUnavailableReason };
export type { StudioScreen } from './studio-navigation';
import type { StudioScreen } from './studio-navigation';

/** Presentation-only task contracts. Nothing here submits commands, advances the
 * simulation, stores form fields, or reads/writes browser persistence. */

export const STUDIO_PANEL_TITLES = {
  'research-programs': 'Research programs', capacity: 'Capacity',
  'development-plans': 'Development plans', 'model-challenges': 'Research challenges',
  data: 'Data desk', 'lab-projects': 'Develop a model', models: 'Test station', people: 'Your team',
  compute: 'Compute rack', product: 'Basic Chat', 'release-desk': 'Release desk', research: 'Research catalog',
  'applied-research': 'Applied research', market: 'Market & rivals', 'developer-api': 'Developer API',
  'business-commitments': 'Business customers', 'customer-briefs': 'Customer briefs', agents: 'Agent workflows', business: 'Company finances',
  infrastructure: 'Infrastructure', chips: 'Chips & networking', 'compute-costs': 'Compute costs',
  'capacity-forecast': 'Capacity forecast', campaign: 'Chapters & ambitions', 'company-log': 'Company journal',
  save: 'Save & load', 'synthetic-data': 'Synthetic data', 'model-corpus-compare': 'Model & data comparison', campus: 'Campus',
} as const;
export type StudioPanelId = keyof typeof STUDIO_PANEL_TITLES;

export function isStudioPanelId(value: string): value is StudioPanelId {
  return Object.hasOwn(STUDIO_PANEL_TITLES, value);
}

/** Each task has one existing retained form owner. Guided setup and inline
 * inspection use those same forms and drafts. */
export const STUDIO_TASKS = {
  'research-program': { owner: 'research-programs', title: 'Manage research programs', pauseOnEntry: true },
  'development-plan': { owner: 'development-plans', title: 'Develop a model · delegated', pauseOnEntry: true },
  'model-challenge': { owner: 'model-challenges', title: 'Run a research challenge', pauseOnEntry: true },
  'prepare-data': { owner: 'data', title: 'Prepare data', pauseOnEntry: true },
  'train-model': { owner: 'lab-projects', title: 'Develop a model', pauseOnEntry: true },
  'evaluate-model': { owner: 'models', title: 'Evaluate a model', pauseOnEntry: true },
  'launch-basic-chat': { owner: 'product', title: 'Launch Basic Chat', pauseOnEntry: true },
  'manage-basic-chat': { owner: 'product', title: 'Manage Basic Chat', pauseOnEntry: true },
  staffing: { owner: 'people', title: 'Manage your team', pauseOnEntry: true },
  'plan-week': { owner: 'planner', title: 'Plan people and compute', pauseOnEntry: true },
  'research-method': { owner: 'research', title: 'Research a method', pauseOnEntry: true },
  'architecture-research': { owner: 'research-programs', title: 'Architecture research', pauseOnEntry: true },
  'apply-research': { owner: 'applied-research', title: 'Apply a discovery', pauseOnEntry: true },
  'synthetic-data': { owner: 'synthetic-data', title: 'Create training data', pauseOnEntry: true },
  'release-decision': { owner: 'release-desk', title: 'Manage releases', pauseOnEntry: true },
  'compute-decision': { owner: 'compute', title: 'Manage compute', pauseOnEntry: true },
  'infrastructure-decision': { owner: 'infrastructure', title: 'Build your infrastructure', pauseOnEntry: true },
  'chip-decision': { owner: 'chips', title: 'Design and build chips', pauseOnEntry: true },
  'campus-decision': { owner: 'campus', title: 'Manage your campus', pauseOnEntry: true },
  'api-decision': { owner: 'developer-api', title: 'Manage your API', pauseOnEntry: true },
  'business-decision': { owner: 'business-commitments', title: 'Manage business customers', pauseOnEntry: true },
  'customer-brief': { owner: 'customer-briefs', title: 'Review customer briefs', pauseOnEntry: true },
  'agent-decision': { owner: 'agents', title: 'Manage agent jobs', pauseOnEntry: true },
  'company-decision': { owner: 'business', title: 'Manage your company', pauseOnEntry: true },
  'compute-cost-decision': { owner: 'compute-costs', title: 'Review compute costs', pauseOnEntry: true },
  'forecast-decision': { owner: 'capacity-forecast', title: 'Plan future capacity', pauseOnEntry: true },
  'hire-staff': { owner: 'people', title: 'Hire staff', pauseOnEntry: true },
  'assign-staff': { owner: 'people', title: 'Team output', pauseOnEntry: true },
  'allocate-compute': { owner: 'compute', title: 'Allocate compute', pauseOnEntry: true },
  'rent-compute': { owner: 'compute', title: 'Rent or release compute', pauseOnEntry: true },
} as const;
export type StudioTaskId = keyof typeof STUDIO_TASKS;
export type StudioTaskOwner = (typeof STUDIO_TASKS)[StudioTaskId]['owner'];

export function isStudioTaskId(value: string): value is StudioTaskId {
  return Object.hasOwn(STUDIO_TASKS, value);
}

export function getStudioTaskForPanel(panel: string): StudioTaskId | null {
  for (const task of Object.keys(STUDIO_TASKS) as StudioTaskId[]) {
    if (STUDIO_TASKS[task].owner === panel) return task;
  }
  return null;
}

/** Exact-entity intents are distinct from browsing a workbench. A consumer must
 * apply the resolved target explicitly; a route alone never means preselection. */
export type StudioIntent =
  | { kind: 'panel'; panel: StudioPanelId }
  | { kind: 'task'; task: StudioTaskId }
  | { kind: 'data'; packetId: string }
  | { kind: 'training-data'; packetId: string }
  | { kind: 'model'; modelId: string }
  | { kind: 'report'; reportId: string }
  | { kind: 'training-base'; baseModelId: string }
  | { kind: 'training-result'; runId: string }
  | { kind: 'first-launch'; candidateId: string; reportId?: string }
  | { kind: 'research-method'; researchId: string }
  | { kind: 'research-experiment'; experimentId: string }
  | { kind: 'staffing'; mode: 'hire' | 'assign'; role?: StaffRole; staffId?: string; reason?: string }
  | { kind: 'product-candidate'; productId: string; candidateId: string };

export type StudioResolvedTarget =
  | { kind: 'data' | 'training-data'; packetId: string }
  | { kind: 'model'; modelId: string }
  | { kind: 'report'; reportId: string; modelId: string; suiteId: EvaluationSuiteId }
  | { kind: 'training-base'; baseModelId: string }
  | { kind: 'training-result'; runId: string; modelId: string }
  | { kind: 'first-launch'; modelId: string; reportId?: string; existingProductId?: string }
  | { kind: 'research-method'; researchId: string }
  | { kind: 'research-experiment'; experimentId: string; programId: ResearchProgramId }
  | { kind: 'staffing'; mode: 'hire' | 'assign'; role?: StaffRole; staffId?: string; reason?: string }
  | { kind: 'product-candidate'; productId: string; candidateId: string };

export type ResolvedStudioIntent =
  | { ok: true; panel: StudioPanelId | 'planner'; task?: StudioTaskId; target?: StudioResolvedTarget }
  | { ok: false; reason: string };

/** Resolves identity and ownership only. Eligibility, quotes and release gates
 * continue to be decided by the existing authoritative command path. */
export function resolveStudioIntent(game: GameState, intent: StudioIntent): ResolvedStudioIntent {
  const owner = game.playerCompanyId;
  const ownModel = (id: string) => {
    const model = game.slices.models.versions[id];
    return model?.companyId === owner ? model : null;
  };
  switch (intent.kind) {
    case 'panel':
      return isStudioPanelId(intent.panel)
        ? { ok: true, panel: intent.panel }
        : { ok: false, reason: 'This menu is unavailable.' };
    case 'task':
      return isStudioTaskId(intent.task)
        ? { ok: true, panel: STUDIO_TASKS[intent.task].owner, task: intent.task }
        : { ok: false, reason: 'This task is unavailable.' };
    case 'data': case 'training-data': {
      const packet = game.slices.data.packets[intent.packetId];
      if (!packet || (packet.companyId !== owner && (packet.companyId || packet.id !== CONTENT.starterData.id))) {
        return { ok: false, reason: 'This dataset is unavailable in the current lab. Choose another dataset.' };
      }
      return { ok: true, panel: intent.kind === 'data' ? 'data' : 'lab-projects',
        task: intent.kind === 'data' ? 'prepare-data' : 'train-model', target: { kind: intent.kind, packetId: intent.packetId } };
    }
    case 'model':
      return ownModel(intent.modelId)
        ? { ok: true, panel: 'models', target: { kind: 'model', modelId: intent.modelId } }
        : { ok: false, reason: 'This model is unavailable in the current lab. Choose another model.' };
    case 'report': {
      const report = game.slices.models.reports[intent.reportId];
      if (!report || report.companyId !== owner) return { ok: false, reason: 'This evaluation report is unavailable in the current lab.' };
      if (!ownModel(report.modelId)) return { ok: false, reason: 'The model for this evaluation report is unavailable. Choose another result.' };
      return { ok: true, panel: 'models', target: { kind: 'report', reportId: report.id, modelId: report.modelId, suiteId: report.suiteId ?? 'basic-conversation-1' } };
    }
    case 'training-base': {
      const reason = trainingBaseUnavailableReason(game, intent.baseModelId);
      return reason ? { ok: false, reason } : { ok: true, panel: 'lab-projects', task: 'train-model', target: { ...intent } };
    }
    case 'training-result': {
      const run = game.slices.models.trainingRuns[intent.runId];
      if (!run || run.companyId !== owner) return { ok: false, reason: 'This training result is unavailable in the current lab.' };
      if (run.status !== 'complete') return { ok: false, reason: 'This training run has not produced a completed output yet.' };
      if (!ownModel(run.outputModelId)) return { ok: false, reason: 'The output model for this training run is unavailable. Choose another result.' };
      return { ok: true, panel: 'models', target: { kind: 'training-result', runId: run.id, modelId: run.outputModelId } };
    }
    case 'first-launch': {
      if (!ownModel(intent.candidateId)) return { ok: false, reason: 'This launch candidate is unavailable in the current lab. Choose another model.' };
      if (intent.reportId) {
        const report = game.slices.models.reports[intent.reportId];
        if (!report || report.companyId !== owner || report.modelId !== intent.candidateId) {
          return { ok: false, reason: 'This evaluation report is unavailable for the selected launch candidate. Choose a test report for this model.' };
        }
      }
      const existing = Object.values(game.slices.products.offers).find(product => product.companyId === owner && product.kind === 'basic-chat');
      return { ok: true, panel: 'product', task: 'launch-basic-chat', target: { kind: 'first-launch', modelId: intent.candidateId,
        ...(intent.reportId ? { reportId: intent.reportId } : {}), ...(existing ? { existingProductId: existing.id } : {}) } };
    }
    case 'staffing': {
      if (intent.role && !CONTENT.staff.some(role => role.id === intent.role)) {
        return { ok: false, reason: 'This staff role is unavailable. Choose another role.' };
      }
      if (intent.staffId && game.slices.company.staff[intent.staffId]?.companyId !== owner) {
        return { ok: false, reason: 'This employee is unavailable in the current lab. Choose another person.' };
      }
      return { ok: true, panel: 'people', task: 'staffing', target: { ...intent } };
    }
    case 'research-method': {
      if (!CONTENT.research.some(method => method.id === intent.researchId)) {
        return { ok: false, reason: 'This research method is unavailable. Choose a discovery from Research.' };
      }
      // Methods are shared content; owned progress and current eligibility are
      // resolved by the research view and ordinary command quote, not navigation.
      return { ok: true, panel: 'research', task: 'research-method',
        target: { kind: 'research-method', researchId: intent.researchId } };
    }
    case 'research-experiment': {
      const experiment = game.slices.campaign.progression?.experiments[intent.experimentId];
      if (!experiment || experiment.id !== intent.experimentId || experiment.companyId !== owner || !RESEARCH_PROGRAM_IDS.includes(experiment.programId)) {
        return { ok: false, reason: 'This research experiment is unavailable in the current lab. Choose another program or result.' };
      }
      return { ok: true, panel: 'research-programs', task: 'research-program',
        target: { kind: 'research-experiment', experimentId: experiment.id, programId: experiment.programId } };
    }
    case 'product-candidate': {
      const product = game.slices.products.offers[intent.productId];
      if (!product || product.companyId !== owner) return { ok: false, reason: 'This product is unavailable in the current lab.' };
      if (!ownModel(intent.candidateId)) return { ok: false, reason: 'This release candidate is unavailable in the current lab. Choose another model.' };
      return { ok: true, panel: 'release-desk', target: { kind: 'product-candidate', productId: product.id, candidateId: intent.candidateId } };
    }
  }
}

export interface StudioReturnTarget {
  screen: StudioScreen;
  panel: StudioPanelId | null;
  projectTab?: 'work' | 'plan';
  /** A named DOM fallback, not a stored DOM node. The surface owns actual focus. */
  focusId?: string;
}

export type StudioCommandAcknowledgement =
  | { status: 'accepted'; commandId: string; effectiveWeek: number }
  | { status: 'rejected'; reason: string }
  | { status: 'cancelled'; reason: string };

export interface StudioSubmissionContext {
  companyEpoch: number;
  owner: StudioTaskOwner;
  taskInstanceId: number;
  requestId: number;
  reviewedRevision: number;
}

export interface StudioTaskReview {
  sourceRevision: number;
  payloadSignature: string;
  /** Independent review snapshot, not a second owner for editable form fields. */
  payload: CommandPayload;
}

export interface StudioTaskRecord {
  task: StudioTaskId;
  owner: StudioTaskOwner;
  /** Changes for a new explicit intent/reset, not for an ordinary close/reopen. */
  instanceId: number;
  intent: StudioIntent;
  phase: 'editing' | 'review' | 'submitting' | 'queued';
  /** Only this generation and companyEpoch belong in the retained owner's key. */
  draftGeneration: number;
  returnTo: StudioReturnTarget;
  review: StudioTaskReview | null;
  requestId: number | null;
  acknowledgement: StudioCommandAcknowledgement | null;
}

export interface StudioTaskDetour {
  owner: StudioTaskOwner;
  taskInstanceId: number;
  destination: StudioReturnTarget;
}

export interface StudioTaskSession {
  companyEpoch: number;
  activeOwner: StudioTaskOwner | null;
  /** Bounded by the registered retained owners, never by click count. */
  tasks: Partial<Record<StudioTaskOwner, StudioTaskRecord>>;
  detour: StudioTaskDetour | null;
  nextInstanceId: number;
  nextRequestId: number;
}

export interface StudioEditorSubmission {
  type: 'submitFromEditor';
  /** UI-only identity: any intervening navigation/edit retires this event. */
  sourceSession: StudioTaskSession;
  task: StudioTaskId;
  returnTo: StudioReturnTarget;
  sourceRevision: number;
  payload: CommandPayload;
  context: StudioSubmissionContext;
}

export type StudioTaskEvent =
  | { type: 'open'; task: StudioTaskId; intent?: StudioIntent; returnTo: StudioReturnTarget }
  | { type: 'close' }
  | { type: 'back' }
  | { type: 'edit' }
  | { type: 'review'; sourceRevision: number; payload: CommandPayload }
  | { type: 'submit'; context: StudioSubmissionContext; payload: CommandPayload }
  | StudioEditorSubmission
  | { type: 'acknowledge'; context: StudioSubmissionContext; acknowledgement: StudioCommandAcknowledgement }
  | { type: 'resetDraft'; owner?: StudioTaskOwner }
  | { type: 'resetCompany'; companyEpoch: number }
  | { type: 'detour'; destination: StudioReturnTarget }
  | { type: 'return' }
  | { type: 'clearDetour' };

export function createStudioTaskSession(companyEpoch = 0): StudioTaskSession {
  return { companyEpoch, activeOwner: null, tasks: {}, detour: null, nextInstanceId: 1, nextRequestId: 1 };
}

export function getActiveStudioTask(session: StudioTaskSession): StudioTaskRecord | null {
  return session.activeOwner ? session.tasks[session.activeOwner] ?? null : null;
}

/** Exact canonical payload text avoids treating a short checksum as identity. */
export function studioPayloadSignature(payload: CommandPayload): string {
  return canonicalStringify(payload);
}

export function isStudioTaskReviewCurrent(task: StudioTaskRecord | null | undefined, sourceRevision: number, payload?: CommandPayload): boolean {
  return !!task?.review && task.review.sourceRevision === sourceRevision
    && task.review.payloadSignature === studioPayloadSignature(payload ?? task.review.payload);
}

/** Returns a request identity before dispatching submit. Two rapid requests get
 * the same next ID; the reducer admits it once and then advances the sequence. */
export function getStudioSubmissionContext(session: StudioTaskSession): StudioSubmissionContext | null {
  const task = getActiveStudioTask(session);
  if (!task || task.phase !== 'review' || !task.review) return null;
  return { companyEpoch: session.companyEpoch, owner: task.owner, taskInstanceId: task.instanceId,
    requestId: session.nextRequestId, reviewedRevision: task.review.sourceRevision };
}

/** A visible editor already contains the current quote. Capture that exact
 * choice and use the same submission identity without another presentation
 * step. The reducer repeats this preparation atomically before admitting it. */
export function createStudioEditorSubmission(session: StudioTaskSession, input: {
  task: StudioTaskId;
  returnTo: StudioReturnTarget;
  sourceRevision: number;
  payload: CommandPayload;
}): StudioEditorSubmission | null {
  if (getActiveStudioTask(session)?.phase === 'submitting') return null;
  const reviewed = reviewEditorSubmission(session, input);
  const context = getStudioSubmissionContext(reviewed);
  const payload = getActiveStudioTask(reviewed)?.review?.payload;
  return context && payload ? { type: 'submitFromEditor', ...input, sourceSession: session, returnTo: { ...input.returnTo }, payload, context } : null;
}

function reviewEditorSubmission(session: StudioTaskSession, input: {
  task: StudioTaskId;
  returnTo: StudioReturnTarget;
  sourceRevision: number;
  payload: CommandPayload;
}): StudioTaskSession {
  const opened = getActiveStudioTask(session)?.task === input.task ? session
    : studioTaskReducer(session, { type: 'open', task: input.task, returnTo: input.returnTo });
  return studioTaskReducer(opened, { type: 'review', sourceRevision: input.sourceRevision, payload: input.payload });
}

function intentOwner(intent: StudioIntent): StudioPanelId | 'planner' {
  switch (intent.kind) {
    case 'staffing': return 'people';
    case 'panel': return intent.panel;
    case 'task': return STUDIO_TASKS[intent.task].owner;
    case 'data': return 'data';
    case 'training-data': case 'training-base': return 'lab-projects';
    case 'model': case 'report': case 'training-result': return 'models';
    case 'first-launch': return 'product';
    case 'research-method': return 'research';
    case 'research-experiment': return 'research-programs';
    case 'product-candidate': return 'release-desk';
  }
}

function replaceTask(session: StudioTaskSession, task: StudioTaskRecord): StudioTaskSession {
  return { ...session, tasks: { ...session.tasks, [task.owner]: task } };
}

function editable(task: StudioTaskRecord): StudioTaskRecord {
  return { ...task, phase: 'editing', review: null, requestId: null, acknowledgement: null };
}

function contextMatches(session: StudioTaskSession, task: StudioTaskRecord, context: StudioSubmissionContext): boolean {
  return context.companyEpoch === session.companyEpoch && context.owner === task.owner
    && context.taskInstanceId === task.instanceId && context.reviewedRevision === task.review?.sourceRevision;
}

/** The shell performs pause/navigation/focus effects separately. Existing fields
 * remain inside their retained owner; only an explicit draft reset changes its
 * generation. A detour is one bounded parent link, not a nested modal stack. */
export function studioTaskReducer(session: StudioTaskSession, event: StudioTaskEvent): StudioTaskSession {
  const active = getActiveStudioTask(session);
  if (event.type === 'resetCompany') {
    // Keep serials monotonic even if a caller accidentally reuses an epoch.
    return { ...createStudioTaskSession(event.companyEpoch), nextInstanceId: session.nextInstanceId, nextRequestId: session.nextRequestId };
  }
  if (event.type === 'acknowledge') {
    const task = session.tasks[event.context.owner];
    if (!task || task.phase !== 'submitting' || !contextMatches(session, task, event.context)
      || task.requestId !== event.context.requestId) return session;
    return replaceTask(session, event.acknowledgement.status === 'accepted'
      ? { ...task, phase: 'queued', requestId: null, acknowledgement: { ...event.acknowledgement } }
      : { ...editable(task), acknowledgement: { ...event.acknowledgement } });
  }
  // Closing, retargeting, resetting or taking a detour must not strand a request.
  // Controller cancellation acknowledges it first; a company reset is above.
  if (active?.phase === 'submitting') return session;

  switch (event.type) {
    case 'open': {
      const owner = STUDIO_TASKS[event.task].owner;
      if (event.intent && intentOwner(event.intent) !== owner) return session;
      const retained = session.tasks[owner];
      const explicitIntent = event.intent !== undefined;
      const changedTask = !!retained && retained.task !== event.task;
      const newIdentity = explicitIntent || changedTask;
      const task: StudioTaskRecord = retained
        ? { ...(newIdentity ? editable(retained) : retained), task: event.task, returnTo: { ...event.returnTo },
          ...(newIdentity ? { intent: { ...(event.intent ?? { kind: 'task', task: event.task }) }, instanceId: session.nextInstanceId } : {}) }
        : { task: event.task, owner, instanceId: session.nextInstanceId, intent: { ...(event.intent ?? { kind: 'task', task: event.task }) },
          phase: 'editing', draftGeneration: 0, returnTo: { ...event.returnTo }, review: null, requestId: null, acknowledgement: null };
      return { ...replaceTask(session, task), activeOwner: owner,
        nextInstanceId: !retained || newIdentity ? session.nextInstanceId + 1 : session.nextInstanceId };
    }
    case 'close':
      // Closing can expose the same retained fields inline. They may be edited
      // without changing GameState, so the old review must never stay submit-ready.
      return active ? { ...replaceTask(session, active.phase === 'review' ? editable(active) : active), activeOwner: null } : session;
    case 'back': case 'edit':
      if (!active || (active.phase === 'editing' && !active.review && !active.acknowledgement)) return session;
      return replaceTask(session, editable(active));
    case 'review': {
      if (!active) return session;
      const payload = structuredClone(event.payload);
      return replaceTask(session, { ...active, phase: 'review', review: { sourceRevision: event.sourceRevision,
        payloadSignature: studioPayloadSignature(payload), payload }, requestId: null, acknowledgement: null });
    }
    case 'submit':
      if (!active || active.phase !== 'review' || !contextMatches(session, active, event.context)
        || event.context.requestId !== session.nextRequestId
        || !isStudioTaskReviewCurrent(active, event.context.reviewedRevision, event.payload)) return session;
      return { ...replaceTask(session, { ...active, phase: 'submitting', requestId: event.context.requestId, acknowledgement: null }),
        nextRequestId: session.nextRequestId + 1 };
    case 'submitFromEditor': {
      if (event.sourceSession !== session) return session;
      const reviewed = reviewEditorSubmission(session, event);
      const next = studioTaskReducer(reviewed, { type: 'submit', context: event.context, payload: event.payload });
      // A stale company, task identity or request serial must not even replace
      // the editor with a captured review, much less start another request.
      return getActiveStudioTask(next)?.phase === 'submitting' ? next : session;
    }
    case 'resetDraft': {
      const owner = event.owner ?? session.activeOwner, task = owner ? session.tasks[owner] : null;
      if (!task || task.phase === 'submitting') return session;
      const reset = { ...editable(task), instanceId: session.nextInstanceId, draftGeneration: task.draftGeneration + 1 };
      return { ...replaceTask(session, reset), nextInstanceId: session.nextInstanceId + 1,
        detour: session.detour?.owner === owner ? { ...session.detour, taskInstanceId: reset.instanceId } : session.detour };
    }
    case 'detour':
      if (!active || session.detour) return session;
      return { ...replaceTask(session, active.phase === 'review' ? editable(active) : active), activeOwner: null,
        detour: { owner: active.owner, taskInstanceId: active.instanceId, destination: { ...event.destination } } };
    case 'return': {
      const parent = session.detour && session.tasks[session.detour.owner];
      if (!session.detour) return session;
      // The helper's retained fields can be edited inline after returning. Its
      // captured review must be retired just as it is on an ordinary close.
      const restored = active?.phase === 'review' ? replaceTask(session, editable(active)) : session;
      return parent?.instanceId === session.detour.taskInstanceId
        ? { ...restored, activeOwner: parent.owner, detour: null }
        : { ...restored, detour: null };
    }
    case 'clearDetour': return session.detour ? { ...session, detour: null } : session;
  }
}
