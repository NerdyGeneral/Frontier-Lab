import { formatWorkPoints } from './workforce-points';
import { CONTENT } from '../content/catalog';
import { CHIP_RULES } from '../content/wave4-hardware';
import { FACILITY_PROFILES, FACILITY_SPECIALIZATION_RULES as RULES, facilityProfileDefinition } from '../content/wave28-facilities';
import type { CommandQuote, ComputePool, ComputeSlice, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { FacilityPoolSpecialization, FacilitySpecialization, FacilitySpecializationPoolView, FacilitySpecializationView, Wave28FacilityCommand } from '../contracts/wave28-facilities';
import { freezeDeep } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getActiveFacilityRetrofitEffects } from './facility-retrofits';
import { getComputePools, getPoolMultiplierBps, getPoolWorkCapacityCU, getPoolWorkCostRate, getRackCapacity, getSiteEnvelope, hasFastFabric, poolSupportsWorkload } from './compute-pools';

export const FACILITY_SPECIALIZATION_COMMANDS = ['start_facility_specialization', 'set_facility_specialization_paused'] as const;
export const facilitySpecializationWorkId = (id: string) => 'facility-specialization-work:' + id;
const records = (compute: Readonly<ComputeSlice>): FacilitySpecialization[] => Object.values(compute.facilitySpecializations ?? {});
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const pending = (project: FacilitySpecialization) => project.status === 'building' || project.status === 'ready';
const validId = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export function facilitySpecializationResearchReady(state: Readonly<GameState>, companyId = state.playerCompanyId, atWeek = state.week): boolean {
  return (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.requiredResearch)
    && Object.values(state.slices.research.projects).some(project => project.companyId === companyId && project.researchId === RULES.requiredResearch
      && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek);
}

/** Activation intervals remain immutable after a paid replacement retires a profile. */
export function getFacilitySpecializationAtWeek(state: Readonly<GameState>, facilityId: string, week = state.week): FacilitySpecialization | null {
  return records(state.slices.compute).find(project => project.facilityId === facilityId && project.activatedWeek !== null
    && project.activatedWeek <= week && (project.retiredWeek === null || week < project.retiredWeek)) ?? null;
}

export function facilityPoolSpecialization(project: Pick<FacilitySpecialization, 'id' | 'profile' | 'activatedWeek'>): FacilityPoolSpecialization {
  if (project.activatedWeek === null) throw new Error('An unfinished profile cannot change a compute pool.');
  const definition = facilityProfileDefinition(project.profile);
  return { id: project.id, profile: project.profile, activatedWeek: project.activatedWeek,
    trainingCapacityBps: definition.trainingCapacityBps, servingCapacityBps: definition.servingCapacityBps,
    crossRackTrainingBps: definition.crossRackTrainingBps, servingVariableCostBps: definition.servingVariableCostBps };
}

export function facilitySpecializationCommandShapeReason(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Choose an authored site specialization command.';
  const p = payload as Wave28FacilityCommand;
  if (p.kind === 'start_facility_specialization') return Object.keys(p).sort().join() === 'facilityId,kind,profile' && validId(p.facilityId)
    && FACILITY_PROFILES.some(item => item.profile === p.profile) ? null : 'Choose only an owned site and its serving or training profile.';
  if (p.kind === 'set_facility_specialization_paused') return Object.keys(p).sort().join() === 'kind,paused,specializationId' && validId(p.specializationId)
    && typeof p.paused === 'boolean' ? null : 'Choose one unfinished specialization and an explicit pause state.';
  return 'Choose an authored site specialization command.';
}

export function validateFacilitySpecializationCommand(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const shape = facilitySpecializationCommandShapeReason(command.payload); if (shape) return reject(shape, 'INVALID_COMMAND');
  const p = command.payload as Wave28FacilityCommand, company = state.slices.company.companies[command.companyId];
  if (!company) return reject('This company does not exist.', 'UNKNOWN_COMPANY');
  if (company.arrearsCents > 0) return reject('Resolve unpaid bills before changing a facility profile.', 'ARREARS');
  if (p.kind === 'start_facility_specialization') {
    if (!facilitySpecializationResearchReady(state, command.companyId)) return reject('Complete paid Facility specialization S5 before funding a site profile.');
    const site = state.slices.compute.facilities[p.facilityId];
    if (!site || site.companyId !== command.companyId || site.status !== 'active') return reject('Choose a commissioned owned facility. Colocation and unfinished sites cannot receive this profile.');
    const history = records(state.slices.compute).filter(project => project.facilityId === site.id);
    if (history.some(pending) || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId
      && other.payload.kind === 'start_facility_specialization' && other.payload.facilityId === site.id)) return reject('Finish or resume this site’s paid specialization before funding a replacement.', 'ALREADY_ACTIVE');
    if (getFacilitySpecializationAtWeek(state, site.id)?.profile === p.profile) return reject('This site already operates with that profile.', 'ALREADY_ACTIVE');
    if (history.length >= RULES.maximumHistoryPerSite) return reject('This site has reached its retained paid profile-history limit.', 'CAPACITY_EXCEEDED');
  } else {
    const project = state.slices.compute.facilitySpecializations?.[p.specializationId];
    if (!project || project.companyId !== command.companyId || project.status !== 'building') return reject('Choose one of your unfinished paid site specializations.');
    if (project.paused === p.paused || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId
      && other.payload.kind === 'set_facility_specialization_paused' && other.payload.specializationId === project.id)) return reject('This pause state already applies or a change is queued.', 'ALREADY_ACTIVE');
  }
}

