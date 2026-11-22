import type { ModelResearchFocus, ModelResearchFocusReceipt, ModelResearchProject, ModelResearchQuote } from '../contracts/model-research';
import type { CommandQuote, DomainResult, GameCommand, GameState, ModuleContext, Rejection, ResearchSlice, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { checkedAdd, formatUnits } from '../core/math';
import { formatWorkPoints } from './workforce-points';

export const MODEL_RESEARCH_COMMANDS = ['start_model_research', 'set_model_research_paused'] as const;
export const MODEL_RESEARCH_PREREQUISITE = 'R1';
export const MODEL_RESEARCH_FOCUSES: Record<ModelResearchFocus, { name: string; description: string; capacity: number; efficiency: number; reliability: number }> = {
  balanced: { name: 'Balanced engineering', description: 'Keep the original balance of skill potential and training/serving efficiency.', capacity: 100, efficiency: 100, reliability: 0 },
  capability: { name: 'Capability depth', description: 'Gain 60% more skill potential from this iteration, with only 20% of its usual efficiency gain.', capacity: 160, efficiency: 20, reliability: 0 },
  efficiency: { name: 'Compute efficiency', description: 'Gain 80% more training/serving efficiency from this iteration, with 40% of its usual skill potential.', capacity: 40, efficiency: 180, reliability: 0 },
  reliability: { name: 'Reliable execution', description: 'Raise future training reliability targets; retain 60% of the usual skill and efficiency gains.', capacity: 60, efficiency: 60, reliability: 60 },
};
const workId = (id: string) => id + ':work';
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });

export function modelResearchProjects(state: Readonly<GameState>, companyId: string): ModelResearchProject[] {
  return Object.values(state.slices.research.modelResearch ?? {}).filter(project => project.companyId === companyId).sort((a, b) => a.level - b.level);
}

/** Knowledge only counts after both paid work meters finish and the next week begins. */
export function getModelResearchLevel(state: Readonly<GameState>, companyId: string, atWeek = state.week): number {
  return modelResearchProjects(state, companyId).reduce((level, project) => project.status === 'complete'
    && project.availableWeek !== undefined && project.availableWeek <= atWeek ? Math.max(level, project.level) : level, 0);
}

/** Extra design potential, with diminishing returns; this does not change an existing model. */
export function modelResearchBonusBps(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0) return 0;
  return Math.floor(2500 * level / (level + 6));
}

/** Historical absence stays byte-compatible with pre-focus design plans. */
export function getModelResearchFocus(state: Readonly<GameState>, companyId: string, atWeek = state.week): ModelResearchFocusReceipt | undefined {
  const projects = modelResearchProjects(state, companyId).filter(project => project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek);
  if (!projects.some(project => project.focus && project.focus !== 'balanced')) return undefined;
  const counts: ModelResearchFocusReceipt['counts'] = { balanced: 0, capability: 0, efficiency: 0, reliability: 0 };
  let capacity = 0, efficiency = 0, reliability = 0;
  for (const project of projects) {
    const focus = project.focus ?? 'balanced', effect = MODEL_RESEARCH_FOCUSES[focus];
    const gain = modelResearchBonusBps(project.level) - modelResearchBonusBps(project.level - 1);
    counts[focus]++;
    capacity += gain * effect.capacity; efficiency += gain * effect.efficiency; reliability += gain * effect.reliability;
  }
  return { counts, capacityBonusBps: Math.floor(capacity / 100), efficiencyBonusBps: Math.floor(efficiency / 200), reliabilityBonusBps: Math.min(650, Math.floor(reliability / 100)) };
}

export function modelResearchQuoteForLevel(level: number): ModelResearchQuote {
  if (!Number.isSafeInteger(level) || level < 1 || level > 100_001) throw new Error('Architecture research level is invalid.');
  // Saturating high-level costs keep resource arithmetic safe. There is no final authored iteration.
  const square = level * level;
  return {
    level,
    feeCents: Math.min(25_000_000_000, 250_000 * square),
    requiredWork: Math.min(1_000_000, 8 * square) * U,
    requiredStaff: Math.min(10_000, level + 1) * U,
    potentialBonusBps: modelResearchBonusBps(level),
    unlock: level === 1 ? 'Edge models' : level === 3 ? 'Frontier models' : 'Higher potential for new custom designs',
  };
}

export function getModelResearchQuote(state: Readonly<GameState>, companyId: string): ModelResearchQuote {
  return modelResearchQuoteForLevel(getModelResearchLevel(state, companyId) + 1);
}

