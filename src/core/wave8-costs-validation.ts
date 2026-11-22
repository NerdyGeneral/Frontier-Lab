import type { ComputePool, GameContent, GameState, LedgerFact, ResourceGrant, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { ComputeCostReport, ComputeCostSnapshot, Wave8ComputeCostFields } from '../contracts/wave8-costs';
import { COMPUTE_COST_RULES as RULES } from '../content/wave8-costs';
import { calculateComputeCostReport, computeCostFact } from '../modules/compute-costs';
import { facilityWorkClass, getComputePools, getInfrastructureBaseCost, getPoolMultiplierBps, getPoolWorkCapacityCU, getPoolWorkCostRate, poolSupportsWorkload, usesCrossRackTraining } from '../modules/compute-pools';
import { batchPlacementAtWeek } from '../modules/batch-inference';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';
import { assertFacilityPoolSpecialization } from './wave28-facilities-validation';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown) => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.');
const id = (value: unknown): void => check(typeof value === 'string' && value.length > 0 && value.length <= 512 && !['__proto__', 'constructor', 'prototype'].includes(value), 'Compute cost identifier is invalid.');
const text = (value: unknown): void => check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), 'Compute cost explanation is invalid.');
const categories = ['serving', 'development', 'research'];
const roles = ['research', 'ml', 'data', 'infrastructure', 'commercial', 'hardware'];

function assertPool(pool: ComputePool, companyId: string, state: GameState, week: number): void {
  record(pool, 'Historical compute pool'); id(pool.id); id(pool.location); id(pool.hardwareId); text(pool.name); text(pool.bottleneck);
  check(pool.companyId === companyId && ['cloud', 'owned'].includes(pool.ownership), 'Compute cost pool ownership is invalid.');
  for (const value of [pool.nominalCU, pool.capacityCU, pool.memoryMU, pool.rackCount, pool.singleRackCU, pool.singleRackMemoryMU, pool.trainingBps, pool.servingBps,
    pool.variableCentsPerCUw, pool.staffCoverageBps, pool.powerCoverageBps, pool.coolingCoverageBps]) checkedInteger(value, 'Historical pool quantity');
  check(pool.capacityCU <= pool.nominalCU && pool.singleRackCU <= pool.capacityCU && pool.singleRackMemoryMU <= pool.memoryMU, 'Historical pool capacity exceeds its frozen equipment.');
  check([pool.staffCoverageBps, pool.powerCoverageBps, pool.coolingCoverageBps].every(value => value <= 10000), 'Historical pool availability exceeds 100%.');
  check(pool.trainingBps > 0 || pool.servingBps > 0, 'Historical pool has no supported hardware conversion.');
  if (pool.ownership === 'cloud') check(pool.id === 'general-cloud' && pool.location === 'cloud' && pool.hardwareId === 'general'
    && pool.variableCentsPerCUw === 0 && pool.capacityCU === pool.nominalCU, 'Historical cloud pool is not the rented general reservation.');
  else check(pool.id === `owned:${pool.location}:${pool.hardwareId}` && (pool.location === 'colocation' || state.slices.compute.facilities[pool.location]?.companyId === companyId), 'Historical owned pool location is missing or foreign.');
  if (pool.fastFabric !== undefined) check(typeof pool.fastFabric === 'boolean', 'Historical fabric availability is invalid.');
  if (pool.architectures !== undefined) check(Array.isArray(pool.architectures) && pool.architectures.length > 0 && pool.architectures.every(item => ['dense', 'sparse'].includes(item)), 'Historical pool architectures are invalid.');
  if (pool.workloads !== undefined) check(Array.isArray(pool.workloads) && pool.workloads.length > 0 && pool.workloads.every(item => ['inference', 'training', 'general'].includes(item)), 'Historical pool workload support is invalid.');
  assertFacilityPoolSpecialization(state, pool, week);
}

