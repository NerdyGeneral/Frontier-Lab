import { CONTENT } from '../content/catalog';
import { RESOURCE_SCALE } from '../contracts/types';
import type { ComputePool, GameContent, GameState, HardwareDefinition, HardwareRack, StaffGrant, WorkCategory } from '../contracts/types';
import type { WorkloadCompatibility } from '../contracts/wave4-hardware';
import { CHIP_RULES, chipDesignValues } from '../content/wave4-hardware';
import type { FacilityWorkRequest } from '../contracts/wave28-facilities';
import { checkedAdd, formatUnits, mulDiv, toUnits } from '../core/math';
import { getWorkforce } from './workforce';
import { getActiveFacilityRetrofitEffects } from './facility-retrofits';
import { facilityPoolSpecialization, getFacilitySpecializationAtWeek } from './facility-specialization';

export const GENERAL_CLOUD_POOL = 'general-cloud';
const installed = (rack: HardwareRack) => rack.status === 'installed' || rack.status === 'parked';

export function infrastructureOperationsId(companyId: string): string { return `infrastructure:${companyId}:operations`; }

export function getRackCapacity(rack: HardwareRack, content: GameContent = CONTENT): number {
  return rack.usableCU ?? content.infrastructure.rackCU;
}

/** Custom profiles are derived from the paid, qualified design rather than editable rack stats. */
export function getRackHardware(state: Readonly<GameState>, rack: HardwareRack, content: GameContent = CONTENT): HardwareDefinition {
  if (!rack.chipDesignId) {
    const standard = content.hardware.find(item => item.id === rack.hardwareId);
    if (!standard) throw new Error('Rack hardware is missing from content.');
    return standard;
  }
  const design = state.slices.compute.chipDesigns?.[rack.chipDesignId];
  if (!design || design.companyId !== rack.companyId || design.status !== 'validated') throw new Error('Custom rack has no qualified owned chip design.');
  const values = chipDesignValues(design);
  return { id: rack.hardwareId, name: design.name, purchaseCentsPerCU: values.purchaseCentsPerCU,
    cloudCentsPerCUWeek: 0, variableCentsPerCUw: values.variableCentsPerCUw,
    memoryMUPerCU: values.memoryMUPerCU, trainingMultiplier: values.trainingBps / 10_000,
    servingMultiplier: values.servingBps / 10_000, powerPerCU: values.powerPerCU };
}

export function hasFastFabric(state: Readonly<GameState>, companyId: string, location: string): boolean {
  return Object.values(state.slices.compute.fabricProjects ?? {}).some(project => project.companyId === companyId
    && project.location === location && project.status === 'active');
}

export function poolSupportsWorkload(pool: ComputePool, request: WorkloadCompatibility & { category?: WorkCategory }): boolean {
  const architecture = request.modelArchitecture ?? 'dense';
  const workload = request.workloadKind ?? (request.category === 'serving' ? 'inference' : 'general');
  if ((request.requiresFastFabric || architecture === 'sparse') && !pool.fastFabric) return false;
  if (pool.architectures && !pool.architectures.includes(architecture)) return false;
  return !pool.workloads || pool.workloads.includes(workload);
}

export function getCompatibleComputePools(state: Readonly<GameState>, companyId: string,
  request: WorkloadCompatibility & { category?: WorkCategory }, content: GameContent = CONTENT, staffGrants?: readonly StaffGrant[]): ComputePool[] {
  return getComputePools(state, companyId, content, staffGrants).filter(pool => poolSupportsWorkload(pool, request));
}

export function getInstalledOwnedCU(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): number {
  return Object.values(state.slices.compute.racks).filter(rack => rack.companyId === companyId && installed(rack))
    .reduce((total, rack) => checkedAdd(total, getRackCapacity(rack, content)), 0);
}

export function getInfrastructureOperatingStaff(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): number {
  const c = content.infrastructure;
  const racks = Object.values(state.slices.compute.racks).filter(rack => rack.companyId === companyId && installed(rack));
  let required = racks.filter(rack => rack.location === 'colocation').length * c.colocationStaffPerRack;
  for (const site of Object.values(state.slices.compute.facilities)) {
    if (site.companyId !== companyId || site.status !== 'active') continue;
    const siteCU = racks.filter(rack => rack.location === site.id).reduce((sum, rack) => checkedAdd(sum, getRackCapacity(rack, content)), 0);
    required = checkedAdd(required, checkedAdd(c.siteBaseStaff, mulDiv(siteCU, c.siteStaffPer16CU, 16 * RESOURCE_SCALE)));
  }
  for (const fabric of Object.values(state.slices.compute.fabricProjects ?? {})) {
    if (fabric.companyId === companyId && fabric.status === 'active') required = checkedAdd(required, CHIP_RULES.fabricOperatingStaff);
  }
  required = checkedAdd(required, getActiveFacilityRetrofitEffects(state, companyId).operatingStaff);
  return required;
}

