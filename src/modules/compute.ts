import { WORK_POINT_LABELS } from './workforce-points';
import { usesPassiveWorkforce, usesWorkPointProfiles } from './workforce';
import { RESOURCE_SCALE } from '../contracts/types';
import type { Allocation, ComputePool, DomainModule, GameContent, GameState, LedgerFact, Rejection, ResourceGrant, WorkRequest } from '../contracts/types';
import { checkedAdd, checkedInteger, formatMoney, formatUnits, mulDiv } from '../core/math';
import { GENERAL_CLOUD_POOL, facilityWorkClass, getComputePools, getInfrastructureBaseCost, getPoolMultiplierBps, getPoolWorkCapacityCU, getPoolWorkCostRate, poolSupportsWorkload } from './compute-pools';
import {
  INFRASTRUCTURE_COMMANDS, advanceInfrastructure, applyInfrastructureCommand, infrastructureCommit, infrastructureRequests,
  quoteInfrastructureCommand, resolveInfrastructure, syncInfrastructureFleets, validateInfrastructureCommand,
} from './infrastructure';
import { CHIP_COMMANDS, advanceChips, applyChipCommand, chipCommit, chipRequests, quoteChipCommand, recordCustomerServing, resolveChips, validateChipCommand } from './chips';
import { adapterSharingSpec, assertAdapterSharingRequest, sharedAdapterKeys, sharedAdapterReuse } from './adapter-bank';
import { FACILITY_RETROFIT_COMMANDS, validateFacilityRetrofitCommand, quoteFacilityRetrofitCommand, applyFacilityRetrofitCommand, facilityRetrofitCommit, facilityRetrofitRequests, advanceFacilityRetrofits, resolveFacilityRetrofits } from './facility-retrofits';
import { RACK_RELOCATION_COMMANDS, validateRackRelocationCommand, quoteRackRelocationCommand, applyRackRelocationCommand, rackRelocationCommit, rackRelocationRequests, advanceRackRelocations, resolveRackRelocations } from './rack-relocation';
import { applyHardwareSale, commitHardwareSales, quoteHardwareSale, validateHardwareSale } from './hardware-sales';
import { recordComputeCosts } from './compute-costs';
import { FACILITY_SPECIALIZATION_COMMANDS, validateFacilitySpecializationCommand, quoteFacilitySpecializationCommand, applyFacilitySpecializationCommand,
  facilitySpecializationCommit, facilitySpecializationRequests, advanceFacilitySpecializations, resolveFacilitySpecializations } from './facility-specialization';

const emptyWork = (): Allocation => ({ serving: 0, development: 0, research: 0 });
const rejection = (code: Rejection['code'], message: string): Rejection => ({ code, message });
type PoolBudget = { pool: ComputePool; capacity: number; memory: number; servingCapacity: number; trainingCapacity: number; adapterResidents: Set<string> };
type Placement = { budget: PoolBudget; physical: number; effective: number; memory: number; chargedMemory: number };
const workCapacity = (budget: PoolBudget, request: WorkRequest) => facilityWorkClass(request) === 'serving' ? budget.servingCapacity
  : facilityWorkClass(request) === 'training' ? budget.trainingCapacity : budget.capacity;

function activeProductMemory(state: Readonly<GameState>, companyId: string, content: GameContent) {
  const residentModels = new Set<string>();
  const adapterResidents = new Set<string>();
  const requirements: { name: string; modelArchitecture: 'dense' | 'sparse'; memoryMU: number }[] = [];
  let primaryMemoryMU = 0;
  for (const offer of Object.values(state.slices.products.offers)) {
    if (offer.companyId !== companyId || offer.status !== 'active') continue;
    const deployment = state.slices.products.deployments[offer.deploymentId];
    if (!deployment || deployment.status !== 'active') continue;
    const model = state.slices.models.versions[deployment.modelId];
    if (!model) throw new Error('An active deployment has no resident model.');
    const shared = adapterSharingSpec(state, offer.id, content);
    if (shared) {
      const [baseKey, adapterKey] = sharedAdapterKeys(shared);
      if (!adapterResidents.has(baseKey)) primaryMemoryMU = checkedAdd(primaryMemoryMU, shared.baseMemoryMU);
      if (!adapterResidents.has(adapterKey)) primaryMemoryMU = checkedAdd(primaryMemoryMU, shared.adapterMemoryMU);
      adapterResidents.add(baseKey); adapterResidents.add(adapterKey);
    } else if (!residentModels.has(model.id)) {
      primaryMemoryMU = checkedAdd(primaryMemoryMU, model.residentMU); residentModels.add(model.id);
    }
    const route = state.slices.products.efficiencyInstalls?.[offer.id + ':routing'];
    const secondary = route?.status === 'active' && route.enabled && route.modelId === model.id && route.secondaryModelId
      ? state.slices.models.versions[route.secondaryModelId] : undefined;
    requirements.push({ name: offer.name, modelArchitecture: model.architecture,
      memoryMU: checkedAdd(model.residentMU, secondary?.residentMU ?? 0) });
  }
  return { primaryMemoryMU, requirements };
}

