import { formatWorkPoints } from './workforce-points';
import type { DomainResult, GameCommand, GameContent, GameState, ModelVersion, ModuleContext, Rejection, ResearchSlice, TrainingRun, WorkRequest } from '../contracts/types';
import type { AppliedResearchView, ModelApplicationRun, SystemRolloutKind } from '../contracts/wave4-research';
import { CONTENT } from '../content/catalog';
import { ASSISTANCE, SYSTEM_RULES, VARIANT_RULES } from '../content/wave4-research';
import { checkedAdd, formatUnits, mulDiv } from '../core/math';
import { getCompatibleComputePools, getPoolMultiplierBps } from './compute-pools';
import { hasCapabilityEvaluation, inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';

const U = 1_000_000_000;
const known = (state: Readonly<GameState>, companyId: string, id: string) => (state.slices.research.completedByCompany[companyId] ?? []).includes(id);
const error = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const runId = (id: string) => 'application-work:' + id;
const systemId = (id: string) => 'system-work:' + id;
export const MODEL_APPLICATION_COMMANDS = ['create_model_variant'] as const;
export const SYSTEM_APPLICATION_COMMANDS = ['start_system_rollout', 'configure_research_assistant'] as const;

export function getAppliedResearchView(state: Readonly<GameState>, companyId: string, content: GameContent = CONTENT): AppliedResearchView {
  const k = (id: string) => known(state, companyId, id);
  return {
    applications: Object.values(state.slices.models.applicationRuns ?? {}).filter(run => run.companyId === companyId).sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id)),
    variants: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && model.runtimeVariant).map(model => ({
      id: model.id, name: model.name, kind: model.runtimeVariant!.kind, sourceName: state.slices.models.versions[model.runtimeVariant!.sourceModelId].name,
      servingWorkBps: model.runtimeVariant!.servingWorkBps, residentMU: model.residentMU, evaluated: hasCapabilityEvaluation(state, model.id),
    })),
    rollouts: Object.values(state.slices.research.systemRollouts ?? {}).filter(rollout => rollout.companyId === companyId),
    assistant: state.slices.research.assistantsByCompany?.[companyId] ?? null,
    available: { compression: k('R7'), memoryFormat: k('R7A'), routing: k('R8'), prefixCache: k('R8A'), supervisor: k('R3B'), assistant: k('R15'), distillation: k('R13'), sparse: k('R14'), deduplication: k('R2A'), evidenceLinks: k('R6A'), capacityForecast: k('R12A'), adapterBank: k('R4B'), actionReceipts: k('R9A'), independentHoldouts: k('R10A'), budgetedPlanner: k('R11A') },
    teachers: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && hasCapabilityEvaluation(state, model.id)).map(model => ({
      id: model.id, name: model.name, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, transferRights: inheritedModelRights(state, model.id, content).weights,
    })),
  };
}
export function validateModelApplication(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload;
  if (p.kind !== 'create_model_variant') return error('Choose a supported model application.', 'INVALID_COMMAND');
  const model = state.slices.models.versions[p.modelId], rule = VARIANT_RULES[p.variant];
  if (!rule || !known(state, command.companyId, rule.research)) return error(`Complete ${rule?.research ?? 'the required research'} before applying this deployment variant.`);
  if (!model || model.companyId !== command.companyId || !hasCapabilityEvaluation(state, model.id)) return error('Choose one of your models with a held-out capability report.');
  if (model.runtimeVariant) return error('Apply a deployment variant to the original model. Compression and memory formats are alternatives and cannot stack.', 'NO_IMPROVEMENT');
  if (Object.values(state.slices.models.applicationRuns ?? {}).some(run => run.companyId === command.companyId && run.sourceModelId === model.id && run.variant === p.variant)
    || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.modelId === model.id && other.payload.variant === p.variant)) return error('This model already has this variant or a queued application. Resume the saved work.', 'ALREADY_ACTIVE');
  if (Object.values(state.slices.models.applicationRuns ?? {}).filter(run => run.companyId === command.companyId).length >= 128) return error('This company has reached its 128 saved deployment variants.', 'CAPACITY_EXCEEDED');
}
export function quoteModelApplication(command: GameCommand) {
  if (command.payload.kind !== 'create_model_variant') throw new Error('Expected model-application command.');
  const rule = VARIANT_RULES[command.payload.variant];
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${rule.name}: ${formatWorkPoints(rule.staff)} Design points and ${formatUnits(rule.work)} development CUw, then a separate held-out evaluation. Applies a ${rule.scorePenaltyBps / 100}-point task penalty; ${rule.servingWorkBps / 100}% serving work and ${rule.memoryBps / 100}% resident weight memory. Existing deployments stay on their selected version.` };
}
export function applyModelApplication(state: Readonly<GameState>, command: GameCommand): DomainResult {
  if (command.payload.kind !== 'create_model_variant') return {};
  const models = structuredClone(state.slices.models), p = command.payload, rule = VARIANT_RULES[p.variant], id = 'application:' + command.id;
  const run: ModelApplicationRun = { id, companyId: command.companyId, sourceModelId: p.modelId, outputModelId: 'variant:' + command.id,
    variant: p.variant, startedWeek: state.week, requiredWork: rule.work, completedWork: 0, physicalWork: 0, requiredStaff: rule.staff, completedStaff: 0,
    status: 'running', lastProgress: 0, lastBottleneck: 'Waiting for ML staff and development work.' };
  models.applicationRuns[id] = run;
  return { updates: { models }, messages: [{ category: 'project', companyId: command.companyId, message: `${rule.name} application started for ${models.versions[p.modelId].name}. The output will need its own evaluation.` }] };
}
export function modelApplicationRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.models.applicationRuns ?? {}).filter(run => run.status === 'running').map(run => ({
    id: runId(run.id), companyId: run.companyId, taskId: run.id, category: 'development', normalizedWorkCUw: run.requiredWork - run.completedWork,
    memoryMU: run.requiredWork > run.completedWork ? state.slices.models.versions[run.sourceModelId].residentMU : 0, priority: 25, poolId: 'auto',
    ...modelExecutionHints(state.slices.models.versions[run.sourceModelId], 'general'),
    staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, run.requiredStaff - run.completedStaff) }],
  }));
}
export function advanceModelApplications(models: GameState['slices']['models'], state: Readonly<GameState>, ctx: ModuleContext): void {
  for (const run of Object.values(models.applicationRuns ?? {})) {
    if (run.status !== 'running') continue;
    const grant = ctx.resources.computeGrants.find(g => g.requestId === runId(run.id));
    const staff = ctx.resources.staffGrants.find(g => g.requestId === runId(run.id))?.grants.find(g => g.role === 'ml')?.staffWeeks ?? 0;
    run.completedWork = checkedAdd(run.completedWork, grant?.hardwareEffectiveCUw ?? 0); run.physicalWork = checkedAdd(run.physicalWork, grant?.physicalCUw ?? 0);
    run.completedStaff = checkedAdd(run.completedStaff, staff); run.lastProgress = grant?.hardwareEffectiveCUw ?? 0;
    run.lastBottleneck = [run.completedStaff < run.requiredStaff && !staff ? 'Waiting for Design points.' : '', run.completedWork < run.requiredWork && !run.lastProgress ? (state.slices.compute.fleets[run.companyId].lastGrants.find(g => g.requestId === runId(run.id))?.reason || 'Allocate development compute and connected model memory.') : ''].filter(Boolean).join(' ');
  }
}
export function variantModel(state: Readonly<GameState>, run: ModelApplicationRun, week: number): ModelVersion {
  const source = state.slices.models.versions[run.sourceModelId], rule = VARIANT_RULES[run.variant];
  return { id: run.outputModelId, companyId: run.companyId, name: source.name + (run.variant === 'compression' ? ' · compressed' : ' · compact memory'),
    family: source.family, architecture: source.architecture, status: 'checkpoint', capabilityBps: Object.fromEntries(Object.entries(source.capabilityBps).map(([domain, score]) => [domain, Math.max(0, score - rule.scorePenaltyBps)])) as ModelVersion['capabilityBps'],
    reliabilityBps: source.reliabilityBps, residentMU: mulDiv(source.residentMU, rule.memoryBps, 10000),
    source: `${rule.name} of ${source.name}. ${rule.scorePenaltyBps / 100}-point task penalty; evaluation is separate.`, parentModelId: source.id, createdWeek: week,
    ...(source.behavior ? { behavior: { ...source.behavior } } : {}), ...(source.foundationAnchor ? { foundationAnchor: { ...source.foundationAnchor } } : {}),
    ...(source.planner ? { planner: { ...source.planner } } : {}),
    ...(source.policy ? { policy: { ...source.policy } } : {}),
    ...(source.advancedCapabilities ? { advancedCapabilities: { ...source.advancedCapabilities } } : {}),
    ...(source.modelDesign ? { modelDesign: structuredClone(source.modelDesign) } : {}),
    runtimeVariant: { kind: run.variant, applicationId: run.id, sourceModelId: source.id, servingWorkBps: rule.servingWorkBps },
  };
}
export function resolveModelApplications(models: GameState['slices']['models'], state: Readonly<GameState>, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const run of Object.values(models.applicationRuns ?? {})) if (run.status === 'running' && run.completedWork === run.requiredWork && run.completedStaff === run.requiredStaff) {
    run.status = 'complete'; run.completedWeek = ctx.week; run.lastBottleneck = '';
    if (models.versions[run.outputModelId]) throw new Error('A deployment variant already exists.');
    models.versions[run.outputModelId] = variantModel(state, run, ctx.week);
    messages.push({ category: 'project', companyId: run.companyId, message: `${models.versions[run.outputModelId].name} is saved. Evaluate this candidate before deploying its efficiency/quality tradeoff.` });
  }
  return messages;
}
export function systemRollout(state: Readonly<GameState>, companyId: string, method: SystemRolloutKind) {
  return Object.values(state.slices.research.systemRollouts ?? {}).find(rollout => rollout.companyId === companyId && rollout.method === method);
}
export function systemApplied(state: Readonly<GameState>, companyId: string, method: SystemRolloutKind): boolean { return systemRollout(state, companyId, method)?.status === 'active'; }
export function validateSystemApplication(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload;
  if (state.slices.company.companies[command.companyId]?.arrearsCents) return error('Resolve unpaid expenses before configuring applications.', 'ARREARS');
  if (p.kind === 'start_system_rollout') {
    const rule = SYSTEM_RULES[p.method];
    if (!rule || !known(state, command.companyId, rule.research)) return error('Complete the required research before paying for its rollout.');
    if (systemRollout(state, command.companyId, p.method) || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.method === p.method)) return error('This company already has this rollout or a queued start.', 'ALREADY_ACTIVE');
    return;
  }
  if (p.kind === 'configure_research_assistant') {
    if (!systemApplied(state, command.companyId, 'research-assistant')) return error('Finish the research-assistant rollout and wait for activation.');
    const model = state.slices.models.versions[p.modelId];
    if (!model || model.companyId !== command.companyId || !hasCapabilityEvaluation(state, model.id) || model.capabilityBps.coding < 6500 || model.capabilityBps.tools < 6000) return error('Choose your evaluated coding 65 / tools 60 model for reviewed research assistance.');
    if (!Number.isSafeInteger(p.maxAssistedFte) || p.maxAssistedFte < U / 4 || p.maxAssistedFte > ASSISTANCE.maximumFte || p.maxAssistedFte % (U / 4)) return error('Choose 5–80 assisted Research points in steps of 5.', 'INVALID_COMMAND');
    if (typeof p.enabled !== 'boolean') return error('The assistant enabled choice must be explicit.', 'INVALID_COMMAND');
    return;
  }
  return error('Choose a supported research application.', 'INVALID_COMMAND');
}
export function quoteSystemApplication(command: GameCommand) {
  const p = command.payload;
  if (p.kind === 'start_system_rollout') { const rule = SYSTEM_RULES[p.method]; return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${rule.name} rollout: ${formatWorkPoints(rule.staff)} Design points and ${formatUnits(rule.work)} development CUw; activates next boundary. Payroll and compute are separate.` }; }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Reviewed assistance adds at most 20% to Research points actually applied to work. Each 20 assisted Research points needs 0.25 baseline serving CUw, model memory and 2 Business review points; research compute remains fully required.' };
}
export function applySystemApplication(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const p = command.payload, research = structuredClone(state.slices.research);
  if (p.kind === 'start_system_rollout') {
    const rule = SYSTEM_RULES[p.method], id = 'system-rollout:' + command.id;
    research.systemRollouts[id] = { id, companyId: command.companyId, method: p.method, startedWeek: state.week, requiredWork: rule.work, completedWork: 0, requiredStaff: rule.staff, completedStaff: 0, status: 'building', readyWeek: null, lastBottleneck: 'Waiting for ML staff and development work.' };
  } else if (p.kind === 'configure_research_assistant') {
    const old = research.assistantsByCompany[command.companyId];
    research.assistantsByCompany[command.companyId] = { companyId: command.companyId, modelId: p.modelId, enabled: p.enabled, maxAssistedFte: p.maxAssistedFte,
      lastWeek: state.week, requestedWork: 0, executedWork: 0, physicalWork: 0, reviewStaff: 0, assistedStaff: 0, bonusStaff: 0, lastBottleneck: p.enabled ? 'Waiting for eligible research, serving capacity and human review.' : 'Disabled by you.', ...(old && !p.enabled ? { lastWeek: old.lastWeek } : {}) };
  }
  return { updates: { research }, messages: [{ category: 'project', companyId: command.companyId, message: p.kind === 'start_system_rollout' ? 'Research application rollout started; both implementation meters must finish.' : 'Research-assistant configuration updated for subsequent resource grants.' }] };
}
export function commitSystemRollouts(research: ResearchSlice, week: number): void {
  for (const rollout of Object.values(research.systemRollouts ?? {})) if (rollout.status === 'ready' && rollout.readyWeek! <= week) { rollout.status = 'active'; rollout.lastBottleneck = ''; }
}
export function systemApplicationRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.research.systemRollouts ?? {}).filter(rollout => rollout.status === 'building').map(rollout => ({ id: systemId(rollout.id), companyId: rollout.companyId, taskId: rollout.id, category: 'development', normalizedWorkCUw: rollout.requiredWork - rollout.completedWork, memoryMU: 0, workloadKind: 'general', priority: 35, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, rollout.requiredStaff - rollout.completedStaff) }] }));
}
export function advanceSystemRollouts(research: ResearchSlice, ctx: ModuleContext): void {
  for (const rollout of Object.values(research.systemRollouts ?? {})) if (rollout.status === 'building') {
    const work = ctx.resources.computeGrants.find(g => g.requestId === systemId(rollout.id))?.hardwareEffectiveCUw ?? 0;
    const staff = ctx.resources.staffGrants.find(g => g.requestId === systemId(rollout.id))?.grants.find(g => g.role === 'ml')?.staffWeeks ?? 0;
    rollout.completedWork = checkedAdd(rollout.completedWork, work); rollout.completedStaff = checkedAdd(rollout.completedStaff, staff);
    rollout.lastBottleneck = [rollout.completedWork < rollout.requiredWork && !work ? 'Allocate development compute.' : '', rollout.completedStaff < rollout.requiredStaff && !staff ? 'Waiting for Design points.' : ''].filter(Boolean).join(' ');
  }
}
export function resolveSystemRollouts(research: ResearchSlice, week: number): void {
  for (const rollout of Object.values(research.systemRollouts ?? {})) if (rollout.status === 'building' && rollout.completedWork === rollout.requiredWork && rollout.completedStaff === rollout.requiredStaff) { rollout.status = 'ready'; rollout.readyWeek = week + 1; rollout.lastBottleneck = 'Implementation finished; activation is next week.'; }
}

