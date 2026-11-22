import { formatWorkPoints, WORK_POINT_LABELS } from '../modules/workforce-points';
import { CONTENT } from '../content/catalog';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { ASSURANCE_BY_ID } from '../content/wave13-assurance';
import type { DomainModule, GameContent, GameState, ModuleContext, ResourceFrame, SubmitResult } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { StudioBoundaryView, StudioPlanCommand, StudioPlanDraft, StudioPlanPreview, StudioRequestView } from '../contracts/wave25-studio';
import { STUDIO_PLAN_CONFLICT_KINDS, STUDIO_PLAN_MAX_COMMANDS, STUDIO_PLAN_MAX_HIRES, STUDIO_PLAN_MAX_HIRES_PER_ROLE } from '../contracts/wave25-studio';
import { commercialCapacityRequests } from '../modules/business';
import { getComputePools, poolSupportsWorkload } from '../modules/compute-pools';
import { emptyRoleAllocation, getPayrollCents, getWorkforce, isQuarterFte, STAFF_ROLES } from '../modules/workforce';
import { canonicalStateHash, freezeDeep } from './canonical';
import { advanceWeek, submitCommand } from './engine';
import { createDefaultModules } from './foundation-modules';
import { checkedAdd, formatUnits, mulDiv } from './math';
import { getWeeklyBaseCost } from './selectors';

/** Uncommitted UI state. Resource quantities use the same fixed-point units as the engine. */
export function createStudioPlanDraft(state: GameState): StudioPlanDraft {
  const owner = state.playerCompanyId, fleet = state.slices.compute.fleets[owner];
  return { founder: { ...state.slices.company.founderAssignments[owner] },
    staff: Object.fromEntries(Object.values(state.slices.company.staff).filter(member => member.companyId === owner).map(member => [member.id, member.assignedFte])),
    hires: emptyRoleAllocation(), cloudCU: fleet.cloudCU, allocation: { ...fleet.allocation } };
}

function planCommands(state: GameState, draft: StudioPlanDraft, content: GameContent): { commands: StudioPlanCommand[]; changes: string[] } {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)
    || Object.keys(draft).sort().join() !== 'allocation,cloudCU,founder,hires,staff') throw new Error('Refresh the planner, then choose your staff and compute settings.');
  const founder = draft.founder, hires = draft.hires, staff = draft.staff, allocation = draft.allocation;
  if (!founder || Object.keys(founder).sort().join() !== [...STAFF_ROLES].sort().join() || STAFF_ROLES.some(role => !isQuarterFte(founder[role]))) throw new Error('Split the founder’s weekly point budget in steps of 5 points.');
  if (!hires || Object.keys(hires).sort().join() !== [...STAFF_ROLES].sort().join()
    || STAFF_ROLES.some(role => !Number.isSafeInteger(hires[role]) || hires[role] < 0 || hires[role] > STUDIO_PLAN_MAX_HIRES_PER_ROLE)
    || STAFF_ROLES.reduce((total, role) => total + hires[role], 0) > STUDIO_PLAN_MAX_HIRES) throw new Error('Plan up to eight hires per role and sixteen hires in total.');
  if (!staff || typeof staff !== 'object' || Array.isArray(staff)) throw new Error('Refresh the employee assignments before planning.');
  if (!allocation || Object.keys(allocation).sort().join() !== 'development,research,serving'
    || Object.values(allocation).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Enter zero or a positive number for each compute allocation.');
  if (!Number.isSafeInteger(draft.cloudCU) || draft.cloudCU < 0 || draft.cloudCU % U || draft.cloudCU > content.firstSale.maxCloudCU) throw new Error('Rent a whole number of CU within the rental limit.');
  const owner = state.playerCompanyId, current = createStudioPlanDraft(state), commands: StudioPlanCommand[] = [], changes: string[] = [];
  const employeeNumbers = new Map(Object.values(state.slices.company.staff).filter(member => member.companyId === owner)
    .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id)).map((member, index) => [member.id, index + 1]));
  if (STAFF_ROLES.some(role => founder[role] !== current.founder[role])) {
    commands.push({ kind: 'assign_founder', allocations: { ...founder } }); changes.push('Change the founder’s shared role assignments.');
  }
  for (const id of Object.keys(staff).sort()) {
    const member = Object.hasOwn(state.slices.company.staff, id) ? state.slices.company.staff[id] : undefined;
    if (!member || member.companyId !== owner) throw new Error('An employee in this draft is no longer in your company. Refresh the planner.');
    if (!isQuarterFte(staff[id])) throw new Error('Set employee output from 0% to 100%, in steps of 25%.');
    if (staff[id] !== member.assignedFte) {
      commands.push({ kind: 'set_staff_allocation', staffId: id, fte: staff[id] });
      changes.push(`Assign ${content.staff.find(role => role.id === member.role)?.name ?? member.role} ${employeeNumbers.get(id)} to ${staff[id] / U * 100}% output.`);
    }
  }
  for (const role of STAFF_ROLES) {
    for (let i = 0; i < hires[role]; i++) commands.push({ kind: 'hire_staff', role });
    if (hires[role]) changes.push(`Hire ${hires[role]} ${content.staff.find(item => item.id === role)?.name ?? role}; pay starts next week, before onboarding finishes.`);
  }
  const resize = draft.cloudCU !== current.cloudCU ? { kind: 'set_cloud_capacity' as const, cu: draft.cloudCU } : null;
  const allocate = Object.keys(allocation).some(key => allocation[key as keyof typeof allocation] !== current.allocation[key as keyof typeof allocation])
    ? { kind: 'allocate_compute' as const, ...allocation } : null;
  // The usual validators remain authoritative: grow capacity before allocating
  // more, or reduce allocations before shrinking a reservation.
  if (resize && draft.cloudCU > current.cloudCU) commands.push(resize);
  if (allocate) commands.push(allocate);
  if (resize && draft.cloudCU < current.cloudCU) commands.push(resize);
  if (resize) changes.push(`Reserve ${formatUnits(draft.cloudCU)} cloud CU.`);
  if (allocate) changes.push(`Allocate ${formatUnits(allocation.serving)} serving, ${formatUnits(allocation.development)} development and ${formatUnits(allocation.research)} research CU.`);
  if (commands.length > STUDIO_PLAN_MAX_COMMANDS) throw new Error('A Studio plan supports at most 64 changes. Apply a smaller plan.');
  return { commands, changes };
}