/** Evaluate both a one-rack placement and an ordinary connected-rack placement. */
function placementFor(request: WorkRequest, budget: PoolBudget, categoryCapacity: number, effectiveLimit: number, content: GameContent): Placement | null {
  const pool = budget.pool;
  const chargedMemory = request.memoryMU - sharedAdapterReuse(request, budget.adapterResidents);
  if (!poolSupportsWorkload(pool, request) || chargedMemory < 0 || chargedMemory > budget.memory) return null;
  if (!request.normalizedWorkCUw) return request.category === 'serving' && request.memoryMU > 0
    ? { budget, physical: 0, effective: 0, memory: request.memoryMU, chargedMemory } : null;
  const physicalLimit = mulDiv(Math.min(categoryCapacity, budget.capacity, workCapacity(budget, request)), 10_000, 10_000 + (request.headroomBps ?? 0));
  if (!physicalLimit || !effectiveLimit) return null;
  const candidates: Placement[] = [];
  const attempt = (crossRack: boolean) => {
    if (!crossRack && pool.ownership === 'owned' && request.category !== 'serving' && request.memoryMU > pool.singleRackMemoryMU) return;
    const multiplier = getPoolMultiplierBps(pool, request.category, crossRack, content, request.workloadKind);
    const ceiling = !crossRack && pool.ownership === 'owned' && request.category !== 'serving'
      ? Math.min(physicalLimit, pool.singleRackCU) : physicalLimit;
    const physical = Math.min(ceiling, mulDiv(effectiveLimit, 10_000, multiplier, 'ceil'));
    if (crossRack && physical <= pool.singleRackCU && request.memoryMU <= pool.singleRackMemoryMU) return;
    const effective = Math.min(effectiveLimit, mulDiv(physical, multiplier, 10_000));
    if (effective > 0) candidates.push({ budget, physical, effective, memory: request.memoryMU, chargedMemory });
  };
  attempt(false);
  if (pool.ownership === 'owned' && pool.rackCount > 1 && request.category !== 'serving') attempt(true);
  candidates.sort((a, b) => b.effective - a.effective || a.physical - b.physical);
  return candidates[0] ?? null;
}

