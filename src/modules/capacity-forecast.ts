import { formatWorkPoints, WORK_POINT_LABELS } from './workforce-points';
import { ASSURANCE_BY_ID } from '../content/wave13-assurance';
import { CONTENT } from '../content/catalog';
import { MARKET_SEGMENTS } from '../content/wave2-market';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { CAPACITY_FORECAST_ASSUMPTIONS, CAPACITY_FORECAST_RULES as RULES } from '../content/wave6-forecast';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { GameContent, GameState, ModuleContext, ResourceGrant, StaffGrant, StaffRole, WorkRequest } from '../contracts/types';
import type { CapacityForecast, CapacityForecastAvailability, CapacityForecastOptions, CapacityForecastRow, CapacityForecastScenario, CustomerCapacityRequestSet, ForecastCloudPlan, ForecastStaffRequirement } from '../contracts/wave6-forecast';
import { checkedAdd, checkedInteger, formatUnits, mulDiv } from '../core/math';
import { systemRollout } from './applied-research';
import { businessRequests, commercialCapacityRequests, commercialOrganizationCount } from './business';
import { createCompanyModule } from './company';
import { createComputeModule } from './compute';
import { getComputePools, getPoolWorkCostRate, infrastructureOperationsId, poolSupportsWorkload } from './compute-pools';
import { infrastructureRequests } from './infrastructure';
import { productDemand, standardServingRequests } from './products';
import { hasResearch } from './research';
import { STAFF_ROLES } from './workforce';

const liveContract = (status: string) => status === 'building' || status === 'ready' || status === 'active';

export function capacityForecastAvailability(state: Readonly<GameState>, companyId = state.playerCompanyId): CapacityForecastAvailability {
  const researched = hasResearch(state, companyId, RULES.researchId);
  const rollout = systemRollout(state, companyId, RULES.method) ?? null;
  return { researched, rollout, available: researched && rollout?.status === 'active' };
}

/**
 * The same recurring requests used by paid service. Signed private deliveries
 * reserve their captured workload immediately; a license only needs support.
 * Transient training, construction, and agent jobs are outside this service plan.
 */
export function customerCapacityRequests(state: Readonly<GameState>, content: GameContent = CONTENT): CustomerCapacityRequestSet {
  const companyId = state.playerCompanyId, demandWeek = state.week + 1;
  // Service suspension must not hide the outstanding customer load. Only the
  // demand-reader sees this copy; the real arrears remain in every grant call.
  const company = state.slices.company.companies[companyId];
  const demandState = company.arrearsCents > 0 ? { ...state, slices: { ...state.slices, company: { ...state.slices.company,
    companies: { ...state.slices.company.companies, [companyId]: { ...company, arrearsCents: 0 } } } } } : state;
  const publicRequests = standardServingRequests(demandState, content, demandWeek).filter(request => request.companyId === companyId);
  const privateRequests = commercialCapacityRequests(state, companyId);
  const contracts = Object.values(state.slices.products.commercialContracts ?? {}).filter(contract => contract.companyId === companyId && liveContract(contract.status));
  const licenses = contracts.filter(contract => contract.contractKind === 'customer-hosted');
  const support: WorkRequest[] = licenses.map(contract => ({ id: 'business-support:' + contract.id, companyId, taskId: contract.id,
    category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 0, poolId: 'auto',
    staffDemand: [{ role: 'commercial', staffWeeks: contract.supportStaffPerWeek }] }));
  const assuranceSupport: WorkRequest[] = Object.values(state.slices.products.assuranceContracts ?? {}).filter(contract => contract.companyId === companyId && liveContract(contract.status))
    .map(contract => ({ id: 'assurance-support:' + contract.id, companyId, taskId: contract.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 0, poolId: 'auto', staffDemand: [{ role: 'commercial', staffWeeks: contract.supportStaffPerWeek }] }));
  const upkeep = businessRequests(state, demandWeek).filter(request => request.companyId === companyId && request.id.startsWith('retrieval-upkeep:'));
  const operations = infrastructureRequests(state, content).filter(request => request.companyId === companyId && request.id === infrastructureOperationsId(companyId));
  let paidAccounts = 0, trialAccounts = 0;
  for (const offer of Object.values(state.slices.products.offers)) if (offer.companyId === companyId && offer.status === 'active') {
    const demand = productDemand(state, offer, content, demandWeek);
    paidAccounts += demand.accounts; trialAccounts += demand.trialAccounts;
  }
  const serving = [...publicRequests, ...privateRequests];
  return { serving, staffing: [...serving, ...support, ...assuranceSupport, ...upkeep, ...operations], privateCommitments: privateRequests.length,
    licenseCommitments: licenses.length, paidAccounts, trialAccounts };
}