function conflictReason(state: GameState): string | null {
  return state.queuedCommands.some(command => command.companyId === state.playerCompanyId && STUDIO_PLAN_CONFLICT_KINDS.includes(command.payload.kind))
    ? 'Advance one week to apply your pending staff or compute changes, then refresh this plan.' : null;
}

function requestLabel(state: GameState, taskId: string, content: GameContent): string {
  const s = state.slices;
  if (taskId === 'infrastructure-operations') return 'Infrastructure operations';
  const contract = s.products.commercialContracts[taskId];
  if (contract) return `${BUSINESS_BY_ID[contract.customerId]?.name ?? 'Business customer'} ${contract.status === 'building' || contract.status === 'ready' ? 'delivery' : contract.contractKind === 'customer-hosted' ? 'support' : 'private hosting'}`;
  const assurance = s.products.assuranceContracts?.[taskId];
  if (assurance) return `${ASSURANCE_BY_ID[assurance.buyerId]?.name ?? 'Assured customer'} assured API`;
  const product = s.products.offers[taskId]; if (product) return product.name;
  const training = s.models.trainingRuns[taskId]; if (training) return training.plan?.recipeName ?? 'Model training';
  const evaluation = s.models.evaluationRuns[taskId]; if (evaluation) return `Evaluate ${s.models.versions[evaluation.modelId]?.name ?? 'model'}`;
  const preparation = s.data.preparationJobs[taskId]; if (preparation) return `Prepare ${s.data.packets[preparation.packetId]?.name ?? 'data'}`;
  const synthetic = s.data.syntheticJobs?.[taskId];
  if (synthetic) return `${synthetic.phase === 'generating' ? 'Generate' : synthetic.phase === 'reviewing' ? 'Review' : 'Audit'} ${synthetic.domain} synthetic data`;
  const research = s.research.projects[taskId]; if (research) return content.research.find(item => item.id === research.researchId)?.name ?? research.researchId;
  const deployment = s.products.deployments[taskId]; if (deployment) return `Deploy ${s.products.offers[deployment.productId]?.name ?? 'model'}`;
  const facility = s.compute.facilities[taskId]; if (facility) return facility.name;
  const profile = s.compute.facilitySpecializations?.[taskId]; if (profile) return (s.compute.facilities[profile.facilityId]?.name ?? 'Owned site') + ' · ' + profile.profile + ' profile';
  const rack = s.compute.racks[taskId]; if (rack) return `Install ${content.hardware.find(item => item.id === rack.hardwareId)?.name ?? 'custom'} rack`;
  const chip = s.compute.chipDesigns[taskId]; if (chip) return chip.name;
  const batch = s.products.batchJobs?.[taskId]; if (batch) return batch.terms.name;
  return taskId;
}