function operatingCoverage(state: Readonly<GameState>, companyId: string, content: GameContent, staffGrants?: readonly StaffGrant[]): number {
  const required = getInfrastructureOperatingStaff(state, companyId, content);
  if (!required) return RESOURCE_SCALE;
  const available = staffGrants === undefined
    ? getWorkforce(state, companyId).capacity.infrastructure
    : staffGrants.find(grant => grant.requestId === infrastructureOperationsId(companyId))?.grants
      .find(grant => grant.role === 'infrastructure')?.staffWeeks ?? 0;
  return Math.min(RESOURCE_SCALE, mulDiv(available, RESOURCE_SCALE, required));
}

/** Power/cooling apply to nonparked racks, independently of staff coverage. */
export function getSiteEnvelope(state: Readonly<GameState>, facilityId: string, content: GameContent = CONTENT) {
  const c = content.infrastructure;
  const racks = Object.values(state.slices.compute.racks).filter(rack => rack.location === facilityId && rack.status === 'installed');
  const powerDemand = racks.reduce((sum, rack) => {
    const hardware = getRackHardware(state, rack, content);
    return checkedAdd(sum, mulDiv(getRackCapacity(rack, content), toUnits(hardware.powerPerCU), RESOURCE_SCALE));
  }, 0);
  const coolingDemand = powerDemand;
  const companyId = state.slices.compute.facilities[facilityId]?.companyId;
  const extensions = companyId ? getActiveFacilityRetrofitEffects(state, companyId, facilityId) : null;
  const powerLimit = Math.max(c.sitePowerUnits, extensions?.powerUnits ?? 0), coolingLimit = Math.max(c.siteCoolingUnits, extensions?.coolingUnits ?? 0);
  const powerCoverage = powerDemand ? Math.min(RESOURCE_SCALE, mulDiv(powerLimit, RESOURCE_SCALE, powerDemand)) : RESOURCE_SCALE;
  const coolingCoverage = coolingDemand ? Math.min(RESOURCE_SCALE, mulDiv(coolingLimit, RESOURCE_SCALE, coolingDemand)) : RESOURCE_SCALE;
  return { powerDemand, coolingDemand, powerLimit, coolingLimit, powerCoverage, coolingCoverage };
}

