import { CODING_AGENT_ORDER } from '../content/wave3-agents';
import { ASSURANCE_BY_ID } from '../content/wave13-assurance';
import { BATCH_ORDER_BY_ID } from '../content/wave14-batch';
import type { ComputeSlice, DomainResult, GameState, LedgerFact, ModuleContext, WorkCategory, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { ComputeCostReport, ComputeCostSnapshot, ComputeCostTarget, ComputeCostTotals, ComputePoolCostUsage, ComputeWorkloadCost, Wave8ComputeCostFields } from '../contracts/wave8-costs';
import { COMPUTE_COST_RULES as RULES } from '../content/wave8-costs';
import { BUSINESS_BY_ID } from '../content/wave3-commerce';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger, mulDiv } from '../core/math';
import { getComputePools, getPoolWorkCostRate } from './compute-pools';

const sum = (values: readonly number[]) => values.reduce((total, value) => checkedAdd(total, value), 0);
const categoryNames: Record<WorkCategory, string> = { serving: 'Internal serving work', development: 'Development work', research: 'Research work' };

export function computeCostAvailability(state: Readonly<GameState>, companyId = state.playerCompanyId) {
  const researched = (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId);
  const rollout = Object.values(state.slices.research.systemRollouts ?? {}).find(item => item.companyId === companyId && item.method === RULES.rolloutMethod) ?? null;
  return { researched, rollout, available: researched && rollout?.status === 'active' && rollout.readyWeek !== null && rollout.readyWeek <= state.week };
}

/** Whole cents from this week's numerators. No later workload inherits an earlier fraction. */
function largestRemainders(numerators: readonly { id: string; numerator: bigint }[], denominator: bigint) {
  if (denominator <= BigInt(0)) throw new Error('Compute cost attribution requires a positive denominator.');
  const rows = numerators.map(row => ({ ...row, cents: checkedInteger(Number(row.numerator / denominator)), remainder: row.numerator % denominator }));
  const numerator = numerators.reduce((total, row) => total + row.numerator, BigInt(0));
  const whole = checkedInteger(Number(numerator / denominator));
  let remaining = whole - sum(rows.map(row => row.cents));
  const ordered = [...rows].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ordered) {
    if (!remaining) break;
    row.cents += 1; remaining -= 1;
  }
  if (remaining !== 0) throw new Error('Compute cost rounding failed to conserve whole cents.');
  return { whole, numerator, cents: new Map(rows.map(row => [row.id, row.cents])) };
}

export function computeCostFact(snapshot: Pick<ComputeCostSnapshot, 'companyId' | 'week' | 'ledgerFacts'>, suffix: 'cloud-rent' | 'owned-fixed' | 'owned-variable'): LedgerFact | null {
  const found = snapshot.ledgerFacts.filter(fact => fact.id === `${snapshot.companyId}:${suffix}:${snapshot.week}`);
  if (found.length > 1) throw new Error('A settled compute charge was recorded more than once.');
  return found[0] ?? null;
}