function commitments(state: GameState): StudioBoundaryView['commitments'] {
  const owner = state.playerCompanyId, live = (status: string) => ['building', 'ready', 'active'].includes(status);
  const contracts = Object.values(state.slices.products.commercialContracts).filter(item => item.companyId === owner && live(item.status));
  const assurance = Object.values(state.slices.products.assuranceContracts ?? {}).filter(item => item.companyId === owner && live(item.status));
  return { privateHosted: contracts.filter(item => item.contractKind === 'private-hosted').length,
    customerHosted: contracts.filter(item => item.contractKind === 'customer-hosted').length, assured: assurance.length,
    reservedWorkCUw: commercialCapacityRequests(state, owner).reduce((total, request) => checkedAdd(total, request.normalizedWorkCUw), 0),
    supportFte: [...contracts, ...assurance].reduce((total, contract) => checkedAdd(total, contract.supportStaffPerWeek), 0) };
}

interface BoundaryCapture { state: GameState; resources: ResourceFrame; contextWeek: number }
function projectBoundary(source: GameState, content: GameContent, planId?: string): { view: StudioBoundaryView | null; reason: string | null } {
  let captured: BoundaryCapture | null = null;
  const observer: DomainModule = { id: 'studio-boundary-observer', owns: [], handlers: {
    execute(state, context: ModuleContext) {
      captured = { state: structuredClone(state), resources: structuredClone(context.resources), contextWeek: context.week };
      return {};
    },
  } };
  const tick = advanceWeek(source, content, [observer, ...createDefaultModules(content)]);
  if (!tick.accepted) return { view: null, reason: tick.reason?.message ?? 'Next week’s forecast could not be calculated.' };
  if (planId && tick.state.commandReceipts[planId]?.status !== 'accepted') return { view: null, reason: tick.state.commandReceipts[planId]?.reason?.message ?? 'This plan would not meet the requirements when next week starts.' };
  // The observer runs first in execute, after real reserve/grant allocation and
  // before a job can finish an installation or otherwise change the pool map.
  const observation = captured as BoundaryCapture | null;
  if (!observation) return { view: null, reason: 'Next week’s resource forecast is unavailable.' };
  const state = tick.state, owner = state.playerCompanyId, fleet = state.slices.compute.fleets[owner], company = state.slices.company.companies[owner];
  const pools = getComputePools(observation.state, owner, content, observation.resources.staffGrants);
  const requests: StudioRequestView[] = observation.resources.requests.filter(request => request.companyId === owner).map(request => {
    const grant = observation.resources.computeGrants.find(item => item.requestId === request.id);
    const staff = observation.resources.staffGrants.find(item => item.requestId === request.id);
    const compatible = pools.filter(pool => (request.poolId === 'auto' || request.poolId === pool.id) && poolSupportsWorkload(pool, request));
    const supplied = new Map(staff?.grants.map(item => [item.role, item.staffWeeks]));
    const roles = new Map((request.staffDemand ?? []).map(item => [item.role, item.staffWeeks]));
    const staffing = [...roles].map(([role, requested]) => ({ role, requested, granted: supplied.get(role) ?? 0 }));
    const actualPool = grant && (grant.physicalCUw > 0 || grant.memoryMU > 0) ? pools.find(pool => pool.id === grant.poolId) : undefined;
    const computeReason = observation.state.slices.compute.fleets[owner].lastGrants.find(item => item.requestId === request.id)?.reason ?? '';
    const staffReasons = staffing.filter(item => item.granted < item.requested).map(item => `${WORK_POINT_LABELS[item.role]}: ${formatWorkPoints(item.granted)} of ${formatWorkPoints(item.requested)} points allocated.`);
    return { id: request.id, taskId: request.taskId, label: requestLabel(observation.state, request.taskId, content) + (request.id.startsWith('canary-serve:') ? ' · canary candidate' : ''), category: request.category,
      requestedWork: request.normalizedWorkCUw, grantedWork: grant?.hardwareEffectiveCUw ?? 0, physicalWork: grant?.physicalCUw ?? 0,
      requestedMemory: request.memoryMU, grantedMemory: grant?.memoryMU ?? 0, poolId: actualPool?.id ?? null, poolName: actualPool?.name ?? null,
      largestCompatibleMemory: Math.max(0, ...compatible.map(pool => pool.memoryMU)), staff: staffing,
      reason: [computeReason, ...staffReasons].filter(Boolean).join(' '),
      liveServing: request.id.startsWith('serve:') || request.id.startsWith('canary-serve:') || request.id.startsWith('business-serve:') || request.id.startsWith('assurance-serve:') };
  });
  const upfrontCostCents = planId ? source.queuedCommands.find(command => command.id === planId)?.reservedCents ?? 0 : 0;
  return { reason: null, view: { week: state.week, cashCents: company.cashCents, arrearsCents: company.arrearsCents, revenueCents: company.lastWeek.revenueCents,
    operatingExpenseCents: company.lastWeek.operatingExpenseCents, upfrontCostCents,
    weeklyBaseCostCents: getWeeklyBaseCost(state, content), payrollCents: getPayrollCents(state, owner, content),
    cloudRentCents: mulDiv(fleet.cloudCU, content.opening.rentCentsPerCUWeek, U),
    workforce: getWorkforce(observation.state, owner, observation.contextWeek),
    compute: { cloudCU: fleet.cloudCU, ownedCU: fleet.ownedCU, allocation: { ...fleet.allocation }, lastWork: { ...fleet.lastWork },
      reservedCU: fleet.reservedCU, memoryMU: fleet.memoryMU, occupiedMemoryMU: fleet.occupiedMemoryMU },
    pools, requests, commitments: commitments(observation.state) } };
}