export function getActiveModelResearch(state: Readonly<GameState>, companyId: string): ModelResearchProject | undefined {
  return modelResearchProjects(state, companyId).find(project => project.status !== 'complete'
    || project.availableWeek === undefined || project.availableWeek > state.week);
}

export function getModelFamilyGate(state: Readonly<GameState>, companyId: string, family: string, atWeek = state.week): string | null {
  const level = getModelResearchLevel(state, companyId, atWeek);
  if (family === 'edge' && level < 1) return 'Complete Architecture research level 1 to unlock Edge models.';
  if (family === 'frontier' && level < 3) return 'Complete Architecture research level 3 to unlock Frontier models.';
  return null;
}

export function modelResearchGate(state: Readonly<GameState>, companyId: string): string | null {
  const known = state.slices.research.completedByCompany[companyId] ?? (companyId === state.playerCompanyId ? state.slices.research.completed : []);
  return known.includes(MODEL_RESEARCH_PREREQUISITE) ? null : 'Complete Evaluation suite (R1) before starting Architecture research.';
}

export function validateModelResearch(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload, owner = command.companyId;
  if (!state.slices.company.companies[owner]) return reject('The company does not exist.', 'UNKNOWN_COMPANY');
  if (state.slices.company.companies[owner].arrearsCents) return reject('Resolve unpaid expenses before starting architecture research.', 'ARREARS');
  if (p.kind === 'start_model_research') {
    if (p.focus !== undefined && !Object.hasOwn(MODEL_RESEARCH_FOCUSES, p.focus)) return reject('Choose a supported research focus.', 'INVALID_COMMAND');
    const gate = modelResearchGate(state, owner);
    if (gate) return reject(gate);
    const active = getActiveModelResearch(state, owner);
    if (active) return reject(active.status === 'complete'
      ? `Level ${active.level} becomes available in week ${active.availableWeek}. Start the next iteration afterward.`
      : 'An architecture iteration is already in progress. Resume it if it is paused.', 'ALREADY_ACTIVE');
    if (state.queuedCommands.some(other => other.id !== command.id && other.companyId === owner && other.payload.kind === p.kind))
      return reject('Architecture research is already queued for the next week.', 'ALREADY_ACTIVE');
    if (getModelResearchLevel(state, owner) >= 100_000) return reject('This campaign has reached the saved-project capacity.', 'CAPACITY_EXCEEDED');
    return;
  }
  if (p.kind === 'set_model_research_paused') {
    const project = state.slices.research.modelResearch?.[p.projectId];
    if (!project || project.companyId !== owner || typeof p.paused !== 'boolean') return reject('Choose one of your unfinished architecture research projects.');
    if (project.status === 'complete') return reject('This architecture iteration has finished.', 'NO_IMPROVEMENT');
    if ((project.status === 'paused') === p.paused) return reject(p.paused ? 'This project is already paused.' : 'This project is already running.', 'ALREADY_ACTIVE');
    return;
  }
  return reject('Choose a supported architecture research action.', 'INVALID_COMMAND');
}

export function quoteModelResearch(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  if (command.payload.kind !== 'start_model_research') return {
    upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Keep all completed architecture work. Pausing or resuming does not charge the entry fee again.',
  };
  const quote = getModelResearchQuote(state, command.companyId), focus = command.payload.focus ?? 'balanced';
  return {
    upfrontCostCents: quote.feeCents, weeklyCostDeltaCents: 0,
    summary: `Architecture level ${quote.level} · ${MODEL_RESEARCH_FOCUSES[focus].name}: ${formatWorkPoints(quote.requiredStaff)} Research points and ${formatUnits(quote.requiredWork)} research CUw. ${quote.unlock}. ${MODEL_RESEARCH_FOCUSES[focus].description} The focus is fixed once started. Knowledge is available after both meters finish and the following week begins.`,
  };
}

