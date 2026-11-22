import { RESOURCE_SCALE } from '../contracts/types';
import type { ComputePool, DomainModule, DomainResult, GameContent, GameState, ResourceFrame, RoleAllocation, StaffDemand, StaffRole, WorkRequest } from '../contracts/types';
import { CONTENT } from '../content/catalog';
import { facilityWorkClass, getComputePools, getPoolMultiplierBps, getPoolWorkCapacityCU, poolSupportsWorkload, usesCrossRackTraining } from '../modules/compute-pools';
import { getWeeklyStaffSupply } from '../modules/workforce';
import { assertAdapterSharingRequest, sharedAdapterKeys, sharedAdapterReuse } from '../modules/adapter-bank';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const CATEGORIES = ['serving', 'development', 'research'];
const ROLES: readonly StaffRole[] = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];
function fail(message: string): never { throw new Error(`Resource allocation: ${message}`); }
function identifier(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 160
    || /[\u0000-\u001f\u007f]/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) {
    fail(`${label} is invalid.`);
  }
}
function object(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record.`);
}
function list<T>(value: readonly T[] | undefined, label: string): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10_000) fail(`${label} must be an array of at most 10000 entries.`);
  return value;
}
function staffByRole(values: readonly StaffDemand[] | undefined, label: string): Map<StaffRole, number> {
  const roles = new Map<StaffRole, number>();
  for (const demand of list(values, label)) {
    object(demand, label);
    if (!ROLES.includes(demand.role)) fail(`${label} has an unknown staff role.`);
    checkedInteger(demand.staffWeeks, `${label} staff-weeks`);
    if (roles.has(demand.role)) fail(`${label} repeats the ${demand.role} role.`);
    roles.set(demand.role, demand.staffWeeks);
  }
  return roles;
}

/** Collect a validated batch into the candidate tick's ephemeral resource frame. */
export function collectResourceResult(
  frame: ResourceFrame,
  module: DomainModule,
  result: DomainResult,
  mode: 'request' | 'grant' | 'closed',
  state: GameState,
  content: GameContent = CONTENT,
): void {
  const requests = list(result.workRequests, 'Work requests');
  const computeGrants = list(result.computeGrants, 'Compute grants');
  const staffGrants = list(result.staffGrants, 'Staff grants');
  if (requests.length && mode !== 'request') fail(`${module.id} can request resources only during reservation.`);
  if ((computeGrants.length || staffGrants.length) && mode !== 'grant') fail(`${module.id} can grant resources only in the grant pass.`);
  if (computeGrants.length && !module.owns.includes('compute')) fail(`${module.id} does not own compute grants.`);
  if (staffGrants.length && !module.owns.includes('company')) fail(`${module.id} does not own staff grants.`);
  if (!requests.length && !computeGrants.length && !staffGrants.length) return;

  const allRequests = [...frame.requests, ...requests];
  const allComputeGrants = [...frame.computeGrants, ...computeGrants];
  const allStaffGrants = [...frame.staffGrants, ...staffGrants];
  if ([allRequests, allComputeGrants, allStaffGrants].some(items => items.length > 10_000)) fail('The weekly resource frame is full.');
  const byRequest = new Map<string, WorkRequest>();
  const demands = new Map<string, Map<StaffRole, number>>();
  for (const request of allRequests) {
    object(request, 'Work request');
    identifier(request.id, 'Request ID'); identifier(request.companyId, 'Request company');
    identifier(request.taskId, 'Request task'); identifier(request.poolId, 'Request pool');
    if (byRequest.has(request.id)) fail(`Duplicate request ${request.id}.`);
    if (!Object.hasOwn(state.slices.company.companies, request.companyId)) fail(`Request ${request.id} has an unknown company.`);
    if (!CATEGORIES.includes(request.category)) fail(`Request ${request.id} has an unknown work category.`);
    checkedInteger(request.priority, 'Request priority');
    checkedInteger(request.normalizedWorkCUw, 'Requested normalized work');
    checkedInteger(request.memoryMU, 'Requested memory');
    if (request.requiresFastFabric !== undefined && typeof request.requiresFastFabric !== 'boolean') fail(`Request ${request.id} fabric requirement is invalid.`);
    if (request.modelArchitecture !== undefined && !['dense', 'sparse'].includes(request.modelArchitecture)) fail(`Request ${request.id} model architecture is invalid.`);
    if (request.modelFamily !== undefined && !['edge', 'compact', 'medium', 'large', 'frontier'].includes(request.modelFamily)) fail(`Request ${request.id} model family is invalid.`);
    if (request.workloadKind !== undefined && !['inference', 'training', 'general'].includes(request.workloadKind)) fail(`Request ${request.id} workload kind is invalid.`);
    assertAdapterSharingRequest(state, request, content);
    const requestDemand = staffByRole(request.staffDemand, `Request ${request.id} demand`);
    if (request.headroomBps !== undefined) {
      checkedInteger(request.headroomBps, 'Requested headroom');
      if (request.headroomBps > 10_000) fail(`Request ${request.id} headroom exceeds 10000 basis points.`);
    }
    if (request.supervision !== undefined) {
      object(request.supervision, `Request ${request.id} supervision`);
      const { role, workPerStaffWeek } = request.supervision;
      if (!ROLES.includes(role) || !requestDemand.has(role)) fail(`Request ${request.id} supervision needs a matching staff demand.`);
      checkedInteger(workPerStaffWeek, 'Supervised work per staff-week');
      if (workPerStaffWeek === 0) fail(`Request ${request.id} supervision throughput must be positive.`);
    }
    demands.set(request.id, requestDemand);
    byRequest.set(request.id, request);
  }

  const staffIds = new Set<string>();
  const grantedStaff = new Map<string, Map<StaffRole, number>>();
  const staffUsage = new Map<string, Map<StaffRole, number>>();
  const staffCapacity = new Map<string, RoleAllocation>();
  for (const grant of allStaffGrants) {
    object(grant, 'Staff grant'); identifier(grant.requestId, 'Staff grant request');
    if (staffIds.has(grant.requestId)) fail(`Duplicate staff grant for ${grant.requestId}.`);
    const request = byRequest.get(grant.requestId), requestDemand = demands.get(grant.requestId);
    if (!request || !requestDemand) fail(`Staff grant refers to unknown request ${grant.requestId}.`);
    if (!Array.isArray(grant.grants)) fail(`Staff grant ${grant.requestId} must declare its granted roles.`);
    const roles = staffByRole(grant.grants, `Staff grant ${grant.requestId}`);
    const capacity = staffCapacity.get(request.companyId) ?? getWeeklyStaffSupply(state, request.companyId, state.week, allRequests).capacity;
    staffCapacity.set(request.companyId, capacity);
    const used = staffUsage.get(request.companyId) ?? new Map<StaffRole, number>();
    for (const [role, quantity] of roles) {
      if (!requestDemand.has(role) || quantity > requestDemand.get(role)!) fail(`Staff grant exceeds ${role} demand for ${grant.requestId}.`);
      if (quantity && state.slices.company.companies[request.companyId].arrearsCents > 0) fail(`Staff grant ${grant.requestId} cannot operate while company bills are unpaid.`);
      const total = checkedAdd(used.get(role) ?? 0, quantity);
      if (total > capacity[role]) fail(`${request.companyId} exceeds its assigned ready ${role} staff capacity.`);
      used.set(role, total);
    }
    staffUsage.set(request.companyId, used);
    grantedStaff.set(grant.requestId, roles);
    staffIds.add(grant.requestId);
  }

  const computeIds = new Set<string>();
  const usage = new Map<string, { serving: number; development: number; research: number; total: number; memory: number }>();
  const poolsByCompany = new Map<string, ComputePool[]>();
  const poolUsage = new Map<string, { capacity: number; memory: number; serving: number; training: number; general: number }>();
  const adapterResidents = new Map<string, Set<string>>();
  for (const grant of allComputeGrants) {
    object(grant, 'Compute grant');
    identifier(grant.requestId, 'Compute grant request'); identifier(grant.poolId, 'Compute grant pool');
    if (computeIds.has(grant.requestId)) fail(`Duplicate compute grant for ${grant.requestId}.`);
    const request = byRequest.get(grant.requestId);
    if (!request) fail(`Compute grant refers to unknown request ${grant.requestId}.`);
    if (request.poolId !== 'auto' && grant.poolId !== request.poolId) fail(`Compute grant pool does not match request ${request.id}.`);
    if (grant.poolId === 'auto') fail(`Compute grant ${request.id} must name its actual placement pool.`);
    checkedInteger(grant.physicalCUw, 'Granted physical work');
    checkedInteger(grant.hardwareEffectiveCUw, 'Granted hardware-effective work');
    checkedInteger(grant.memoryMU, 'Granted memory');
    if (grant.hardwareEffectiveCUw > request.normalizedWorkCUw) fail(`Compute grant exceeds requested work for ${request.id}.`);
    if (grant.memoryMU > request.memoryMU) fail(`Compute grant exceeds requested memory for ${request.id}.`);
    if (state.slices.company.companies[request.companyId].arrearsCents > 0 && (grant.physicalCUw || grant.memoryMU)) fail(`Compute grant ${request.id} cannot operate while company bills are unpaid.`);
    if (grant.hardwareEffectiveCUw > 0 && grant.physicalCUw === 0) fail(`Compute grant ${request.id} has work without physical capacity.`);
    if (grant.physicalCUw > 0 && grant.hardwareEffectiveCUw === 0) fail(`Compute grant ${request.id} has physical work without an executable request.`);
    if (grant.memoryMU !== 0 && grant.memoryMU !== request.memoryMU) fail(`Compute grant ${request.id} has only a partial memory workspace.`);
    if (grant.physicalCUw > 0 && grant.memoryMU !== request.memoryMU) fail(`Compute grant ${request.id} has work without its full memory workspace.`);
    if (grant.poolId === 'general-cloud' && grant.hardwareEffectiveCUw !== grant.physicalCUw) fail(`General cloud grant ${request.id} must use its one-to-one hardware conversion.`);
    let supervisedWork = request.normalizedWorkCUw;
    if (request.supervision) {
      const staff = grantedStaff.get(request.id)?.get(request.supervision.role) ?? 0;
      supervisedWork = mulDiv(staff, request.supervision.workPerStaffWeek, RESOURCE_SCALE);
      if (grant.hardwareEffectiveCUw > supervisedWork) fail(`Compute grant ${request.id} exceeds its granted staff supervision.`);
    }
    const fleet = state.slices.compute.fleets[request.companyId];
    if (!fleet || fleet.companyId !== request.companyId) fail(`Request ${request.id} has no matching compute fleet.`);
    checkedInteger(fleet.cloudCU, 'Cloud capacity'); checkedInteger(fleet.ownedCU, 'Owned capacity');
    checkedInteger(fleet.allocation[request.category], 'Category allocation');
    checkedInteger(fleet.memoryMU, 'Fleet memory');
    const pools = poolsByCompany.get(request.companyId) ?? getComputePools(state, request.companyId, content, allStaffGrants);
    poolsByCompany.set(request.companyId, pools);
    const pool = pools.find(item => item.id === grant.poolId);
    if (!pool && (grant.physicalCUw || grant.memoryMU)) fail(`Compute grant ${request.id} refers to an unavailable compatible pool.`);
    if (pool && (grant.physicalCUw || grant.memoryMU) && !poolSupportsWorkload(pool, request)) fail(`Compute grant ${request.id} violates model/workload compatibility or lacks active fast fabric.`);
    // Reused weights are independently reconstructed from earlier, complete
    // placements in this company's exact pool. Logical workspaces stay full.
    const residentKey = JSON.stringify([request.companyId, grant.poolId]);
    const residents = adapterResidents.get(residentKey) ?? new Set<string>();
    let reusedMemory = 0;
    if (request.sharedAdapterMemory) {
      if (grant.sharedMemoryMU === undefined) fail(`Compute grant ${request.id} omitted its shared adapter residency receipt.`);
      checkedInteger(grant.sharedMemoryMU, 'Reused adapter memory');
      reusedMemory = grant.memoryMU > 0 ? sharedAdapterReuse(request, residents) : 0;
      if (grant.sharedMemoryMU !== reusedMemory) fail(`Compute grant ${request.id} changed its actual shared adapter residency.`);
    } else if (grant.sharedMemoryMU !== undefined) fail(`Compute grant ${request.id} claims sharing without an eligible adapter request.`);
    const chargedMemory = grant.memoryMU - reusedMemory;
    if (chargedMemory < 0) fail(`Compute grant ${request.id} has negative resident memory.`);
    if (pool?.ownership === 'owned' && grant.physicalCUw) {
      const crossRack = usesCrossRackTraining(pool, request.category, grant.physicalCUw, grant.memoryMU);
      const multiplier = getPoolMultiplierBps(pool, request.category, crossRack, content, request.workloadKind);
      const maximum = mulDiv(grant.physicalCUw, multiplier, 10_000);
      const expected = Math.min(request.normalizedWorkCUw, supervisedWork, maximum);
      if (grant.hardwareEffectiveCUw !== expected) fail(`Compute grant ${request.id} does not match its hardware and fabric conversion.`);
      if (grant.physicalCUw > mulDiv(Math.min(request.normalizedWorkCUw, supervisedWork), 10_000, multiplier, 'ceil')) fail(`Compute grant ${request.id} overexecutes its normalized workload.`);
    }
    const reserved = mulDiv(grant.physicalCUw, checkedAdd(10_000, request.headroomBps ?? 0), 10_000, 'ceil');
    const used = usage.get(request.companyId) ?? { serving: 0, development: 0, research: 0, total: 0, memory: 0 };
    used[request.category] = checkedAdd(used[request.category], reserved);
    used.total = checkedAdd(used.total, reserved);
    used.memory = checkedAdd(used.memory, chargedMemory);
    if (used[request.category] > fleet.allocation[request.category]) fail(`${request.companyId} exceeds its ${request.category} allocation.`);
    if (used.total > checkedAdd(fleet.cloudCU, fleet.ownedCU)) fail(`${request.companyId} exceeds its total physical capacity including headroom.`);
    const usableMemory = pools.reduce((sum, item) => checkedAdd(sum, item.memoryMU), 0);
    if (used.memory > usableMemory) fail(`${request.companyId} exceeds its total memory capacity.`);
    if (pool) {
      const key = `${request.companyId}:${pool.id}`, placed = poolUsage.get(key) ?? { capacity: 0, memory: 0, serving: 0, training: 0, general: 0 };
      placed.capacity = checkedAdd(placed.capacity, reserved); placed.memory = checkedAdd(placed.memory, chargedMemory);
      if (placed.capacity > pool.capacityCU) fail(`${request.companyId} exceeds its compatible pool physical capacity including headroom.`);
      if (placed.memory > pool.memoryMU) fail(`${request.companyId} exceeds its compatible pool memory capacity.`);
      const workload = facilityWorkClass(request);
      placed[workload] = checkedAdd(placed[workload], reserved);
      if (placed[workload] > getPoolWorkCapacityCU(pool, request)) fail(`${request.companyId} exceeds its compatible pool ${workload} workload ceiling including headroom.`);
      poolUsage.set(key, placed);
    }
    if (grant.memoryMU > 0 && request.sharedAdapterMemory) {
      for (const key of sharedAdapterKeys(request.sharedAdapterMemory)) residents.add(key);
      adapterResidents.set(residentKey, residents);
    }
    usage.set(request.companyId, used);
    computeIds.add(grant.requestId);
  }

  // Owners decide placement and priority; the shared boundary independently
  // enforces conservation, full workspaces, supervision, and headroom budgets.
  // Cloning the whole addition first keeps failed batches and caller objects out
  // of the frame, without mutating the company or its durable domain slices.
  const addition = structuredClone({ requests, computeGrants, staffGrants });
  frame.requests.push(...addition.requests);
  frame.computeGrants.push(...addition.computeGrants);
  frame.staffGrants.push(...addition.staffGrants);
}