function assertFrame(report: ComputeCostReport, state: GameState, content: GameContent): void {
  const { resources } = report;
  record(resources, 'Historical resource frame');
  check(Array.isArray(resources.requests) && resources.requests.length <= RULES.maximumRequestsPerReport
    && Array.isArray(resources.computeGrants) && resources.computeGrants.length === resources.requests.length
    && Array.isArray(resources.staffGrants) && resources.staffGrants.length <= resources.requests.length, 'Compute cost resource history exceeds its supported bounds.');
  const requests = new Map<string, WorkRequest>(), pools = new Set(report.pools.map(pool => pool.id));
  const waitingForBatchPool = (request: WorkRequest): boolean => {
    const job = state.slices.products.batchJobs?.[request.taskId];
    return !!job && job.companyId === report.companyId && request.category === 'serving' && request.id === `batch-serve:${job.id}`
      && request.poolId !== 'auto' && !pools.has(request.poolId) && batchPlacementAtWeek(job, report.week) === request.poolId;
  };
  for (const request of resources.requests) {
    record(request, 'Historical workload'); id(request.id); id(request.taskId); id(request.poolId);
    check(!requests.has(request.id) && request.companyId === report.companyId && categories.includes(request.category), 'Compute cost workload is duplicated or foreign.');
    check(request.workloadKind === undefined || ['inference', 'training', 'general'].includes(request.workloadKind), 'Historical workload has an unknown execution class.');
    check(request.modelArchitecture === undefined || ['dense', 'sparse'].includes(request.modelArchitecture), 'Historical workload has an unknown model architecture.');
    check(request.requiresFastFabric === undefined || typeof request.requiresFastFabric === 'boolean', 'Historical workload has an invalid fabric requirement.');
    requests.set(request.id, request);
    for (const value of [request.normalizedWorkCUw, request.memoryMU, request.priority, request.headroomBps ?? 0]) checkedInteger(value, 'Historical workload quantity');
    if (request.staffPriority !== undefined) {
      const job = state.slices.products.batchJobs?.[request.taskId];
      check(request.staffPriority === 60 && job?.companyId === request.companyId && request.id === `batch-serve:${job.id}`, 'Historical separate staff priority has no owned batch workload.');
    }
    check((request.headroomBps ?? 0) <= 10000 && (request.poolId === 'auto' || pools.has(request.poolId) || waitingForBatchPool(request)), 'Historical workload placement or headroom is invalid.');
    if (request.staffDemand !== undefined) {
      check(Array.isArray(request.staffDemand) && request.staffDemand.length <= roles.length, 'Historical staff demand is invalid.');
      const seen = new Set<string>();
      for (const item of request.staffDemand) { record(item, 'Historical staff demand'); checkedInteger(item.staffWeeks); check(roles.includes(item.role) && !seen.has(item.role), 'Historical staff demand is duplicated or unknown.'); seen.add(item.role); }
    }
  }
  const grants = new Map<string, ResourceGrant>();
  for (const grant of resources.computeGrants) {
    record(grant, 'Historical compute grant'); id(grant.requestId); id(grant.poolId);
    const request = requests.get(grant.requestId);
    const emptyMissingBatch = request && waitingForBatchPool(request) && grant.poolId === request.poolId
      && grant.physicalCUw === 0 && grant.hardwareEffectiveCUw === 0 && grant.memoryMU === 0 && !grant.sharedMemoryMU;
    check(request && !grants.has(grant.requestId) && (pools.has(grant.poolId) || emptyMissingBatch), 'Historical compute grant is duplicated, foreign, or unplaced.'); grants.set(grant.requestId, grant);
    for (const value of [grant.physicalCUw, grant.hardwareEffectiveCUw, grant.memoryMU, grant.sharedMemoryMU ?? 0]) checkedInteger(value, 'Historical compute grant quantity');
    check(grant.hardwareEffectiveCUw <= request!.normalizedWorkCUw && (grant.memoryMU === 0 || grant.memoryMU === request!.memoryMU)
      && (grant.sharedMemoryMU ?? 0) <= grant.memoryMU, 'Historical compute grant exceeds its request or uses partial workspace.');
    check((grant.physicalCUw === 0) === (grant.hardwareEffectiveCUw === 0), 'Historical physical and useful work disagree.');
    if (grant.physicalCUw > 0) check(grant.memoryMU === request!.memoryMU, 'Historical work ran without its full memory workspace.');
    if (grant.sharedMemoryMU !== undefined) check(!!request!.sharedAdapterMemory, 'Historical memory reuse lacks an adapter request.');
  }
  const staffSeen = new Set<string>();
  for (const staff of resources.staffGrants) {
    record(staff, 'Historical staff grant');
    const request = requests.get(staff.requestId);
    check(request && !staffSeen.has(staff.requestId) && Array.isArray(staff.grants) && staff.grants.length <= roles.length, 'Historical staff grant is duplicated or foreign.'); staffSeen.add(staff.requestId);
    const seen = new Set<string>();
    for (const item of staff.grants) {
      record(item, 'Historical staff effort'); checkedInteger(item.staffWeeks); check(roles.includes(item.role) && !seen.has(item.role), 'Historical staff effort is duplicated or unknown.'); seen.add(item.role);
      check(item.staffWeeks <= (request!.staffDemand?.find(demand => demand.role === item.role)?.staffWeeks ?? 0), 'Historical staff effort exceeds its request.');
    }
  }
  for (const pool of report.pools.filter(item => item.specialization)) {
    const used = { serving: 0, training: 0, general: 0 };
    for (const grant of resources.computeGrants.filter(item => item.poolId === pool.id)) {
      const request = requests.get(grant.requestId)!;
      used[facilityWorkClass(request)] += mulDiv(grant.physicalCUw, 10000 + (request.headroomBps ?? 0), 10000, 'ceil');
      if (grant.physicalCUw) {
        check(poolSupportsWorkload(pool, request), 'Specialized historical work used incompatible hardware.');
        const supervised = request.supervision ? mulDiv(resources.staffGrants.find(item => item.requestId === request.id)?.grants.find(item => item.role === request.supervision!.role)?.staffWeeks ?? 0,
          request.supervision.workPerStaffWeek, U) : request.normalizedWorkCUw;
        const multiplier = getPoolMultiplierBps(pool, request.category, usesCrossRackTraining(pool, request.category, grant.physicalCUw, request.memoryMU), content, request.workloadKind);
        check(grant.hardwareEffectiveCUw === Math.min(request.normalizedWorkCUw, supervised, mulDiv(grant.physicalCUw, multiplier, 10000)),
          'Specialized historical work invented output beyond its exact hardware/fabric/profile conversion.');
      }
    }
    check(used.serving <= getPoolWorkCapacityCU(pool, { category: 'serving', workloadKind: 'inference' })
      && used.training <= getPoolWorkCapacityCU(pool, { category: 'development', workloadKind: 'training' })
      && used.serving + used.training + used.general <= pool.capacityCU, 'Historical work exceeded its shared facility profile ceiling or headroom budget.');
  }
}