/** The supervisor still reserves human coverage proportional to the chosen allocation. */
export function trainingSupervision(state: Readonly<GameState>, run: TrainingRun, work: number, content: GameContent): Pick<WorkRequest, 'staffDemand' | 'supervision'> {
  if (!systemApplied(state, run.companyId, 'run-supervisor')) return { staffDemand: [{ role: 'ml', staffWeeks: mulDiv(work, U, content.firstSale.trainingWorkPerMl, 'ceil') }], supervision: { role: 'ml', workPerStaffWeek: content.firstSale.trainingWorkPerMl } };
  const allocation = state.slices.compute.fleets[run.companyId].allocation.development;
  const groups = Math.max(1, Math.ceil(allocation / (8 * U)));
  const familiar = Object.values(state.slices.models.trainingRuns).some(previous => previous.companyId === run.companyId && previous.id !== run.id && previous.status === 'complete' && previous.plan?.family === run.plan?.family && previous.plan?.architecture === run.plan?.architecture && hasCapabilityEvaluation(state, previous.outputModelId));
  const staff = U / 2 + groups * U / 4 + (familiar ? 0 : U / 2);
  // This ceiling only releases work actually supplied by GPUs. A partial human grant scales it down.
  const base = state.slices.models.versions[run.baseModelId], hints = modelExecutionHints({ ...base, architecture: run.plan?.architecture ?? base.architecture, family: run.plan?.family ?? base.family }, 'training');
  const available = getCompatibleComputePools(state, run.companyId, hints, content).filter(pool => pool.memoryMU >= run.requiredMemory);
  const ceiling = available.reduce((maximum, pool) => {
    const physical = Math.min(allocation, pool.capacityCU);
    const single = pool.ownership === 'cloud' || run.requiredMemory <= pool.singleRackMemoryMU ? mulDiv(pool.ownership === 'cloud' ? physical : Math.min(physical, pool.singleRackCU), getPoolMultiplierBps(pool, 'development', false, content, 'training'), 10000) : 0;
    const cross = pool.ownership === 'owned' && pool.rackCount > 1 ? mulDiv(physical, getPoolMultiplierBps(pool, 'development', true, content, 'training'), 10000) : 0;
    return Math.max(maximum, single, cross);
  }, 0);
  const maximum = Math.max(1, Math.min(work, ceiling));
  return { staffDemand: [{ role: 'ml', staffWeeks: staff }], supervision: { role: 'ml', workPerStaffWeek: Math.max(1, mulDiv(maximum, U, staff, 'ceil')) } };
}
export function researchAssistantRequests(state: Readonly<GameState>): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const assistant of Object.values(state.slices.research.assistantsByCompany ?? {})) {
    if (!assistant.enabled) continue;
    const eligible = Object.values(state.slices.research.projects).filter(project => project.companyId === assistant.companyId && project.status === 'running' && project.role === 'research' && project.researchId !== 'R15').reduce((sum, project) => checkedAdd(sum, project.requiredStaff - project.completedStaff), 0);
    const assisted = Math.min(assistant.maxAssistedFte, eligible);
    if (!assisted) continue;
    const model = state.slices.models.versions[assistant.modelId];
    const work = mulDiv(mulDiv(assisted, ASSISTANCE.workPerFte, U), modelWorkBps(model), 10000);
    requests.push({ id: 'research-assistant:' + assistant.companyId, companyId: assistant.companyId, taskId: assistant.modelId, category: 'serving', normalizedWorkCUw: work,
      memoryMU: model.residentMU, ...modelExecutionHints(model), priority: 45, poolId: 'auto', staffDemand: [{ role: 'commercial', staffWeeks: mulDiv(assisted, ASSISTANCE.reviewPerFte, U) }] });
  }
  return requests;
}
/** Distribute a bounded boost only after real staff, inference, and human review grants. */
export function applyResearchAssistance(research: ResearchSlice, state: Readonly<GameState>, ctx: ModuleContext, ordinaryGrants: Record<string, number>): void {
  for (const assistant of Object.values(research.assistantsByCompany ?? {})) {
    assistant.lastWeek = ctx.week; assistant.requestedWork = 0; assistant.executedWork = 0; assistant.physicalWork = 0; assistant.reviewStaff = 0; assistant.assistedStaff = 0; assistant.bonusStaff = 0;
    if (!assistant.enabled) { assistant.lastBottleneck = 'Disabled by you.'; continue; }
    const id = 'research-assistant:' + assistant.companyId, request = ctx.resources.requests.find(r => r.id === id);
    const compute = ctx.resources.computeGrants.find(g => g.requestId === id), review = ctx.resources.staffGrants.find(g => g.requestId === id)?.grants.find(g => g.role === 'commercial')?.staffWeeks ?? 0;
    const model = state.slices.models.versions[assistant.modelId], workPerFte = mulDiv(ASSISTANCE.workPerFte, modelWorkBps(model), 10000);
    let eligible = Math.min(assistant.maxAssistedFte, mulDiv(compute?.hardwareEffectiveCUw ?? 0, U, workPerFte), mulDiv(review, U, ASSISTANCE.reviewPerFte));
    assistant.requestedWork = request?.normalizedWorkCUw ?? 0; assistant.executedWork = compute?.hardwareEffectiveCUw ?? 0; assistant.physicalWork = compute?.physicalCUw ?? 0; assistant.reviewStaff = review;
    for (const project of Object.values(research.projects).sort((a, b) => a.id.localeCompare(b.id))) {
      if (project.companyId !== assistant.companyId || project.status !== 'running' || project.role !== 'research' || project.researchId === 'R15') continue;
      const used = Math.min(eligible, ordinaryGrants[project.id] ?? 0), bonus = Math.min(project.requiredStaff - project.completedStaff, mulDiv(used, ASSISTANCE.bonusBps, 10000));
      eligible -= used; assistant.assistedStaff = checkedAdd(assistant.assistedStaff, used); assistant.bonusStaff = checkedAdd(assistant.bonusStaff, bonus);
      project.completedStaff = checkedAdd(project.completedStaff, bonus); project.assistanceStaff = checkedAdd(project.assistanceStaff ?? 0, bonus);
    }
    assistant.lastBottleneck = !request ? 'No eligible research staff work remains.' : !assistant.assistedStaff ? 'Real research staff, serving work and commercial review must all be available.' : assistant.executedWork < assistant.requestedWork ? 'Serving capacity limits assistance.' : '';
  }
}
