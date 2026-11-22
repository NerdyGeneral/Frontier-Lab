import { validatedFacilityRate } from '../modules/facility-tariffs';
import { CANARY_RULES as RULES } from '../content/wave27-canary';
import { SEGMENT_BY_ID } from '../content/wave2-market';
import type { GameContent, GameState, WeeklyUsage } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { CanaryRelease, CanaryUsageReceipt } from '../contracts/wave27-canary';
import { addCanaryOutcomes, canaryFulfillment, canaryRequestId, observedCanaryOutcomes, splitExecutedRequests } from '../modules/canary-traffic';
import { getRackHardware } from '../modules/compute-pools';
import { requestMeter, segmentForProduct } from '../modules/product-models';
import { meteredBill } from '../modules/products';
import { assessCanary, automaticCanaryDecision, canaryConfigurationFingerprint, canaryEvidenceKey } from '../modules/release-canary';
import { evaluatedReleaseIdentityReason } from '../modules/release-identity';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, name: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), name + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'Invalid canary identity.'); }
function bps(value: number): void { checkedInteger(value); check(value <= 10000, 'Canary rate exceeds 100%.'); }

function assertCohort(state: GameState, canary: CanaryRelease, receipt: CanaryUsageReceipt, arm: 'incumbent' | 'candidate', content: GameContent): void {
  const row = receipt[arm]; record(row, 'Canary cohort');
  const modelId = arm === 'candidate' ? canary.candidateModelId : canary.sourceModelId, model = state.slices.models.versions[modelId], meter = requestMeter(model, canary.features);
  check(row.modelId === modelId && row.requestId === (arm === 'candidate' ? canaryRequestId(canary.id) : 'serve:' + canary.productId), 'Canary cohort changed its model or shared resource request.');
  for (const value of [row.requestedRequests, row.executedRequests, row.requestedWorkCUw, row.effectiveWorkCUw, row.physicalWorkCUw,
    row.requiredMemoryMU, row.grantedMemoryMU, row.multiplierBps, row.rateCentsPerCUw, row.attributedComputeCents, row.ownedVariableCostCents,
    row.inputTokens, row.outputTokens, row.internalTokens]) checkedInteger(value);
  for (const value of [row.fulfillmentBps, row.errorBps, row.confidentErrorBps, row.falseRefusalBps]) bps(value);
  check(row.requestedWorkCUw === row.requestedRequests * meter.work && row.effectiveWorkCUw <= row.requestedWorkCUw
    && row.executedRequests === Math.floor(row.effectiveWorkCUw / meter.work), 'Canary cohort invented completed requests or normalized work.');
  check(row.fulfillmentBps === (row.requestedWorkCUw ? mulDiv(row.effectiveWorkCUw, 10000, row.requestedWorkCUw) : 10000), 'Canary cohort fulfillment is not its actual work.');
  const expectedMemory = arm === 'incumbent' ? model.residentMU + (receipt.paidAccounts + receipt.trialAccounts) * meter.sessionMemory
    : row.requestedRequests ? model.residentMU + Math.min(receipt.paidAccounts, row.requestedRequests) * meter.sessionMemory : 0;
  check(row.requiredMemoryMU === expectedMemory, 'Canary cohort removed its separate connected model/session workspace.');
  if (row.effectiveWorkCUw) check(row.grantedMemoryMU === row.requiredMemoryMU && row.physicalWorkCUw > 0, 'Executed canary traffic has no full connected workspace or physical grant.');
  const segments = segmentForProduct(canary.productKind);
  check(Array.isArray(row.segments) && row.segments.length === segments.length && row.segments.every((item, index) => item.segmentId === segments[index].id), 'Canary segments changed or were duplicated.');
  const executed = splitExecutedRequests(row.segments.map(item => item.requestedRequests), row.executedRequests);
  for (const [index, segment] of row.segments.entries()) {
    for (const value of [segment.accounts, segment.requestedRequests, segment.executedRequests]) checkedInteger(value);
    check(segment.accounts <= SEGMENT_BY_ID[segment.segmentId].population && segment.executedRequests === executed[index], 'Canary segment allocation exceeds its real request population.');
    const expected = observedCanaryOutcomes(model, canary.features, segment.segmentId, segment.executedRequests, canary.evidenceKey);
    check(segment.technicalErrorBps === expected.technicalErrorBps && same(segment.outcomes, expected.outcomes), 'Canary behavior observations changed their exact model or deterministic paid-request evidence.');
  }
  check(row.requestedRequests === row.segments.reduce((sum, item) => checkedAdd(sum, item.requestedRequests), 0)
    && row.segments.reduce((sum, item) => checkedAdd(sum, item.accounts), 0) === receipt.paidAccounts
    && same(row.outcomes, addCanaryOutcomes(row.segments.map(item => item.outcomes))), 'Canary cohort totals do not reconcile.');
  const rate = (count: number) => row.executedRequests ? mulDiv(count, 10000, row.executedRequests) : 0;
  check(row.errorBps === rate(row.outcomes.confidentError + row.outcomes.clarification)
    && row.confidentErrorBps === rate(row.outcomes.confidentError) && row.falseRefusalBps === rate(row.outcomes.falseRefusal), 'Canary outcome rates changed.');
  check(row.inputTokens === mulDiv(row.effectiveWorkCUw, meter.inputTokens, meter.work)
    && row.outputTokens === mulDiv(row.effectiveWorkCUw, meter.outputTokens, meter.work)
    && row.internalTokens === mulDiv(row.effectiveWorkCUw, meter.internalTokens, meter.work), 'Canary tokens were not produced by actual cohort work.');
  if (row.hardwareId !== null) {
    id(row.hardwareId); id(row.poolId); check(row.ownership === 'cloud' || row.ownership === 'owned', 'Canary hardware ownership changed.');
    if (row.ownership === 'cloud') check(row.hardwareId === 'general' && row.multiplierBps === 10000 && row.rateCentsPerCUw === validatedFacilityRate(state, row, canary.companyId, content.opening.rentCentsPerCUWeek, receipt.week, receipt.week, { category: 'serving' }, row.poolId), 'Canary cloud work changed its authored tariff.');
    else {
      const rack = Object.values(state.slices.compute.racks).find(item => item.companyId === canary.companyId && item.hardwareId === row.hardwareId);
      const hardware = content.hardware.find(item => item.id === row.hardwareId) ?? (rack ? getRackHardware(state, rack, content) : undefined);
      check(hardware && row.multiplierBps === Math.round(hardware.servingMultiplier * 10000) && row.rateCentsPerCUw === validatedFacilityRate(state, row, canary.companyId, hardware.variableCentsPerCUw, receipt.week, receipt.week, { category: 'serving' }, row.poolId), 'Canary owned work changed its qualified hardware conversion or tariff.');
    }
  } else check(!Object.hasOwn(row, 'facilityTariff') && row.physicalWorkCUw === 0 && row.effectiveWorkCUw === 0 && row.ownership === null && row.multiplierBps === 0 && row.rateCentsPerCUw === 0, 'Canary work has no hardware provenance.');
  check(row.attributedComputeCents === mulDiv(row.physicalWorkCUw, row.rateCentsPerCUw, U)
    && row.ownedVariableCostCents === (row.ownership === 'owned' ? row.attributedComputeCents : 0), 'Canary GPU tariff attribution was changed or billed twice.');
}

