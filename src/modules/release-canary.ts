import { CONTENT } from '../content/catalog';
import { CANARY_RULES as RULES } from '../content/wave27-canary';
import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, ModuleContext, ProductsSlice, Rejection } from '../contracts/types';
import type { CanaryAssessment, CanaryCommand, CanaryIncident, CanaryRelease, CanaryStopCode, CanaryView } from '../contracts/wave27-canary';
import { canonicalStateHash, freezeDeep } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { activeEfficiency } from './product-efficiency';
import { getProductRetrieval } from './business';
import { currentRuntimeGuardrail, pendingRuntimeGuardrail } from './runtime-guardrails';
import { hasResearch } from './research';
import { preparedReleaseReadinessReason } from './prepared-releases';
import { releaseConfiguration } from './release-rehearsals';
import { evaluatedReleaseIdentityReason, getEvaluatedReleaseIdentity } from './release-identity';
import { requestMeter } from './product-models';

export const CANARY_COMMANDS = ['start_release_canary', 'stop_release_canary'] as const;
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const records = (state: Readonly<GameState>) => Object.values(state.slices.products.canaryReleases ?? {});
const open = (item: CanaryRelease) => item.status === 'scheduled' || item.status === 'collecting';
const isCommand = (command: GameCommand): command is GameCommand & { payload: CanaryCommand } => (CANARY_COMMANDS as readonly string[]).includes(command.payload.kind);
const conflictingKinds = ['start_release_canary', 'stop_release_canary', 'promote_prepared_release', 'discard_prepared_release', 'start_release_rollback',
  'upgrade_product', 'set_product_features', 'set_product_strategy', 'set_product_terms', 'set_consumer_sessions', 'install_retrieval', 'install_product_efficiency',
  'set_product_efficiency_enabled', 'install_runtime_guardrail', 'set_runtime_guardrail_enabled'];

export function canaryConfigurationFingerprint(state: Readonly<GameState>, productId: string): string {
  const product = state.slices.products.offers[productId];
  return canonicalStateHash({ configuration: releaseConfiguration(state, productId),
    priceCents: state.slices.products.contracts[product.contractId].weeklyPriceCents, sessionProfile: product.sessionProfile ?? null });
}
export function canaryEvidenceKey(state: Readonly<GameState>, companyId: string, productId: string): string {
  return canonicalStateHash({ protocol: RULES.protocol, seed: state.seed, companyId, productId });
}
function productForCommand(state: Readonly<GameState>, command: GameCommand): string | undefined {
  const p = command.payload;
  return 'productId' in p ? p.productId : 'canaryId' in p ? state.slices.products.canaryReleases?.[p.canaryId]?.productId
    : 'releaseId' in p ? state.slices.products.preparedReleases?.[p.releaseId]?.productId : undefined;
}
function queuedConflict(state: Readonly<GameState>, command: GameCommand, productId: string): boolean {
  return state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId
    && conflictingKinds.includes(item.payload.kind) && productForCommand(state, item) === productId);
}
export function canaryUnsupportedReason(state: Readonly<GameState>, productId: string): Rejection | undefined {
  const product = state.slices.products.offers[productId];
  if (!product || product.status !== 'active') return reject('Choose an active public product; the incumbent must be serving during this canary.');
  if (product.sessionProfile) return reject('This canary protocol uses stateless public requests. Turn off retained consumer sessions and prepare a matching release first.');
  if (['routing', 'prefix-cache', 'evidence-links'].some(kind => activeEfficiency(state, productId, kind as 'routing' | 'prefix-cache' | 'evidence-links')))
    return reject('This canary protocol needs a single uncached public route. Disable routing, prefix caching and evidence checks before rehearsing and preparing its fixed configuration.');
  if (getProductRetrieval(state, productId)) return reject('This first canary protocol does not split a bound retrieval index. Use the existing prepared handover for this retrieval product.');
  if (currentRuntimeGuardrail(state, productId)?.enabled || pendingRuntimeGuardrail(state, productId))
    return reject('The installed or pending runtime guardrail is bound to its exact deployed models. This canary cannot silently transfer that protection to another model; use its existing prepared release workflow.');
}
function releaseReason(state: Readonly<GameState>, releaseId: string, owner: string, content: GameContent): Rejection | undefined {
  if (!hasResearch(state, owner, RULES.requiredResearch)) return reject('Complete Release telemetry S3 before funding a public canary.');
  const release = state.slices.products.preparedReleases?.[releaseId];
  if (!release || release.companyId !== owner || release.status !== 'ready' || release.rollback) return reject('Choose a finished, available forward prepared release. Its paid rehearsal and deployment preparation remain required.');
  const readiness = preparedReleaseReadinessReason(state, release, content); if (readiness) return readiness;
  const unsupported = canaryUnsupportedReason(state, release.productId); if (unsupported) return unsupported;
  if (records(state).some(item => item.releaseId === releaseId)) return reject('This prepared bundle already has its saved canary. Review its outcome; another paid bundle is required for a new attempt.', 'ALREADY_ACTIVE');
  if (records(state).some(item => item.productId === release.productId && open(item))) return reject('Stop this product’s active canary before beginning another.', 'ALREADY_ACTIVE');
  if (!getEvaluatedReleaseIdentity(state, release.sourceModelId, content) || !getEvaluatedReleaseIdentity(state, release.candidateModelId, content))
    return reject('Both exact model/runtime versions need completed paid capability evidence and any required policy report.');
  if (records(state).length >= RULES.maximumHistory) return reject('This save has reached its retained canary-history limit. Existing prepared releases remain available.', 'CAPACITY_EXCEEDED');
}
export function canaryPromotionReason(state: Readonly<GameState>, releaseId: string, content: GameContent = CONTENT): Rejection | undefined {
  const canary = records(state).find(item => item.releaseId === releaseId); if (!canary) return;
  const release = state.slices.products.preparedReleases?.[releaseId];
  if (canary.status === 'promoted' && release?.rollback) return;
  if (canary.status !== 'qualified') return reject(canary.status === 'stopped'
    ? 'This canary stopped. Keep the incumbent and discard this bundle before preparing another candidate.'
    : 'Keep full rollout paused until both cohorts meet the sample floor and the canary qualifies.');
  return release ? preparedReleaseReadinessReason(state, release, content) : reject('The prepared release is unavailable.');
}
/** Check both command orders; a queued stop or start never grants a same-week
 * promotion or configuration change before its own boundary is committed. */