export function quoteFacilitySpecializationCommand(_state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload as Wave28FacilityCommand;
  if (p.kind === 'start_facility_specialization') {
    const definition = facilityProfileDefinition(p.profile);
    return { upfrontCostCents: definition.purchaseCents, weeklyCostDeltaCents: 0,
      summary: `${definition.name}: ${formatMoney(definition.purchaseCents)} capital, ${definition.requiredWeeks} elapsed weeks, ${formatWorkPoints(definition.requiredStaff)} Operations points, and ${formatUnits(definition.requiredWork)} development CUw in ${formatUnits(definition.requiredMemory)} MU. The current profile remains until the following activation boundary. ${definition.benefit} ${definition.tradeoff}` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.paused
    ? 'Pause elapsed time, staff work and GPU qualification next week. Paid progress and the current active profile remain.'
    : 'Resume paid specialization next week using available Infrastructure staff and development compute.' };
}

export function applyFacilitySpecializationCommand(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const compute = structuredClone(state.slices.compute), p = command.payload as Wave28FacilityCommand;
  if (p.kind === 'set_facility_specialization_paused') {
    const project = compute.facilitySpecializations![p.specializationId]; project.paused = p.paused; project.lastProgress = 0;
    project.lastBottleneck = p.paused ? 'Profile work paused; the current active profile remains.' : 'Profile work resumed.';
    return { updates: { compute }, messages: [{ companyId: command.companyId, category: 'project', message: project.lastBottleneck }] };
  }
  const definition = facilityProfileDefinition(p.profile), id = 'facility-specialization:' + command.id, paymentId = 'facility-specialization-capital:' + command.id;
  compute.facilitySpecializations ??= {};
  compute.facilitySpecializations[id] = { id, companyId: command.companyId, facilityId: p.facilityId, profile: p.profile,
    startCommandId: command.id, paymentId, purchaseCents: definition.purchaseCents,
    previousProfileId: getFacilitySpecializationAtWeek(state, p.facilityId)?.id ?? null,
    status: 'building', paused: false, startedWeek: state.week, requiredWeeks: definition.requiredWeeks, elapsedWeeks: 0,
    requiredStaff: definition.requiredStaff, completedStaff: 0, requiredWork: definition.requiredWork, completedWork: 0, physicalWork: 0,
    requiredMemory: definition.requiredMemory, completedWeek: null, readyWeek: null, activatedWeek: null, retiredWeek: null,
    grants: [], lastProgress: 0, lastBottleneck: 'Funded; elapsed time, Infrastructure staff and paid GPU qualification must complete.' };
  return { updates: { compute }, facts: [{ id: paymentId, companyId: command.companyId, sourceId: id, week: state.week,
    kind: 'expense', category: 'capital', amountCents: definition.purchaseCents,
    label: `${compute.facilities[p.facilityId].name}: ${definition.name}` }],
  messages: [{ companyId: command.companyId, category: 'project', message: quoteFacilitySpecializationCommand(state, command).summary }] };
}

export function facilitySpecializationCommit(_state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of records(compute)) {
    if (project.status !== 'ready' || project.readyWeek !== context.week) continue;
    if (project.previousProfileId) {
      const previous = compute.facilitySpecializations![project.previousProfileId];
      if (previous.status !== 'active' || previous.facilityId !== project.facilityId) throw new Error('The retained active profile changed before paid replacement.');
      previous.status = 'retired'; previous.retiredWeek = context.week;
    }
    project.status = 'active'; project.activatedWeek = context.week; project.lastProgress = 0; project.lastBottleneck = '';
    messages.push({ companyId: project.companyId, category: 'delivery', message: `${compute.facilities[project.facilityId].name}: ${facilityProfileDefinition(project.profile).name} active. Its supported workload benefit and capacity tradeoff begin together.` });
  }
  return messages;
}