export function applyModelResearch(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const research = structuredClone(state.slices.research), p = command.payload;
  if (p.kind === 'start_model_research') {
    const quote = getModelResearchQuote(state, command.companyId), id = 'model-research-' + command.id;
    const focus = p.focus;
    const focusFactId = focus ? `${id}:focus:${focus}` : undefined;
    const project: ModelResearchProject = {
      id, companyId: command.companyId, level: quote.level, startedWeek: state.week,
      ...(focus ? { focus, focusFactId } : {}),
      feeCents: quote.feeCents, requiredWork: quote.requiredWork, completedWork: 0, physicalWork: 0,
      requiredStaff: quote.requiredStaff, completedStaff: 0,
      status: 'running', lastProgress: 0, lastBottleneck: 'Waiting for Research points and research compute.',
    };
    (research.modelResearch ??= {})[id] = project;
    return {
      updates: { research },
      facts: [{ id: id + ':fee', companyId: command.companyId, week: state.week, sourceId: id, category: 'operating', amountCents: quote.feeCents, label: `Architecture research level ${quote.level}`, kind: 'expense' },
        ...(focusFactId ? [{ id: focusFactId, companyId: command.companyId, week: state.week, sourceId: id, category: 'operating' as const, amountCents: 0, label: `Research focus: ${MODEL_RESEARCH_FOCUSES[focus!].name}`, kind: 'expense' as const }] : [])],
      messages: [{ companyId: command.companyId, category: 'project', message: `Architecture research level ${quote.level} started. The entry fee is charged once; staff and compute are paid separately.` }],
    };
  }
  if (p.kind === 'set_model_research_paused') {
    const project = research.modelResearch![p.projectId];
    project.status = p.paused ? 'paused' : 'running'; project.lastProgress = 0;
    project.lastBottleneck = p.paused ? 'Paused by you.' : 'Waiting for Research points and research compute.';
    return { updates: { research }, messages: [{ companyId: command.companyId, category: 'project', message: `${p.paused ? 'Paused' : 'Resumed'} architecture level ${project.level}; paid progress is preserved.` }] };
  }
  return {};
}

export function modelResearchRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.research.modelResearch ?? {}).filter(project => project.status === 'running').map(project => ({
    id: workId(project.id), companyId: project.companyId, taskId: project.id,
    category: 'research', normalizedWorkCUw: project.requiredWork - project.completedWork,
    memoryMU: 0, workloadKind: 'general', priority: 50, poolId: 'auto',
    staffDemand: [{ role: 'research', staffWeeks: project.requiredStaff - project.completedStaff }],
  }));
}

export function advanceModelResearch(research: ResearchSlice, ctx: ModuleContext): void {
  for (const project of Object.values(research.modelResearch ?? {})) {
    if (project.status !== 'running') continue;
    const grant = ctx.resources.computeGrants.find(item => item.requestId === workId(project.id));
    const work = grant?.hardwareEffectiveCUw ?? 0, physical = grant?.physicalCUw ?? 0;
    const staff = ctx.resources.staffGrants.find(item => item.requestId === workId(project.id))?.grants.find(item => item.role === 'research')?.staffWeeks ?? 0;
    if (work > project.requiredWork - project.completedWork || staff > project.requiredStaff - project.completedStaff)
      throw new Error('Architecture research grant exceeds remaining paid work.');
    project.completedWork = checkedAdd(project.completedWork, work);
    project.physicalWork = checkedAdd(project.physicalWork, physical);
    project.completedStaff = checkedAdd(project.completedStaff, staff);
    project.lastProgress = work;
    project.lastBottleneck = [project.completedWork < project.requiredWork && !work ? 'Allocate research compute.' : '',
      project.completedStaff < project.requiredStaff && !staff ? 'Waiting for Research points.' : ''].filter(Boolean).join(' ');
  }
}

export function resolveModelResearch(research: ResearchSlice, week: number): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of Object.values(research.modelResearch ?? {})) {
    if (project.status !== 'running' || project.completedWork !== project.requiredWork || project.completedStaff !== project.requiredStaff) continue;
    project.status = 'complete'; project.completedWeek = week; project.availableWeek = week + 1;
    project.lastBottleneck = `Knowledge becomes available in week ${project.availableWeek}.`;
    messages.push({ companyId: project.companyId, category: 'project', message: `Architecture research level ${project.level} is complete. ${modelResearchQuoteForLevel(project.level).unlock} becomes available in week ${project.availableWeek}.` });
  }
  return messages;
}

export function commitModelResearch(research: ResearchSlice, week: number): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of Object.values(research.modelResearch ?? {})) if (project.status === 'complete' && project.availableWeek === week) {
    project.lastBottleneck = '';
    messages.push({ companyId: project.companyId, category: 'project', message: `Architecture level ${project.level} is ready. ${modelResearchQuoteForLevel(project.level).unlock} is now available for new training plans. You can fund the next research iteration.` });
  }
  return messages;
}
