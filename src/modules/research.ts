import { GAMEPLAY_POLISH_CONTENT_VERSION } from '../core/gameplay-polish-version';
import { AI_SYSTEMS_CONTENT_VERSION, isAISystemsResearch } from '../core/ai-systems-version';
import { MODEL_CUSTOMIZATION_CONTENT_VERSION, isModelCustomizationResearch } from '../core/model-customization-version';
import { MODEL_RESEARCH_COMMANDS, validateModelResearch, quoteModelResearch, applyModelResearch, modelResearchRequests, advanceModelResearch, resolveModelResearch, commitModelResearch } from './model-research';
import { formatWorkPoints, WORK_POINT_LABELS } from './workforce-points';
import type { DomainModule, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import type { ResearchProject, ResearchSlice, ResearchViewItem } from '../contracts/wave2-lab';
import { CONTENT } from '../content/catalog';
import { IMPLEMENTED_RESEARCH_IDS } from '../content/wave2-lab';
import { checkedAdd, formatUnits, mulDiv, toUnits } from '../core/math';
import { SYSTEM_APPLICATION_COMMANDS, advanceSystemRollouts, applyResearchAssistance, applySystemApplication, commitSystemRollouts, quoteSystemApplication, researchAssistantRequests, resolveSystemRollouts, systemApplicationRequests, validateSystemApplication } from './applied-research';
import { hasCapabilityEvaluation, inheritedModelRights } from './model-runtime';
import { getComputePools } from './compute-pools';
import { getServingHistoryWeeks } from './chips';

const implemented = new Set<string>(IMPLEMENTED_RESEARCH_IDS);
const workId = (id: string) => id + ':work';
function completedFor(state: Readonly<GameState>, companyId: string): readonly string[] {
  return state.slices.research.completedByCompany?.[companyId]
    ?? (companyId === state.playerCompanyId ? state.slices.research.completed : []);
}
export function hasResearch(state: Readonly<GameState>, companyId: string, researchId: string): boolean {
  return completedFor(state, companyId).includes(researchId);
}
export function researchEvidenceGate(state: Readonly<GameState>, companyId: string, researchId: string, content: GameContent = CONTENT): string | null {
  const models = Object.values(state.slices.models.versions).filter(model => model.companyId === companyId);
  if (researchId === 'R13') {
    const students = models.filter(model => model.family === 'compact' && model.architecture === 'dense' && !model.runtimeVariant);
    const qualified = models.some(teacher => hasCapabilityEvaluation(state, teacher.id) && inheritedModelRights(state, teacher.id, content).weights
      && students.some(student => Object.keys(teacher.capabilityBps).some(key => { const domain = key as keyof typeof teacher.capabilityBps; const anchor = student.foundationAnchor ?? content.seedModel.capabilityBps; return teacher.capabilityBps[domain] >= 6000 && teacher.capabilityBps[domain] >= anchor[domain] + 1000; })));
    if (!qualified) return 'Choose one of your tested teacher models with a license that allows model distribution. It needs at least 60 in one skill and a ten-point lead over a compact student’s starting score.';
  }
  if (researchId === 'R14') {
    const capacity = getComputePools(state, companyId, content).filter(pool => !pool.architectures || pool.architectures.includes('sparse')).reduce((sum, pool) => checkedAdd(sum, pool.capacityCU), 0);
    if (capacity < 16_000_000_000) return 'You need at least 16 compatible CU to research Sparse architecture. You will install the fast fabric network in a separate project afterward.';
  }
  if (researchId === 'R15' && !models.some(model => hasCapabilityEvaluation(state, model.id) && model.capabilityBps.coding >= 6500 && model.capabilityBps.tools >= 6000)) return 'Test a model with coding 65 and tool use 60 before researching assistance.';
  if (researchId === 'S5' && !Object.values(state.slices.compute.facilities).some(site => site.companyId === companyId && site.status === 'active')) return 'Finish opening a site you own before researching facility specialization.';
  if (researchId === 'S6' && !Object.values(state.slices.compute.hardwareSales ?? {}).some(sale => sale.companyId === companyId && sale.shippedWeek !== null && sale.shippedWeek <= state.week)) return 'Ship a verified accelerator order to a buyer before researching second-generation silicon.';
  if (researchId === 'R16' && getServingHistoryWeeks(state, companyId) < 8) return 'Use your GPUs to serve customers for eight weeks before researching chip feasibility.';
  return null;
}
function aliases(research: ResearchSlice, playerCompanyId: string): void {
  research.completed = [...(research.completedByCompany[playerCompanyId] ?? [])].sort();
  research.active = Object.values(research.projects).filter(project => project.companyId === playerCompanyId
    && !research.completed.includes(project.researchId)).map(project => project.researchId).sort();
}
export function getResearchView(state: Readonly<GameState>, companyId: string, content: GameContent = CONTENT): ResearchViewItem[] {
  return content.research.map(definition => {
    const project = Object.values(state.slices.research.projects ?? {}).find(item => item.companyId === companyId && item.researchId === definition.id) ?? null;
    const missingPrerequisites = definition.requires.filter(id => !hasResearch(state, companyId, id));
    const evidenceGate = researchEvidenceGate(state, companyId, definition.id, content);
    if (evidenceGate) missingPrerequisites.push(evidenceGate);
    const available = implemented.has(definition.id);
    const status: ResearchViewItem['status'] = hasResearch(state, companyId, definition.id) ? 'complete'
      : project?.status === 'complete' ? 'pending' : project?.status ?? (!available ? 'planned' : missingPrerequisites.length ? 'locked' : 'available');
    const progressBps = project ? Math.min(10000, mulDiv(project.completedWork, 5000, project.requiredWork) + mulDiv(project.completedStaff, 5000, project.requiredStaff)) : 0;
    return {
      id: definition.id, name: definition.name, description: definition.description,
      ...(definition.parentId ? { parentId: definition.parentId } : {}),
      implemented: available, status, prerequisiteNames: definition.requires.map(id => content.research.find(item => item.id === id)?.name ?? id),
      missingPrerequisites, feeCents: definition.feeCents, requiredWork: definition.workCUw,
      requiredStaff: toUnits(definition.staffWeeks), role: definition.role, progressBps, project,
    };
  });
}
function validate(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const company = state.slices.company.companies[command.companyId], p = command.payload;
  if (!company) return { code: 'UNKNOWN_COMPANY', message: 'The company does not exist.' };
  if ((MODEL_RESEARCH_COMMANDS as readonly string[]).includes(p.kind)) return validateModelResearch(state, command);
  if ((SYSTEM_APPLICATION_COMMANDS as readonly string[]).includes(p.kind)) return validateSystemApplication(state, command);
  if (p.kind === 'start_research') {
    if (isModelCustomizationResearch(p.researchId) && ![MODEL_CUSTOMIZATION_CONTENT_VERSION, GAMEPLAY_POLISH_CONTENT_VERSION, AI_SYSTEMS_CONTENT_VERSION].includes(content.version)) return { code: 'NOT_READY', message: 'This model design discovery is unavailable in this historical build.' };
    if (isAISystemsResearch(p.researchId) && content.version !== AI_SYSTEMS_CONTENT_VERSION) return { code: 'NOT_READY', message: 'AI systems research is unavailable in this historical build.' };
    if (company.arrearsCents) return { code: 'ARREARS', message: 'Resolve unpaid expenses before starting research.' };
    const definition = content.research.find(item => item.id === p.researchId);
    if (!definition || !implemented.has(definition.id)) return { code: 'NOT_READY', message: 'This discovery is not available yet.' };
    if (hasResearch(state, command.companyId, definition.id)) return { code: 'NO_IMPROVEMENT', message: 'You already know this method. Put it to work in a data, training, or testing project.' };
    if (Object.values(state.slices.research.projects ?? {}).some(item => item.companyId === command.companyId && item.researchId === definition.id)
      || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === 'start_research' && other.payload.researchId === definition.id)) {
      return { code: 'ALREADY_ACTIVE', message: 'This research is already running or queued. If it is paused, resume it to keep going.' };
    }
    const missing = definition.requires.filter(id => !hasResearch(state, command.companyId, id));
    if (missing.length) return { code: 'NOT_READY', message: `Complete ${missing.join(', ')} and wait until the following week to start this research.` };
    const evidenceGate = researchEvidenceGate(state, command.companyId, definition.id, content);
    if (evidenceGate) return { code: 'NOT_READY', message: evidenceGate };
    return;
  }
  if (p.kind === 'set_research_paused') {
    const project = state.slices.research.projects?.[p.projectId];
    if (!project || project.companyId !== command.companyId || typeof p.paused !== 'boolean') return { code: 'NOT_READY', message: 'Choose one of your unfinished research projects.' };
    if (project.status === 'complete') return { code: 'NO_IMPROVEMENT', message: 'This research has finished.' };
    if ((project.status === 'paused') === p.paused) return { code: 'ALREADY_ACTIVE', message: p.paused ? 'This project is already paused.' : 'This project is already running.' };
    return;
  }
  return { code: 'INVALID_COMMAND', message: 'This is not a research command.' };
}
function requests(state: Readonly<GameState>): WorkRequest[] {
  const ordinary: WorkRequest[] = Object.values(state.slices.research.projects ?? {}).filter(project => project.status === 'running').map(project => ({
    id: workId(project.id), companyId: project.companyId, taskId: project.id, category: 'research',
    normalizedWorkCUw: project.requiredWork - project.completedWork, memoryMU: 0, workloadKind: 'general', priority: 50, poolId: 'auto',
    staffDemand: [{ role: project.role, staffWeeks: project.requiredStaff - project.completedStaff }],
  }));
  return [...ordinary, ...modelResearchRequests(state), ...systemApplicationRequests(state), ...researchAssistantRequests(state)];
}
function advance(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const research = structuredClone(state.slices.research);
  advanceSystemRollouts(research, ctx);
  advanceModelResearch(research, ctx);
  const ordinaryGrants: Record<string, number> = {};
  for (const project of Object.values(research.projects)) {
    if (project.status !== 'running') continue;
    const work = ctx.resources.computeGrants.find(grant => grant.requestId === workId(project.id))?.hardwareEffectiveCUw ?? 0;
    const staff = ctx.resources.staffGrants.find(grant => grant.requestId === workId(project.id))?.grants.find(grant => grant.role === project.role)?.staffWeeks ?? 0;
    if (work > project.requiredWork - project.completedWork || staff > project.requiredStaff - project.completedStaff) throw new Error('Research grant exceeds remaining work.');
    project.completedWork = checkedAdd(project.completedWork, work);
    project.completedStaff = checkedAdd(project.completedStaff, staff); project.lastProgress = work; ordinaryGrants[project.id] = staff;
    const reasons: string[] = [];
    if (project.completedWork < project.requiredWork && !work) reasons.push('Allocate research compute.');
    if (project.completedStaff < project.requiredStaff && !staff) reasons.push(`Generate ${WORK_POINT_LABELS[project.role]} points.`);
    project.lastBottleneck = reasons.join(' ');
  }
  applyResearchAssistance(research, state, ctx, ordinaryGrants);
  return { updates: { research } };
}
export function createResearchModule(content: GameContent): DomainModule {
  return {
    id: 'research', owns: ['research'], commandKinds: ['start_research', 'set_research_paused', ...MODEL_RESEARCH_COMMANDS, ...SYSTEM_APPLICATION_COMMANDS],
    validateCommand: (state, command) => validate(state, command, content),
    quoteCommand(state, command) {
      const p = command.payload;
      if ((MODEL_RESEARCH_COMMANDS as readonly string[]).includes(p.kind)) return quoteModelResearch(state, command);
      if ((SYSTEM_APPLICATION_COMMANDS as readonly string[]).includes(p.kind)) return quoteSystemApplication(command);
      if (p.kind !== 'start_research') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'This change takes effect next week. You keep completed research progress and do not pay the entry fee again.' };
      const definition = content.research.find(item => item.id === p.researchId)!;
      return { upfrontCostCents: definition.feeCents, weeklyCostDeltaCents: 0, summary: `${definition.name}: ${formatWorkPoints(toUnits(definition.staffWeeks))} ${WORK_POINT_LABELS[definition.role]} points and ${formatUnits(definition.workCUw)} research CUw. Complete both point work and compute, then the discovery unlocks the following week.` };
    },
    applyCommand(state, command) {
      const p = command.payload;
      if ((MODEL_RESEARCH_COMMANDS as readonly string[]).includes(p.kind)) return applyModelResearch(state, command);
      if ((SYSTEM_APPLICATION_COMMANDS as readonly string[]).includes(p.kind)) return applySystemApplication(state, command);
      const research = structuredClone(state.slices.research);
      research.projects ??= {}; research.completedByCompany ??= {};
      if (p.kind === 'start_research') {
        const definition = content.research.find(item => item.id === p.researchId)!;
        const project: ResearchProject = {
          id: 'research-' + command.id, companyId: command.companyId, researchId: definition.id,
          startedWeek: state.week, requiredWork: definition.workCUw, completedWork: 0,
          requiredStaff: toUnits(definition.staffWeeks), completedStaff: 0, role: definition.role,
          status: 'running', lastProgress: 0, lastBottleneck: 'Waiting for research compute and relevant staff.',
        };
        research.projects[project.id] = project; aliases(research, state.playerCompanyId);
        return { updates: { research }, facts: [{ id: project.id + ':fee', companyId: command.companyId, week: state.week, sourceId: project.id,
          category: 'operating', amountCents: definition.feeCents, label: definition.name + ' research', kind: 'expense' },
          ...(isModelCustomizationResearch(definition.id) || isAISystemsResearch(definition.id) ? [{ id: `${project.id}:method:${definition.id}`, companyId: command.companyId,
            week: state.week, sourceId: project.id, category: 'operating' as const, amountCents: 0,
            label: definition.name + ' discovery authorization', kind: 'expense' as const }] : [])],
          messages: [{ companyId: command.companyId, category: 'project', message: `${definition.name} research started. Entry fee charged once; payroll and compute are separate.` }] };
      }
      if (p.kind === 'set_research_paused') {
        const project = research.projects[p.projectId]; project.status = p.paused ? 'paused' : 'running'; project.lastProgress = 0;
        project.lastBottleneck = p.paused ? 'Paused by you.' : 'Waiting for the next resource grant.';
        aliases(research, state.playerCompanyId);
        return { updates: { research }, messages: [{ companyId: command.companyId, category: 'project', message: `${p.paused ? 'Paused' : 'Resumed'} ${project.researchId}; its progress and fee were preserved.` }] };
      }
      return {};
    },
    handlers: {
      commit(state, ctx) {
        const research = structuredClone(state.slices.research), messages: NonNullable<DomainResult['messages']> = [];
        commitSystemRollouts(research, ctx.week);
        messages.push(...commitModelResearch(research, ctx.week));
        for (const project of Object.values(research.projects)) {
          if (project.status !== 'complete' || project.availableWeek === undefined || project.availableWeek > ctx.week) continue;
          const known = research.completedByCompany[project.companyId] ??= [];
          if (known.includes(project.researchId)) continue;
          known.push(project.researchId); known.sort();
          messages.push({ companyId: project.companyId, category: 'project', message: `${content.research.find(item => item.id === project.researchId)?.name ?? project.researchId} is now available for new projects. Existing assets keep their saved requirements.` });
        }
        aliases(research, state.playerCompanyId);
        return { updates: { research }, messages };
      },
      reserve: state => ({ workRequests: requests(state) }),
      execute: advance,
      resolve(state, ctx) {
        const research = structuredClone(state.slices.research), messages: NonNullable<DomainResult['messages']> = [];
        resolveSystemRollouts(research, ctx.week);
        messages.push(...resolveModelResearch(research, ctx.week));
        for (const project of Object.values(research.projects)) {
          if (project.status !== 'running' || project.completedWork < project.requiredWork || project.completedStaff < project.requiredStaff) continue;
          project.status = 'complete'; project.completedWeek = ctx.week; project.availableWeek = ctx.week + 1; project.lastBottleneck = '';
          messages.push({ companyId: project.companyId, category: 'project', message: `${project.researchId} completed both research meters. Its method becomes available in week ${project.availableWeek}.` });
        }
        aliases(research, state.playerCompanyId);
        return { updates: { research }, messages };
      },
    },
  };
}