/** Recompute every derived number solely from the saved historical evidence. */
export function calculateComputeCostReport(snapshot: ComputeCostSnapshot): ComputeCostReport {
  const pools = new Map(snapshot.pools.map(pool => [pool.id, pool]));
  const requests = new Map(snapshot.resources.requests.map(request => [request.id, request]));
  const grants = new Map(snapshot.resources.computeGrants.map(grant => [grant.requestId, grant]));
  const targetByRequest = new Map(snapshot.targets.flatMap(target => target.requestIds.map(id => [id, target.id] as const)));
  const cloudRentCents = computeCostFact(snapshot, 'cloud-rent')?.amountCents ?? 0;
  const ownedFixedCents = computeCostFact(snapshot, 'owned-fixed')?.amountCents ?? 0;
  const ownedVariableCents = computeCostFact(snapshot, 'owned-variable')?.amountCents ?? 0;
  const workloads: ComputeWorkloadCost[] = [...snapshot.resources.requests].sort((a, b) => a.id.localeCompare(b.id)).map(request => {
    const grant = grants.get(request.id), targetId = targetByRequest.get(request.id);
    const waitingForBatchPool = grant && request.id === `batch-serve:${request.taskId}` && request.category === 'serving'
      && request.poolId !== 'auto' && grant.poolId === request.poolId && !grant.physicalCUw && !grant.hardwareEffectiveCUw && !grant.memoryMU && !grant.sharedMemoryMU;
    if (!grant || !targetId || (!pools.has(grant.poolId) && !waitingForBatchPool)) throw new Error('A compute cost workload lost its grant, target, or historical pool.');
    const reservedCUw = mulDiv(grant.physicalCUw, 10000 + (request.headroomBps ?? 0), 10000, 'ceil');
    return { requestId: request.id, targetId, category: request.category, poolId: grant.poolId,
      requestedWorkCUw: request.normalizedWorkCUw, effectiveWorkCUw: grant.hardwareEffectiveCUw, physicalWorkCUw: grant.physicalCUw,
      reservedCUw, headroomCUw: reservedCUw - grant.physicalCUw, chargedMemoryMU: grant.memoryMU - (grant.sharedMemoryMU ?? 0),
      cloudRentCents: 0, ownedVariableCents: 0, attributedComputeCents: 0 };
  });
  const cloud = snapshot.pools.filter(pool => pool.ownership === 'cloud');
  if (cloud.length !== 1) throw new Error('A compute cost report needs its one historical cloud reservation.');
  const cloudRows = workloads.filter(row => pools.get(row.poolId)?.ownership === 'cloud');
  const cloudAttribution = largestRemainders(cloudRows.map(row => ({ id: row.requestId, numerator: BigInt(cloudRentCents) * BigInt(row.reservedCUw) })), BigInt(cloud[0].nominalCU || 1));
  const ownedAttribution = largestRemainders(workloads.filter(row => pools.get(row.poolId)?.ownership === 'owned')
    .map(row => ({ id: row.requestId, numerator: BigInt(row.physicalWorkCUw) * BigInt(getPoolWorkCostRate(pools.get(row.poolId)!, requests.get(row.requestId)!)) })), BigInt(U));
  for (const row of workloads) {
    row.cloudRentCents = cloudAttribution.cents.get(row.requestId) ?? 0;
    row.ownedVariableCents = ownedAttribution.cents.get(row.requestId) ?? 0;
    row.attributedComputeCents = checkedAdd(row.cloudRentCents, row.ownedVariableCents);
  }
  const poolUsage: ComputePoolCostUsage[] = snapshot.pools.map(pool => {
    const work = workloads.filter(row => row.poolId === pool.id);
    const reservedCUw = sum(work.map(row => row.reservedCUw));
    const physicalWorkCUw = sum(work.map(row => row.physicalWorkCUw));
    return { poolId: pool.id, physicalWorkCUw, reservedCUw, headroomCUw: reservedCUw - physicalWorkCUw,
      unusedCapacityCU: pool.capacityCU - reservedCUw, unavailableCapacityCU: pool.nominalCU - pool.capacityCU,
      chargedMemoryMU: sum(work.map(row => row.chargedMemoryMU)), attributedCloudRentCents: sum(work.map(row => row.cloudRentCents)),
      attributedOwnedVariableCents: sum(work.map(row => row.ownedVariableCents)) };
  });
  const facts = new Map(snapshot.ledgerFacts.map(fact => [fact.id, fact]));
  const activities = snapshot.targets.map(target => {
    const rows = workloads.filter(row => row.targetId === target.id);
    const revenueCents = sum(target.revenueFactIds.map(id => {
      const fact = facts.get(id);
      if (!fact || fact.kind !== 'receipt' || fact.category !== 'revenue') throw new Error('A cost contribution lost its earned revenue fact.');
      return fact.amountCents;
    }));
    const attributedComputeCents = sum(rows.map(row => row.attributedComputeCents));
    return { targetId: target.id, revenueCents, cloudRentCents: sum(rows.map(row => row.cloudRentCents)),
      ownedVariableCents: sum(rows.map(row => row.ownedVariableCents)), attributedComputeCents,
      contributionCents: checkedAdd(revenueCents, -attributedComputeCents), physicalWorkCUw: sum(rows.map(row => row.physicalWorkCUw)),
      reservedCUw: sum(rows.map(row => row.reservedCUw)) };
  });
  const attributedCloudRentCents = cloudAttribution.whole, attributedOwnedVariableCents = ownedAttribution.whole;
  const attributedComputeCents = checkedAdd(attributedCloudRentCents, attributedOwnedVariableCents);
  const sharedCarryCents = ownedVariableCents - attributedOwnedVariableCents;
  const unallocatedCloudCents = cloudRentCents - attributedCloudRentCents;
  const sharedComputeCents = sum([ownedFixedCents, sharedCarryCents, unallocatedCloudCents]);
  const totalComputeCents = sum([cloudRentCents, ownedFixedCents, ownedVariableCents]);
  const companyRevenueCents = sum(snapshot.ledgerFacts.filter(fact => fact.kind === 'receipt' && fact.category === 'revenue').map(fact => fact.amountCents));
  const companyOperatingCents = sum(snapshot.ledgerFacts.filter(fact => fact.kind === 'expense' && fact.category !== 'capital').map(fact => fact.amountCents));
  const capitalOutlayCents = sum(snapshot.ledgerFacts.filter(fact => fact.kind === 'expense' && fact.category === 'capital').map(fact => fact.amountCents));
  const totals: ComputeCostTotals = { cloudRentCents, ownedFixedCents, ownedVariableCents, attributedCloudRentCents, attributedOwnedVariableCents,
    attributedComputeCents, unallocatedCloudCents, sharedCarryCents, sharedComputeCents, totalComputeCents, companyRevenueCents,
    otherOperatingCents: companyOperatingCents - totalComputeCents, companyOperatingCents, capitalOutlayCents,
    operatingSurplusCents: checkedAdd(companyRevenueCents, -companyOperatingCents) };
  return { ...structuredClone(snapshot), workloads, poolUsage, activities, totals };
}