export function canaryMutationReason(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload, productId = productForCommand(state, command); if (!productId) return;
  if (p.kind === 'promote_prepared_release') { const gate = canaryPromotionReason(state, p.releaseId, content); if (gate) return gate; }
  if ((CANARY_COMMANDS as readonly string[]).includes(p.kind)) return;
  if (!conflictingKinds.includes(p.kind)) return;
  if (records(state).some(item => item.productId === productId && open(item)) || state.queuedCommands.some(item => item.id !== command.id
    && item.companyId === command.companyId && (CANARY_COMMANDS as readonly string[]).includes(item.payload.kind) && productForCommand(state, item) === productId))
    return reject('Stop the active or queued canary at its command boundary before changing or handing over this fixed release configuration.');
}
export function validateCanaryCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  if (!isCommand(command)) return reject('Choose a supported canary operation.', 'INVALID_COMMAND');
  const p = command.payload;
  const expectedKeys = p.kind === 'start_release_canary' ? 'budgetCUw,kind,releaseId,sampleFloor,shareBps' : 'canaryId,kind';
  if (Array.isArray(p) || Object.keys(p).sort().join() !== expectedKeys)
    return reject('Choose only the explicit canary release, traffic share, sample floor and work allowance, or one saved canary to stop.', 'INVALID_COMMAND');
  if (p.kind === 'start_release_canary') {
    const gate = releaseReason(state, p.releaseId, command.companyId, content); if (gate) return gate;
    const release = state.slices.products.preparedReleases![p.releaseId];
    if (queuedConflict(state, command, release.productId)) return reject('Apply this product’s queued change before funding the canary.', 'ALREADY_ACTIVE');
    if (!(RULES.shares as readonly number[]).includes(p.shareBps) || !Number.isSafeInteger(p.sampleFloor) || p.sampleFloor < RULES.minimumSample || p.sampleFloor > RULES.maximumSample
      || !Number.isSafeInteger(p.budgetCUw) || p.budgetCUw <= 0 || p.budgetCUw > RULES.maximumBudgetCUw) return reject('Choose 1%, 5% or 10%, a 100–10,000 request sample floor, and a positive candidate allowance of at most 32 CUw.', 'INVALID_COMMAND');
    const product = state.slices.products.offers[release.productId], candidate = state.slices.models.versions[release.candidateModelId];
    if (p.budgetCUw < p.sampleFloor * requestMeter(candidate, product.features ?? releaseConfiguration(state, product.id).features).work)
      return reject('The candidate CUw allowance cannot fund the selected sample floor. Increase the allowance or lower the explicit floor.');
  } else {
    const canary = state.slices.products.canaryReleases?.[p.canaryId];
    if (!canary || canary.companyId !== command.companyId || !open(canary)) return reject('Choose this company’s scheduled or collecting canary. Completed outcomes cannot be resumed or rewritten.');
    if (queuedConflict(state, command, canary.productId)) return reject('Apply the queued canary/product command before choosing another action.', 'ALREADY_ACTIVE');
  }
}
export function quoteCanaryCommand(_state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload;
  return p.kind === 'start_release_canary' ? { upfrontCostCents: RULES.setupFeeCents, weeklyCostDeltaCents: 0,
    summary: `${formatMoney(RULES.setupFeeCents)} telemetry setup; at most ${p.shareBps / 100}% of eligible paid requests, a ${p.sampleFloor}-request floor in each cohort, and ${formatUnits(p.budgetCUw)} candidate CUw allowance. The allowance is a hard work limit, not a cash prepayment. Normal serving tariffs and one customer invoice continue.` }
    : { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Stop experimental traffic at the next command boundary and send all public requests to the incumbent. Retain observed outcomes and the original invoice history.' };
}
function stop(canary: CanaryRelease, code: CanaryStopCode, message: string, week: number, routingWeek: number, severity: CanaryIncident['severity'] = 'major'): void {
  canary.status = 'stopped'; canary.stoppedWeek = week; canary.stopCode = code; canary.lastMessage = message;
  const assessment = assessCanary(canary);
  canary.incident = { id: `canary-incident:${canary.id}`, week, code, severity, productId: canary.productId,
    modelId: canary.candidateModelId, deploymentId: canary.sourceDeploymentId, candidateSamples: assessment.candidateSamples,
    incumbentSamples: assessment.incumbentSamples, sampleFloor: canary.sampleFloor, message, restoredRoutingWeek: routingWeek };
}
export function applyCanaryCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): DomainResult {
  if (!isCommand(command)) return {};
  const products = structuredClone(state.slices.products), p = command.payload;
  products.canaryReleases ??= {};
  if (p.kind === 'stop_release_canary') {
    const canary = products.canaryReleases[p.canaryId];
    stop(canary, 'manual', 'Canary stopped by the operator. All requests use the retained incumbent from this boundary.', state.week, state.week, 'notice');
    canary.stopCommandId = command.id;
    return { updates: { products }, messages: [{ category: 'project', companyId: command.companyId, message: canary.lastMessage }] };
  }
  const release = products.preparedReleases![p.releaseId], product = products.offers[release.productId], configuration = releaseConfiguration(state, product.id);
  const id = 'canary:' + command.id;
  products.canaryReleases[id] = { id, startCommandId: command.id, companyId: command.companyId, productId: product.id, releaseId: release.id,
    sourceDeploymentId: release.sourceDeployment.id, sourceModelId: release.sourceModelId, candidateModelId: release.candidateModelId,
    source: getEvaluatedReleaseIdentity(state, release.sourceModelId, content)!, candidate: getEvaluatedReleaseIdentity(state, release.candidateModelId, content)!,
    configuration, configurationFingerprint: canaryConfigurationFingerprint(state, product.id), productKind: product.kind,
    features: { ...configuration.features }, priceCents: products.contracts[product.contractId].weeklyPriceCents, allowance: configuration.allowance,
    evidenceKey: canaryEvidenceKey(state, command.companyId, product.id), shareBps: p.shareBps, sampleFloor: p.sampleFloor, budgetCUw: p.budgetCUw,
    startedWeek: state.week, availableWeek: state.week + 1, status: 'scheduled', qualifiedWeek: null, stoppedWeek: null,
    stopCommandId: null, stopCode: null, promotedWeek: null, consumedWorkCUw: 0, observations: [], incident: null,
    lastMessage: 'Paid telemetry is ready. The fixed candidate cohort begins at the following weekly boundary.' };
  return { updates: { products }, facts: [{ id: 'canary-setup:' + command.id, companyId: command.companyId, week: state.week,
    sourceId: id, category: 'operating', kind: 'expense', amountCents: RULES.setupFeeCents, label: 'Release canary telemetry setup' }],
    schedule: [{ id: 'canary-model:' + id, companyId: command.companyId, kind: 'model_release', targetId: release.candidateModelId, dueWeek: state.week + 1 }],
    messages: [{ category: 'project', companyId: command.companyId, message: quoteCanaryCommand(state, command).summary }] };
}