function planningContext(state: Readonly<GameState>, content: GameContent, requests: WorkRequest[], staffGrants: StaffGrant[] = []): ModuleContext {
  // The source week deliberately freezes readiness. Projecting the calendar must
  // not silently grant staff who are still onboarding or finish other projects.
  return { week: state.week, phase: 'reserve', content, facts: [], resources: { requests, staffGrants, computeGrants: [] },
    random: { draw: () => { throw new Error('Capacity planning must not draw simulation randomness.'); } } };
}

function requestFits(request: WorkRequest, grant: ResourceGrant | undefined): boolean {
  return !!grant && grant.hardwareEffectiveCUw >= request.normalizedWorkCUw && grant.memoryMU >= request.memoryMU;
}

function requestLabel(state: Readonly<GameState>, request: WorkRequest): string {
  if (request.id.startsWith('canary-serve:')) return (state.slices.products.offers[request.taskId]?.name ?? 'Public product') + ' canary candidate';
  if (request.id.startsWith('serve:')) return state.slices.products.offers[request.taskId]?.name ?? 'Public product';
  const assurance = state.slices.products.assuranceContracts?.[request.taskId];
  if (assurance) return ASSURANCE_BY_ID[assurance.buyerId].name + ' assured API';
  const contract = state.slices.products.commercialContracts[request.taskId];
  return contract ? BUSINESS_BY_ID[contract.customerId].name + ' private service' : 'Customer service';
}

function staffRequirements(requests: WorkRequest[], grants: StaffGrant[]): ForecastStaffRequirement[] {
  const required = Object.fromEntries(STAFF_ROLES.map(role => [role, 0])) as Record<StaffRole, number>;
  const granted = { ...required };
  for (const request of requests) for (const demand of request.staffDemand ?? []) required[demand.role] = checkedAdd(required[demand.role], demand.staffWeeks);
  for (const request of grants) for (const grant of request.grants) granted[grant.role] = checkedAdd(granted[grant.role], grant.staffWeeks);
  return STAFF_ROLES.filter(role => required[role] > 0).map(role => ({ role, requiredFte: required[role], grantedFte: granted[role], shortfallFte: required[role] - granted[role] }));
}

/** Only counters in this local hypothetical copy change. Source evidence stays untouched. */
function projectedCustomers(source: Readonly<GameState>, factorBps: number): GameState {
  const companyId = source.playerCompanyId, active = new Set(Object.values(source.slices.products.offers).filter(offer => offer.companyId === companyId && offer.status === 'active').map(offer => offer.id));
  const cohorts = source.slices.markets.cohorts.map(cohort => ({ ...cohort }));
  for (const segment of MARKET_SEGMENTS) {
    const inSegment = (id: string | undefined) => (id ?? 'regular') === segment.id;
    const present = cohorts.filter(cohort => inSegment(cohort.segmentId)).reduce((sum, cohort) => sum + cohort.count, 0)
      + source.slices.markets.trials.filter(trial => inSegment(trial.segmentId)).reduce((sum, trial) => sum + trial.count, 0)
      + (source.slices.markets.returnedNextWeek[segment.id] ?? 0)
      + (segment.market === 'business' ? commercialOrganizationCount(source) : 0);
    let remaining = Math.max(0, segment.population - present);
    for (const cohort of cohorts.filter(cohort => inSegment(cohort.segmentId) && cohort.companyId === companyId && active.has(cohort.productId) && cohort.activeWeek <= source.week + 1).sort((a, b) => a.id.localeCompare(b.id))) {
      const extra = Math.min(remaining, Math.max(0, mulDiv(cohort.count, factorBps, 10000) - cohort.count));
      cohort.count += extra; remaining -= extra;
    }
  }
  return { ...source, slices: { ...source.slices, markets: { ...source.slices.markets, cohorts } } };
}

function cloudState(state: Readonly<GameState>, totalCloudCU: number): GameState {
  const companyId = state.playerCompanyId, fleet = state.slices.compute.fleets[companyId];
  const serving = totalCloudCU + fleet.ownedCU - fleet.allocation.development - fleet.allocation.research;
  return { ...state, slices: { ...state.slices, compute: { ...state.slices.compute,
    fleets: { ...state.slices.compute.fleets, [companyId]: { ...fleet, cloudCU: totalCloudCU, allocation: { ...fleet.allocation, serving } } } } } };
}