export function assertCanaryReceipt(state: GameState, canary: CanaryRelease, receipt: CanaryUsageReceipt, content: GameContent): void {
  record(receipt, 'Canary observation');
  check(receipt.protocol === RULES.protocol && receipt.canaryId === canary.id && receipt.evidenceKey === canary.evidenceKey && receipt.shareBps === canary.shareBps, 'Canary observation changed its frozen traffic identity.');
  for (const value of [receipt.week, receipt.eligibleRequests, receipt.candidateBudgetBeforeCUw, receipt.trialRequestedWorkCUw, receipt.trialExecutedWorkCUw,
    receipt.trialPhysicalWorkCUw, receipt.sourceRequestedWorkCUw, receipt.sourceEffectiveWorkCUw, receipt.sourcePhysicalWorkCUw,
    receipt.paidAccounts, receipt.trialAccounts, receipt.grossBillCents, receipt.creditsCents, receipt.billedCents, receipt.billCarryIn, receipt.billCarryOut]) checkedInteger(value);
  check(receipt.week >= canary.availableWeek && receipt.week <= state.week && receipt.candidateBudgetBeforeCUw <= canary.budgetCUw,
    'Canary observation preceded its available paid release or changed its allowance.');
  assertCohort(state, canary, receipt, 'incumbent', content); assertCohort(state, canary, receipt, 'candidate', content);
  const source = receipt.incumbent, candidate = receipt.candidate;
  const sourceMeter = requestMeter(state.slices.models.versions[canary.sourceModelId], canary.features), candidateMeter = requestMeter(state.slices.models.versions[canary.candidateModelId], canary.features);
  check(receipt.eligibleRequests === source.requestedRequests + candidate.requestedRequests
    && candidate.requestedRequests <= Math.floor(receipt.eligibleRequests * canary.shareBps / 10000), 'Canary traffic overlapped the incumbent or exceeded its permitted share.');
  let budget = Math.floor(receipt.candidateBudgetBeforeCUw / candidateMeter.work);
  for (const [index, row] of source.segments.entries()) {
    const other = candidate.segments[index], total = row.accounts * Math.min(SEGMENT_BY_ID[row.segmentId].exchanges, canary.allowance);
    const selected = Math.min(Math.floor(total * canary.shareBps / 10000), budget); budget -= selected;
    check(row.accounts === other.accounts && row.requestedRequests + other.requestedRequests === total && other.requestedRequests === selected,
      'Canary assignment changed its deterministic disjoint request cohort or budget cap.');
  }
  check(receipt.sourceRequestedWorkCUw === source.requestedWorkCUw + receipt.trialRequestedWorkCUw
    && receipt.sourceEffectiveWorkCUw === source.effectiveWorkCUw + receipt.trialExecutedWorkCUw
    && receipt.sourcePhysicalWorkCUw === source.physicalWorkCUw + receipt.trialPhysicalWorkCUw
    && source.effectiveWorkCUw === Math.min(receipt.sourceEffectiveWorkCUw, source.requestedWorkCUw)
    && receipt.trialExecutedWorkCUw <= receipt.trialRequestedWorkCUw
    && candidate.effectiveWorkCUw <= receipt.candidateBudgetBeforeCUw, 'Canary source/trial work or candidate allowance does not reconcile.');
  check(source.physicalWorkCUw === (receipt.sourceEffectiveWorkCUw ? mulDiv(receipt.sourcePhysicalWorkCUw, source.effectiveWorkCUw, receipt.sourceEffectiveWorkCUw) : 0), 'Canary source paid/trial physical attribution changed.');
  if (receipt.sourcePhysicalWorkCUw) check(receipt.sourceEffectiveWorkCUw === Math.min(receipt.sourceRequestedWorkCUw, mulDiv(receipt.sourcePhysicalWorkCUw, source.multiplierBps, 10000)), 'Incumbent work does not match physical hardware conversion.');
  if (candidate.physicalWorkCUw) check(candidate.effectiveWorkCUw === Math.min(candidate.requestedWorkCUw, mulDiv(candidate.physicalWorkCUw, candidate.multiplierBps, 10000)), 'Candidate work does not match physical hardware conversion.');
  check(Array.isArray(receipt.trialCompletedIds) && new Set(receipt.trialCompletedIds).size === receipt.trialCompletedIds.length, 'Canary trial completions are duplicated.');
  receipt.trialCompletedIds.forEach(id);
  const fulfillment = canaryFulfillment(receipt, sourceMeter.work, candidateMeter.work);
  const tokens = { input: source.inputTokens + candidate.inputTokens, output: source.outputTokens + candidate.outputTokens, internal: source.internalTokens + candidate.internalTokens };
  if (canary.productKind === 'developer-api') {
    const bill = meteredBill(tokens.input, tokens.output, tokens.internal, mulDiv(canary.priceCents, 5, 3), mulDiv(canary.priceCents, 25, 3), receipt.billCarryIn);
    check(receipt.billCarryIn < 1_000_000 && receipt.billCarryOut === bill.remainder && receipt.grossBillCents === bill.cents
      && receipt.creditsCents === 0 && receipt.billedCents === bill.cents, 'Canary API cohorts did not share one exact token-billing carry.');
  } else check(receipt.billCarryIn === 0 && receipt.billCarryOut === 0 && receipt.grossBillCents === receipt.paidAccounts * canary.priceCents
    && receipt.creditsCents === mulDiv(receipt.grossBillCents, 10000 - fulfillment, 10000, 'nearest')
    && receipt.billedCents === receipt.grossBillCents - receipt.creditsCents, 'Canary subscription was duplicated or its request-based service credit changed.');
  const retained = state.slices.compute.costReports?.[canary.companyId]?.find(item => item.week === receipt.week);
  for (const arm of ['incumbent', 'candidate'] as const) {
    const row = receipt[arm], requested = arm === 'incumbent' ? receipt.sourceRequestedWorkCUw : row.requestedWorkCUw;
    const effective = arm === 'incumbent' ? receipt.sourceEffectiveWorkCUw : row.effectiveWorkCUw, physical = arm === 'incumbent' ? receipt.sourcePhysicalWorkCUw : row.physicalWorkCUw;
    if (receipt.week === state.week && (arm === 'incumbent' || requested)) {
      const grant = state.slices.compute.fleets[canary.companyId].lastGrants.find(item => item.requestId === row.requestId);
      check(grant && grant.requestedWork === requested && grant.grantedWork === effective, 'Canary work differs from the shared allocator’s actual grant.');
    }
    if (retained && (arm === 'incumbent' || requested)) {
      const request = retained.resources.requests.find(item => item.id === row.requestId), grant = retained.resources.computeGrants.find(item => item.requestId === row.requestId);
      check(request?.taskId === canary.productId && request.category === 'serving' && request.normalizedWorkCUw === requested
        && request.memoryMU === row.requiredMemoryMU && grant?.hardwareEffectiveCUw === effective && grant.physicalCUw === physical
        && grant.memoryMU === row.grantedMemoryMU && grant.poolId === row.poolId && !grant.sharedMemoryMU, 'Canary traffic changed retained serving, memory or physical grant evidence.');
    }
  }
}