export function createComputeModule(content: GameContent): DomainModule {
  const memoryPerCU = content.hardware.find(hardware => hardware.id === 'general')!.memoryMUPerCU;
  const cloudMemory = (cu: number) => mulDiv(cu, memoryPerCU, RESOURCE_SCALE);
  const cloudCost = (cu: number) => mulDiv(cu, content.opening.rentCentsPerCUWeek, RESOURCE_SCALE);
  return {
    id: 'compute', owns: ['compute'], commandKinds: ['allocate_compute', 'set_cloud_capacity', 'set_batch_capacity', ...INFRASTRUCTURE_COMMANDS, ...CHIP_COMMANDS, 'accept_hardware_order', ...FACILITY_RETROFIT_COMMANDS, ...RACK_RELOCATION_COMMANDS, ...FACILITY_SPECIALIZATION_COMMANDS],
    validateCommand(state, command) {
      const company = state.slices.company.companies[command.companyId], fleet = state.slices.compute.fleets[command.companyId];
      if (!company || !fleet) return rejection('UNKNOWN_COMPANY', 'This company has no compute fleet.');
      if (company.arrearsCents > 0) return rejection('ARREARS', 'Compute changes are paused while bills are unpaid.');
      const payload = command.payload;
      if ((FACILITY_SPECIALIZATION_COMMANDS as readonly string[]).includes(payload.kind)) return validateFacilitySpecializationCommand(state, command);
      if (payload.kind === 'set_batch_capacity') {
        const scheduler = state.slices.products.batchSchedulers?.[command.companyId];
        if (!scheduler || scheduler.status !== 'active' || scheduler.availableWeek === null || scheduler.availableWeek > state.week) return rejection('NOT_READY', 'Activate the paid batch scheduler before applying a combined batch capacity plan.');
        if (![payload.cloudCU, payload.servingCU].every(value => Number.isSafeInteger(value) && value >= 0) || payload.cloudCU > content.firstSale.maxCloudCU || payload.cloudCU % RESOURCE_SCALE !== 0) return rejection('INVALID_ALLOCATION', 'Use whole cloud CU within the rental limit and a nonnegative serving allocation.');
        if (state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId && ['allocate_compute', 'set_cloud_capacity', 'set_batch_capacity'].includes(item.payload.kind))) return rejection('ALREADY_ACTIVE', 'Finish the queued compute change before applying another capacity plan.');
        const total = payload.servingCU + fleet.allocation.development + fleet.allocation.research;
        if (!Number.isSafeInteger(total) || total > payload.cloudCU + fleet.ownedCU) return rejection('CAPACITY_EXCEEDED', 'The plan must cover serving plus the unchanged development and research allocations.');
        if (payload.cloudCU === fleet.cloudCU && payload.servingCU === fleet.allocation.serving) return rejection('ALREADY_ACTIVE', 'These cloud and serving amounts already apply.');
        const planned = { ...state, slices: { ...state.slices, compute: { ...state.slices.compute, fleets: { ...state.slices.compute.fleets,
          [command.companyId]: { ...fleet, allocation: { ...fleet.allocation, serving: payload.servingCU } } } } } };
        return createComputeModule(content).validateCommand!(planned, { ...command, payload: { kind: 'set_cloud_capacity', cu: payload.cloudCU } }, content);
      }
      if ((payload.kind === 'allocate_compute' || payload.kind === 'set_cloud_capacity') && state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId && item.payload.kind === 'set_batch_capacity')) return rejection('ALREADY_ACTIVE', 'A combined batch capacity plan is already queued.');
      if ((FACILITY_RETROFIT_COMMANDS as readonly string[]).includes(payload.kind)) return validateFacilityRetrofitCommand(state, command, content);
      if ((RACK_RELOCATION_COMMANDS as readonly string[]).includes(payload.kind)) return validateRackRelocationCommand(state, command, content);
      if (payload.kind === 'allocate_compute') {
        if (![payload.serving, payload.development, payload.research].every(value => Number.isSafeInteger(value) && value >= 0)) return rejection('INVALID_ALLOCATION', 'Use nonnegative compute amounts.');
        const total = payload.serving + payload.development + payload.research;
        if (!Number.isSafeInteger(total) || total > fleet.cloudCU + fleet.ownedCU) return rejection('CAPACITY_EXCEEDED', 'The allocation exceeds rented and installed nominal compute. Install a rack, rent capacity, or reduce an amount.');
        return;
      }
      if (payload.kind === 'set_cloud_capacity') {
        if (!Number.isSafeInteger(payload.cu) || payload.cu < 0 || payload.cu > content.firstSale.maxCloudCU || payload.cu % RESOURCE_SCALE !== 0) {
          return rejection('INVALID_ALLOCATION', `Rent a whole number of general CU between 0 and ${formatUnits(content.firstSale.maxCloudCU)}.`);
        }
        const allocated = fleet.allocation.serving + fleet.allocation.development + fleet.allocation.research;
        if (allocated > payload.cu + fleet.ownedCU) return rejection('CAPACITY_EXCEEDED', 'Reduce compute allocations before shrinking the cloud reservation.');
        const resident = activeProductMemory(state, command.companyId, content), pools = getComputePools(state, command.companyId, content);
        const largestOwnedMemory = Math.max(0, ...pools.filter(pool => pool.ownership === 'owned').map(pool => pool.memoryMU));
        if (Math.max(cloudMemory(payload.cu), largestOwnedMemory) < resident.primaryMemoryMU) return rejection('MISSING_MEMORY', `Active products need ${formatUnits(resident.primaryMemoryMU)} MU for model weights in a compatible pool. Keep enough usable memory or pause the product first.`);
        // Keep the original aggregate guard, then require each deployed model or
        // routed pair to fit an inference-compatible pool after the cloud change.
        for (const requirement of resident.requirements) {
          const supported = pools.some(pool => poolSupportsWorkload(pool, { modelArchitecture: requirement.modelArchitecture, workloadKind: 'inference' })
            && (pool.ownership === 'cloud' ? cloudMemory(payload.cu) : pool.memoryMU) >= requirement.memoryMU);
          if (!supported) return rejection('MISSING_MEMORY', `${requirement.name} needs ${formatUnits(requirement.memoryMU)} MU in a compatible inference pool. Keep sufficient cloud capacity or pause the product first.`);
        }
        return;
      }
      if (payload.kind === 'accept_hardware_order') return validateHardwareSale(state, command, content);
      return (CHIP_COMMANDS as readonly string[]).includes(payload.kind) ? validateChipCommand(state, command, content) : validateInfrastructureCommand(state, command, content);
    },
    quoteCommand(state, command) {
      const fleet = state.slices.compute.fleets[command.companyId], payload = command.payload;
      if ((FACILITY_SPECIALIZATION_COMMANDS as readonly string[]).includes(payload.kind)) return quoteFacilitySpecializationCommand(state, command);
      if (payload.kind === 'set_batch_capacity') return { upfrontCostCents: 0, weeklyCostDeltaCents: checkedAdd(cloudCost(payload.cloudCU), -cloudCost(fleet.cloudCU)),
        summary: `From next week, rent ${formatUnits(payload.cloudCU)} cloud CU for ${formatMoney(cloudCost(payload.cloudCU))}/week and allocate ${formatUnits(payload.servingCU)} physical CU to serving. Development (${formatUnits(fleet.allocation.development)}) and research (${formatUnits(fleet.allocation.research)}) remain allocated. Rent continues after a batch finishes until you change the reservation. Pool placement, memory and staff still limit actual work.` };
      if ((FACILITY_RETROFIT_COMMANDS as readonly string[]).includes(payload.kind)) return quoteFacilityRetrofitCommand(state, command, content);
      if ((RACK_RELOCATION_COMMANDS as readonly string[]).includes(payload.kind)) return quoteRackRelocationCommand(state, command, content);
      if (payload.kind === 'set_cloud_capacity') {
        return { upfrontCostCents: 0, weeklyCostDeltaCents: checkedAdd(cloudCost(payload.cu), -cloudCost(fleet.cloudCU)),
          summary: `${formatUnits(payload.cu)} general cloud CU provide ${formatUnits(cloudMemory(payload.cu))} MU and cost ${formatMoney(cloudCost(payload.cu))} per week, including energy. The change begins next week.` };
      }
      if (payload.kind === 'allocate_compute') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
        summary: 'Physical allocation ceilings change next week. Serving headroom fits inside its ceiling; owned pools remain subject to memory, staff, power, and cooling.' };
      if (payload.kind === 'accept_hardware_order') return quoteHardwareSale(state, command, content);
      return (CHIP_COMMANDS as readonly string[]).includes(payload.kind) ? quoteChipCommand(state, command, content) : quoteInfrastructureCommand(state, command, content);
    },
    applyCommand(state, command) {
      const payload = command.payload;
      if ((FACILITY_SPECIALIZATION_COMMANDS as readonly string[]).includes(payload.kind)) return applyFacilitySpecializationCommand(state, command);
      if ((FACILITY_RETROFIT_COMMANDS as readonly string[]).includes(payload.kind)) return applyFacilityRetrofitCommand(state, command, content);
      if ((RACK_RELOCATION_COMMANDS as readonly string[]).includes(payload.kind)) return applyRackRelocationCommand(state, command, content);
      if (payload.kind === 'accept_hardware_order') return applyHardwareSale(state, command, content);
      if (payload.kind !== 'allocate_compute' && payload.kind !== 'set_cloud_capacity' && payload.kind !== 'set_batch_capacity') return (CHIP_COMMANDS as readonly string[]).includes(payload.kind) ? applyChipCommand(state, command, content) : applyInfrastructureCommand(state, command, content);
      const next = structuredClone(state.slices.compute), fleet = next.fleets[command.companyId];
      if (payload.kind === 'allocate_compute') {
        fleet.allocation = { serving: payload.serving, development: payload.development, research: payload.research };
        return { updates: { compute: next }, messages: [{ category: 'command', companyId: command.companyId, message: 'Compute allocations updated. Serving, development, and research share the same physical fleet.' }] };
      }
      fleet.cloudCU = payload.kind === 'set_batch_capacity' ? payload.cloudCU : payload.cu;
      if (payload.kind === 'set_batch_capacity') fleet.allocation.serving = payload.servingCU;
      syncInfrastructureFleets(state, next, content);
      fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.reservedCU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
      return { updates: { compute: next }, messages: [{ category: 'command', companyId: command.companyId,
        message: payload.kind === 'set_batch_capacity'
          ? `Batch capacity plan applied: ${formatUnits(fleet.cloudCU)} cloud CU at ${formatMoney(cloudCost(fleet.cloudCU))}/week, with ${formatUnits(fleet.allocation.serving)} physical CU allocated to serving. Rent continues until changed.`
          : `Cloud reservation changed to ${formatUnits(payload.cu)} CU / ${formatUnits(cloudMemory(payload.cu))} MU. Rent is ${formatMoney(cloudCost(payload.cu))} per week.` }] };
    },
    grantResources(state, context) {
      const next = structuredClone(state.slices.compute);
      const categories = new Map<string, Allocation>(), pools = new Map<string, PoolBudget[]>();
      for (const fleet of Object.values(next.fleets)) {
        fleet.reservedCU = 0; fleet.occupiedMemoryMU = 0; fleet.lastReservedMemoryMU = 0; fleet.lastGrants = []; fleet.lastBottleneck = '';
        const available = getComputePools(state, fleet.companyId, content, context.resources.staffGrants);
        if (state.slices.company.companies[fleet.companyId].arrearsCents > 0) for (const pool of available) {
          pool.capacityCU = 0; pool.memoryMU = 0; pool.bottleneck = 'Unpaid bills; operations suspended.';
        }
        categories.set(fleet.companyId, { ...fleet.allocation });
        pools.set(fleet.companyId, available.map(pool => ({ pool, capacity: pool.capacityCU, memory: pool.memoryMU,
          servingCapacity: getPoolWorkCapacityCU(pool, { category: 'serving', workloadKind: 'inference' }),
          trainingCapacity: getPoolWorkCapacityCU(pool, { category: 'development', workloadKind: 'training' }), adapterResidents: new Set<string>() })));
        fleet.memoryMU = available.reduce((sum, pool) => checkedAdd(sum, pool.memoryMU), 0);
      }
      const staffGrants = new Map(context.resources.staffGrants.map(grant => [grant.requestId, grant]));
      const computeGrants: ResourceGrant[] = [];
      const requests = [...context.resources.requests].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
      for (const request of requests) {
        assertAdapterSharingRequest(state, request, content);
        const fleet = next.fleets[request.companyId], category = categories.get(request.companyId)!;
        const compatible = pools.get(request.companyId)!.filter(budget => (request.poolId === 'auto' || request.poolId === budget.pool.id) && poolSupportsWorkload(budget.pool, request));
        let reason = '', supervisedLimit = request.normalizedWorkCUw;
        const headroomBps = request.headroomBps ?? 0;
        checkedInteger(headroomBps, 'Serving headroom');
        if (headroomBps > 10_000) throw new Error('Serving headroom exceeds the supported reservation limit.');
        if (request.supervision) {
          const grantedStaff = staffGrants.get(request.id)?.grants.find(grant => grant.role === request.supervision!.role)?.staffWeeks ?? 0;
          supervisedLimit = Math.min(supervisedLimit, mulDiv(grantedStaff, request.supervision.workPerStaffWeek, RESOURCE_SCALE));
        }
        const suspended = state.slices.company.companies[request.companyId].arrearsCents > 0;
        const choices = suspended ? [] : compatible.map(budget => placementFor(request, budget, category[request.category], supervisedLimit, content)).filter((value): value is Placement => !!value);
        choices.sort((a, b) => b.effective - a.effective || a.physical - b.physical
          || getPoolWorkCostRate(a.budget.pool, request) - getPoolWorkCostRate(b.budget.pool, request) || a.budget.pool.id.localeCompare(b.budget.pool.id));
        const selected = choices[0];
        if (suspended) reason = 'Unpaid bills; operations suspended.';
        else if (!compatible.length && request.id.startsWith('batch-serve:') && request.poolId !== 'auto') reason = 'The selected batch pool is no longer available or compatible. Choose another pool or restore automatic placement; the deadline continues.';
        else if (!compatible.length && (request.requiresFastFabric || request.modelArchitecture === 'sparse')) reason = 'This sparse workload needs compatible owned hardware with active fast fabric at its location.';
        else if (!compatible.length) reason = 'This workload needs a pool supporting its model architecture and inference or training target.';
        else if (!selected && request.normalizedWorkCUw > 0) {
          const maxMemory = Math.max(0, ...compatible.map(budget => checkedAdd(budget.memory, sharedAdapterReuse(request, budget.adapterResidents))));
          if (request.supervision && !supervisedLimit) reason = usesPassiveWorkforce(state, request.companyId)
            ? `Waiting for ${WORK_POINT_LABELS[request.supervision.role]} points to supervise this work.` : 'Waiting for assigned ML supervision.';
          else if (!compatible.some(budget => budget.capacity > 0)) reason = compatible.find(budget => budget.pool.ownership === 'owned' && budget.pool.bottleneck)?.pool.bottleneck
            ?? `No ${request.category} capacity is available after existing reservations.`;
          else if (request.memoryMU > maxMemory) reason = `Memory full: this request needs ${formatUnits(request.memoryMU)} MU in one compatible pool; the largest has ${formatUnits(maxMemory)} MU ${request.sharedAdapterMemory ? 'available including reusable weights' : 'free'}.`;
          else if (compatible.some(budget => budget.pool.specialization && workCapacity(budget, request) < budget.capacity)) reason = 'The active facility profile’s shared workload ceiling is exhausted; other pool capacity does not remove that tradeoff.';
          else reason = `No ${request.category} capacity is available after existing reservations.`;
        } else if (!selected && request.memoryMU > 0) {
          reason = request.category === 'serving' ? `Memory full: this request needs ${formatUnits(request.memoryMU)} MU in one compatible pool.` : `Allocate ${request.category} compute to continue this job.`;
        } else if (selected && selected.effective < request.normalizedWorkCUw) {
          reason = supervisedLimit < request.normalizedWorkCUw && selected.effective === supervisedLimit ? (usesWorkPointProfiles(state)
            ? `${WORK_POINT_LABELS[request.supervision!.role]} points limit supervised progress.` : 'Assigned ML supervision limits training progress.')
            : selected.budget.pool.specialization && workCapacity(selected.budget, request) < Math.min(category[request.category], selected.budget.capacity)
              ? 'The active facility profile limits this workload’s shared physical allocation, including headroom.'
            : request.category === 'serving' ? 'Serving capacity and its headroom limit fulfillment.'
              : `${request.category === 'development' ? 'Development' : 'Research'} capacity, hardware, and fabric limit progress.`;
        }
        const physicalCUw = selected?.physical ?? 0, effective = selected?.effective ?? 0, memoryMU = selected?.memory ?? 0;
        const chargedMemory = selected?.chargedMemory ?? 0;
        const reserved = mulDiv(physicalCUw, checkedAdd(10_000, headroomBps), 10_000, 'ceil');
        if (selected) {
          selected.budget.capacity -= reserved; selected.budget.memory -= chargedMemory; category[request.category] -= reserved;
          if (facilityWorkClass(request) === 'serving') selected.budget.servingCapacity -= reserved;
          else if (facilityWorkClass(request) === 'training') selected.budget.trainingCapacity -= reserved;
          if (request.sharedAdapterMemory) for (const key of sharedAdapterKeys(request.sharedAdapterMemory)) selected.budget.adapterResidents.add(key);
        }
        fleet.reservedCU = checkedAdd(fleet.reservedCU, reserved); fleet.occupiedMemoryMU = checkedAdd(fleet.occupiedMemoryMU, chargedMemory);
        fleet.lastReservedMemoryMU = fleet.occupiedMemoryMU;
        fleet.lastGrants.push({ requestId: request.id, requestedWork: request.normalizedWorkCUw, grantedWork: effective, reason });
        if (reason && !fleet.lastBottleneck) fleet.lastBottleneck = reason;
        computeGrants.push({ requestId: request.id, physicalCUw, hardwareEffectiveCUw: effective, memoryMU,
          ...(request.sharedAdapterMemory ? { sharedMemoryMU: memoryMU - chargedMemory } : {}),
          poolId: selected?.budget.pool.id ?? (request.poolId === 'auto' ? GENERAL_CLOUD_POOL : request.poolId) });
      }
      return { updates: { compute: next }, computeGrants };
    },
    handlers: {
      commit(state, context) {
        const result = infrastructureCommit(state, context), compute = result.updates!.compute!;
        const messages = [...chipCommit(state, context, compute), ...facilityRetrofitCommit(state, context, compute), ...rackRelocationCommit(state, context, compute),
          ...facilitySpecializationCommit(state, context, compute)];
        const hardwareSales = commitHardwareSales(compute, context.week);
        syncInfrastructureFleets(state, compute, content);
        return { ...result, updates: { compute }, facts: [...(result.facts ?? []), ...hardwareSales.facts],
          messages: [...(result.messages ?? []), ...messages, ...hardwareSales.messages] };
      },
      reserve: state => ({ workRequests: [...infrastructureRequests(state, content), ...chipRequests(state), ...facilityRetrofitRequests(state, content), ...rackRelocationRequests(state), ...facilitySpecializationRequests(state)] }),
      execute(state, context) {
        const next = advanceInfrastructure(state, context);
        advanceChips(state, context, next);
        advanceFacilityRetrofits(state, context, next);
        advanceRackRelocations(state, context, next);
        advanceFacilitySpecializations(state, context, next);
        for (const fleet of Object.values(next.fleets)) fleet.lastWork = emptyWork();
        const requests = new Map(context.resources.requests.map(request => [request.id, request]));
        const pools = new Map<string, ComputePool>();
        for (const companyId of Object.keys(next.fleets)) for (const pool of getComputePools(state, companyId, content, context.resources.staffGrants)) pools.set(`${companyId}:${pool.id}`, pool);
        const variableNumerators = new Map<string, bigint>();
        for (const grant of context.resources.computeGrants) {
          const request = requests.get(grant.requestId);
          if (!request) throw new Error('A compute grant lost its workload request.');
          const fleet = next.fleets[request.companyId]; fleet.lastWork[request.category] = checkedAdd(fleet.lastWork[request.category], grant.physicalCUw);
          const pool = pools.get(`${request.companyId}:${grant.poolId}`);
          if (pool?.ownership === 'owned' && grant.physicalCUw) variableNumerators.set(request.companyId,
            (variableNumerators.get(request.companyId) ?? BigInt(0)) + BigInt(grant.physicalCUw) * BigInt(getPoolWorkCostRate(pool, request)));
        }
        const facts: LedgerFact[] = [];
        for (const fleet of Object.values(next.fleets)) {
          const fact = (suffix: string, sourceId: string, amountCents: number, label: string, category: LedgerFact['category']) => {
            if (amountCents) facts.push({ id: `${fleet.companyId}:${suffix}:${context.week}`, companyId: fleet.companyId, week: context.week,
              sourceId, category, amountCents, label, kind: 'expense' });
          };
          fact('cloud-rent', 'general-cloud-reservation', cloudCost(fleet.cloudCU), 'Reserved general GPU capacity (energy included)', 'rent');
          fact('owned-fixed', 'owned-infrastructure', getInfrastructureBaseCost(state, fleet.companyId, content), 'Installed rack and commissioned site upkeep', 'operating');
          const numerator = (variableNumerators.get(fleet.companyId) ?? BigInt(0)) + BigInt(fleet.variableCostCarry);
          const cents = checkedInteger(Number(numerator / BigInt(RESOURCE_SCALE)), 'Owned work cost');
          fleet.variableCostCarry = Number(numerator % BigInt(RESOURCE_SCALE));
          fact('owned-variable', 'owned-gpu-work', cents, 'Actual owned GPU work (physical CUw)', 'operating');
        }
        return { updates: { compute: next }, facts };
      },
      resolve(state, context) {
        const result = resolveInfrastructure(state, context), compute = result.updates!.compute!;
        const messages = [...resolveChips(state, context, compute), ...resolveFacilityRetrofits(state, context, compute), ...resolveRackRelocations(state, context, compute),
          ...resolveFacilitySpecializations(state, context, compute)];
        return { ...result, updates: { compute }, messages: [...(result.messages ?? []), ...messages] };
      },
      plan(state, context) {
        const serving = recordCustomerServing(state, context);
        const metering = recordComputeCosts(state, context, serving.updates?.compute ?? state.slices.compute);
        return { ...serving, updates: { ...serving.updates, ...metering.updates }, messages: [...(serving.messages ?? []), ...(metering.messages ?? [])] };
      },
    },
  };
}