function cloudRemedy(state: Readonly<GameState>, requests: WorkRequest[], staffGrants: StaffGrant[], alreadyFits: boolean, content: GameContent): ForecastCloudPlan {
  const companyId = state.playerCompanyId, fleet = state.slices.compute.fleets[companyId];
  if (alreadyFits) return { additionalCU: 0, additionalRentCents: 0, totalCloudCU: fleet.cloudCU, servingAllocationCU: fleet.allocation.serving, usesSpareAllocation: false, reason: 'Your current serving limit covers this customer demand.' };
  if (state.slices.company.companies[companyId].arrearsCents > 0) return { additionalCU: null, additionalRentCents: null, totalCloudCU: null, servingAllocationCU: null, usesSpareAllocation: false, reason: 'This lab has unpaid bills and cannot continue. Inspect or export this run, or start a new lab.' };
  const compute = createComputeModule(content);
  // Search actual whole-CU choices rather than assuming that a greedy placement
  // across specialized pools is monotone. The authored cloud ceiling bounds this.
  for (let total = fleet.cloudCU; total <= content.firstSale.maxCloudCU; total += U) {
    if (total > fleet.cloudCU && compute.validateCommand!(state, { id: 'forecast-cloud-plan', companyId, issuedForWeek: state.week + 1,
      payload: { kind: 'set_cloud_capacity', cu: total } }, content)) continue;
    const candidate = cloudState(state, total), result = compute.grantResources!(candidate, planningContext(candidate, content, requests, staffGrants));
    const grants = new Map((result.computeGrants ?? []).map(grant => [grant.requestId, grant]));
    if (!requests.every(request => requestFits(request, grants.get(request.id)))) continue;
    const additionalCU = total - fleet.cloudCU, servingAllocationCU = candidate.slices.compute.fleets[companyId].allocation.serving;
    return { additionalCU, additionalRentCents: mulDiv(additionalCU, content.opening.rentCentsPerCUWeek, U), totalCloudCU: total, servingAllocationCU,
      usesSpareAllocation: servingAllocationCU > fleet.allocation.serving + additionalCU,
      reason: additionalCU ? 'Rent this much cloud capacity and set the serving limit shown. Check staff and other jobs separately.' : 'Give serving some of your spare capacity. No extra cloud rental is needed.' };
  }
  return { additionalCU: null, additionalRentCents: null, totalCloudCU: null, servingAllocationCU: null, usesSpareAllocation: false,
    reason: `Even ${formatUnits(content.firstSale.maxCloudCU)} total cloud CU cannot cover this demand. Check hardware compatibility, memory, networking, and operating staff.` };
}

function forecastRow(state: Readonly<GameState>, content: GameContent, offset: number, cache: Map<string, ForecastCloudPlan>): CapacityForecastRow {
  const companyId = state.playerCompanyId, fleet = state.slices.compute.fleets[companyId], requests = customerCapacityRequests(state, content);
  const staffGrants = createCompanyModule(content).grantResources!(state, planningContext(state, content, requests.staffing)).staffGrants ?? [];
  const context = planningContext(state, content, requests.serving, staffGrants), result = createComputeModule(content).grantResources!(state, context);
  const grants = result.computeGrants ?? [], byId = new Map(grants.map(grant => [grant.requestId, grant]));
  const observed = result.updates!.compute!.fleets[companyId], pools = getComputePools(state, companyId, content, staffGrants);
  const physicalWorkCUw = grants.reduce((sum, grant) => checkedAdd(sum, grant.physicalCUw), 0);
  const staff = staffRequirements(requests.staffing, staffGrants), staffFits = staff.every(item => item.shortfallFte === 0);
  const fit = requests.serving.map(request => {
    const grant = byId.get(request.id), compatible = pools.filter(pool => poolSupportsWorkload(pool, request));
    const pool = grant && pools.find(item => item.id === grant.poolId);
    return { requestId: request.id, label: requestLabel(state, request), requestedWorkCUw: request.normalizedWorkCUw, grantedWorkCUw: grant?.hardwareEffectiveCUw ?? 0,
      physicalWorkCUw: grant?.physicalCUw ?? 0, requestedMemoryMU: request.memoryMU, grantedMemoryMU: grant?.memoryMU ?? 0,
      largestCompatiblePoolMU: Math.max(0, ...compatible.map(item => item.memoryMU)), poolName: grant && (grant.physicalCUw > 0 || grant.memoryMU > 0) ? pool?.name ?? null : null,
      fits: requestFits(request, grant), reason: observed.lastGrants.find(item => item.requestId === request.id)?.reason ?? '' };
  });
  const computeFits = fit.every(item => item.fits);
  const weakestCapacityBps = Math.min(10000, ...fit.map(item => item.grantedMemoryMU < item.requestedMemoryMU ? 0 : item.requestedWorkCUw ? mulDiv(item.grantedWorkCUw, 10000, item.requestedWorkCUw) : 10000));
  const key = JSON.stringify([requests.serving, staffGrants, computeFits]);
  let cloudPlan = cache.get(key);
  if (!cloudPlan) { cloudPlan = cloudRemedy(state, requests.serving, staffGrants, computeFits, content); cache.set(key, cloudPlan); }
  const variableNumerator = grants.reduce((sum, grant) => {
    const pool = pools.find(item => item.id === grant.poolId), request = requests.serving.find(item => item.id === grant.requestId);
    return sum + BigInt(grant.physicalCUw) * BigInt(pool && request ? getPoolWorkCostRate(pool, request) : 0);
  }, BigInt(0));
  return { week: state.week + offset, offset, paidAccounts: requests.paidAccounts, trialAccounts: requests.trialAccounts,
    privateCommitments: requests.privateCommitments, licenseCommitments: requests.licenseCommitments,
    requestedWorkCUw: requests.serving.reduce((sum, request) => checkedAdd(sum, request.normalizedWorkCUw), 0),
    publicWorkCUw: requests.serving.filter(request => request.id.startsWith('serve:') || request.id.startsWith('canary-serve:')).reduce((sum, request) => checkedAdd(sum, request.normalizedWorkCUw), 0),
    privateWorkCUw: requests.serving.filter(request => (request.id.startsWith('business-serve:') || request.id.startsWith('assurance-serve:'))).reduce((sum, request) => checkedAdd(sum, request.normalizedWorkCUw), 0),
    requestedMemoryMU: requests.serving.reduce((sum, request) => checkedAdd(sum, request.memoryMU), 0), physicalWorkCUw,
    reservedPhysicalCU: observed.reservedCU, headroomCU: observed.reservedCU - physicalWorkCUw, servingAllocationCU: fleet.allocation.serving,
    grantedWorkCUw: grants.reduce((sum, grant) => checkedAdd(sum, grant.hardwareEffectiveCUw), 0),
    weakestCapacityBps, computeFits, staffFits, fits: computeFits && staffFits, ownedServiceWorkCents: checkedInteger(Number(variableNumerator / BigInt(U))),
    staff, requests: fit,
    bottlenecks: [...new Set([...fit.filter(item => !item.fits).map(item => `${item.label}: ${item.reason || 'This job needs more resources.'}`),
      ...staff.filter(item => item.shortfallFte > 0).map(item => `${WORK_POINT_LABELS[item.role]} output is short by ${formatWorkPoints(item.shortfallFte)} points per week.`)])], cloudPlan };
}