/** An explicit one-boundary comparison. Each branch executes the real tick once
 * on an isolated candidate, including prior queued actions and signed services. */
export function previewStudioPlan(state: GameState, draft: StudioPlanDraft, content: GameContent = CONTENT): StudioPlanPreview {
  const preview: StudioPlanPreview = { sourceHash: canonicalStateHash(state), sourceRevision: state.revision, sourceWeek: state.week,
    effectiveWeek: state.week + 1, valid: false, reason: null, upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    baseline: null, proposed: null, changes: [], warnings: [] };
  try {
    const conflict = conflictReason(state); if (conflict) throw new Error(conflict);
    const plan = planCommands(state, draft, content); preview.changes = plan.changes;
    const baseline = projectBoundary(state, content); preview.baseline = baseline.view;
    if (baseline.reason) throw new Error(baseline.reason);
    if (!plan.commands.length) { preview.proposed = baseline.view; throw new Error('Change a hiring count or compute setting before applying a plan.'); }
    const queued = submitCommand(state, { kind: 'apply_studio_plan', commands: plan.commands }, content);
    if (!queued.accepted) throw new Error(queued.reason?.message ?? 'The plan could not be queued.');
    preview.upfrontCostCents = queued.state.queuedCommands.find(command => command.id === queued.commandId)?.reservedCents ?? 0;
    const proposed = projectBoundary(queued.state, content, queued.commandId); preview.proposed = proposed.view;
    if (proposed.reason || !proposed.view || !baseline.view) throw new Error(proposed.reason ?? 'Next week’s forecast is unavailable.');
    preview.weeklyCostDeltaCents = proposed.view.weeklyBaseCostCents - baseline.view.weeklyBaseCostCents;
    for (const request of proposed.view.requests.filter(item => item.liveServing)) {
      const before = baseline.view.requests.find(item => item.id === request.id);
      if (before && request.grantedWork < before.grantedWork) preview.warnings.push(`${request.label} receives ${formatUnits(request.grantedWork)} CUw instead of ${formatUnits(before.grantedWork)}; this plan reduces live service.`);
      else if (request.grantedWork < request.requestedWork) preview.warnings.push(`${request.label}: ${request.reason || 'The next-week service workload is not fully covered.'}`);
    }
    if (proposed.view.workforce.onboarding) preview.warnings.push(`${proposed.view.workforce.onboarding} employee(s) will still be onboarding next week. Their pay starts before they can work.`);
    if (proposed.view.arrearsCents > 0) preview.warnings.push('You would run out of cash next week. Hiring, wages and rent cost more than you have, so the game would pause with unpaid bills.');
    preview.valid = true;
  } catch (error) { preview.reason = error instanceof Error ? error.message : 'The plan could not be projected.'; }
  return freezeDeep(preview);
}

/** A successful Apply queues exactly one atomic transaction; it never advances
 * time. Changed source state requires a fresh review. Commit revalidates again. */
export function submitStudioPlan(state: GameState, draft: StudioPlanDraft, expectedSourceHash: string, content: GameContent = CONTENT): SubmitResult {
  if (canonicalStateHash(state) !== expectedSourceHash) return { state, accepted: false, reason: { code: 'NOT_READY', message: 'The company changed after this preview. Preview the next week again before applying the plan.' } };
  try {
    const conflict = conflictReason(state); if (conflict) throw new Error(conflict);
    const { commands } = planCommands(state, draft, content);
    if (!commands.length) throw new Error('Change a hiring count or compute setting before applying a plan.');
    const queued = submitCommand(state, { kind: 'apply_studio_plan', commands }, content);
    if (!queued.accepted) return queued;
    const boundary = projectBoundary(queued.state, content, queued.commandId);
    if (boundary.reason) return { state, accepted: false, reason: { code: 'NOT_READY', message: boundary.reason } };
    return queued;
  } catch (error) { return { state, accepted: false, reason: { code: 'INVALID_COMMAND', message: error instanceof Error ? error.message : 'The plan could not be queued.' } }; }
}