function targetsFor(state: Readonly<GameState>, companyId: string, requests: readonly WorkRequest[], facts: readonly LedgerFact[]): ComputeCostTarget[] {
  const targets = new Map<string, ComputeCostTarget>();
  const add = (target: Omit<ComputeCostTarget, 'requestIds' | 'revenueFactIds'>): ComputeCostTarget => {
    const existing = targets.get(target.id);
    if (existing) return existing;
    const value: ComputeCostTarget = { ...target, requestIds: [], revenueFactIds: [] };
    targets.set(value.id, value); return value;
  };
  const publicTarget = (productId: string) => {
    const product = state.slices.products.offers[productId];
    return add({ id: `product:${product.id}`, kind: 'public-product', sourceId: product.id, contractId: product.contractId, name: product.name });
  };
  const businessTarget = (contractId: string) => {
    const contract = state.slices.products.commercialContracts[contractId];
    const customer = BUSINESS_BY_ID[contract.customerId];
    return add({ id: `business:${contract.id}`, kind: contract.contractKind === 'private-hosted' ? 'private-service' : 'weight-license', sourceId: contract.id,
      commercialGeneration: contract.generation, commercialSignedWeek: contract.signedWeek,
      name: `${customer?.name ?? contract.customerId} · ${contract.contractKind === 'private-hosted' ? 'private service' : 'weight license'}` });
  };
  const assuranceTarget = (contractId: string) => {
    const contract = state.slices.products.assuranceContracts![contractId];
    return add({ id: `assurance:${contract.id}`, kind: 'assured-api', sourceId: contract.id, contractId: contract.id, name: `${ASSURANCE_BY_ID[contract.buyerId].name} · assured API` });
  };
  const batchTarget = (jobId: string) => {
    const job = state.slices.products.batchJobs![jobId];
    return add({ id: `batch:${job.id}`, kind: 'batch-inference', sourceId: job.id, contractId: job.id, name: `${BATCH_ORDER_BY_ID[job.orderId].name} · batch order ${job.claim}` });
  };
  const isCodingJobId = (id: string) => id.startsWith('agent:') && id.split(':')[2] === CODING_AGENT_ORDER.id;
  const hasCodingActivity = requests.some(request => isCodingJobId(request.taskId))
    || facts.some(fact => fact.id.startsWith('invoice:agent:') && isCodingJobId(fact.sourceId));
  const agentTarget = () => add({ id: `agents:${companyId}`, kind: 'agent-orders', sourceId: companyId, name: hasCodingActivity ? 'Agent services' : 'Support agents' });
  for (const request of requests) {
    const product = state.slices.products.offers[request.taskId];
    const business = state.slices.products.commercialContracts?.[request.taskId];
    const assurance = state.slices.products.assuranceContracts?.[request.taskId];
    const batch = state.slices.products.batchJobs?.[request.taskId];
    const canary = request.id.startsWith('canary-serve:') ? state.slices.products.canaryReleases?.[request.id.slice('canary-serve:'.length)] : undefined;
    const target = product?.companyId === companyId && (request.id === `serve:${product.id}`
      || canary?.companyId === companyId && canary.productId === product.id) ? publicTarget(product.id)
      : business?.companyId === companyId && ['business-serve:', 'business-support:', 'business-delivery:'].some(prefix => request.id === prefix + business.id) ? businessTarget(business.id)
        : assurance?.companyId === companyId && ['assurance-serve:', 'assurance-support:', 'assurance-onboard:'].some(prefix => request.id === prefix + assurance.id) ? assuranceTarget(assurance.id)
        : batch?.companyId === companyId && request.id === `batch-serve:${batch.id}` ? batchTarget(batch.id)
        : request.taskId.startsWith('agent:') && request.id === `${request.taskId}:work` ? agentTarget()
          : add({ id: `internal:${request.category}`, kind: 'internal', sourceId: request.category, category: request.category, name: categoryNames[request.category] });
    target.requestIds.push(request.id);
  }
  for (const fact of facts.filter(item => item.kind === 'receipt' && item.category === 'revenue')) {
    const productContract = state.slices.products.contracts[fact.sourceId];
    const business = state.slices.products.commercialContracts?.[fact.sourceId];
    const assurance = state.slices.products.assuranceContracts?.[fact.sourceId];
    const batch = state.slices.products.batchJobs?.[fact.sourceId];
    const target = productContract?.companyId === companyId ? publicTarget(productContract.productId)
      : business?.companyId === companyId ? businessTarget(business.id)
        : assurance?.companyId === companyId ? assuranceTarget(assurance.id)
        : batch?.companyId === companyId ? batchTarget(batch.id)
        : fact.id.startsWith('invoice:agent:') ? agentTarget()
          : add({ id: `other:${companyId}`, kind: 'other-revenue', sourceId: companyId, name: 'Other earned revenue' });
    target.revenueFactIds.push(fact.id);
  }
  return [...targets.values()].map(target => ({ ...target, requestIds: target.requestIds.sort(), revenueFactIds: target.revenueFactIds.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Must run in plan, after company settlement. It only records evidence, never money facts. */
export function recordComputeCosts(state: Readonly<GameState>, context: ModuleContext, compute: ComputeSlice = state.slices.compute): DomainResult {
  if (context.phase !== 'plan') throw new Error('Compute cost reports must be recorded after settlement.');
  const eligible = Object.keys(compute.fleets).filter(companyId => computeCostAvailability(state, companyId).available);
  if (!eligible.length) return compute === state.slices.compute ? {} : { updates: { compute } };
  const next: ComputeSlice & Wave8ComputeCostFields = structuredClone(compute);
  next.costReports ??= {};
  for (const companyId of eligible) {
    const requests = context.resources.requests.filter(request => request.companyId === companyId), requestIds = new Set(requests.map(request => request.id));
    const resources = structuredClone({ requests,
      computeGrants: context.resources.computeGrants.filter(grant => requestIds.has(grant.requestId)),
      staffGrants: context.resources.staffGrants.filter(grant => requestIds.has(grant.requestId)) });
    const ledgerFacts = context.facts.filter(fact => fact.companyId === companyId && fact.week === context.week)
      .map(fact => structuredClone(fact)).sort((a, b) => a.id.localeCompare(b.id));
    for (const fact of ledgerFacts) if (!Object.hasOwn(state.slices.company.postedFacts, fact.id)) throw new Error('Compute accounting encountered an unsettled company fact.');
    const pools = getComputePools(state, companyId, context.content, context.resources.staffGrants).map(pool => structuredClone(pool)).sort((a, b) => a.id.localeCompare(b.id));
    const byPool = new Map(pools.map(pool => [pool.id, pool]));
    const byRequest = new Map(resources.requests.map(request => [request.id, request]));
    const rawVariableNumerator = resources.computeGrants.reduce((total, grant) => {
      const pool = byPool.get(grant.poolId);
      return total + (pool?.ownership === 'owned' ? BigInt(grant.physicalCUw) * BigInt(getPoolWorkCostRate(pool, byRequest.get(grant.requestId)!)) : BigInt(0));
    }, BigInt(0));
    const variableCents = ledgerFacts.find(fact => fact.id === `${companyId}:owned-variable:${context.week}`)?.amountCents ?? 0;
    const variableCostCarryOut = compute.fleets[companyId].variableCostCarry;
    const variableCostCarryIn = Number(BigInt(variableCents) * BigInt(U) + BigInt(variableCostCarryOut) - rawVariableNumerator);
    checkedInteger(variableCostCarryIn, 'Recorded owned-cost carry');
    if (variableCostCarryIn >= U) throw new Error('Recorded owned-cost carry exceeds a fractional cent.');
    const report = calculateComputeCostReport({ protocol: RULES.protocol, id: `compute-cost:${companyId}:${context.week}`, companyId, week: context.week,
      rolloutId: computeCostAvailability(state, companyId).rollout!.id, cloudRentCentsPerCUWeek: context.content.opening.rentCentsPerCUWeek,
      pools, resources, ledgerFacts, variableCostCarryIn, variableCostCarryOut, targets: targetsFor(state, companyId, resources.requests, ledgerFacts) });
    const previous = next.costReports[companyId] ?? [], existing = previous.find(item => item.week === context.week);
    if (existing && canonicalStateHash(existing) !== canonicalStateHash(report)) throw new Error('A settled compute cost report cannot be rewritten.');
    next.costReports[companyId] = existing ? previous : [...previous, report].sort((a, b) => a.week - b.week).slice(-RULES.historyWeeks);
  }
  return { updates: { compute: next } };
}

export function getComputeCostView(state: Readonly<GameState>, companyId = state.playerCompanyId) {
  const reports = ((state.slices.compute as ComputeSlice & Wave8ComputeCostFields).costReports?.[companyId] ?? []).slice().sort((a, b) => b.week - a.week);
  return { ...computeCostAvailability(state, companyId), reports, latest: reports[0] ?? null };
}