export function getCapacityForecast(state: Readonly<GameState>, options: CapacityForecastOptions = {}, content: GameContent = CONTENT): CapacityForecast {
  const availability = capacityForecastAvailability(state), fleet = state.slices.compute.fleets[state.playerCompanyId];
  const baseGrowthBps = options.baseGrowthBps ?? RULES.defaultBaseGrowthBps, stressGrowthBps = options.stressGrowthBps ?? RULES.defaultStressGrowthBps;
  for (const rate of [baseGrowthBps, stressGrowthBps]) if (!Number.isSafeInteger(rate) || rate < 0 || rate > RULES.maximumGrowthBps) throw new Error('Forecast growth must be between 0% and 10% per week.');
  if (stressGrowthBps < baseGrowthBps) throw new Error('The higher-growth scenario must be at least as high as the expected rate.');
  const result: CapacityForecast = { ...availability, sourceWeek: state.week, horizonWeeks: RULES.horizonWeeks,
    assumptions: CAPACITY_FORECAST_ASSUMPTIONS, currentCloudCU: fleet.cloudCU,
    currentCloudRentCents: mulDiv(fleet.cloudCU, content.opening.rentCentsPerCUWeek, U),
    developmentAllocationCU: fleet.allocation.development, researchAllocationCU: fleet.allocation.research, scenarios: [] };
  if (!availability.available) return result;
  const cache = new Map<string, ForecastCloudPlan>();
  for (const [id, name, growthBps] of [['base', 'Base case', baseGrowthBps], ['stress', 'Heavier load', stressGrowthBps]] as const) {
    let factorBps = 10000;
    const rows: CapacityForecastRow[] = [];
    for (let offset = 1; offset <= RULES.horizonWeeks; offset++) {
      rows.push(forecastRow(projectedCustomers(state, factorBps), content, offset, cache));
      factorBps = mulDiv(factorBps, 10000 + growthBps, 10000);
    }
    const scenario: CapacityForecastScenario = { id, name, growthBps, rows, firstPressureWeek: rows.find(row => !row.fits)?.week ?? null,
      peakAdditionalCloudCU: rows.some(row => row.cloudPlan.additionalCU === null) ? null : Math.max(0, ...rows.map(row => row.cloudPlan.additionalCU!)) };
    result.scenarios.push(scenario);
  }
  return result;
}