/** A job must fit one connected pool; cloud, sites and hardware classes do not lend memory to each other. */
export function getComputePools(
  state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT,
  staffGrants?: readonly StaffGrant[],
): ComputePool[] {
  const fleet = state.slices.compute.fleets[companyId];
  if (!fleet) return [];
  const general = content.hardware.find(item => item.id === 'general')!;
  const pools: ComputePool[] = [{
    id: GENERAL_CLOUD_POOL, companyId, name: 'General cloud', ownership: 'cloud', location: 'cloud', hardwareId: 'general',
    nominalCU: fleet.cloudCU, capacityCU: fleet.cloudCU,
    memoryMU: mulDiv(fleet.cloudCU, general.memoryMUPerCU, RESOURCE_SCALE),
    rackCount: 1, singleRackCU: fleet.cloudCU, singleRackMemoryMU: mulDiv(fleet.cloudCU, general.memoryMUPerCU, RESOURCE_SCALE),
    trainingBps: 10_000, servingBps: 10_000, variableCentsPerCUw: 0,
    staffCoverageBps: 10_000, powerCoverageBps: 10_000, coolingCoverageBps: 10_000,
    bottleneck: fleet.cloudCU ? '' : 'No general cloud capacity is reserved.',
  }];
  const groups = new Map<string, HardwareRack[]>();
  for (const rack of Object.values(state.slices.compute.racks).sort((a, b) => a.id.localeCompare(b.id))) {
    if (rack.companyId !== companyId || !installed(rack)) continue;
    const id = `owned:${rack.location}:${rack.hardwareId}`;
    const group = groups.get(id) ?? []; group.push(rack); groups.set(id, group);
  }
  const staffCoverage = operatingCoverage(state, companyId, content, staffGrants);
  for (const [id, racks] of groups) {
    const first = racks[0];
    const hardware = getRackHardware(state, first, content);
    const chip = first.chipDesignId ? state.slices.compute.chipDesigns?.[first.chipDesignId] : undefined;
    const site = first.location === 'colocation' ? undefined : state.slices.compute.facilities[first.location];
    const commissioned = first.location === 'colocation' || site?.status === 'active';
    const specialization = site && commissioned ? getFacilitySpecializationAtWeek(state, site.id) : null;
    const live = racks.filter(rack => rack.status === 'installed'), liveRacks = live.length;
    const envelope = site ? getSiteEnvelope(state, site.id, content)
      : { powerCoverage: RESOURCE_SCALE, coolingCoverage: RESOURCE_SCALE };
    const siteCoverage = Math.min(envelope.powerCoverage, envelope.coolingCoverage);
    const availability = commissioned ? mulDiv(siteCoverage, staffCoverage, RESOURCE_SCALE) : 0;
    const liveCU = live.reduce((sum, rack) => checkedAdd(sum, getRackCapacity(rack, content)), 0);
    const largestRackCU = Math.max(0, ...live.map(rack => getRackCapacity(rack, content)));
    const capacityCU = mulDiv(liveCU, availability, RESOURCE_SCALE);
    const memoryMU = mulDiv(capacityCU, hardware.memoryMUPerCU, RESOURCE_SCALE);
    let bottleneck = '';
    if (!commissioned) bottleneck = 'Waiting for site commissioning.';
    else if (!liveRacks) bottleneck = 'All racks in this pool are parked; installed upkeep continues.';
    else if (staffCoverage < RESOURCE_SCALE) bottleneck = `Infrastructure staff coverage limits this pool to ${formatUnits(capacityCU)} CU.`;
    else if (envelope.powerCoverage < RESOURCE_SCALE) bottleneck = 'The site power envelope limits active capacity. Park equipment or use another site.';
    else if (envelope.coolingCoverage < RESOURCE_SCALE) bottleneck = 'The site cooling envelope limits active capacity. Park equipment or use another site.';
    pools.push({
      id, companyId, name: `${hardware.name} · ${site?.name ?? 'Colocation'}`, ownership: 'owned', location: first.location, hardwareId: first.hardwareId,
      nominalCU: racks.reduce((sum, rack) => checkedAdd(sum, getRackCapacity(rack, content)), 0), capacityCU, memoryMU, rackCount: liveRacks,
      singleRackCU: liveRacks ? mulDiv(largestRackCU, availability, RESOURCE_SCALE) : 0,
      singleRackMemoryMU: liveRacks ? mulDiv(mulDiv(largestRackCU, availability, RESOURCE_SCALE), hardware.memoryMUPerCU, RESOURCE_SCALE) : 0,
      trainingBps: Math.round(hardware.trainingMultiplier * 10_000), servingBps: Math.round(hardware.servingMultiplier * 10_000),
      variableCentsPerCUw: hardware.variableCentsPerCUw,
      staffCoverageBps: mulDiv(staffCoverage, 10_000, RESOURCE_SCALE),
      powerCoverageBps: mulDiv(envelope.powerCoverage, 10_000, RESOURCE_SCALE), coolingCoverageBps: mulDiv(envelope.coolingCoverage, 10_000, RESOURCE_SCALE),
      bottleneck,
      ...(hasFastFabric(state, companyId, first.location) ? { fastFabric: true } : {}),
      ...(chip ? { architectures: [chip.spec.architecture], workloads: [chip.spec.target] } : {}),
      ...(specialization ? { specialization: facilityPoolSpecialization(specialization) } : {}),
    });
  }
  return pools;
}

export function usesCrossRackTraining(pool: ComputePool, category: WorkCategory, physicalCUw: number, memoryMU: number): boolean {
  return pool.ownership === 'owned' && category !== 'serving' && pool.rackCount > 1
    && (physicalCUw > pool.singleRackCU || memoryMU > pool.singleRackMemoryMU);
}

export function getPoolMultiplierBps(pool: ComputePool, category: WorkCategory, crossRack: boolean, content: GameContent = CONTENT, workloadKind?: WorkloadCompatibility['workloadKind']): number {
  // Standard GPUs retain their original category conversion. A custom inference
  // chip may also execute an evaluation call charged to development allocation.
  const inference = pool.workloads ? workloadKind === 'inference' || (!workloadKind && category === 'serving') : category === 'serving';
  const hardware = inference ? pool.servingBps : pool.trainingBps;
  const ordinary = crossRack && category !== 'serving' && pool.ownership === 'owned' && !(pool.workloads && inference)
    ? mulDiv(hardware, pool.fastFabric ? CHIP_RULES.fabricCrossRackBps : content.infrastructure.crossRackTrainingBps, 10_000) : hardware;
  return crossRack && category !== 'serving' && pool.ownership === 'owned' && workloadKind === 'training'
    && (!pool.workloads || pool.workloads.includes('training')) && pool.specialization?.profile === 'training'
    ? mulDiv(ordinary, pool.specialization.crossRackTrainingBps, 10_000) : ordinary;
}