export function facilitySpecializationRequests(state: Readonly<GameState>): WorkRequest[] {
  return records(state.slices.compute).filter(project => project.status === 'building' && !project.paused
    && state.slices.company.companies[project.companyId].arrearsCents === 0).map(project => {
    const work = project.requiredWork - project.completedWork;
    return { id: facilitySpecializationWorkId(project.id), companyId: project.companyId, taskId: project.id,
      category: 'development', normalizedWorkCUw: work, memoryMU: work ? project.requiredMemory : 0,
      workloadKind: 'general', priority: RULES.requestPriority, poolId: 'auto',
      staffDemand: [{ role: 'infrastructure', staffWeeks: project.requiredStaff - project.completedStaff }] };
  });
}

export function advanceFacilitySpecializations(state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): void {
  for (const project of records(compute)) {
    project.lastProgress = 0;
    if (project.status !== 'building' || project.paused) continue;
    if (state.slices.company.companies[project.companyId].arrearsCents) { project.lastBottleneck = 'Unpaid bills; specialization work is suspended.'; continue; }
    const requestId = facilitySpecializationWorkId(project.id), grant = context.resources.computeGrants.find(item => item.requestId === requestId);
    const staff = context.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'infrastructure')?.staffWeeks ?? 0;
    const work = grant?.hardwareEffectiveCUw ?? 0, physical = grant?.physicalCUw ?? 0;
    const remainingWork = project.requiredWork - project.completedWork, remainingStaff = project.requiredStaff - project.completedStaff;
    if (work > remainingWork || staff > remainingStaff) throw new Error('Specialization grant exceeds its remaining paid work.');
    const elapsed = project.elapsedWeeks < project.requiredWeeks;
    if (elapsed || work || staff) {
      const pool = physical ? getComputePools(state, project.companyId, context.content, context.resources.staffGrants).find(item => item.id === grant!.poolId) : null;
      if (physical && !pool) throw new Error('Specialization GPU qualification has no actual connected pool.');
      project.grants.push({ week: context.week, elapsed, requestedWork: remainingWork, requestedStaff: remainingStaff,
        grantedWork: work, physicalWork: physical, grantedStaff: staff, requiredMemory: remainingWork ? project.requiredMemory : 0,
        grantedMemory: grant?.memoryMU ?? 0, pool: pool ? structuredClone(pool) : null });
    }
    if (elapsed) project.elapsedWeeks++;
    project.completedStaff = checkedAdd(project.completedStaff, staff); project.completedWork = checkedAdd(project.completedWork, work);
    project.physicalWork = checkedAdd(project.physicalWork, physical); project.lastProgress = work;
    project.lastBottleneck = project.completedStaff < project.requiredStaff ? 'Operations points reach this project after operating coverage and existing construction.'
      : project.completedWork < project.requiredWork ? state.slices.compute.fleets[project.companyId].lastGrants.find(item => item.requestId === requestId)?.reason || 'Allocate development compute and connected memory for qualification.'
        : project.elapsedWeeks < project.requiredWeeks ? 'Staff and GPU work are complete; the physical retrofit still needs elapsed weeks.' : '';
  }
}

export function resolveFacilitySpecializations(_state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const project of records(compute)) {
    if (project.status !== 'building' || project.paused || project.elapsedWeeks !== project.requiredWeeks
      || project.completedStaff !== project.requiredStaff || project.completedWork !== project.requiredWork) continue;
    project.status = 'ready'; project.completedWeek = context.week; project.readyWeek = context.week + 1;
    project.lastBottleneck = `Paid work complete; the existing profile remains until Week ${project.readyWeek}.`;
    messages.push({ companyId: project.companyId, category: 'project', message: `${facilityProfileDefinition(project.profile).name} qualified. Benefit and tradeoff activate together next week.` });
  }
  return messages;
}

