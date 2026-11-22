import { emptySessionHistory, SESSION_MEMORY_PER_TOKEN, SESSION_PROFILES, sessionExchanges, sessionInputTokens, sessionQuality } from './consumer-sessions';
import { BATCH_COMMANDS, validateBatchCommand, quoteBatchCommand, applyBatchCommand, commitBatch, batchRequests, advanceBatch, resolveBatch, settleBatch } from './batch-inference';
import { ASSURANCE_COMMANDS, validateAssuranceCommand, quoteAssuranceCommand, applyAssuranceCommand, assuranceCommit, assuranceTermBoundary, assuranceRequests, advanceAssurance, resolveAssurance, settleAssurance } from './assured-api';
import { familyMultiplier, requestMeter, taskScore, executionErrorBps, segmentForProduct, behaviorMeter, eligibleModel } from './product-models';
export { familyMultiplier, requestMeter, taskScore, executionErrorBps, segmentForProduct, behaviorMeter } from './product-models';
import type { DomainModule, DomainResult, GameContent, GameState, ModelVersion, ProductFeatures, ProductKind, ProductOffer, SegmentDefinition, SegmentUsage, WeeklyUsage, WorkRequest, TrialBatch } from '../contracts/types';
import { RESOURCE_SCALE } from '../contracts/types';
import { policyReleaseRejection } from './policy-holdouts';
import { DEFAULT_FEATURES, SEGMENT_BY_ID } from '../content/wave2-market';
import { getCompatibleComputePools, getComputePools, getPoolWorkCostRate } from './compute-pools';
import { checkedAdd, mulDiv } from '../core/math';
import { modelExecutionHints, modelWorkBps, inheritedModelRights } from './model-runtime';
import { PREFIX_CACHE, ROUTING } from '../content/wave4-research';
import { PRODUCT_EFFICIENCY_COMMANDS, activeEfficiency, advanceProductEfficiency, applyProductEfficiency, cacheWarm, commitProductEfficiency, productEfficiencyMemory, productEfficiencyRequests, productRoutingStateMemory, quoteProductEfficiency, resolveProductEfficiency, routedModel, validateProductEfficiency, warmProductCache } from './product-efficiency';
import { COMMERCE_COMMANDS, applyBusinessCommand, businessCommit, businessExecute, businessRequests, businessResolve, businessSettle, businessTermBoundary, commercialCapacityRequests, queuedBusinessCapacityRequests, getProductRetrieval, isCommerceCommand, quoteBusinessCommand, retrievalDocumentBonus, validateBusinessCommand } from './business';
import type { EvidenceCheckUsage } from '../contracts/wave6-evidence';
import type { RuntimeGuardrailUsage } from '../contracts/wave12-guardrails';
import { RUNTIME_GUARDRAIL_COMMANDS, validateRuntimeGuardrail, quoteRuntimeGuardrail, applyRuntimeGuardrail, runtimeGuardrailRequests, advanceRuntimeGuardrails, resolveRuntimeGuardrails, commitRuntimeGuardrails, runtimeGuardrailWorkPerRequest, runtimeGuardrailMemory, measureRuntimeGuardrails, guardrailFalseRefusalBps } from './runtime-guardrails';
import { evidenceWorkPerRequest, measureEvidenceChecks } from './retrieval-evidence';
import { adapterSharingSpec } from './adapter-bank';
import { RELEASE_REHEARSAL_COMMANDS, validateReleaseRehearsalCommand, quoteReleaseRehearsalCommand, applyReleaseRehearsalCommand, releaseRehearsalRequests, advanceReleaseRehearsals, resolveReleaseRehearsals, commitReleaseRehearsals } from './release-rehearsals';
import { PREPARED_RELEASE_COMMANDS, validatePreparedRelease, quotePreparedRelease, applyPreparedRelease, preparedReleaseMutationReason, preparedReleaseRequests, advancePreparedReleases, resolvePreparedReleases, commitPreparedReleases } from './prepared-releases';
import { CANARY_COMMANDS, validateCanaryCommand, quoteCanaryCommand, applyCanaryCommand, canaryMutationReason, commitCanaries, resolveCanaries } from './release-canary';
import { executeCanaryUsage, getCanaryTrafficPlan } from './canary-traffic';
import { PRODUCT_STRATEGY_COMMANDS, applyProductStrategy, quoteProductStrategy, routingSecondaryShareBps, validateProductStrategy } from './product-strategy';
import { hasConnectedCompanyRules } from '../core/connected-company-version';
import { PRODUCT_KIND_LIMIT, PRODUCT_PORTFOLIO_LIMIT, PRODUCT_WORKLOADS } from '../content/product-workloads';
import { activePortfolio, blendWorkloadMeasures, createProductWorkloadReceipt, getProductWorkloadMeasure, isProductWorkloadId, productPortfolioShapeRejection, productRetirementObligationReason, validProductName, workloadErrorBps } from './product-workloads';