/** Explicit training keeps its physical identity even if a caller uses another
 * allocation category. Inference includes ordinary serving and paid inference
 * work charged to development/research; other work receives neither benefit. */
export function facilityWorkClass(request: FacilityWorkRequest): 'serving' | 'training' | 'general' {
  return request.workloadKind === 'training' ? 'training'
    : request.category === 'serving' || request.workloadKind === 'inference' ? 'serving' : 'general';
}

export function getPoolWorkCapacityCU(pool: ComputePool, request: FacilityWorkRequest): number {
  if (pool.ownership !== 'owned' || !pool.specialization) return pool.capacityCU;
  const kind = facilityWorkClass(request), factor = kind === 'training' ? pool.specialization.trainingCapacityBps
    : kind === 'serving' ? pool.specialization.servingCapacityBps : 10000;
  return mulDiv(pool.capacityCU, factor, 10000);
}

export function getPoolWorkCostRate(pool: ComputePool, request: FacilityWorkRequest): number {
  return pool.ownership === 'owned' && pool.specialization && facilityWorkClass(request) === 'serving'
    ? mulDiv(pool.variableCentsPerCUw, pool.specialization.servingVariableCostBps, 10000) : pool.variableCentsPerCUw;
}

function historicalOwnedLocation(poolId: string, hardwareId: string): string | null {
  if (!poolId.startsWith('owned:')) return null;
  const suffix = ':' + hardwareId;
  if (!poolId.endsWith(suffix) || poolId.length <= 'owned:'.length + suffix.length) throw new Error('Owned pool and captured hardware identity disagree.');
  return poolId.slice('owned:'.length, -suffix.length);
}

export function getHistoricalPoolWorkCostRate(state: Readonly<GameState>, poolId: string, hardwareId: string, week: number,
  baseRateCentsPerCUw: number, request: FacilityWorkRequest): number {
  const location = historicalOwnedLocation(poolId, hardwareId), profile = location ? getFacilitySpecializationAtWeek(state, location, week) : null;
  return profile && facilityWorkClass(request) === 'serving'
    ? mulDiv(baseRateCentsPerCUw, facilityPoolSpecialization(profile).servingVariableCostBps, 10000) : baseRateCentsPerCUw;
}

/** baseMultiplierBps already includes the ordinary hardware and fabric cost. */
export function getHistoricalPoolTrainingMultiplier(state: Readonly<GameState>, poolId: string, hardwareId: string, week: number,
  baseMultiplierBps: number, crossRack: boolean, request: FacilityWorkRequest): number {
  const location = historicalOwnedLocation(poolId, hardwareId), profile = location ? getFacilitySpecializationAtWeek(state, location, week) : null;
  return crossRack && request.category !== 'serving' && facilityWorkClass(request) === 'training' && profile?.profile === 'training'
    ? mulDiv(baseMultiplierBps, facilityPoolSpecialization(profile).crossRackTrainingBps, 10000) : baseMultiplierBps;
}

/** Fixed owned costs only; cloud reservation and payroll are separate company costs. */
export function getInfrastructureBaseCost(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): number {
  const c = content.infrastructure;
  let cost = 0;
  for (const rack of Object.values(state.slices.compute.racks)) {
    if (rack.companyId !== companyId || !installed(rack)) continue;
    cost = checkedAdd(cost, rack.location === 'colocation' ? c.colocationCentsPerRackWeek
      : mulDiv(getRackCapacity(rack, content), c.ownedMaintenanceCentsPerCUWeek, RESOURCE_SCALE));
  }
  for (const fabric of Object.values(state.slices.compute.fabricProjects ?? {})) {
    if (fabric.companyId === companyId && fabric.status === 'active') cost = checkedAdd(cost, CHIP_RULES.fabricFixedCentsPerWeek);
  }
  for (const site of Object.values(state.slices.compute.facilities)) {
    if (site.companyId === companyId && site.status === 'active') cost = checkedAdd(cost, c.siteFixedCentsPerWeek);
  }
  cost = checkedAdd(cost, getActiveFacilityRetrofitEffects(state, companyId).weeklyCents);
  return cost;
}

export function synchronizeFleetCapacity(state: Readonly<GameState>, companyId: string, content: GameContent, staffGrants?: readonly StaffGrant[]) {
  const pools = getComputePools(state, companyId, content, staffGrants);
  return { ownedCU: getInstalledOwnedCU(state, companyId, content), memoryMU: pools.reduce((sum, pool) => checkedAdd(sum, pool.memoryMU), 0) };
}