function assertTargets(report: ComputeCostReport, state: GameState): void {
  check(Array.isArray(report.targets) && report.targets.length <= report.resources.requests.length + report.ledgerFacts.length, 'Compute cost activity bindings are invalid.');
  const requests = new Map(report.resources.requests.map(request => [request.id, request])), facts = new Map(report.ledgerFacts.map(fact => [fact.id, fact]));
  const targetIds = new Set<string>(), boundRequests = new Set<string>(), boundRevenue = new Set<string>();
  for (const target of report.targets) {
    record(target, 'Cost activity'); id(target.id); id(target.sourceId); text(target.name);
    check(!targetIds.has(target.id) && ['public-product', 'batch-inference', 'assured-api', 'private-service', 'weight-license', 'agent-orders', 'internal', 'other-revenue'].includes(target.kind), 'Compute cost activity is duplicated or unknown.'); targetIds.add(target.id);
    check(Array.isArray(target.requestIds) && Array.isArray(target.revenueFactIds) && target.requestIds.length + target.revenueFactIds.length > 0, 'Compute cost activity has no source records.');
    if (target.kind === 'public-product') {
      const product = state.slices.products.offers[target.sourceId];
      check(target.id === `product:${target.sourceId}` && product?.companyId === report.companyId && target.contractId === product.contractId, 'Compute cost product or contract is foreign.');
    } else if (target.kind === 'batch-inference') {
      const job = state.slices.products.batchJobs?.[target.sourceId];
      check(target.id === `batch:${target.sourceId}` && job?.companyId === report.companyId && target.contractId === job.id
        && job.acceptedWeek <= report.week && (job.terminalWeek === null || report.week <= job.terminalWeek),
      'Compute cost batch job is foreign or outside its accepted service window.');
    } else if (target.kind === 'assured-api') {
      const contract = state.slices.products.assuranceContracts?.[target.sourceId];
      check(target.id === `assurance:${target.sourceId}` && contract?.companyId === report.companyId && target.contractId === contract.id && contract.signedWeek <= report.week, 'Compute cost assurance contract is foreign or premature.');
    } else if (target.kind === 'private-service' || target.kind === 'weight-license') {
      const contract = state.slices.products.commercialContracts[target.sourceId];
      checkedInteger(target.commercialGeneration!, 'Historical commercial generation'); checkedInteger(target.commercialSignedWeek!, 'Historical commercial signing week');
      check(target.id === `business:${target.sourceId}` && contract && target.commercialGeneration! > 0 && target.commercialGeneration! <= contract.generation
        && target.commercialSignedWeek! <= report.week, 'Compute cost commercial commitment has an invalid generation.');
      check(target.commercialGeneration === contract.generation
        ? contract.companyId === report.companyId && target.commercialSignedWeek === contract.signedWeek && (target.kind === 'private-service') === (contract.contractKind === 'private-hosted')
        : report.week < contract.signedWeek, 'Compute cost commercial commitment is foreign or changed kind within its recorded generation.');
    } else if (target.kind === 'agent-orders') check(target.id === `agents:${report.companyId}` && target.sourceId === report.companyId, 'Compute cost agent activity is foreign.');
    else if (target.kind === 'internal') check(target.id === `internal:${target.category}` && categories.includes(target.category!) && target.sourceId === target.category && target.revenueFactIds.length === 0, 'Internal compute activity cannot claim customer revenue.');
    else check(target.id === `other:${report.companyId}` && target.sourceId === report.companyId && target.requestIds.length === 0, 'Other revenue cannot absorb unclassified workloads.');
    for (const requestId of target.requestIds) {
      const request = requests.get(requestId); check(request && !boundRequests.has(requestId), 'Compute workload attribution is missing or duplicated.'); boundRequests.add(requestId);
      if (target.kind === 'public-product') {
        const canary = requestId.startsWith('canary-serve:') ? state.slices.products.canaryReleases?.[requestId.slice('canary-serve:'.length)] : undefined;
        check(request!.taskId === target.sourceId && (requestId === `serve:${target.sourceId}`
          || canary?.companyId === report.companyId && canary.productId === target.sourceId
            && canary.observations.some(receipt => receipt.week === report.week && receipt.candidate.requestId === requestId)), 'A product claimed another workload.');
      }
      else if (target.kind === 'batch-inference') check(request!.taskId === target.sourceId && requestId === `batch-serve:${target.sourceId}`, 'A batch job claimed another workload.');
      else if (target.kind === 'assured-api') check(request!.taskId === target.sourceId && ['assurance-serve:', 'assurance-support:', 'assurance-onboard:'].some(prefix => requestId === prefix + target.sourceId), 'An assured API contract claimed another workload.');
      else if (target.kind === 'private-service' || target.kind === 'weight-license') check(request!.taskId === target.sourceId && ['business-serve:', 'business-support:', 'business-delivery:'].some(prefix => requestId === prefix + target.sourceId), 'A commercial commitment claimed another workload.');
      else if (target.kind === 'agent-orders') check(request!.taskId.startsWith('agent:') && requestId === `${request!.taskId}:work`, 'Agent costs include a non-agent workload.');
      else if (target.kind === 'internal') check(request!.category === target.category && !requestId.startsWith('serve:') && !requestId.startsWith('canary-serve:') && !requestId.startsWith('business-serve:') && !requestId.startsWith('assurance-serve:') && !requestId.startsWith('batch-serve:') && !(request!.taskId.startsWith('agent:') && requestId === `${request!.taskId}:work`), 'Internal compute concealed customer serving work.');
    }
    for (const factId of target.revenueFactIds) {
      const fact = facts.get(factId); check(fact?.kind === 'receipt' && fact.category === 'revenue' && !boundRevenue.has(factId), 'Earned revenue attribution is missing or duplicated.'); boundRevenue.add(factId);
      if (target.kind === 'public-product') check(fact!.sourceId === target.contractId && factId === `invoice:${target.sourceId}:${report.week}`, 'A product claimed another invoice.');
      else if (target.kind === 'batch-inference') check(fact!.sourceId === target.sourceId && factId === `batch-invoice:${target.sourceId}`, 'A batch job claimed another invoice.');
      else if (target.kind === 'assured-api') check(fact!.sourceId === target.sourceId && factId === `assurance-invoice:${target.sourceId}:${report.week}`, 'An assured API contract claimed another invoice.');
      else if (target.kind === 'private-service' || target.kind === 'weight-license') check(fact!.sourceId === target.sourceId && factId === `business-invoice:${target.sourceId}:${target.commercialGeneration}:${report.week}`, 'A commercial commitment claimed another invoice.');
      else if (target.kind === 'agent-orders') check(factId.startsWith('invoice:agent:'), 'Agent activity claimed another invoice.');
      else if (target.kind === 'other-revenue') check(!state.slices.products.contracts[fact!.sourceId]
        && !state.slices.products.commercialContracts[fact!.sourceId] && !state.slices.products.assuranceContracts?.[fact!.sourceId] && !state.slices.products.batchJobs?.[fact!.sourceId] && !factId.startsWith('batch-invoice:') && !factId.startsWith('assurance-invoice:') && !factId.startsWith('invoice:') && !factId.startsWith('business-invoice:'),
      'Other earned revenue cannot conceal an identified customer invoice.');
    }
  }
  check(boundRequests.size === requests.size && boundRevenue.size === report.ledgerFacts.filter(fact => fact.kind === 'receipt' && fact.category === 'revenue').length, 'Compute accounting omitted a workload or earned-revenue receipt.');
}