/** Replacement for the single-model usage checks only. The ordinary invoice
 * validator continues afterwards and remains the sole billing writer. */
export function assertCanaryUsage(state: GameState, usage: WeeklyUsage, content: GameContent): void {
  const receipt = usage.canary; check(receipt, 'Canary usage receipt is missing.');
  const canary = state.slices.products.canaryReleases?.[receipt.canaryId]; check(canary, 'Canary usage has no paid release.');
  assertCanaryReceipt(state, canary, receipt, content);
  const source = receipt.incumbent, candidate = receipt.candidate;
  const sourceMeter = requestMeter(state.slices.models.versions[canary.sourceModelId], canary.features), candidateMeter = requestMeter(state.slices.models.versions[canary.candidateModelId], canary.features);
  const samples = source.executedRequests + candidate.executedRequests, outcomes = addCanaryOutcomes([source.outcomes, candidate.outcomes]);
  const rate = (count: number) => samples ? mulDiv(count, 10000, samples) : 0;
  check(usage.productId === canary.productId && usage.week === receipt.week && usage.paidAccounts === receipt.paidAccounts && usage.trialAccounts === receipt.trialAccounts
    && usage.paidRequestedWork === source.requestedWorkCUw + candidate.requestedWorkCUw && usage.paidExecutedWork === source.effectiveWorkCUw + candidate.effectiveWorkCUw
    && usage.trialRequestedWork === receipt.trialRequestedWorkCUw && usage.trialExecutedWork === receipt.trialExecutedWorkCUw
    && usage.requestedWork === usage.paidRequestedWork + usage.trialRequestedWork && usage.executedWork === usage.paidExecutedWork + usage.trialExecutedWork
    && usage.exchanges === samples + Math.floor(receipt.trialExecutedWorkCUw / sourceMeter.work)
    && usage.fulfillmentBps === canaryFulfillment(receipt, sourceMeter.work, candidateMeter.work), 'Combined canary usage lost or duplicated requests, work or fulfillment.');
  check(usage.errorBps === rate(outcomes.confidentError + outcomes.clarification)
    && same(usage.behavior, { confidentErrorBps: rate(outcomes.confidentError), falseRefusalBps: rate(outcomes.falseRefusal) })
    && usage.consumerSessions === undefined && usage.evidence === undefined && usage.guardrail === undefined, 'Canary behavior claimed unexecuted or unsupported protected traffic.');
  check(usage.grossBillCents === receipt.grossBillCents && usage.creditsCents === receipt.creditsCents && usage.billedCents === receipt.billedCents
    && same(usage.trialCompletedIds, receipt.trialCompletedIds), 'The canary observation and unified bill disagree.');
  const expectedSegments = source.segments.map((row, index) => {
    const other = candidate.segments[index], count = row.executedRequests + other.executedRequests;
    const errors = row.outcomes.confidentError + row.outcomes.clarification + other.outcomes.confidentError + other.outcomes.clarification;
    return { segmentId: row.segmentId, accounts: row.accounts, requestedExchanges: row.requestedRequests + other.requestedRequests,
      requestedWork: row.requestedRequests * sourceMeter.work + other.requestedRequests * candidateMeter.work, errorBps: count ? mulDiv(errors, 10000, count) : 0 };
  });
  check(same(usage.segments, expectedSegments), 'Combined canary segment outcomes changed.');
  const expectedTokens = { inputTokens: source.inputTokens + candidate.inputTokens, outputTokens: source.outputTokens + candidate.outputTokens,
    internalTokens: source.internalTokens + candidate.internalTokens, inputPriceCentsPerMillion: mulDiv(canary.priceCents, 5, 3), outputPriceCentsPerMillion: mulDiv(canary.priceCents, 25, 3),
    billCarryIn: receipt.billCarryIn, billCarryOut: receipt.billCarryOut, physicalWork: receipt.sourcePhysicalWorkCUw + candidate.physicalWorkCUw,
    ownedVariableCostCents: source.ownedVariableCostCents + candidate.ownedVariableCostCents + (source.ownership === 'owned' ? mulDiv(receipt.trialPhysicalWorkCUw, source.rateCentsPerCUw, U) : 0) };
  check(same(usage.tokens, expectedTokens), 'Combined canary token or compute attribution changed.');
  if (usage.week === state.week && canary.productKind === 'developer-api') check(state.slices.products.contracts[canary.configuration.contractId].tokenBillRemainder === receipt.billCarryOut, 'Canary settlement lost its single contract billing remainder.');
  check(canary.observations.some(item => item.week === receipt.week && same(item, receipt)), 'Settled canary usage is absent from its immutable observation history.');
}