export function featureConfig(product: ProductOffer): ProductFeatures { return product.features ?? { ...DEFAULT_FEATURES }; }
export function productWorkloadMeasure(state: Readonly<GameState>, product: ProductOffer) {
  const primary = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  const measured = getProductWorkloadMeasure(primary, product.workload);
  const route = activeEfficiency(state, product.id, 'routing');
  if (!measured || !route?.secondaryModelId || route.secondaryModelId === primary.id) return measured;
  return blendWorkloadMeasures(measured, getProductWorkloadMeasure(state.slices.models.versions[route.secondaryModelId], product.workload)!, routingSecondaryShareBps(product));
}
export function productRequestMeter(state: Readonly<GameState>, product: ProductOffer, model: ModelVersion, retainedInput = 0) {
  const retrieval = getProductRetrieval(state, product.id);
  const measured = (version: ModelVersion) => {
    const plain = requestMeter(version, featureConfig(product));
    const sharedInputTokens = plain.inputTokens + (retrieval?.evidence.extraInputTokens ?? 0);
    const inputTokens = sharedInputTokens + retainedInput;
    const extraInputWork = mulDiv((retrieval?.evidence.extraInputTokens ?? 0) * 200 * familyMultiplier(version), modelWorkBps(version), 10000);
    const historyWork = mulDiv(retainedInput * 200 * familyMultiplier(version), modelWorkBps(version), 10000);
    return { ...plain, inputTokens, work: plain.work + extraInputWork + historyWork + (retrieval?.evidence.lookupWorkCUw ?? 0) * familyMultiplier(version), inputWork: mulDiv(sharedInputTokens * 200 * familyMultiplier(version), modelWorkBps(version), 10000) };
  };
  const primary = measured(model), routing = activeEfficiency(state, product.id, 'routing');
  let work = primary.work, inputWork = primary.inputWork;
  if (routing?.secondaryModelId) {
    const secondary = measured(state.slices.models.versions[routing.secondaryModelId]), share = routingSecondaryShareBps(product);
    work = mulDiv(primary.work, 10000 - share, 10000) + mulDiv(secondary.work, share, 10000) + ROUTING.overheadPerRequest;
    inputWork = mulDiv(primary.inputWork, 10000 - share, 10000) + mulDiv(secondary.inputWork, share, 10000);
  }
  if (cacheWarm(state, product)) work -= mulDiv(mulDiv(inputWork, PREFIX_CACHE.reusedInputShareBps, 10000), 10000 - PREFIX_CACHE.hitWorkBps, 10000);
  // Checking is additional request work; routing, model formats and prefix reuse cannot erase it.
  work = checkedAdd(work, evidenceWorkPerRequest(state, product.id));
  work = checkedAdd(work, runtimeGuardrailWorkPerRequest(state, product.id));
  return { inputTokens: primary.inputTokens, outputTokens: primary.outputTokens, internalTokens: primary.internalTokens, sessionMemory: checkedAdd(primary.sessionMemory, productRoutingStateMemory(state, product)), work };
}
/** A trial retains its completed request fraction when model or feature work changes. */
export function trialAtMeter(trial: TrialBatch, workPerAccount: number): TrialBatch {
  const previous = trial.workPerAccount ?? 5_000_000;
  return { ...trial, workPerAccount, requiredWork: trial.count * workPerAccount,
    workCompleted: previous === workPerAccount ? trial.workCompleted : mulDiv(trial.workCompleted, workPerAccount, previous) };
}
export function meteredBill(inputTokens: number, outputTokens: number, internalTokens: number, inputPrice: number, outputPrice: number, carry = 0) {
  const numerator = BigInt(inputTokens) * BigInt(inputPrice) + BigInt(outputTokens + internalTokens) * BigInt(outputPrice) + BigInt(carry);
  return { cents: Number(numerator / BigInt(1_000_000)), remainder: Number(numerator % BigInt(1_000_000)) };
}
/** Withholding changes emitted behavior, never the model's attempted technical error rate. */
export function productBehaviorMeter(model: ModelVersion, technicalErrorBps: number, evidence?: EvidenceCheckUsage, guardrail?: RuntimeGuardrailUsage) {
  const baseline = behaviorMeter(model, technicalErrorBps);
  const checked = !evidence?.checkedRequests ? baseline : { ...baseline,
    confidentErrorBps: mulDiv(baseline.confidentErrorBps, evidence.supportedRequests, evidence.checkedRequests) };
  return !guardrail ? checked : { ...checked,
    falseRefusalBps: guardrailFalseRefusalBps(baseline.falseRefusalBps, technicalErrorBps, guardrail) };
}
export function productDemand(state: Readonly<GameState>, product: ProductOffer, content: GameContent, week: number) {
  const contract = state.slices.products.contracts[product.contractId];
  const primaryModel = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  const model = routedModel(state, product, primaryModel);
  const workload = productWorkloadMeasure(state, product);
  const features = featureConfig(product), meter = productRequestMeter(state, product, model), retrieval = getProductRetrieval(state, product.id), documentBonusBps = retrievalDocumentBonus(state, product.id);
  const cohorts = state.slices.markets.cohorts.filter(c => c.productId === product.id && c.activeWeek <= week);
  const accounts = cohorts.reduce((sum, c) => sum + c.count, 0);
  const trials = state.slices.markets.trials.filter(t => t.productId === product.id && t.activeWeek <= week && t.expiresWeek >= week)
    .map(t => trialAtMeter(t, SEGMENT_BY_ID[t.segmentId ?? 'regular'].trialExchanges * meter.work))
    .sort((a, b) => a.activeWeek - b.activeWeek || a.id.localeCompare(b.id));
  const trialAccounts = trials.reduce((sum, t) => sum + t.count, 0);
  const profile = product.sessionProfile;
  const segments: SegmentUsage[] = segmentForProduct(product.kind).map(segment => {
    const members = cohorts.filter(c => (c.segmentId ?? 'regular') === segment.id);
    const count = members.reduce((sum, cohort) => sum + cohort.count, 0);
    if (!profile) {
      const requestedExchanges = count * Math.min(segment.exchanges, contract.allowance);
      return { segmentId: segment.id, accounts: count, requestedExchanges, requestedWork: requestedExchanges * meter.work, errorBps: workloadErrorBps(executionErrorBps(model, segment, features, documentBonusBps), workload) };
    }
    const history = members.reduce((sum, cohort) => {
      const retained = cohort.sessionHistory;
      if (retained) {
        sum.accounts += retained.accounts;
        sum.tokens += Math.min(retained.tokens, retained.accounts * SESSION_PROFILES[profile].maxTokens);
      }
      return sum;
    }, { ...emptySessionHistory });
    const requestedExchanges = sessionExchanges(profile, segment, contract.allowance, count, history.accounts);
    return { segmentId: segment.id, accounts: count, requestedExchanges, requestedWork: 0, sessionHistory: history,
      errorBps: Math.max(0, workloadErrorBps(executionErrorBps(model, segment, features, documentBonusBps), workload) - sessionQuality(profile, count, history)) };
  });
  const retainedInput = profile ? sessionInputTokens(profile, segments, contract.allowance, SEGMENT_BY_ID) : 0;
  const paidMeter = retainedInput ? productRequestMeter(state, product, model, retainedInput) : meter;
  const historyMemory = profile ? segments.reduce((sum, row) => sum + (row.sessionHistory?.tokens ?? 0) * SESSION_MEMORY_PER_TOKEN, 0) : 0;
  if (profile) for (const row of segments) row.requestedWork = row.requestedExchanges * paidMeter.work;
  const paidWork = segments.reduce((n, row) => checkedAdd(n, row.requestedWork), 0);
  const trialWork = trials.reduce((sum, t) => checkedAdd(sum, t.requiredWork - t.workCompleted), 0);
  const memory = checkedAdd(checkedAdd(checkedAdd(model.residentMU, (accounts + trialAccounts) * meter.sessionMemory), retrieval?.evidence.indexMemoryMU ?? 0), checkedAdd(productEfficiencyMemory(state, product, accounts + trialAccounts), runtimeGuardrailMemory(state, product.id)));
  return { contract, model, primaryModel, features, meter, paidMeter, retainedInput, historyMemory, accounts, trials, trialAccounts, paidWork, trialWork, memory: checkedAdd(memory, historyMemory), segments, retrieval, documentBonusBps, workload };
}
export function standardServingRequests(state: Readonly<GameState>, content: GameContent, week: number): WorkRequest[] {
  return Object.values(state.slices.products.offers).filter(product => product.status === 'active' && !state.slices.company.companies[product.companyId].arrearsCents).flatMap(product => {
    const demand = productDemand(state, product, content, week);
    const canary = getCanaryTrafficPlan(state, product, demand, content, week); if (canary) return canary.requests;
    const sharedAdapterMemory = adapterSharingSpec(state, product.id, content);
    return [{ id: 'serve:' + product.id, companyId: product.companyId, taskId: product.id, category: 'serving', normalizedWorkCUw: checkedAdd(demand.paidWork, demand.trialWork), memoryMU: demand.memory, ...modelExecutionHints(demand.primaryModel), priority: 0, poolId: 'auto', headroomBps: content.firstSale.servingHeadroomBps,
      ...(sharedAdapterMemory ? { sharedAdapterMemory } : {}) } as WorkRequest];
  });
}
export function getProductView(state: GameState, productId: string, content: GameContent) {
  const p = state.slices.products.offers[productId], demand = productDemand(state, p, content, state.week + 1);
  return { product: p, ...demand, usage: state.slices.products.lastUsage[productId] ?? null, billing: p.kind === 'developer-api' ? 'Executed tokens' : 'Weekly subscription', inputPriceCentsPerMillion: mulDiv(demand.contract.weeklyPriceCents, 5, 3), outputPriceCentsPerMillion: mulDiv(demand.contract.weeklyPriceCents, 25, 3), forecastWork: demand.paidWork + demand.trialWork };
}
export function createProductsModule(content: GameContent): DomainModule {
  const termsError = (price: number, allowance: number, kind: ProductKind) => !Number.isSafeInteger(price) || price < 100 || price > (kind === 'basic-chat' ? 10000 : 100000) || !Number.isSafeInteger(allowance) || allowance < 25 || allowance > (kind === 'basic-chat' ? 500 : 5000);
  const featureError = (f: ProductFeatures) => !f || Object.keys(f).sort().join() !== ['deepReasoning', 'extendedContext', 'memory'].sort().join() || Object.values(f).some(v => typeof v !== 'boolean');
  const names: Record<ProductKind, string> = { 'basic-chat': 'Basic Chat', 'developer-api': 'Developer API', 'business-docs': 'Business Documents' };
  return {
    id: 'products', owns: ['products'], commandKinds: ['configure_product_offer', 'retire_product', 'deploy_product', 'set_product_terms', 'set_product_paused', 'set_product_features', 'set_consumer_sessions', 'upgrade_product', ...COMMERCE_COMMANDS, ...PRODUCT_EFFICIENCY_COMMANDS, ...PRODUCT_STRATEGY_COMMANDS, ...RELEASE_REHEARSAL_COMMANDS, ...PREPARED_RELEASE_COMMANDS, ...CANARY_COMMANDS, ...RUNTIME_GUARDRAIL_COMMANDS, ...ASSURANCE_COMMANDS, ...BATCH_COMMANDS],
    validateCommand(state, command) {
      const p = command.payload;
      const target = 'productId' in p ? p.productId : 'releaseId' in p ? state.slices.products.preparedReleases?.[p.releaseId]?.productId
        : 'canaryId' in p ? state.slices.products.canaryReleases?.[p.canaryId]?.productId : 'rehearsalId' in p ? state.slices.products.releaseRehearsals?.[p.rehearsalId]?.productId
          : 'jobId' in p ? state.slices.products.batchJobs?.[p.jobId]?.productId : 'contractId' in p ? state.slices.products.assuranceContracts?.[p.contractId]?.productId : undefined;
      if (target && state.slices.products.offers[target]?.retiredWeek !== undefined) return { code: 'NOT_READY', message: 'This offer is retired. Its delivery and invoice archive remains available; create a new offer to serve new customers.' };
      if (target && state.queuedCommands.some(other => other.id !== command.id && other.payload.kind === 'retire_product' && other.payload.productId === target)) return { code: 'ALREADY_ACTIVE', message: 'Retirement is already queued for this offer. Remove that queued action before starting other work.' };
      if ((CANARY_COMMANDS as readonly string[]).includes(p.kind)) return validateCanaryCommand(state, command, content);
      const canaryConflict = canaryMutationReason(state, command, content); if (canaryConflict) return canaryConflict;
      if ((BATCH_COMMANDS as readonly string[]).includes(p.kind)) return validateBatchCommand(state, command, content);
      if ((ASSURANCE_COMMANDS as readonly string[]).includes(p.kind)) return validateAssuranceCommand(state, command, content, { standardRequests: [...standardServingRequests(state, content, state.week + 1), ...commercialCapacityRequests(state, command.companyId), ...queuedBusinessCapacityRequests(state, command.companyId, command.id, content)] });
      if ((RELEASE_REHEARSAL_COMMANDS as readonly string[]).includes(p.kind)) return validateReleaseRehearsalCommand(state, command, content);
      if ((PREPARED_RELEASE_COMMANDS as readonly string[]).includes(p.kind)) return validatePreparedRelease(state, command, content);
      const releaseConflict = preparedReleaseMutationReason(state, command);
      if (releaseConflict) return releaseConflict;
      if ('productId' in p && state.slices.products.offers[p.productId]?.retiredWeek !== undefined) return { code: 'NOT_READY', message: 'This offer is retired. Its historical customers and invoices remain in the archive; create a new offer to serve new customers.' };
      if (p.kind === 'configure_product_offer' || p.kind === 'retire_product') {
        const malformed = productPortfolioShapeRejection(p); if (malformed) return malformed;
        if (!hasConnectedCompanyRules(state.contentVersion)) return { code: 'NOT_READY', message: 'Upgrade this campaign to manage a product portfolio.' };
        const offer = state.slices.products.offers[p.productId];
        if (!offer || offer.companyId !== command.companyId || offer.status === 'deploying') return { code: 'NOT_READY', message: 'Choose an owned, fully deployed offer.' };
        if (state.queuedCommands.some(other => other.id !== command.id && 'productId' in other.payload && other.payload.productId === p.productId
          && ['configure_product_offer', 'retire_product'].includes(other.payload.kind))) return { code: 'ALREADY_ACTIVE', message: 'A portfolio change for this offer is already queued.' };
        if (p.kind === 'retire_product') {
          if (offer.status !== 'paused' || state.slices.markets.cohorts.some(c => c.productId === offer.id) || state.slices.markets.trials.some(t => t.productId === offer.id)) return { code: 'NOT_READY', message: 'Pause this offer and let its remaining customer commitments and trials finish before retiring it.' };
          const obligation = productRetirementObligationReason(state, offer.id); if (obligation) return { code: 'NOT_READY', message: obligation };
          if (state.queuedCommands.some(other => other.id !== command.id && 'productId' in other.payload && other.payload.productId === offer.id)) return { code: 'ALREADY_ACTIVE', message: 'Settle other queued work for this offer before retiring it.' };
        } else if (activePortfolio(state, command.companyId).some(other => other.id !== offer.id && other.name.toLowerCase() === p.name.trim().toLowerCase())) return { code: 'ALREADY_ACTIVE', message: 'Choose a different name for this offer.' };
        else if (offer.name === p.name.trim() && offer.workload?.id === p.workload) return { code: 'NO_IMPROVEMENT', message: 'This offer already has that name and customer promise.' };
        return;
      }
      if (p.kind === 'set_product_strategy') return validateProductStrategy(state, command);
      if (p.kind === 'set_consumer_sessions') {
        const offer = state.slices.products.offers[p.productId];
        if (!offer || offer.companyId !== command.companyId || offer.kind !== 'basic-chat' || offer.status === 'deploying') return { code: 'NOT_READY', message: 'Choose your deployed Basic Chat product.' };
        if (p.profile !== 'off' && !Object.hasOwn(SESSION_PROFILES, p.profile)) return { code: 'INVALID_COMMAND', message: 'Choose Off, Brief history, or Extended history.' };
        if ((offer.sessionProfile ?? 'off') === p.profile || state.queuedCommands.some(other => other.id !== command.id && other.payload.kind === p.kind && other.payload.productId === p.productId)) return { code: 'ALREADY_ACTIVE', message: 'This history choice is already active or a change is queued.' };
        return;
      }
      if ((RUNTIME_GUARDRAIL_COMMANDS as readonly string[]).includes(p.kind)) return validateRuntimeGuardrail(state, command, content);
      if ((PRODUCT_EFFICIENCY_COMMANDS as readonly string[]).includes(p.kind)) return validateProductEfficiency(state, command, content);
      if (isCommerceCommand(p)) return validateBusinessCommand(state, command, content, { standardRequests: standardServingRequests(state, content, state.week + 1) });
      if (p.kind === 'deploy_product' || p.kind === 'upgrade_product') {
        const offer = p.kind === 'upgrade_product' ? state.slices.products.offers[p.productId] : undefined;
        const kind = p.kind === 'deploy_product' ? p.productKind ?? 'basic-chat' : offer?.kind ?? 'basic-chat';
        if (!Object.hasOwn(names, kind)) return { code: 'INVALID_COMMAND', message: 'Choose a known product type.' };
        if (p.kind === 'upgrade_product' && offer && state.slices.products.deployments[offer.deploymentId]?.modelId === p.modelId) return { code: 'NO_IMPROVEMENT', message: 'This product already uses the selected model.' };
        if (p.kind === 'upgrade_product' && (!offer || offer.companyId !== command.companyId || offer.status === 'deploying')) return { code: 'NOT_READY', message: 'Choose an existing deployed product to replace its model.' };
        if (p.kind === 'deploy_product') {
          const existing = activePortfolio(state, command.companyId);
          const queued = state.queuedCommands.filter(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === 'deploy_product');
          if (!hasConnectedCompanyRules(state.contentVersion)) {
            if (p.workload !== undefined || p.name !== undefined) return { code: 'NOT_READY', message: 'Upgrade this campaign to choose an offer name and customer workload.' };
            if (existing.some(o => o.kind === kind)) return { code: 'ALREADY_ACTIVE', message: 'This company already has this product. Adjust its terms or replace its model.' };
          } else {
            if (p.workload !== undefined && !isProductWorkloadId(p.workload) || p.name !== undefined && !validProductName(p.name)) return { code: 'INVALID_COMMAND', message: 'Choose a recognized workload and an offer name of 1–48 characters.' };
            if (existing.length + queued.length >= PRODUCT_PORTFOLIO_LIMIT || existing.filter(o => o.kind === kind).length + queued.filter(other => other.payload.kind === 'deploy_product' && (other.payload.productKind ?? 'basic-chat') === kind).length >= PRODUCT_KIND_LIMIT) return { code: 'CAPACITY_EXCEEDED', message: 'A company can operate four public offers, with at most two of each kind. Paused offers still count; retire an empty offer to open a slot.' };
            if (p.name && (existing.some(o => o.name.toLowerCase() === p.name!.trim().toLowerCase()) || queued.some(other => other.payload.kind === 'deploy_product' && other.payload.name?.trim().toLowerCase() === p.name!.trim().toLowerCase()))) return { code: 'ALREADY_ACTIVE', message: 'Choose a different name for this offer.' };
          }
          if (termsError(p.priceCents, p.allowance, kind) || (p.features && featureError(p.features))) return { code: 'INVALID_COMMAND', message: 'Check the price, allowance, and product options.' };
        }
        const policyRejection = policyReleaseRejection(state, p.modelId); if (policyRejection) return policyRejection;
        if (!eligibleModel(state, p.modelId, command.companyId, kind)) return { code: 'NOT_READY', message: kind === 'developer-api' ? 'The API needs an evaluated coding score of 50 and reliability of 80.' : kind === 'business-docs' ? 'Business Documents requires R6 Retrieval Systems and evaluated documents 55 / reliability 90.' : 'Basic Chat needs an evaluated conversation score of 45 and reliability of 65.' };
        const model = state.slices.models.versions[p.modelId];
        if (!inheritedModelRights(state, model.id, content).hosted) return { code: 'NOT_READY', message: 'The training evidence does not permit hosted commercial use.' };
        if (!getCompatibleComputePools(state, command.companyId, modelExecutionHints(model), content).some(pool => pool.memoryMU >= model.residentMU)) return { code: 'MISSING_MEMORY', message: 'Provide an inference-compatible connected pool large enough to host this model. Sparse models also require fast fabric.' };
      } else if (p.kind === 'set_product_terms' || p.kind === 'set_product_paused' || p.kind === 'set_product_features') {
        const offer = state.slices.products.offers[p.productId];
        if (!offer || offer.companyId !== command.companyId) return { code: 'INVALID_COMMAND', message: 'Choose a product belonging to this company.' };
        if (p.kind === 'set_product_terms' && termsError(p.priceCents, p.allowance, offer.kind)) return { code: 'INVALID_COMMAND', message: 'Choose a supported price and request allowance.' };
        if (p.kind === 'set_product_features' && featureError(p.features)) return { code: 'INVALID_COMMAND', message: 'All three product feature flags must be explicit.' };
        if (p.kind === 'set_product_paused' && (typeof p.paused !== 'boolean' || offer.status === 'deploying')) return { code: 'NOT_READY', message: 'Finish deployment before changing service status.' };
      } else return { code: 'INVALID_COMMAND', message: 'This is not a product action.' };
    },
    quoteCommand(_state, command) {
      if ((CANARY_COMMANDS as readonly string[]).includes(command.payload.kind)) return quoteCanaryCommand(_state, command);
      const p = command.payload;
      if ((BATCH_COMMANDS as readonly string[]).includes(p.kind)) return quoteBatchCommand(_state, command, content);
      if ((ASSURANCE_COMMANDS as readonly string[]).includes(p.kind)) return quoteAssuranceCommand(_state, command);
      if ((RUNTIME_GUARDRAIL_COMMANDS as readonly string[]).includes(p.kind)) return quoteRuntimeGuardrail(_state, command);
      if ((RELEASE_REHEARSAL_COMMANDS as readonly string[]).includes(p.kind)) return quoteReleaseRehearsalCommand(_state, command, content);
      if ((PREPARED_RELEASE_COMMANDS as readonly string[]).includes(p.kind)) return quotePreparedRelease(_state, command);
      if ((PRODUCT_EFFICIENCY_COMMANDS as readonly string[]).includes(p.kind)) return quoteProductEfficiency(command, _state);
      if (p.kind === 'set_product_strategy') return quoteProductStrategy(_state, command);
      if (p.kind === 'configure_product_offer') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Name this offer ${p.name.trim()} and serve ${PRODUCT_WORKLOADS[p.workload].name.toLowerCase()} from next week. ${PRODUCT_WORKLOADS[p.workload].promise} Compute and memory costs remain fully metered.` };
      if (p.kind === 'retire_product') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Retire this paused, empty offer and free its portfolio slot. Keep historical delivery and invoices. It cannot resume; shared cloud, facilities and payroll continue.' };
      if (isCommerceCommand(p)) return quoteBusinessCommand(_state, command, content);
      if (p.kind === 'set_consumer_sessions') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.profile === 'off'
        ? 'Turn off persistent sessions and clear retained history at the next weekly boundary.'
        : 'Change the history policy next week. Actual paid service grows history. Returning subscribers use more of their existing allowance and need extra GPU work and connected memory.' };
      const summary = p.kind === 'deploy_product' ? 'Build a product with 20 Design points; it activates the following week.'
        : p.kind === 'upgrade_product' ? 'Replace the serving model using 20 Design points. Service pauses during deployment; subscriptions receive credits.'
        : p.kind === 'set_product_features' ? 'Apply options next week. Memory adds input tokens; long context increases tokens and session memory; reasoning adds internal tokens and task quality.'
        : p.kind === 'set_product_terms' ? 'Change price and allowance next week. API price sets the reference bill for 600 standard requests; executed tokens determine revenue.'
        : p.kind === 'set_product_paused' && p.paused ? 'Pause service and acquisition. Unserved subscriptions receive full credits.' : 'Resume service and acquisition next week.';
      return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary };
    },
    applyCommand(state, command) {
      if (command.payload.kind === 'set_product_strategy') return applyProductStrategy(state, command);
      if ((CANARY_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyCanaryCommand(state, command, content);
      if ((BATCH_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyBatchCommand(state, command, content);
      if ((ASSURANCE_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyAssuranceCommand(state, command);
      if ((RUNTIME_GUARDRAIL_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyRuntimeGuardrail(state, command);
      if ((RELEASE_REHEARSAL_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyReleaseRehearsalCommand(state, command, content);
      if ((PREPARED_RELEASE_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyPreparedRelease(state, command, content);
      if ((PRODUCT_EFFICIENCY_COMMANDS as readonly string[]).includes(command.payload.kind)) return applyProductEfficiency(state, command);
      if (isCommerceCommand(command.payload)) return applyBusinessCommand(state, command, content);
      const products = structuredClone(state.slices.products), p = command.payload;
      if (p.kind === 'deploy_product' || p.kind === 'upgrade_product') {
        const id = p.kind === 'upgrade_product' ? p.productId : 'product:' + command.id, deploymentId = 'deployment:' + command.id;
        const contractId = p.kind === 'upgrade_product' ? products.offers[id].contractId : 'contract:' + command.id;
        if (p.kind === 'upgrade_product') { products.offers[id].publicModelId ??= products.deployments[products.offers[id].deploymentId].modelId; delete products.deployments[products.offers[id].deploymentId]; products.offers[id].deploymentId = deploymentId; products.offers[id].status = 'deploying'; }
        else {
          const kind = p.productKind ?? 'basic-chat';
          let name = p.name?.trim() ?? names[kind], suffix = 1;
          if (!p.name) while (Object.values(products.offers).some(offer => offer.companyId === command.companyId && offer.retiredWeek === undefined && offer.name.toLowerCase() === name.toLowerCase())) name = names[kind] + ' ' + ++suffix;
          products.offers[id] = { id, companyId: command.companyId, name, kind, features: p.features ?? { ...DEFAULT_FEATURES }, deploymentId, contractId, status: 'deploying', createdWeek: state.week,
            ...(hasConnectedCompanyRules(state.contentVersion) ? { workload: createProductWorkloadReceipt(p.workload ?? 'general', state.week) } : {}) };
          products.contracts[contractId] = { id: contractId, companyId: command.companyId, productId: id, weeklyPriceCents: p.priceCents, allowance: p.allowance, creditBps: 10000, effectiveWeek: state.week };
        }
        products.deployments[deploymentId] = { id: deploymentId, companyId: command.companyId, productId: id, modelId: p.modelId, status: 'building', startedWeek: state.week, requiredStaff: content.firstSale.deploymentStaff, completedStaff: 0, readyWeek: null, lastBottleneck: 'Waiting for ML staff.' };
      }
      if (p.kind === 'set_product_terms') { const c = products.contracts[products.offers[p.productId].contractId]; c.weeklyPriceCents = p.priceCents; c.allowance = p.allowance; c.effectiveWeek = state.week; }
      if (p.kind === 'set_product_paused') products.offers[p.productId].status = p.paused ? 'paused' : 'active';
      if (p.kind === 'configure_product_offer') { const offer = products.offers[p.productId]; offer.name = p.name.trim(); if (offer.workload?.id !== p.workload) offer.workload = createProductWorkloadReceipt(p.workload, state.week); }
      if (p.kind === 'retire_product') products.offers[p.productId].retiredWeek = state.week;
      if (p.kind === 'set_consumer_sessions') {
        const offer = products.offers[p.productId];
        if (p.profile === 'off') delete offer.sessionProfile;
        else offer.sessionProfile = p.profile;
      }
      if (p.kind === 'set_product_features') products.offers[p.productId].features = structuredClone(p.features);
      products.activeIds = Object.values(products.offers).filter(o => o.status === 'active').map(o => o.id);
      return { updates: { products }, messages: [{ category: 'project', companyId: command.companyId, message: p.kind === 'deploy_product' || p.kind === 'upgrade_product' ? 'Product deployment started. 20 Design points are required.' : 'Product terms, options, or service status updated.' }] };
    },
    handlers: {
      commit(state, ctx) {
        const commercial = businessCommit(state, ctx), products = commercial.updates!.products!, messages: NonNullable<DomainResult['messages']> = commercial.messages ?? [];
        commitProductEfficiency(products, ctx.week);
        messages.push(...commitReleaseRehearsals(state, ctx, products));
        messages.push(...commitPreparedReleases(state, products, ctx));
        messages.push(...commitCanaries(state, products, ctx));
        for (const d of Object.values(products.deployments)) if (d.status === 'ready' && d.readyWeek !== null && d.readyWeek <= ctx.week) {
          d.status = 'active'; products.offers[d.productId].status = 'active'; products.offers[d.productId].publicModelId = d.modelId;
          messages.push({ category: 'delivery', companyId: d.companyId, message: `${products.offers[d.productId].name} is live. Allocate serving capacity for trials and paid usage.` });
        }
        messages.push(...commitRuntimeGuardrails({ ...state, slices: { ...state.slices, products } }, products, ctx));
        messages.push(...assuranceCommit({ ...state, slices: { ...state.slices, products } }, products, ctx));
        messages.push(...commitBatch({ ...state, slices: { ...state.slices, products } }, products, ctx));
        products.activeIds = Object.values(products.offers).filter(o => o.status === 'active').map(o => o.id);
        return { updates: { products }, messages };
      },
      reserve(state, ctx) {
        const commercial = businessTermBoundary(state, ctx), reservingProducts = commercial.updates!.products!;
        const assuranceMessages = assuranceTermBoundary({ ...state, slices: { ...state.slices, products: reservingProducts } }, reservingProducts, ctx);
        commercial.messages = [...(commercial.messages ?? []), ...assuranceMessages];
        const reservingState = { ...state, slices: { ...state.slices, products: reservingProducts } };
        const workRequests: WorkRequest[] = [...businessRequests(reservingState, ctx.week), ...productEfficiencyRequests(reservingState), ...releaseRehearsalRequests(reservingState, content), ...preparedReleaseRequests(reservingState, content), ...runtimeGuardrailRequests(reservingState), ...assuranceRequests(reservingState, ctx.week), ...batchRequests(reservingState, ctx.week)];
        for (const d of Object.values(state.slices.products.deployments)) if (d.status === 'building') workRequests.push({ id: 'deploy-work:' + d.id, companyId: d.companyId, taskId: d.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: 10, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: Math.min(RESOURCE_SCALE, d.requiredStaff - d.completedStaff) }] });
        workRequests.push(...standardServingRequests(reservingState, content, ctx.week));
        return { ...commercial, workRequests };
      },
      execute(state, ctx) {
        const products = businessExecute(state, ctx).updates!.products!;
        advanceProductEfficiency(products, ctx);
        advanceReleaseRehearsals(state, ctx, products);
        advancePreparedReleases(products, ctx);
        advanceRuntimeGuardrails(state, products, ctx);
        advanceAssurance({ ...state, slices: { ...state.slices, products } }, products, ctx);
        advanceBatch({ ...state, slices: { ...state.slices, products } }, products, ctx);
        const executingState = { ...state, slices: { ...state.slices, products } };
        for (const d of Object.values(products.deployments)) if (d.status === 'building') {
          const staff = ctx.resources.staffGrants.find(g => g.requestId === 'deploy-work:' + d.id)?.grants.find(g => g.role === 'ml')?.staffWeeks ?? 0;
          d.completedStaff = Math.min(d.requiredStaff, checkedAdd(d.completedStaff, staff)); d.lastBottleneck = staff > 0 ? '' : 'Deployment is waiting for Design points. An ML engineer can increase weekly output.';
        }
        for (const p of Object.values(products.offers)) {
          const demand = productDemand(executingState, p, content, ctx.week);
          const canaryUsage = executeCanaryUsage(executingState, p, demand, ctx);
          if (canaryUsage) {
            products.lastUsage[p.id] = canaryUsage;
            if (p.kind === 'developer-api') products.contracts[p.contractId].tokenBillRemainder = canaryUsage.tokens!.billCarryOut!;
            continue;
          }
          const grant = p.status === 'active' ? ctx.resources.computeGrants.find(g => g.requestId === 'serve:' + p.id) : undefined;
          const granted = grant?.hardwareEffectiveCUw ?? 0, paidExecutedWork = Math.min(granted, demand.paidWork), trialExecutedWork = Math.min(Math.max(0, granted - paidExecutedWork), demand.trialWork);
          const fulfillmentBps = demand.paidWork > 0 ? mulDiv(paidExecutedWork, 10000, demand.paidWork) : p.status === 'active' ? 10000 : 0;
          const inputTokens = mulDiv(paidExecutedWork, demand.paidMeter.inputTokens, demand.paidMeter.work), outputTokens = mulDiv(paidExecutedWork, demand.paidMeter.outputTokens, demand.paidMeter.work), internalTokens = mulDiv(paidExecutedWork, demand.paidMeter.internalTokens, demand.paidMeter.work);
          const inputPrice = mulDiv(demand.contract.weeklyPriceCents, 5, 3), outputPrice = mulDiv(demand.contract.weeklyPriceCents, 25, 3);
          const billCarryIn = p.kind === 'developer-api' ? demand.contract.tokenBillRemainder ?? 0 : 0;
          const tokenBill = meteredBill(inputTokens, outputTokens, internalTokens, inputPrice, outputPrice, billCarryIn);
          if (p.kind === 'developer-api') products.contracts[p.contractId].tokenBillRemainder = tokenBill.remainder;
          const grossBillCents = p.kind === 'developer-api' ? tokenBill.cents : demand.accounts * demand.contract.weeklyPriceCents, creditsCents = p.kind === 'developer-api' ? 0 : mulDiv(grossBillCents, 10000 - fulfillmentBps, 10000, 'nearest');
          let remaining = trialExecutedWork; const trialCompletedIds: string[] = [];
          for (const trial of demand.trials) { const done = Math.min(remaining, trial.requiredWork - trial.workCompleted); remaining -= done; if (trial.workCompleted + done >= trial.requiredWork) trialCompletedIds.push(trial.id); }
          const errorBps = demand.accounts ? Math.floor(demand.segments.reduce((n, s) => n + s.accounts * s.errorBps, 0) / demand.accounts) : workloadErrorBps(executionErrorBps(demand.model, segmentForProduct(p.kind)[0], demand.features, demand.documentBonusBps), demand.workload);
          const evidence = measureEvidenceChecks(executingState, p, demand.paidWork + demand.trialWork, paidExecutedWork + trialExecutedWork, demand.meter.work);
          const sessionUsage = p.sessionProfile ? { profile: p.sessionProfile, paidWorkPerExchange: demand.paidMeter.work } : undefined;
          const sessionTraffic = sessionUsage ? { consumerSessions: sessionUsage, paidRequestedWork: demand.paidWork, paidExecutedWork, trialRequestedWork: demand.trialWork, trialExecutedWork } : undefined;
          const guardrail = measureRuntimeGuardrails(executingState, p, demand.paidWork + demand.trialWork, paidExecutedWork + trialExecutedWork, demand.meter.work, behaviorMeter(demand.model, errorBps).falseRefusalBps, errorBps, sessionTraffic);
          const servingPool = grant ? getComputePools(state, p.companyId, content, ctx.resources.staffGrants).find(pool => pool.id === grant.poolId) : undefined;
          const usage: WeeklyUsage = { ...(sessionUsage ? { consumerSessions: sessionUsage } : {}), week: ctx.week, productId: p.id, paidAccounts: demand.accounts, trialAccounts: demand.trialAccounts, requestedWork: demand.paidWork + demand.trialWork, executedWork: paidExecutedWork + trialExecutedWork, paidRequestedWork: demand.paidWork, paidExecutedWork, trialRequestedWork: demand.trialWork, trialExecutedWork, exchanges: sessionUsage ? Math.floor(paidExecutedWork / demand.paidMeter.work) + Math.floor(trialExecutedWork / demand.meter.work) : Math.floor((paidExecutedWork + trialExecutedWork) / demand.meter.work), fulfillmentBps, errorBps, behavior: productBehaviorMeter(demand.model, errorBps, evidence, guardrail), ...(evidence ? { evidence } : {}), ...(guardrail ? { guardrail } : {}), trialCompletedIds, grossBillCents, creditsCents, billedCents: grossBillCents - creditsCents, segments: demand.segments, tokens: { inputTokens, outputTokens, internalTokens, inputPriceCentsPerMillion: inputPrice, outputPriceCentsPerMillion: outputPrice, billCarryIn, billCarryOut: p.kind === 'developer-api' ? tokenBill.remainder : 0, physicalWork: grant?.physicalCUw ?? 0, ownedVariableCostCents: grant ? mulDiv(grant.physicalCUw, servingPool ? getPoolWorkCostRate(servingPool, { category: 'serving' }) : 0, RESOURCE_SCALE) : 0 } };
          if (demand.workload) usage.workload = demand.workload;
          products.lastUsage[p.id] = usage;
          warmProductCache(products, executingState, p, ctx.week, usage.executedWork);
        }
        return { updates: { products } };
      },
      resolve(state, ctx) {
        const commercial = businessResolve(state, ctx), products = commercial.updates!.products!, schedule: NonNullable<ReturnType<NonNullable<DomainModule['handlers']['resolve']>>['schedule']> = [], messages: NonNullable<DomainResult['messages']> = commercial.messages ?? [];
        const newRoutes = Object.values(products.efficiencyInstalls ?? {}).filter(item => item.status === 'building' && item.kind === 'routing' && item.completedWork === item.requiredWork && item.completedStaff === item.requiredStaff);
        resolveProductEfficiency(products, ctx.week);
        messages.push(...resolveReleaseRehearsals(state, ctx, products));
        resolvePreparedReleases(products, ctx);
        messages.push(...resolveCanaries(state, products, ctx));
        messages.push(...resolveRuntimeGuardrails(state, products, ctx));
        messages.push(...resolveAssurance(state, products, ctx));
        messages.push(...resolveBatch(state, products, ctx));
        for (const item of newRoutes) schedule.push({ id: 'release:' + item.id + ':secondary', companyId: item.companyId, dueWeek: ctx.week + 1, kind: 'model_release', targetId: item.secondaryModelId! });
        for (const d of Object.values(products.deployments)) if (d.status === 'building' && d.completedStaff >= d.requiredStaff) {
          d.status = 'ready'; d.readyWeek = ctx.week + 1; d.lastBottleneck = '';
          schedule.push({ id: 'release:' + d.id, companyId: d.companyId, dueWeek: d.readyWeek, kind: 'model_release', targetId: d.modelId });
          messages.push({ category: 'project', companyId: d.companyId, message: `${products.offers[d.productId].name} deployment finished. Service becomes available next week.` });
        }
        return { updates: { products }, schedule, messages };
      },
      settle(state, ctx) {
        const commercial = businessSettle(state, ctx), products = commercial.updates!.products!, facts: NonNullable<ReturnType<NonNullable<DomainModule['handlers']['settle']>>['facts']> = commercial.facts ?? [];
        facts.push(...settleAssurance(state, products, ctx));
        facts.push(...settleBatch(state, products, ctx));
        for (const p of Object.values(products.offers)) {
          const u = products.lastUsage[p.id]; if (!u || u.week !== ctx.week || u.paidAccounts === 0) continue;
          const id = 'invoice:' + p.id + ':' + ctx.week; if (products.invoices.some(i => i.id === id)) continue;
          products.invoices.push({ id, companyId: p.companyId, productId: p.id, contractId: p.contractId, week: ctx.week, accounts: u.paidAccounts, grossCents: u.grossBillCents, creditsCents: u.creditsCents, amountCents: u.billedCents, billing: p.kind === 'developer-api' ? 'tokens' : 'subscription', inputTokens: u.tokens?.inputTokens ?? 0, outputTokens: (u.tokens?.outputTokens ?? 0) + (u.tokens?.internalTokens ?? 0) });
          facts.push({ id, companyId: p.companyId, week: ctx.week, sourceId: p.contractId, category: 'revenue', amountCents: u.billedCents, label: `${p.name}: ${u.paidAccounts} accounts, ${p.kind === 'developer-api' ? 'executed token bill' : 'after service credits'}`, kind: 'receipt' });
        }
        products.invoices = products.invoices.slice(-100); return { updates: { products }, facts };
      },
    },
  };
}