/** Throws on malformed or unreconciled retained reports; creates no game effects. */
export function assertWave8ComputeCosts(state: GameState, content: GameContent): void {
  const active = Object.values(state.slices.research.systemRollouts).filter(rollout => rollout.method === RULES.rolloutMethod);
  for (const rollout of active) {
    const research = Object.values(state.slices.research.projects).find(project => project.companyId === rollout.companyId && project.researchId === RULES.researchId);
    check(research?.status === 'complete' && research.availableWeek !== undefined && research.availableWeek <= rollout.startedWeek, 'Cost accounting began before its researched method was available.');
  }
  const histories = (state.slices.compute as GameState['slices']['compute'] & Wave8ComputeCostFields).costReports;
  if (histories === undefined) return;
  record(histories, 'Compute cost histories');
  for (const [companyId, history] of Object.entries(histories)) {
    const company = state.slices.company.companies[companyId];
    check(company && Array.isArray(history) && history.length > 0 && history.length <= RULES.historyWeeks, 'Compute cost history has an invalid owner or length.');
    const rollout = active.find(item => item.companyId === companyId);
    check(rollout?.status === 'active' && rollout.readyWeek !== null, 'Compute cost history has no completed accounting installation.');
    let previousWeek: number | null = null;
    for (const report of history) {
      record(report, 'Compute cost report'); checkedInteger(report.week); id(report.id); id(report.rolloutId);
      check(report.protocol === RULES.protocol && report.companyId === companyId && report.id === `compute-cost:${companyId}:${report.week}` && report.rolloutId === rollout!.id
        && report.week >= rollout!.readyWeek! && report.week <= state.week && (previousWeek === null || report.week === previousWeek + 1), 'Compute cost report identity or chronology is invalid.'); previousWeek = report.week;
      checkedInteger(report.cloudRentCentsPerCUWeek); check(report.cloudRentCentsPerCUWeek === content.opening.rentCentsPerCUWeek, 'Historical cloud tariff differs from the authored reservation price.');
      for (const value of [report.variableCostCarryIn, report.variableCostCarryOut]) { checkedInteger(value, 'Historical fractional cent'); check(value < U, 'Historical fractional cent exceeds its denominator.'); }
      check(Array.isArray(report.pools) && report.pools.length > 0 && report.pools.length <= RULES.maximumPoolsPerReport, 'Historical compute pools are missing or excessive.');
      const poolIds = new Set<string>(); for (const pool of report.pools) { assertPool(pool, companyId, state, report.week); check(!poolIds.has(pool.id), 'Historical compute pool is duplicated.'); poolIds.add(pool.id); }
      assertFrame(report, state, content);
      check(Array.isArray(report.ledgerFacts) && report.ledgerFacts.length <= RULES.maximumFactsPerReport, 'Compute cost ledger history is invalid.');
      const factIds = new Set<string>();
      for (const fact of report.ledgerFacts) {
        record(fact, 'Historical settled fact'); id(fact.id); id(fact.sourceId); text(fact.label); checkedInteger(fact.amountCents);
        check(!factIds.has(fact.id) && fact.companyId === companyId && fact.week === report.week && ['expense', 'receipt'].includes(fact.kind)
          && ['rent', 'overhead', 'operating', 'revenue', 'capital', 'financing'].includes(fact.category), 'Compute cost fact is duplicated, foreign, or outside its settled week.'); factIds.add(fact.id);
        check(state.slices.company.postedFacts[fact.id] === true, 'A compute cost receipt has no retained company settlement proof.');
        const retained = state.slices.company.ledger.find(entry => entry.id === fact.id);
        if (retained) { const { paidCents: _paid, unpaidCents: _unpaid, ...posted } = retained; check(same(fact, posted), 'A compute cost receipt disagrees with its retained company ledger entry.'); }
        const publicInvoice = state.slices.products.invoices.find(invoice => invoice.id === fact.id);
        const businessInvoice = state.slices.products.commercialInvoices.find(invoice => invoice.id === fact.id);
        const agentInvoice = state.slices.agents.invoices.find(invoice => invoice.id === fact.id);
        const assuranceInvoice = state.slices.products.assuranceInvoices?.find(invoice => invoice.id === fact.id);
        const batchInvoice = state.slices.products.batchInvoices?.find(invoice => invoice.id === fact.id);
        const invoice = publicInvoice ?? businessInvoice ?? assuranceInvoice ?? batchInvoice ?? agentInvoice;
        if (invoice) check(fact.kind === 'receipt' && fact.category === 'revenue' && invoice.companyId === companyId
          && invoice.week === report.week && invoice.amountCents === fact.amountCents
          && fact.sourceId === (publicInvoice?.contractId ?? businessInvoice?.contractId ?? assuranceInvoice?.contractId ?? batchInvoice?.jobId ?? agentInvoice!.jobId),
        'A compute cost receipt disagrees with its retained customer invoice.');
      }
      check(state.slices.company.ledger.filter(entry => entry.companyId === companyId && entry.week === report.week).every(entry => factIds.has(entry.id)),
        'A compute cost report omitted a retained company ledger fact.');
      const expectFact = (suffix: 'cloud-rent' | 'owned-fixed' | 'owned-variable', sourceId: string, category: LedgerFact['category']) => {
        const fact = computeCostFact(report, suffix); if (fact) check(fact.kind === 'expense' && fact.amountCents > 0 && fact.sourceId === sourceId && fact.category === category, 'Compute cost charge has the wrong ledger source.'); return fact?.amountCents ?? 0;
      };
      const cloudCents = expectFact('cloud-rent', 'general-cloud-reservation', 'rent'), fixedCents = expectFact('owned-fixed', 'owned-infrastructure', 'operating'), variableCents = expectFact('owned-variable', 'owned-gpu-work', 'operating');
      const cloud = report.pools.filter(pool => pool.ownership === 'cloud');
      check(cloud.length === 1 && cloudCents === mulDiv(cloud[0].nominalCU, report.cloudRentCentsPerCUWeek, U), 'Recorded cloud rent does not match the rented capacity.');
      const pools = new Map(report.pools.map(pool => [pool.id, pool]));
      const requests = new Map(report.resources.requests.map(request => [request.id, request]));
      const raw = report.resources.computeGrants.reduce((total, grant) => total + (pools.get(grant.poolId)?.ownership === 'owned'
        ? BigInt(grant.physicalCUw) * BigInt(getPoolWorkCostRate(pools.get(grant.poolId)!, requests.get(grant.requestId)!)) : BigInt(0)), BigInt(0));
      check(raw + BigInt(report.variableCostCarryIn) === BigInt(variableCents) * BigInt(U) + BigInt(report.variableCostCarryOut), 'Owned work costs do not reconcile to actual work and fractional carry.');
      assertTargets(report, state);
      const { workloads: _workloads, poolUsage: _poolUsage, activities: _activities, totals: _totals, ...snapshot } = report;
      const expected = calculateComputeCostReport(snapshot as ComputeCostSnapshot);
      check(same(report, expected), 'Compute cost attribution or totals differ from their frozen resource and ledger facts.');
      check(expected.poolUsage.every(usage => usage.unusedCapacityCU >= 0 && usage.unavailableCapacityCU >= 0 && usage.chargedMemoryMU <= pools.get(usage.poolId)!.memoryMU), 'Historical workloads overbook their physical pool.');
      check(expected.totals.unallocatedCloudCents >= 0 && expected.totals.otherOperatingCents >= 0 && [0, 1].includes(expected.totals.sharedCarryCents)
        && expected.totals.attributedComputeCents + expected.totals.sharedComputeCents === expected.totals.totalComputeCents, 'Compute costs do not reconcile in whole cents.');
      if (report.week === state.week) {
        const fleet = state.slices.compute.fleets[companyId];
        const actualGrants = new Map(fleet.lastGrants.map(grant => [grant.requestId, grant]));
        const recordedGrants = new Map(report.resources.computeGrants.map(grant => [grant.requestId, grant]));
        check(actualGrants.size === report.resources.requests.length && report.resources.requests.every(request => {
          const actual = actualGrants.get(request.id), recorded = recordedGrants.get(request.id);
          return actual?.requestedWork === request.normalizedWorkCUw && actual.grantedWork === recorded?.hardwareEffectiveCUw;
        }), 'Latest cost report differs from the actual requested or granted useful work.');
        check(report.variableCostCarryOut === fleet.variableCostCarry && fixedCents === getInfrastructureBaseCost(state, companyId, content), 'Latest compute costs disagree with the settled fleet.');
        check(same(report.pools, getComputePools(state, companyId, content, report.resources.staffGrants).sort((a, b) => a.id.localeCompare(b.id))), 'Latest pool prices or locations differ from the actual settled pools.');
        check(expected.totals.companyRevenueCents === company.lastWeek.revenueCents && expected.totals.companyOperatingCents === company.lastWeek.operatingExpenseCents, 'Latest cost report does not reconcile to the company operating ledger.');
        for (const category of categories) check(expected.workloads.filter(row => row.category === category).reduce((total, row) => total + row.physicalWorkCUw, 0) === fleet.lastWork[category as keyof typeof fleet.lastWork], 'Latest compute cost work differs from actual physical work.');
        check(expected.workloads.reduce((total, row) => total + row.reservedCUw, 0) === fleet.reservedCU
          && expected.workloads.reduce((total, row) => total + row.chargedMemoryMU, 0) === fleet.occupiedMemoryMU, 'Latest cost report differs from actual occupied capacity or memory.');
      }
    }
    check(previousWeek === state.week, 'Compute cost history is missing its latest settled week.');
  }
}