export function assertWave27CanaryState(state: GameState, content: GameContent): void {
  const saved = state.slices.products.canaryReleases; if (saved === undefined) return;
  record(saved, 'Canary releases'); const entries = Object.entries(saved); check(entries.length <= RULES.maximumHistory, 'Canary history exceeds its bound.');
  const releases = new Set<string>(), activeProducts = new Set<string>();
  for (const [key, canary] of entries) {
    record(canary, 'Canary release'); id(key); id(canary.companyId); id(canary.productId); id(canary.releaseId); id(canary.startCommandId);
    check(key === canary.id && key === 'canary:' + canary.startCommandId && !releases.has(canary.releaseId), 'Canary identity or prepared-release attempt was duplicated.'); releases.add(canary.releaseId);
    const command = state.commandReceipts[canary.startCommandId], product = state.slices.products.offers[canary.productId], prepared = state.slices.products.preparedReleases?.[canary.releaseId];
    check(command?.status === 'accepted' && command.week === canary.startedWeek && product?.companyId === canary.companyId
      && prepared?.companyId === canary.companyId && prepared.productId === canary.productId && prepared.availableWeek !== null && prepared.availableWeek <= canary.startedWeek
      && state.slices.company.postedFacts['canary-setup:' + canary.startCommandId], 'Canary lacks paid setup or its available prepared release.');
    check(Object.values(state.slices.research.projects).some(item => item.companyId === canary.companyId && item.researchId === RULES.requiredResearch
      && item.status === 'complete' && item.availableWeek !== undefined && item.availableWeek <= canary.startedWeek), 'Canary preceded paid Release telemetry research.');
    for (const value of [canary.startedWeek, canary.availableWeek, canary.priceCents, canary.allowance, canary.sampleFloor, canary.budgetCUw, canary.consumedWorkCUw]) checkedInteger(value);
    check(canary.startedWeek <= state.week && canary.availableWeek === canary.startedWeek + 1 && (RULES.shares as readonly number[]).includes(canary.shareBps)
      && canary.sampleFloor >= RULES.minimumSample && canary.sampleFloor <= RULES.maximumSample && canary.budgetCUw > 0 && canary.budgetCUw <= RULES.maximumBudgetCUw
      && canary.consumedWorkCUw <= canary.budgetCUw && ['scheduled', 'collecting', 'qualified', 'stopped', 'promoted'].includes(canary.status), 'Canary terms, timing, budget or status changed.');
    check(canary.sourceDeploymentId === prepared.sourceDeployment.id && canary.sourceModelId === prepared.sourceModelId && canary.candidateModelId === prepared.candidateModelId
      && canary.sourceModelId !== canary.candidateModelId && canary.source.modelId === canary.sourceModelId && canary.candidate.modelId === canary.candidateModelId
      && !evaluatedReleaseIdentityReason(state, canary.source, content, canary.startedWeek) && !evaluatedReleaseIdentityReason(state, canary.candidate, content, canary.startedWeek)
      && canary.source.rights.hosted && canary.candidate.rights.hosted, 'Canary changed its evaluated model/runtime identity or release rights.');
    check(state.slices.models.versions[canary.sourceModelId].companyId === canary.companyId && state.slices.models.versions[canary.candidateModelId].companyId === canary.companyId,
      'Canary exposes a foreign model.');
    check(canonicalStateHash(canary.configuration) === prepared.configurationFingerprint && same(canary.features, canary.configuration.features)
      && canary.productKind === canary.configuration.productKind && canary.productKind === product.kind && canary.allowance === canary.configuration.allowance
      && canary.configurationFingerprint === canonicalStateHash({ configuration: canary.configuration, priceCents: canary.priceCents, sessionProfile: null })
      && canary.evidenceKey === canaryEvidenceKey(state, canary.companyId, canary.productId), 'Canary configuration or deterministic cohort key changed.');
    check(canary.configuration.retrieval === null && canary.configuration.efficiency.every(item => !item.enabled)
      && (!canary.configuration.guardrail || !canary.configuration.guardrail.enabled && !canary.configuration.guardrail.pendingInstallationId), 'Canary silently adopted an unsupported exact-bound service.');
    check(canary.budgetCUw >= canary.sampleFloor * requestMeter(state.slices.models.versions[canary.candidateModelId], canary.features).work, 'Canary budget never funded its declared sample floor.');
    check(Array.isArray(canary.observations) && canary.observations.length <= RULES.maximumObservations, 'Canary observations exceed their retained bound.');
    let consumed = 0, lastWeek = canary.availableWeek - 1;
    for (const [index, receipt] of canary.observations.entries()) {
      check(receipt.week === lastWeek + 1 && receipt.candidateBudgetBeforeCUw === canary.budgetCUw - consumed, 'Canary observation was omitted, repeated or reset its work allowance.');
      assertCanaryReceipt(state, canary, receipt, content); consumed = checkedAdd(consumed, receipt.candidate.effectiveWorkCUw); lastWeek = receipt.week;
      if (index < canary.observations.length - 1) check(automaticCanaryDecision(state, { ...canary, consumedWorkCUw: consumed,
        observations: canary.observations.slice(0, index + 1) }).status === 'collecting', 'Canary routed another cohort after a required stop or qualification.');
    }
    check(canary.consumedWorkCUw === consumed, 'Canary cumulative work changed.');
    const assessment = assessCanary(canary), last = canary.observations.at(-1), decision = automaticCanaryDecision(state, canary);
    if (canary.status === 'scheduled' || canary.status === 'collecting') {
      check(!activeProducts.has(canary.productId), 'Two canaries route the same public product.'); activeProducts.add(canary.productId);
      check(product.deploymentId === canary.sourceDeploymentId && canaryConfigurationFingerprint(state, product.id) === canary.configurationFingerprint
        && prepared.status === 'ready' && canary.qualifiedWeek === null && canary.stoppedWeek === null && canary.stopCode === null && canary.incident === null,
        'An active canary changed the incumbent or acquired an unearned result.');
      check(canary.status === 'scheduled' ? canary.availableWeek > state.week && !canary.observations.length : canary.availableWeek <= state.week,
        'Canary ran before its public availability boundary.');
      if (canary.status === 'collecting') check(decision.status === 'collecting' && lastWeek === state.week,
        'A stopped or qualified canary was resurrected, or an observation week was omitted.');
    }
    if (canary.status === 'qualified' || canary.status === 'promoted') {
      check(last && canary.qualifiedWeek === last.week && decision.status === 'qualified' && assessment.sufficient && canary.stoppedWeek === null && canary.stopCode === null && canary.incident === null
        && assessment.incumbentUsefulBps - assessment.candidateUsefulBps < RULES.regressionBps
        && assessment.candidateConfidentErrorBps - assessment.incumbentConfidentErrorBps < RULES.regressionBps
        && assessment.candidateFalseRefusalBps - assessment.incumbentFalseRefusalBps < RULES.regressionBps
        && (assessment.costRatioBps === null || assessment.costRatioBps <= RULES.maximumCostRatioBps), 'Canary qualified without sufficient nonregressing paid evidence.');
      check(last.candidate.fulfillmentBps >= RULES.minimumFulfillmentBps
        && (!last.sourceRequestedWorkCUw || mulDiv(last.sourceEffectiveWorkCUw, 10000, last.sourceRequestedWorkCUw) >= RULES.minimumFulfillmentBps), 'A capacity failure was promoted as qualified evidence.');
    }
    if (canary.status === 'promoted') check(prepared.status === 'released' && canary.promotedWeek === prepared.releasedWeek && canary.promotedWeek! > canary.qualifiedWeek!, 'Canary promotion bypassed the existing paid handover boundary.');
    else check(canary.promotedWeek === null, 'Canary acquired an uncommitted full rollout.');
    if (canary.status === 'stopped') {
      checkedInteger(canary.stoppedWeek!); const incident = canary.incident; record(incident, 'Canary incident');
      check(canary.qualifiedWeek === null && canary.stoppedWeek! >= canary.startedWeek && canary.stoppedWeek! <= state.week
        && lastWeek <= canary.stoppedWeek! && ['manual', 'regression', 'severe-incident', 'headroom', 'budget', 'insufficient-sample', 'configuration', 'arrears'].includes(canary.stopCode!), 'Canary stop changed its reason or timeline.');
      check(incident!.id === 'canary-incident:' + canary.id && incident!.week === canary.stoppedWeek && incident!.code === canary.stopCode
        && incident!.productId === canary.productId && incident!.modelId === canary.candidateModelId && incident!.deploymentId === canary.sourceDeploymentId
        && incident!.candidateSamples === assessment.candidateSamples && incident!.incumbentSamples === assessment.incumbentSamples && incident!.sampleFloor === canary.sampleFloor
        && incident!.message === canary.lastMessage && [canary.stoppedWeek, canary.stoppedWeek! + 1].includes(incident!.restoredRoutingWeek), 'Canary incident lost its scope, revision, evidence or routing restoration boundary.');
      if (canary.stopCode === 'manual') check(canary.stopCommandId && state.commandReceipts[canary.stopCommandId]?.status === 'accepted'
        && state.commandReceipts[canary.stopCommandId].week === canary.stoppedWeek && incident!.restoredRoutingWeek === canary.stoppedWeek, 'Manual stop has no accepted boundary command.');
      else check(canary.stopCommandId === null, 'Automatic stop invented an operator command.');
      if (!['manual', 'configuration', 'arrears'].includes(canary.stopCode!)) check(last?.week === canary.stoppedWeek && decision.status === 'stopped'
        && decision.code === canary.stopCode && decision.severity === incident!.severity && decision.message === incident!.message
        && incident!.restoredRoutingWeek === canary.stoppedWeek! + 1, 'Canary incident did not follow its actual automatic stop rule.');
    } else check(canary.stopCommandId === null, 'An unfinished or qualified canary contains a stop command.');
  }
}