/** Match the incumbent's observed segment mix to the candidate's samples. A
 * cheap/easy segment cannot hide a regression in another paid workload. */
export function assessCanary(canary: CanaryRelease): CanaryAssessment {
  const bySegment = new Map<string, { source: { count: number; useful: number; confident: number; refusal: number }; candidate: { count: number; useful: number; confident: number; refusal: number } }>();
  let sourceCost = 0, candidateCost = 0;
  for (const receipt of canary.observations) {
    sourceCost += receipt.incumbent.attributedComputeCents; candidateCost += receipt.candidate.attributedComputeCents;
    for (const arm of ['incumbent', 'candidate'] as const) for (const segment of receipt[arm].segments) {
      const entry = bySegment.get(segment.segmentId) ?? { source: { count: 0, useful: 0, confident: 0, refusal: 0 }, candidate: { count: 0, useful: 0, confident: 0, refusal: 0 } };
      const row = arm === 'incumbent' ? entry.source : entry.candidate;
      row.count += segment.executedRequests; row.useful += segment.outcomes.useful; row.confident += segment.outcomes.confidentError; row.refusal += segment.outcomes.falseRefusal;
      bySegment.set(segment.segmentId, entry);
    }
  }
  const rows = [...bySegment.values()], candidateSamples = rows.reduce((sum, row) => sum + row.candidate.count, 0), incumbentSamples = rows.reduce((sum, row) => sum + row.source.count, 0);
  const candidateRate = (key: 'useful' | 'confident' | 'refusal') => candidateSamples ? mulDiv(rows.reduce((sum, row) => sum + row.candidate[key], 0), 10000, candidateSamples) : 0;
  const sourceRate = (key: 'useful' | 'confident' | 'refusal') => candidateSamples ? Number(rows.reduce((sum, row) => sum + (row.source.count
    ? BigInt(row.source[key]) * BigInt(row.candidate.count) * BigInt(10000) / BigInt(row.source.count) : BigInt(0)), BigInt(0)) / BigInt(candidateSamples)) : 0;
  return { candidateSamples, incumbentSamples, sufficient: candidateSamples >= canary.sampleFloor && incumbentSamples >= canary.sampleFloor && rows.every(row => !row.candidate.count || row.source.count > 0),
    candidateUsefulBps: candidateRate('useful'), incumbentUsefulBps: sourceRate('useful'),
    candidateConfidentErrorBps: candidateRate('confident'), incumbentConfidentErrorBps: sourceRate('confident'),
    candidateFalseRefusalBps: candidateRate('refusal'), incumbentFalseRefusalBps: sourceRate('refusal'),
    costRatioBps: sourceCost && candidateSamples && incumbentSamples ? Number(BigInt(candidateCost) * BigInt(incumbentSamples) * BigInt(10000) / (BigInt(sourceCost) * BigInt(candidateSamples))) : null };
}
export interface CanaryDecision { status: 'collecting' | 'qualified' | 'stopped'; code: CanaryStopCode | null; severity: CanaryIncident['severity']; message: string }
/** The live resolver and imported-save validator use the same ordered stop rule. */
export function automaticCanaryDecision(state: Readonly<GameState>, canary: CanaryRelease): CanaryDecision {
  const receipt = canary.observations.at(-1), assessment = assessCanary(canary);
  const stopped = (code: CanaryStopCode, message: string, severity: CanaryIncident['severity'] = 'major'): CanaryDecision => ({ status: 'stopped', code, message, severity });
  if (receipt) {
    const candidate = receipt.candidate, sourceService = receipt.sourceRequestedWorkCUw ? mulDiv(receipt.sourceEffectiveWorkCUw, 10000, receipt.sourceRequestedWorkCUw) : 10000;
    if (candidate.requestedRequests >= RULES.severeMinimumSamples && candidate.fulfillmentBps < 5000
      || candidate.executedRequests >= RULES.severeMinimumSamples && candidate.confidentErrorBps >= RULES.severeConfidentErrorBps)
      return stopped('severe-incident', 'Severe candidate availability or confident-error incident. Experimental traffic stops and the incumbent receives all new requests next week.', 'severe');
    if (candidate.requestedRequests && candidate.fulfillmentBps < RULES.minimumFulfillmentBps || sourceService < RULES.minimumFulfillmentBps)
      return stopped('headroom', 'The actual serving grants did not preserve 98% fulfillment. Experimental traffic stops; all new requests return to the incumbent next week.');
    if (assessment.sufficient) {
      const regressions = [assessment.incumbentUsefulBps - assessment.candidateUsefulBps >= RULES.regressionBps ? 'useful answers' : '',
        assessment.candidateConfidentErrorBps - assessment.incumbentConfidentErrorBps >= RULES.regressionBps ? 'confident errors' : '',
        assessment.candidateFalseRefusalBps - assessment.incumbentFalseRefusalBps >= RULES.regressionBps ? 'false refusals' : '',
        assessment.costRatioBps !== null && assessment.costRatioBps > RULES.maximumCostRatioBps ? 'GPU tariff cost per completed request' : ''].filter(Boolean);
      return regressions.length ? stopped('regression', `Canary regression in ${regressions.join(', ')}. The incumbent receives all new requests next week; the existing invoice settles this week’s actual work once.`)
        : { status: 'qualified', code: null, severity: 'notice', message: 'Both cohorts met the sample floor without triggering the stop rules. Canary traffic ends next week; choose the existing prepared handover to promote the candidate.' };
    }
    if (canary.budgetCUw - canary.consumedWorkCUw < requestMeter(state.slices.models.versions[canary.candidateModelId], canary.features).work)
      return stopped('budget', 'The candidate work allowance ended before sufficient evidence. Full rollout stays paused and all new requests return to the incumbent next week.', 'notice');
    if (canary.observations.length >= RULES.maximumObservations)
      return stopped('insufficient-sample', 'Eight observation weeks ended without the required sample. Full rollout stays paused; all new requests return to the incumbent next week.', 'notice');
  }
  return { status: 'collecting', code: null, severity: 'notice', message: `Collecting evidence: ${assessment.candidateSamples}/${canary.sampleFloor} candidate and ${assessment.incumbentSamples}/${canary.sampleFloor} incumbent completed requests. Full rollout stays paused.` };
}
function bindingReason(state: Readonly<GameState>, canary: CanaryRelease, content: GameContent): string | null {
  const product = state.slices.products.offers[canary.productId];
  if (!product || product.deploymentId !== canary.sourceDeploymentId || state.slices.products.deployments[product.deploymentId]?.modelId !== canary.sourceModelId
    || canaryConfigurationFingerprint(state, product.id) !== canary.configurationFingerprint) return 'The frozen incumbent or product configuration changed; experimental traffic has stopped.';
  const unsupported = canaryUnsupportedReason(state, product.id); if (unsupported) return unsupported.message;
  return evaluatedReleaseIdentityReason(state, canary.source, content)?.message ?? evaluatedReleaseIdentityReason(state, canary.candidate, content)?.message ?? null;
}
export function commitCanaries(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [], current = { ...state, slices: { ...state.slices, products } };
  for (const canary of Object.values(products.canaryReleases ?? {})) {
    const release = products.preparedReleases?.[canary.releaseId];
    if (canary.status === 'qualified' && release?.status === 'released') { canary.status = 'promoted'; canary.promotedWeek = release.releasedWeek; canary.lastMessage = 'The qualified candidate was handed over through its existing prepared release. Its paid rollback window is retained.'; continue; }
    if (!open(canary) || canary.availableWeek > ctx.week) continue;
    const reason = bindingReason(current, canary, ctx.content);
    if (reason || state.slices.company.companies[canary.companyId].arrearsCents) {
      stop(canary, reason ? 'configuration' : 'arrears', reason ?? 'Unpaid company bills stopped experimental traffic.', ctx.week, ctx.week);
      messages.push({ category: 'project', companyId: canary.companyId, message: canary.lastMessage });
    } else if (canary.status === 'scheduled') { canary.status = 'collecting'; canary.lastMessage = 'Collecting disjoint paid-request cohorts. Full rollout remains paused until the sample and stop rules pass.'; }
  }
  return messages;
}
export function resolveCanaries(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const canary of Object.values(products.canaryReleases ?? {})) {
    if (canary.status !== 'collecting') continue;
    const usage = products.lastUsage[canary.productId], receipt = usage?.week === ctx.week && usage.canary?.canaryId === canary.id ? usage.canary : undefined;
    if (!receipt) { stop(canary, 'configuration', 'Experimental traffic stopped because the product is no longer eligible or active.', ctx.week, ctx.week + 1); }
    else {
      if (canary.observations.some(item => item.week === ctx.week)) throw new Error('A canary observation cannot be settled twice.');
      canary.observations.push(structuredClone(receipt)); canary.consumedWorkCUw = checkedAdd(canary.consumedWorkCUw, receipt.candidate.effectiveWorkCUw);
      const decision = automaticCanaryDecision(state, canary);
      if (decision.status === 'stopped') stop(canary, decision.code!, decision.message, ctx.week, ctx.week + 1, decision.severity);
      else { canary.status = decision.status; if (decision.status === 'qualified') canary.qualifiedWeek = ctx.week; canary.lastMessage = decision.message; }
    }
    if (canary.status !== 'collecting') messages.push({ category: 'project', companyId: canary.companyId, message: canary.lastMessage });
  }
  return messages;
}
export function getCanaryView(state: Readonly<GameState>, productId?: string, content: GameContent = CONTENT): CanaryView {
  const owner = state.playerCompanyId, researched = hasResearch(state, owner, RULES.requiredResearch);
  const canaries = records(state).filter(item => item.companyId === owner && (!productId || item.productId === productId)).sort((a, b) => b.startedWeek - a.startedWeek || a.id.localeCompare(b.id));
  return freezeDeep({ researched, researchReason: researched ? null : 'Complete Release telemetry S3 to fund a metered public canary.',
    releases: Object.values(state.slices.products.preparedReleases ?? {}).filter(item => item.companyId === owner && item.status === 'ready' && !item.rollback && (!productId || item.productId === productId)).map(release => {
      const reason = releaseReason(state, release.id, owner, content);
      return { releaseId: release.id, productId: release.productId, productName: state.slices.products.offers[release.productId].name,
        sourceModelId: release.sourceModelId, sourceName: state.slices.models.versions[release.sourceModelId].name,
        candidateModelId: release.candidateModelId, candidateName: state.slices.models.versions[release.candidateModelId].name, eligible: !reason, reason: reason?.message ?? null };
    }), canaries: canaries.map(item => {
      const assessment = assessCanary(item), promotion = canaryPromotionReason(state, item.releaseId, content);
      return { ...structuredClone(item), productName: state.slices.products.offers[item.productId].name,
        sourceName: state.slices.models.versions[item.sourceModelId].name, candidateName: state.slices.models.versions[item.candidateModelId].name,
        activeShareBps: item.status === 'collecting' ? item.shareBps : 0, remainingBudgetCUw: item.budgetCUw - item.consumedWorkCUw,
        candidateSamples: assessment.candidateSamples, incumbentSamples: assessment.incumbentSamples, assessment,
        latest: structuredClone(item.observations.at(-1) ?? null), canStop: open(item), canPromote: item.status === 'qualified' && !promotion, promotionReason: promotion?.message ?? null };
    }), incidents: canaries.flatMap(item => item.incident ? [structuredClone(item.incident)] : []),
    rules: { setupFeeCents: RULES.setupFeeCents, shares: RULES.shares, minimumSample: RULES.minimumSample, maximumSample: RULES.maximumSample,
      maximumBudgetCUw: RULES.maximumBudgetCUw, maximumObservations: RULES.maximumObservations, regressionBps: RULES.regressionBps,
      maximumCostRatioBps: RULES.maximumCostRatioBps, minimumFulfillmentBps: RULES.minimumFulfillmentBps } });
}