function poolView(pool: ComputePool, content: GameContent): FacilitySpecializationPoolView {
  const architecture = pool.architectures?.[0] ?? 'dense';
  const serving = { category: 'serving' as const, workloadKind: 'inference' as const, modelArchitecture: architecture };
  const training = { category: 'development' as const, workloadKind: 'training' as const, modelArchitecture: architecture };
  const supportsServing = poolSupportsWorkload(pool, serving), supportsTraining = poolSupportsWorkload(pool, training);
  return { id: pool.id, name: pool.name, hardwareId: pool.hardwareId, nominalCU: pool.nominalCU, capacityCU: pool.capacityCU,
    memoryMU: pool.memoryMU, rackCount: pool.rackCount,
    servingCapacityCU: supportsServing ? getPoolWorkCapacityCU(pool, serving) : 0,
    trainingCapacityCU: supportsTraining ? getPoolWorkCapacityCU(pool, training) : 0,
    baseVariableCentsPerCUw: pool.variableCentsPerCUw, servingVariableCentsPerCUw: getPoolWorkCostRate(pool, serving),
    crossRackTrainingMultiplierBps: supportsTraining && pool.rackCount > 1 ? getPoolMultiplierBps(pool, 'development', true, content, 'training') : 0,
    staffCoverageBps: pool.staffCoverageBps, powerCoverageBps: pool.powerCoverageBps, coolingCoverageBps: pool.coolingCoverageBps,
    fastFabric: !!pool.fastFabric, bottleneck: pool.bottleneck, supportsServing, supportsTraining,
    architectures: [...(pool.architectures ?? ['dense', 'sparse'])], workloads: [...(pool.workloads ?? ['inference', 'training', 'general'])] };
}

/** A cheap read-only comparison of the current site's physical facts under each
 * authored profile. It does not advance time or promise future utilization. */
export function getFacilitySpecializationView(state: Readonly<GameState>, content: GameContent = CONTENT): FacilitySpecializationView {
  const owner = state.playerCompanyId, researched = facilitySpecializationResearchReady(state, owner);
  const pools = getComputePools(state, owner, content), history = records(state.slices.compute);
  return freezeDeep({ researched, researchReason: researched ? null : 'Complete paid Facility specialization S5 to fund a site profile.',
    profiles: FACILITY_PROFILES.map(item => ({ ...item })),
    sites: Object.values(state.slices.compute.facilities).filter(site => site.companyId === owner).sort((a, b) => a.id.localeCompare(b.id)).map(site => {
      const rows = history.filter(project => project.facilityId === site.id), current = getFacilitySpecializationAtWeek(state, site.id), work = rows.find(pending) ?? null;
      const sitePools = pools.filter(pool => pool.location === site.id), envelope = getSiteEnvelope(state, site.id, content);
      const racks = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === owner && rack.location === site.id && ['installed', 'parked'].includes(rack.status));
      const nominal = racks.reduce((sum, rack) => checkedAdd(sum, getRackCapacity(rack, content)), 0), extensions = getActiveFacilityRetrofitEffects(state, owner, site.id);
      const fabric = hasFastFabric(state, owner, site.id);
      return { id: site.id, name: site.name, commissioned: site.status === 'active', active: current ? structuredClone(current) : null,
        pending: work ? structuredClone(work) : null, history: structuredClone(rows),
        installedRacks: racks.filter(rack => rack.status === 'installed').length, parkedRacks: racks.filter(rack => rack.status === 'parked').length,
        powerDemand: envelope.powerDemand, powerLimit: envelope.powerLimit, coolingDemand: envelope.coolingDemand, coolingLimit: envelope.coolingLimit,
        fixedWeeklyCents: mulDiv(nominal, content.infrastructure.ownedMaintenanceCentsPerCUWeek, U)
          + (site.status === 'active' ? content.infrastructure.siteFixedCentsPerWeek : 0) + extensions.weeklyCents + (fabric ? CHIP_RULES.fabricFixedCentsPerWeek : 0),
        requiredOperatingStaff: (site.status === 'active' ? content.infrastructure.siteBaseStaff + mulDiv(nominal, content.infrastructure.siteStaffPer16CU, 16 * U) : 0)
          + extensions.operatingStaff + (fabric ? CHIP_RULES.fabricOperatingStaff : 0),
        pools: sitePools.map(pool => poolView(pool, content)), choices: FACILITY_PROFILES.map(definition => {
          const payload: Extract<Wave28FacilityCommand, { kind: 'start_facility_specialization' }> = { kind: 'start_facility_specialization', facilityId: site.id, profile: definition.profile };
          const reason = validateFacilitySpecializationCommand(state, { id: 'facility-profile-preview', companyId: owner, issuedForWeek: state.week + 1, payload });
          const specialization = facilityPoolSpecialization({ id: 'proposed-profile', profile: definition.profile, activatedWeek: state.week + 1 });
          return { profile: definition.profile, eligible: !reason, reason: reason?.message ?? null, payload,
            proposedPools: sitePools.map(pool => poolView({ ...pool, specialization }, content)) };
        }) };
    }) });
}
