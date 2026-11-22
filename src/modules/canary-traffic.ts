import { facilityTariffBinding } from './facility-tariffs';
import { CANARY_RULES as RULES } from '../content/wave27-canary';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import type { GameContent, GameState, ModelVersion, ModuleContext, ProductOffer, ResourceGrant, WeeklyUsage, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { CanaryCohortReceipt, CanaryOutcomes, CanaryRelease, CanarySegmentReceipt, CanaryUsageReceipt } from '../contracts/wave27-canary';
import { hashText } from '../core/canonical';
import { checkedAdd, mulDiv } from '../core/math';
import { getComputePools, getPoolWorkCostRate, getPoolMultiplierBps } from './compute-pools';
import { modelExecutionHints } from './model-runtime';
import { behaviorMeter, executionErrorBps, requestMeter } from './product-models';
import { meteredBill } from './products';
import type { productDemand } from './products';

export type CanaryDemand = ReturnType<typeof productDemand>;
export interface CanaryTrafficPlan {
  canary: CanaryRelease; source: ModelVersion; candidate: ModelVersion;
  sourceMeter: ReturnType<typeof requestMeter>; candidateMeter: ReturnType<typeof requestMeter>;
  segments: { segmentId: CanarySegmentReceipt['segmentId']; accounts: number; requestedRequests: number; candidateRequests: number }[];
  sourcePaidWork: number; candidateWork: number; sourceMemoryMU: number; candidateMemoryMU: number;
  eligibleRequests: number; candidateBudgetBeforeCUw: number; requests: WorkRequest[];
}
export const canaryRequestId = (id: string) => 'canary-serve:' + id;
export function canaryForTraffic(state: Readonly<GameState>, productId: string, week: number): CanaryRelease | undefined {
  return Object.values(state.slices.products.canaryReleases ?? {}).find(item => item.productId === productId
    && (item.status === 'collecting' || item.status === 'scheduled') && item.availableWeek <= week);
}

/** Every complete block of 10/20/100 paid requests contributes exactly one
 * candidate request. Remainders and all trials stay with the incumbent. */
export function getCanaryTrafficPlan(state: Readonly<GameState>, product: ProductOffer, demand: CanaryDemand,
  content: GameContent, week: number): CanaryTrafficPlan | null {
  const canary = canaryForTraffic(state, product.id, week);
  if (!canary || product.status !== 'active' || state.slices.company.companies[product.companyId].arrearsCents) return null;
  const source = state.slices.models.versions[canary.sourceModelId], candidate = state.slices.models.versions[canary.candidateModelId];
  const sourceMeter = requestMeter(source, canary.features), candidateMeter = requestMeter(candidate, canary.features);
  const candidateBudgetBeforeCUw = Math.max(0, canary.budgetCUw - canary.consumedWorkCUw);
  let budgetRequests = Math.floor(candidateBudgetBeforeCUw / candidateMeter.work);
  const segments = demand.segments.map(row => {
    const candidateRequests = Math.min(Math.floor(row.requestedExchanges * canary.shareBps / 10000), budgetRequests);
    budgetRequests -= candidateRequests;
    return { segmentId: row.segmentId, accounts: row.accounts, requestedRequests: row.requestedExchanges, candidateRequests };
  });
  const eligibleRequests = segments.reduce((sum, row) => checkedAdd(sum, row.requestedRequests), 0);
  const candidateRequests = segments.reduce((sum, row) => checkedAdd(sum, row.candidateRequests), 0);
  const sourcePaidWork = (eligibleRequests - candidateRequests) * sourceMeter.work, candidateWork = candidateRequests * candidateMeter.work;
  const sourceMemoryMU = source.residentMU + (demand.accounts + demand.trialAccounts) * sourceMeter.sessionMemory;
  // Both models may serve the same paid account. No unsupported shared-session
  // or shared-adapter memory discount is invented for the experimental arm.
  const candidateMemoryMU = candidateRequests ? candidate.residentMU + Math.min(demand.accounts, candidateRequests) * candidateMeter.sessionMemory : 0;
  const requests: WorkRequest[] = [{ id: 'serve:' + product.id, companyId: product.companyId, taskId: product.id,
    category: 'serving', normalizedWorkCUw: checkedAdd(sourcePaidWork, demand.trialWork), memoryMU: sourceMemoryMU,
    ...modelExecutionHints(source), priority: 0, poolId: 'auto', headroomBps: content.firstSale.servingHeadroomBps }];
  if (candidateRequests) requests.push({ id: canaryRequestId(canary.id), companyId: product.companyId, taskId: product.id,
    category: 'serving', normalizedWorkCUw: candidateWork, memoryMU: candidateMemoryMU, ...modelExecutionHints(candidate),
    priority: RULES.candidatePriority, poolId: 'auto', headroomBps: content.firstSale.servingHeadroomBps });
  return { canary, source, candidate, sourceMeter, candidateMeter, segments, sourcePaidWork, candidateWork,
    sourceMemoryMU, candidateMemoryMU, eligibleRequests, candidateBudgetBeforeCUw, requests };
}
const emptyOutcomes = (): CanaryOutcomes => ({ useful: 0, confidentError: 0, falseRefusal: 0, clarification: 0 });
export function addCanaryOutcomes(rows: readonly CanaryOutcomes[]): CanaryOutcomes {
  const result = emptyOutcomes();
  for (const row of rows) for (const key of Object.keys(result) as (keyof CanaryOutcomes)[]) result[key] = checkedAdd(result[key], row[key]);
  return result;
}

/** Deterministic balanced counts for actual completed requests. The fixed
 * source/product/segment key excludes command IDs, names, weeks and RNG draws. */
export function observedCanaryOutcomes(model: ModelVersion, features: CanaryRelease['features'], segmentId: CanarySegmentReceipt['segmentId'],
  count: number, evidenceKey: string): { technicalErrorBps: number; outcomes: CanaryOutcomes } {
  const technicalErrorBps = executionErrorBps(model, SEGMENT_BY_ID[segmentId], features), behavior = behaviorMeter(model, technicalErrorBps);
  const falseRefusalBps = Math.min(10000 - technicalErrorBps, behavior.falseRefusalBps);
  const usefulBps = 10000 - technicalErrorBps - falseRefusalBps;
  const offset = parseInt(hashText(`${evidenceKey}:${segmentId}:outcome`), 16) % 10000;
  const below = (bps: number) => Number((BigInt(count) * BigInt(bps) + BigInt(offset)) / BigInt(10000));
  const useful = below(usefulBps), falseRefusal = below(usefulBps + falseRefusalBps) - useful;
  const confidentError = below(usefulBps + falseRefusalBps + behavior.confidentErrorBps) - useful - falseRefusal;
  return { technicalErrorBps, outcomes: { useful, falseRefusal, confidentError, clarification: count - useful - falseRefusal - confidentError } };
}

export function splitExecutedRequests(requests: readonly number[], executed: number): number[] {
  const total = requests.reduce((sum, count) => checkedAdd(sum, count), 0);
  if (!total) return requests.map(() => 0);
  const result = requests.map(count => mulDiv(count, executed, total));
  let remaining = executed - result.reduce((sum, count) => sum + count, 0);
  for (let index = 0; remaining && index < result.length; index++) if (result[index] < requests[index]) { result[index]++; remaining--; }
  return result;
}

function cohort(state: Readonly<GameState>, plan: CanaryTrafficPlan, arm: 'incumbent' | 'candidate',
  grant: ResourceGrant | undefined, effective: number, physical: number, ctx: ModuleContext): CanaryCohortReceipt {
  const model = arm === 'candidate' ? plan.candidate : plan.source, meter = arm === 'candidate' ? plan.candidateMeter : plan.sourceMeter;
  const counts = plan.segments.map(row => arm === 'candidate' ? row.candidateRequests : row.requestedRequests - row.candidateRequests);
  const requestedRequests = counts.reduce((sum, value) => sum + value, 0), executedRequests = Math.min(requestedRequests, Math.floor(effective / meter.work));
  const split = splitExecutedRequests(counts, executedRequests);
  const segments = plan.segments.map((row, index) => ({ segmentId: row.segmentId, accounts: row.accounts,
    requestedRequests: counts[index], executedRequests: split[index], ...observedCanaryOutcomes(model, plan.canary.features, row.segmentId, split[index], plan.canary.evidenceKey) }));
  const outcomes = addCanaryOutcomes(segments.map(row => row.outcomes));
  const pool = grant ? getComputePools(state, plan.canary.companyId, ctx.content, ctx.resources.staffGrants).find(item => item.id === grant.poolId) : undefined;
  const rateCentsPerCUw = pool ? pool.ownership === 'cloud' ? ctx.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, { category: 'serving' }) : 0;
  const requestedWorkCUw = requestedRequests * meter.work;
  return { modelId: model.id, requestId: arm === 'candidate' ? canaryRequestId(plan.canary.id) : 'serve:' + plan.canary.productId,
    requestedRequests, executedRequests, requestedWorkCUw, effectiveWorkCUw: effective, physicalWorkCUw: physical,
    requiredMemoryMU: arm === 'candidate' ? plan.candidateMemoryMU : plan.sourceMemoryMU, grantedMemoryMU: grant?.memoryMU ?? 0,
    poolId: grant?.poolId ?? null, hardwareId: pool?.hardwareId ?? null, ownership: pool?.ownership ?? null,
    multiplierBps: pool ? getPoolMultiplierBps(pool, 'serving', false, ctx.content, 'inference') : 0, rateCentsPerCUw, ...(pool ? facilityTariffBinding(pool, { category: 'serving' }) : {}),
    attributedComputeCents: mulDiv(physical, rateCentsPerCUw, U), ownedVariableCostCents: pool?.ownership === 'owned' ? mulDiv(physical, rateCentsPerCUw, U) : 0,
    inputTokens: mulDiv(effective, meter.inputTokens, meter.work), outputTokens: mulDiv(effective, meter.outputTokens, meter.work), internalTokens: mulDiv(effective, meter.internalTokens, meter.work),
    fulfillmentBps: requestedWorkCUw ? mulDiv(effective, 10000, requestedWorkCUw) : 10000,
    errorBps: executedRequests ? mulDiv(outcomes.confidentError + outcomes.clarification, 10000, executedRequests) : 0,
    confidentErrorBps: executedRequests ? mulDiv(outcomes.confidentError, 10000, executedRequests) : 0,
    falseRefusalBps: executedRequests ? mulDiv(outcomes.falseRefusal, 10000, executedRequests) : 0, outcomes, segments };
}

