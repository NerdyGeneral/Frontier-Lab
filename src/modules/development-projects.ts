import type { DevelopmentPlan, DevelopmentPlanArchive, DevelopmentPlanSpec } from '../contracts/development-plans';
import { DEVELOPMENT_ACTIVE_LIMIT } from '../contracts/development-plans';
import type { DevelopmentGoal, DevelopmentProjectObjective } from '../contracts/development-objectives';
import { developmentObjectiveChallenge } from '../contracts/development-objectives';
import type { GameCommand, GameContent, GameState, TrainingRun, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { canonicalStateHash } from '../core/canonical';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { mulDiv } from '../core/math';
import { getWeeklyBaseCost } from '../core/selectors';
import { getAvailableRoleCapacity } from './workforce';
import { careerLevel, staffDisplayName } from './staff-careers';
import { evaluationSuite } from './lab-evaluation';
import { isCapabilitySuite } from './evaluation-classification';
import { buildTrainingPlan, getTrainingPreview } from './lab-planner';
import { preparationTerms } from './lab-data';
import { trainingSupervision } from './applied-research';
import { getSystemsBriefOffers, isCanonicalSystemsBriefTerms } from './systems-briefs';
import { hasResearch } from './research';

export const unfinishedDevelopmentPlans = (state: Readonly<GameState>, companyId = state.playerCompanyId) =>
  Object.values(state.slices.models.developmentPlans ?? {}).filter(plan => plan.companyId === companyId && !['review', 'cancelled'].includes(plan.status));
export const developmentLeadId = (plan: Pick<DevelopmentPlanSpec, 'leadStaffId'>) => plan.leadStaffId ?? 'founder';
export const developmentCapacityShare = (plan: Pick<DevelopmentPlanSpec, 'capacityShareBps'>) => plan.capacityShareBps ?? 10000;
export function developmentLeadName(state: Readonly<GameState>, plan: Pick<DevelopmentPlanSpec, 'leadStaffId'>): string {
  const id = developmentLeadId(plan), member = state.slices.company.staff[id];
  return id === 'founder' ? 'Founder' : member ? staffDisplayName(member) : 'Unavailable lead';
}
export function developmentLeadOptions(state: Readonly<GameState>) {
  return [{ id: 'founder', name: 'Founder' }, ...Object.values(state.slices.company.staff)
    .filter(member => member.companyId === state.playerCompanyId && member.readyWeek <= state.week && ['data', 'ml', 'research'].includes(member.role) && careerLevel(member.career?.experience) >= 1)
    .map(member => ({ id: member.id, name: `${staffDisplayName(member)} · ${member.role === 'ml' ? 'Model' : member.role === 'data' ? 'Data' : 'Research'} lead` }))];
}
export function developmentResponsibilityIssue(state: Readonly<GameState>, spec: Pick<DevelopmentPlanSpec, 'leadStaffId' | 'capacityShareBps'>, companyId = state.playerCompanyId): string | undefined {
  const lead = developmentLeadId(spec);
  if (lead === 'founder') return state.slices.company.companies[companyId]?.founderFte > 0 ? undefined : 'The founder is unavailable. Assign a ready senior development lead.';
  const member = state.slices.company.staff[lead];
  if (!member || member.companyId !== companyId || member.readyWeek > state.week || !['data', 'ml', 'research'].includes(member.role) || careerLevel(member.career?.experience) < 1)
    return 'This project needs its ready senior data, model or research lead. Reassign responsibility to continue.';
}
export function developmentPortfolioIssue(state: Readonly<GameState>, spec: Pick<DevelopmentPlanSpec, 'leadStaffId' | 'capacityShareBps'>, command: GameCommand, excludingPlanId?: string): string | undefined {
  const active = unfinishedDevelopmentPlans(state, command.companyId).filter(plan => plan.id !== excludingPlanId);
  const scheduled = state.queuedCommands.filter(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === 'start_development_plan')
    .map(other => other.payload as DevelopmentPlanSpec);
  if (active.length + scheduled.length >= DEVELOPMENT_ACTIVE_LIMIT) return `Keep at most ${DEVELOPMENT_ACTIVE_LIMIT} unfinished projects. Finish or stop a project before adding another.`;
  const others = [...active, ...scheduled];
  if (others.some(plan => developmentLeadId(plan) === developmentLeadId(spec))) return 'This lead already owns an unfinished or scheduled project. Choose another senior lead or finish that project.';
  if (others.reduce((sum, plan) => sum + developmentCapacityShare(plan), 0) + developmentCapacityShare(spec) > 10000)
    return 'Project capacity shares exceed 100%. Reduce a project’s share before reserving another team budget.';
  return developmentResponsibilityIssue(state, spec, command.companyId);
}

/** Convert an old category-only browser goal once. Existing pinned offers never
 * follow the rotating market or change when the player's workspace changes. */
export function pinDevelopmentGoal(state: Readonly<GameState>, goal: DevelopmentGoal | null | undefined): DevelopmentProjectObjective | undefined {
  if (!goal) return;
  if (goal.kind !== 'renewable-brief') return structuredClone(goal);
  const terms = goal.terms ?? getSystemsBriefOffers(state).find(offer => offer.briefId === goal.id)?.terms;
  return terms ? { kind: 'renewable-brief', id: goal.id, terms: structuredClone(terms) } : undefined;
}
export function developmentObjectiveIssue(state: Readonly<GameState>, spec: DevelopmentPlanSpec, content: GameContent): string | undefined {
  if (!spec.objective) return;
  if (!hasConnectedCompanyRules(state.contentVersion)) return 'Upgrade this campaign before binding a development objective.';
  if (spec.objective.kind === 'renewable-brief' && !isCanonicalSystemsBriefTerms(state, spec.objective.terms)) return 'The pinned customer requirements do not match this campaign’s offered terms.';
  const challenge = developmentObjectiveChallenge(spec.objective);
  if (challenge) {
    if (!isCapabilitySuite(spec.suiteId)) return 'Choose Basic conversation or Expanded capabilities as the paid baseline before the systems challenge.';
    const suite = evaluationSuite(challenge);
    if (suite?.requiredResearch && !hasResearch(state, state.playerCompanyId, suite.requiredResearch)) return `Complete ${content.research.find(item => item.id === suite.requiredResearch)?.name ?? suite.requiredResearch} before delegating the paid challenge.`;
  }
}

/** A cap on ordinary requests, never a grant. The existing resource allocator
 * still handles physical hardware, memory, supervision and competing work. */
export function limitDevelopmentRequests(state: Readonly<GameState>, requests: WorkRequest[]): WorkRequest[] {
  if (!hasConnectedCompanyRules(state.contentVersion)) return requests;
  const byJob = new Map<string, DevelopmentPlan>();
  for (const plan of Object.values(state.slices.models.developmentPlans ?? {})) {
    // Cancellation ends the plan's ownership. Its unfinished paid jobs can be
    // explicitly resumed as ordinary work, just as they can after archival.
    if (plan.status === 'cancelled') continue;
    for (const step of plan.steps)
      byJob.set((step.payload.kind === 'start_training' ? 'training-' : step.payload.kind === 'evaluate_model' ? 'evaluation-' : 'preparation-') + step.commandId, plan);
  }
  return requests.flatMap(request => {
    const plan = byJob.get(request.taskId);
    if (!plan || plan.capacityShareBps === undefined) return [request];
    if (plan.status !== 'running' || developmentResponsibilityIssue(state, plan, plan.companyId)) return [];
    const share = developmentCapacityShare(plan), fleet = state.slices.compute.fleets[plan.companyId];
    const compute = mulDiv(fleet?.allocation[request.category] ?? 0, share, 10000);
    const staffDemand = request.staffDemand?.map(demand => ({ ...demand,
      staffWeeks: Math.min(demand.staffWeeks, mulDiv(getAvailableRoleCapacity(state, plan.companyId, demand.role), share, 10000)) }));
    let work = Math.min(request.normalizedWorkCUw, compute);
    if (request.supervision) work = Math.min(work, mulDiv(mulDiv(getAvailableRoleCapacity(state, plan.companyId, request.supervision.role), share, 10000), request.supervision.workPerStaffWeek, U));
    return [{ ...request, normalizedWorkCUw: work, ...(staffDemand ? { staffDemand } : {}) }];
  });
}

export const developmentArchiveProofId = (archive: DevelopmentPlanArchive) => `development-archive:${archive.companyId}:${archive.id}:${canonicalStateHash(archive)}`;
export const developmentObjectiveProofId = (plan: Pick<DevelopmentPlan, 'id' | 'companyId' | 'objective' | 'training' | 'suiteId'>) =>
  `development-objective:${plan.companyId}:${plan.id}:${canonicalStateHash({ objective: plan.objective, training: plan.training, suiteId: plan.suiteId })}`;

export function developmentFeasibility(state: Readonly<GameState>, spec: DevelopmentPlanSpec, content: GameContent) {
  const prepared = structuredClone(state), owner = state.playerCompanyId, share = developmentCapacityShare(spec);
  const packetIds = [...new Set([spec.training.packetId, ...(spec.training.packetIds ?? [])])];
  let preparationStaff = 0, setupCents = 0, unprepared = 0;
  for (const id of packetIds) {
    const packet = prepared.slices.data.packets[id];
    if (!packet || packet.prepared) continue;
    const terms = preparationTerms(packet, content); preparationStaff += terms.staff; setupCents += terms.feeCents; unprepared++;
    packet.prepared = true; packet.readyUnits = packet.rawUnits;
  }
  const preview = getTrainingPreview(prepared, owner, spec.training, content);
  setupCents += preview.feeCents;
  const planned = buildTrainingPlan(prepared, owner, spec.training, content), teacherWork = planned.plan.teacher?.requiredWork ?? 0;
  const suites = [evaluationSuite(spec.suiteId)!, ...(developmentObjectiveChallenge(spec.objective) ? [evaluationSuite(developmentObjectiveChallenge(spec.objective))!] : [])];
  const developmentCU = mulDiv(state.slices.compute.fleets[owner].allocation.development, share, 10000);
  const servingCU = mulDiv(state.slices.compute.fleets[owner].allocation.serving, share, 10000);
  const capacity = (role: 'data' | 'research' | 'ml') => mulDiv(getAvailableRoleCapacity(state, owner, role), share, 10000);
  const weeks = (work: number, supply: number) => !work ? 0 : supply ? Math.ceil(work / supply) : null;
  const trainingWork = preview.workCUw + preview.checkpointOverheadWork;
  const previewRun: TrainingRun = { id: 'development-feasibility', companyId: owner, baseModelId: spec.training.baseModelId,
    packetId: spec.training.packetId, outputModelId: 'development-feasibility-model', recipeId: planned.recipe.id,
    startedWeek: state.week, requiredWork: planned.requiredWork, completedWork: 0, physicalWork: 0,
    requiredMemory: planned.requiredMemory, status: 'running', checkpointWork: 0, checkpointModelId: null,
    anchorScores: planned.anchorScores, anchorReliabilityBps: planned.anchorReliabilityBps, evidence: planned.evidence,
    lastProgress: 0, lastBottleneck: '', plan: planned.plan };
  const supervision = trainingSupervision(prepared, previewRun, trainingWork, content).supervision;
  const supervisedCU = supervision ? mulDiv(capacity('ml'), supervision.workPerStaffWeek, U) : developmentCU;
  const parts = [weeks(preparationStaff, capacity('data')), weeks(preview.preparationStaff, capacity('research')),
    weeks(teacherWork, servingCU), weeks(trainingWork, Math.min(developmentCU, supervisedCU)),
    ...suites.map(suite => { const compute = weeks(suite.workCUw, developmentCU), staff = weeks(suite.researchStaff, capacity('research')); return compute === null || staff === null ? null : Math.max(compute, staff); })];
  const nominalWeeks = parts.some(part => part === null) ? null : Math.max(3, 1 + unprepared + suites.length + parts.reduce<number>((sum, part) => sum + (part ?? 0), 0));
  const otherWork = unfinishedDevelopmentPlans(state).length;
  const cautiousWeeks = nominalWeeks === null ? null : Math.ceil(nominalWeeks * (1.35 + otherWork * .15));
  const weeklyBaseCents = getWeeklyBaseCost(state, content, owner);
  const totalWork = preview.workCUw + preview.checkpointOverheadWork + teacherWork + suites.reduce((sum, suite) => sum + suite.workCUw, 0);
  const variableCeiling = mulDiv(totalWork, Math.max(0, ...content.hardware.map(hardware => hardware.variableCentsPerCUw)), U, 'ceil');
  const issues: string[] = [];
  if (preview.reason) issues.push(preview.reason.message);
  const responsibility = developmentResponsibilityIssue(state, spec); if (responsibility) issues.push(responsibility);
  const objectiveIssue = developmentObjectiveIssue(state, spec, content); if (objectiveIssue) issues.push(objectiveIssue);
  if (nominalWeeks === null) issues.push('A required stage has no assigned staff or compute. Add capacity before expecting a completion date.');
  if (preview.memoryMU > state.slices.compute.fleets[owner].memoryMU) issues.push('Training memory exceeds the current cloud fleet. Review owned hardware and memory fit before starting.');
  const finishWeek = nominalWeeks === null ? null : state.week + nominalWeeks;
  if (finishWeek !== null && finishWeek > spec.deadlineWeek) issues.push('The nominal finish is later than this project deadline.');
  const customer = spec.objective?.kind === 'renewable-brief' ? spec.objective.terms : null;
  if (customer && (finishWeek === null || finishWeek + 1 > customer.acceptUntilWeek)) issues.push(`The pinned ${customer.client} offer closes in Week ${customer.acceptUntilWeek}; this design is unlikely to qualify in time. Its terms remain pinned; choose another target deliberately.`);
  return { nominalWeeks, cautiousWeeks, finishWeek, setupCents, weeklyBaseCents,
    operatingLowCents: nominalWeeks === null ? null : weeklyBaseCents * nominalWeeks,
    operatingHighCents: cautiousWeeks === null ? null : weeklyBaseCents * cautiousWeeks + variableCeiling,
    issues, shareBps: share, includesChallenge: !!developmentObjectiveChallenge(spec.objective) };
}