/** Request-based fulfillment remains fair when the models use different CUw
 * per request. Partial completed work follows the ordinary token meter. */
export function canaryFulfillment(receipt: Pick<CanaryUsageReceipt, 'eligibleRequests' | 'incumbent' | 'candidate'>,
  sourceWorkPerRequest: number, candidateWorkPerRequest: number): number {
  if (!receipt.eligibleRequests) return 10000;
  const numerator = (BigInt(receipt.incumbent.effectiveWorkCUw) * BigInt(candidateWorkPerRequest)
    + BigInt(receipt.candidate.effectiveWorkCUw) * BigInt(sourceWorkPerRequest)) * BigInt(10000);
  return Number(numerator / (BigInt(receipt.eligibleRequests) * BigInt(sourceWorkPerRequest) * BigInt(candidateWorkPerRequest)));
}

/** One combined usage record goes through the existing product invoice writer.
 * This function never posts a revenue or compute expense fact. */
export function executeCanaryUsage(state: Readonly<GameState>, product: ProductOffer, demand: CanaryDemand, ctx: ModuleContext): WeeklyUsage | null {
  const plan = getCanaryTrafficPlan(state, product, demand, ctx.content, ctx.week); if (!plan) return null;
  const sourceGrant = ctx.resources.computeGrants.find(item => item.requestId === 'serve:' + product.id);
  const candidateGrant = ctx.resources.computeGrants.find(item => item.requestId === canaryRequestId(plan.canary.id));
  const sourceEffective = sourceGrant?.hardwareEffectiveCUw ?? 0, sourcePhysical = sourceGrant?.physicalCUw ?? 0;
  const sourcePaid = Math.min(sourceEffective, plan.sourcePaidWork), trialExecuted = Math.min(Math.max(0, sourceEffective - sourcePaid), demand.trialWork);
  const paidPhysical = sourceEffective ? mulDiv(sourcePhysical, sourcePaid, sourceEffective) : 0;
  const incumbent = cohort(state, plan, 'incumbent', sourceGrant, sourcePaid, paidPhysical, ctx);
  const candidate = cohort(state, plan, 'candidate', candidateGrant, candidateGrant?.hardwareEffectiveCUw ?? 0, candidateGrant?.physicalCUw ?? 0, ctx);
  let remaining = trialExecuted; const trialCompletedIds: string[] = [];
  for (const trial of demand.trials) { const done = Math.min(remaining, trial.requiredWork - trial.workCompleted); remaining -= done;
    if (trial.workCompleted + done >= trial.requiredWork) trialCompletedIds.push(trial.id); }
  const partial = { eligibleRequests: plan.eligibleRequests, incumbent, candidate };
  const fulfillmentBps = canaryFulfillment(partial, plan.sourceMeter.work, plan.candidateMeter.work);
  const inputTokens = checkedAdd(incumbent.inputTokens, candidate.inputTokens), outputTokens = checkedAdd(incumbent.outputTokens, candidate.outputTokens), internalTokens = checkedAdd(incumbent.internalTokens, candidate.internalTokens);
  const inputPrice = mulDiv(demand.contract.weeklyPriceCents, 5, 3), outputPrice = mulDiv(demand.contract.weeklyPriceCents, 25, 3);
  const billCarryIn = product.kind === 'developer-api' ? demand.contract.tokenBillRemainder ?? 0 : 0;
  const bill = meteredBill(inputTokens, outputTokens, internalTokens, inputPrice, outputPrice, billCarryIn);
  const grossBillCents = product.kind === 'developer-api' ? bill.cents : demand.accounts * demand.contract.weeklyPriceCents;
  const creditsCents = product.kind === 'developer-api' ? 0 : mulDiv(grossBillCents, 10000 - fulfillmentBps, 10000, 'nearest');
  const receipt: CanaryUsageReceipt = { protocol: RULES.protocol, canaryId: plan.canary.id, week: ctx.week, evidenceKey: plan.canary.evidenceKey,
    shareBps: plan.canary.shareBps, eligibleRequests: plan.eligibleRequests, candidateBudgetBeforeCUw: plan.candidateBudgetBeforeCUw, incumbent, candidate,
    trialRequestedWorkCUw: demand.trialWork, trialExecutedWorkCUw: trialExecuted, trialPhysicalWorkCUw: sourcePhysical - paidPhysical,
    sourceRequestedWorkCUw: plan.sourcePaidWork + demand.trialWork, sourceEffectiveWorkCUw: sourceEffective, sourcePhysicalWorkCUw: sourcePhysical,
    trialCompletedIds, paidAccounts: demand.accounts, trialAccounts: demand.trialAccounts, grossBillCents, creditsCents,
    billedCents: grossBillCents - creditsCents, billCarryIn, billCarryOut: product.kind === 'developer-api' ? bill.remainder : 0 };
  const outcomes = addCanaryOutcomes([incumbent.outcomes, candidate.outcomes]), samples = incumbent.executedRequests + candidate.executedRequests;
  const errorBps = samples ? mulDiv(outcomes.confidentError + outcomes.clarification, 10000, samples) : 0;
  const segments = plan.segments.map((row, index) => {
    const source = incumbent.segments[index], other = candidate.segments[index], count = source.executedRequests + other.executedRequests;
    const errors = source.outcomes.confidentError + source.outcomes.clarification + other.outcomes.confidentError + other.outcomes.clarification;
    return { segmentId: row.segmentId, accounts: row.accounts, requestedExchanges: row.requestedRequests,
      requestedWork: source.requestedRequests * plan.sourceMeter.work + other.requestedRequests * plan.candidateMeter.work,
      errorBps: count ? mulDiv(errors, 10000, count) : 0 };
  });
  const trialOwned = incumbent.ownership === 'owned' ? mulDiv(receipt.trialPhysicalWorkCUw, incumbent.rateCentsPerCUw, U) : 0;
  return { canary: receipt, week: ctx.week, productId: product.id, paidAccounts: demand.accounts, trialAccounts: demand.trialAccounts,
    requestedWork: plan.sourcePaidWork + plan.candidateWork + demand.trialWork, executedWork: sourceEffective + candidate.effectiveWorkCUw,
    paidRequestedWork: plan.sourcePaidWork + plan.candidateWork, paidExecutedWork: sourcePaid + candidate.effectiveWorkCUw,
    trialRequestedWork: demand.trialWork, trialExecutedWork: trialExecuted,
    exchanges: samples + Math.floor(trialExecuted / plan.sourceMeter.work), fulfillmentBps, errorBps,
    behavior: { confidentErrorBps: samples ? mulDiv(outcomes.confidentError, 10000, samples) : 0,
      falseRefusalBps: samples ? mulDiv(outcomes.falseRefusal, 10000, samples) : 0 },
    trialCompletedIds, grossBillCents, creditsCents, billedCents: grossBillCents - creditsCents, segments,
    tokens: { inputTokens, outputTokens, internalTokens, inputPriceCentsPerMillion: inputPrice, outputPriceCentsPerMillion: outputPrice,
      billCarryIn, billCarryOut: receipt.billCarryOut, physicalWork: sourcePhysical + candidate.physicalWorkCUw,
      ownedVariableCostCents: incumbent.ownedVariableCostCents + candidate.ownedVariableCostCents + trialOwned } };
}
