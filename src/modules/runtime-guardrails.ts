import { usesWorkPointProfiles } from './workforce';
import { facilityTariffBinding, facilityTariffIdentity } from './facility-tariffs';
import { CONTENT } from '../content/catalog';
import { DEFAULT_FEATURES } from '../content/wave2-market';
import { ROUTING } from '../content/wave4-research';
import { POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS } from '../content/wave11-policy';
import { RUNTIME_GUARDRAIL_PROFILES as PROFILES, RUNTIME_GUARDRAIL_RULES as RULES } from '../content/wave12-guardrails';
import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, ModuleContext, ProductOffer, ProductsSlice, Rejection, WeeklyUsage, WorkRequest } from '../contracts/types';
import type { PolicyHoldoutCase, PolicyHoldoutTotals } from '../contracts/wave11-policy';
import type { RuntimeGuardrailAudit, RuntimeGuardrailAuditCase, RuntimeGuardrailBinding, RuntimeGuardrailConfiguration, RuntimeGuardrailInstallation, RuntimeGuardrailModelBinding, RuntimeGuardrailProfile, RuntimeGuardrailUsage, RuntimeGuardrailView, RuntimeGuardrailWorkReceipt } from '../contracts/wave12-guardrails';
import { canonicalStateHash, hashText } from '../core/canonical';
import { checkedAdd, checkedInteger, formatUnits, mulDiv } from '../core/math';
import { RIVAL_STARTS } from '../core/wave2-state';
import { getCompatibleComputePools, getComputePools, getPoolWorkCostRate, getPoolMultiplierBps, poolSupportsWorkload, usesCrossRackTraining } from './compute-pools';
import { inheritedModelRights, modelExecutionHints } from './model-runtime';
import { paidPolicyCapabilityBaseline, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from './policy-holdouts';
import { activeEfficiency } from './product-efficiency';
import { routingSecondaryShareBps } from './product-strategy';
import { behaviorMeter, executionErrorBps, requestMeter, segmentForProduct } from './product-models';

export const RUNTIME_GUARDRAIL_COMMANDS = ['install_runtime_guardrail', 'set_runtime_guardrail_enabled'] as const;
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const records = (products: Readonly<ProductsSlice>): RuntimeGuardrailInstallation[] => Object.values(products.runtimeGuardrails ?? {});
const newestFirst = (a: RuntimeGuardrailInstallation, b: RuntimeGuardrailInstallation) => b.startedWeek - a.startedWeek || b.id.localeCompare(a.id);
const profile = (value: unknown): value is RuntimeGuardrailProfile => value === 'balanced' || value === 'strict';
export const runtimeGuardrailWorkId = (id: string, kind: 'compute' | 'ml') => `guardrail-work:${id}:${kind}`;

export function runtimeGuardrailResearchReady(state: Readonly<GameState>, companyId: string, atWeek = state.week): boolean {
  const completed = state.slices.research.completedByCompany[companyId] ?? (companyId === state.playerCompanyId ? state.slices.research.completed : []);
  return RULES.researchIds.every(id => {
    if (!completed.includes(id)) return false;
    const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId && item.researchId === id);
    return project ? project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek
      : companyId !== state.playerCompanyId && RIVAL_STARTS.some(item => `rival-${item.id}` === companyId && item.research.includes(id));
  });
}

function modelBinding(state: Readonly<GameState>, modelId: string): RuntimeGuardrailModelBinding | null {
  const model = state.slices.models.versions[modelId], report = policyHoldoutReport(state, modelId);
  if (!model || !report?.policy || !paidPolicyCapabilityBaseline(state, model, report.policy.baselineReportId, state.week)) return null;
  return { modelId, modelFingerprint: policyModelFingerprint(model), capabilityReportId: report.policy.baselineReportId, policyReportId: report.id };
}

/** Exact reports and runtime inputs, with no installation ID, profile, week or cache warmth. */
export function runtimeGuardrailBinding(state: Readonly<GameState>, productId: string): RuntimeGuardrailBinding | null {
  const product = state.slices.products.offers[productId], deployment = product && state.slices.products.deployments[product.deploymentId];
  if (!product || !['basic-chat', 'developer-api'].includes(product.kind) || !deployment || deployment.status !== 'active') return null;
  const primary = modelBinding(state, deployment.modelId); if (!primary) return null;
  const secondaryId = activeEfficiency(state, productId, 'routing')?.secondaryModelId;
  const secondary = secondaryId ? modelBinding(state, secondaryId) : null;
  if (secondaryId && !secondary) return null;
  return { productKind: product.kind as RuntimeGuardrailBinding['productKind'], primary, secondary,
    secondaryShareBps: secondary ? routingSecondaryShareBps(product) : 0, features: { ...(product.features ?? DEFAULT_FEATURES) } };
}

export function runtimeGuardrailBindingFingerprint(binding: RuntimeGuardrailBinding): string { return canonicalStateHash(binding); }
export function runtimeGuardrailEvidenceKey(state: Readonly<GameState>, companyId: string): string {
  return canonicalStateHash({ seed: state.seed, companyId, protocol: RULES.protocol });
}
export function runtimeGuardrailInputsMatch(state: Readonly<GameState>, installation: RuntimeGuardrailInstallation): boolean {
  const binding = runtimeGuardrailBinding(state, installation.productId);
  return !!binding && runtimeGuardrailBindingFingerprint(binding) === installation.bindingFingerprint;
}
export function currentRuntimeGuardrail(state: Readonly<GameState>, productId: string): RuntimeGuardrailInstallation | null {
  return records(state.slices.products).filter(item => item.productId === productId && item.status === 'active').sort(newestFirst)[0] ?? null;
}
export function pendingRuntimeGuardrail(state: Readonly<GameState>, productId: string): RuntimeGuardrailInstallation | null {
  return records(state.slices.products).find(item => item.productId === productId && item.status !== 'active') ?? null;
}
export function activeRuntimeGuardrail(state: Readonly<GameState>, productId: string): RuntimeGuardrailInstallation | null {
  const installation = currentRuntimeGuardrail(state, productId);
  return installation?.enabled && runtimeGuardrailInputsMatch(state, installation) ? installation : null;
}
export function runtimeGuardrailWorkPerRequest(state: Readonly<GameState>, productId: string): number {
  const installation = activeRuntimeGuardrail(state, productId); return installation ? PROFILES[installation.profile].workPerRequestCUw : 0;
}
export function runtimeGuardrailMemory(state: Readonly<GameState>, productId: string): number {
  const installation = activeRuntimeGuardrail(state, productId); return installation ? PROFILES[installation.profile].memoryMU : 0;
}

export function releaseGuardrailConfiguration(state: Readonly<GameState>, productId: string): RuntimeGuardrailConfiguration | undefined {
  const current = currentRuntimeGuardrail(state, productId), pending = pendingRuntimeGuardrail(state, productId), installation = current ?? pending;
  if (!installation) return;
  return { installationId: installation.id, profile: installation.profile, enabled: current?.enabled ?? false,
    bindingFingerprint: installation.bindingFingerprint, ...(pending ? { pendingInstallationId: pending.id } : {}) };
}

export function runtimeGuardrailRolloutMemory(state: Readonly<GameState>, binding: RuntimeGuardrailBinding, selected: RuntimeGuardrailProfile): number {
  const primary = state.slices.models.versions[binding.primary.modelId], secondary = binding.secondary && state.slices.models.versions[binding.secondary.modelId];
  return checkedAdd(checkedAdd(primary.residentMU, secondary?.residentMU ?? 0), checkedAdd(requestMeter(primary, binding.features).sessionMemory, PROFILES[selected].memoryMU));
}

function baselineUnsafe(state: Readonly<GameState>, binding: RuntimeGuardrailBinding): number {
  const tendency = (modelId: string) => state.slices.models.versions[modelId].policy?.currentUnsafeComplianceBps ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS;
  return binding.secondary ? mulDiv(tendency(binding.primary.modelId), 10000 - binding.secondaryShareBps, 10000)
    + mulDiv(tendency(binding.secondary.modelId), binding.secondaryShareBps, 10000) : tendency(binding.primary.modelId);
}

export function runtimeGuardrailAddedRefusalBps(baseFalseRefusalBps: number, technicalErrorBps: number, selected: RuntimeGuardrailProfile): number {
  const remainingUseful = Math.max(0, 10000 - technicalErrorBps - baseFalseRefusalBps);
  return mulDiv(remainingUseful, PROFILES[selected].allowedBlockBps, 10000);
}
export function guardrailFalseRefusalBps(baseFalseRefusalBps: number, technicalErrorBps: number, usage?: RuntimeGuardrailUsage): number {
  return usage?.checkedRequests ? baseFalseRefusalBps + runtimeGuardrailAddedRefusalBps(baseFalseRefusalBps, technicalErrorBps, usage.profile) : baseFalseRefusalBps;
}

type SessionTraffic = Pick<WeeklyUsage, 'consumerSessions' | 'paidRequestedWork' | 'paidExecutedWork' | 'trialRequestedWork' | 'trialExecutedWork'>;

export function measuredRuntimeGuardrailUsage(input: Pick<RuntimeGuardrailUsage, 'installationId' | 'profile' | 'bindingFingerprint' | 'requestWorkCUw' | 'baselineFalseRefusalBps' | 'technicalErrorBps' | 'baselineUnsafeComplianceBps'>,
  requestedWork: number, executedWork: number, traffic?: SessionTraffic): RuntimeGuardrailUsage {
  const rule = PROFILES[input.profile];
  const paidWork = traffic?.consumerSessions?.paidWorkPerExchange;
  const requestedRequests = traffic && paidWork ? mulDiv(traffic.paidRequestedWork, 1, paidWork, 'ceil') + mulDiv(traffic.trialRequestedWork, 1, input.requestWorkCUw, 'ceil')
    : mulDiv(requestedWork, 1, input.requestWorkCUw, 'ceil');
  const checkedRequests = traffic && paidWork ? mulDiv(traffic.paidExecutedWork, 1, paidWork) + mulDiv(traffic.trialExecutedWork, 1, input.requestWorkCUw)
    : mulDiv(executedWork, 1, input.requestWorkCUw);
  const checkWorkCUw = traffic && paidWork ? mulDiv(traffic.paidExecutedWork, rule.workPerRequestCUw, paidWork) + mulDiv(traffic.trialExecutedWork, rule.workPerRequestCUw, input.requestWorkCUw)
    : mulDiv(executedWork, rule.workPerRequestCUw, input.requestWorkCUw);
  const addedFalseRefusalBps = checkedRequests > 0 ? runtimeGuardrailAddedRefusalBps(input.baselineFalseRefusalBps, input.technicalErrorBps, input.profile) : 0;
  return { ...input, checkWorkCUw,
    requestedRequests, checkedRequests, uncheckedRequests: requestedRequests - checkedRequests,
    addedFalseRefusalBps, additionalFalseRefusals: mulDiv(checkedRequests, addedFalseRefusalBps, 10000),
    guardedUnsafeComplianceBps: mulDiv(input.baselineUnsafeComplianceBps, 10000 - rule.unsafeCatchBps, 10000) };
}

export function measureRuntimeGuardrails(state: Readonly<GameState>, product: ProductOffer, requestedWork: number, executedWork: number,
  requestWorkCUw: number, baselineFalseRefusalBps: number, technicalErrorBps: number, traffic?: SessionTraffic): RuntimeGuardrailUsage | undefined {
  const installation = activeRuntimeGuardrail(state, product.id); if (!installation) return;
  return measuredRuntimeGuardrailUsage({ installationId: installation.id, profile: installation.profile, bindingFingerprint: installation.bindingFingerprint,
    requestWorkCUw, baselineFalseRefusalBps, technicalErrorBps, baselineUnsafeComplianceBps: baselineUnsafe(state, installation.binding) }, requestedWork, executedWork, traffic);
}

const allowedCategories: PolicyHoldoutCase['category'][] = ['privacy', 'permission', 'valid-sensitive-request', 'harmful-assistance'];
const restrictedCategories: PolicyHoldoutCase['category'][] = ['privacy', 'permission', 'harmful-assistance'];
function auditTotals(cases: readonly RuntimeGuardrailAuditCase[], arm: 'baseline' | 'guarded'): PolicyHoldoutTotals {
  const count = (predicate: (item: RuntimeGuardrailAuditCase) => boolean) => cases.filter(predicate).length;
  const result = (outcome: PolicyHoldoutCase['outcome']) => count(item => item[arm] === outcome);
  return { cases: cases.length, allowedCases: count(item => item.eligibility === 'allowed'), usefulAnswers: result('useful'),
    confidentErrors: result('confident-error'), falseRefusals: result('false-refusal'), clarifications: result('clarification'),
    restrictedCases: count(item => item.eligibility === 'restricted'), correctPolicyRefusals: result('correct-policy-refusal'), unsafeCompliances: result('unsafe-compliance'),
    directRestrictedCases: count(item => item.eligibility === 'restricted' && item.challenge === 'direct'),
    directUnsafeCompliances: count(item => item.challenge === 'direct' && item[arm] === 'unsafe-compliance'),
    adversarialRestrictedCases: count(item => item.eligibility === 'restricted' && item.challenge === 'adversarial'),
    adversarialUnsafeCompliances: count(item => item.challenge === 'adversarial' && item[arm] === 'unsafe-compliance') };
}

/** Pure fixed audit recipe. Only the paid rollout's following commit exposes its report. */
export function runtimeGuardrailAudit(state: Readonly<GameState>, installation: Pick<RuntimeGuardrailInstallation, 'binding' | 'bindingFingerprint' | 'profile' | 'evidenceKey'>): RuntimeGuardrailAudit {
  const { binding, profile: selected, evidenceKey } = installation, rule = PROFILES[selected], segments = segmentForProduct(binding.productKind);
  let baselineStandardWorkCUw = 0;
  const cases: RuntimeGuardrailAuditCase[] = Array.from({ length: RULES.cases }, (_, index) => {
    // Every block of five probes gives the easy route three cases, including both eligibility classes and challenges.
    const route = binding.secondary && index % 5 < 3 ? 'secondary' : 'primary';
    const modelId = (route === 'secondary' ? binding.secondary! : binding.primary).modelId, model = state.slices.models.versions[modelId];
    const eligibility = index < RULES.allowedCases ? 'allowed' : 'restricted', groupIndex = index % RULES.allowedCases;
    const challenge = groupIndex < 25 ? 'direct' : 'adversarial', categories = eligibility === 'allowed' ? allowedCategories : restrictedCategories;
    const category = categories[groupIndex % categories.length];
    const draw = parseInt(hashText(`${evidenceKey}:reserved-runtime-policy-case:${index + 1}`), 16) % 10000;
    const checkDraw = parseInt(hashText(`${evidenceKey}:runtime-check:${index + 1}`), 16) % 10000;
    let baseline: PolicyHoldoutCase['outcome'];
    if (eligibility === 'restricted') {
      const unsafe = model.policy?.currentUnsafeComplianceBps ?? POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS;
      const pressure = mulDiv(unsafe, challenge === 'direct' ? 7500 : 12500, 10000);
      baseline = draw < Math.min(10000, pressure) ? 'unsafe-compliance' : 'correct-policy-refusal';
    } else {
      const segment = segments[binding.productKind === 'basic-chat' ? groupIndex % segments.length : 0];
      const error = executionErrorBps(model, segment, binding.features), behavior = behaviorMeter(model, error);
      const refusal = Math.min(10000 - error, behavior.falseRefusalBps), useful = 10000 - error - refusal;
      baseline = draw < useful ? 'useful' : draw < useful + refusal ? 'false-refusal'
        : draw < useful + refusal + behavior.confidentErrorBps ? 'confident-error' : 'clarification';
    }
    const guarded = baseline === 'unsafe-compliance' && checkDraw < rule.unsafeCatchBps ? 'correct-policy-refusal'
      : baseline === 'useful' && checkDraw < rule.allowedBlockBps ? 'false-refusal' : baseline;
    baselineStandardWorkCUw = checkedAdd(baselineStandardWorkCUw, requestMeter(model, binding.features).work + (binding.secondary ? ROUTING.overheadPerRequest : 0));
    return { id: `runtime-policy-case-${String(index + 1).padStart(3, '0')}`, modelId, route, category, eligibility, challenge, baseline, guarded };
  });
  return { protocol: RULES.protocol, evidenceKey, bindingFingerprint: installation.bindingFingerprint, profile: selected,
    baseline: auditTotals(cases, 'baseline'), guarded: auditTotals(cases, 'guarded'),
    primaryCases: cases.filter(item => item.route === 'primary').length, secondaryCases: cases.filter(item => item.route === 'secondary').length,
    baselineStandardWorkCUw, guardedStandardWorkCUw: baselineStandardWorkCUw + RULES.cases * rule.workPerRequestCUw, cases };
}

export function validateRuntimeGuardrail(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload;
  if (p.kind !== 'install_runtime_guardrail' && p.kind !== 'set_runtime_guardrail_enabled') return reject('INVALID_COMMAND', 'Choose an implemented runtime guardrail action.');
  const company = state.slices.company.companies[command.companyId], product = state.slices.products.offers[p.productId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (company.arrearsCents) return reject('ARREARS', 'This lab has unpaid bills and cannot continue. Inspect or export this run, or start a new lab.');
  if (!product || product.companyId !== command.companyId || !['basic-chat', 'developer-api'].includes(product.kind) || product.status === 'deploying'
    || state.slices.products.deployments[product.deploymentId]?.status !== 'active') return reject('NOT_READY', 'Choose one of your deployed Chat or developer API products. Other delivery channels retain their existing obligations.');
  const current = currentRuntimeGuardrail(state, p.productId);
  if (p.kind === 'set_runtime_guardrail_enabled') {
    if (!current || typeof p.enabled !== 'boolean') return reject('NOT_READY', 'Finish a runtime guardrail rollout before changing its operating state.');
    if (current.enabled === p.enabled) return reject('ALREADY_ACTIVE', 'This installed checker already has that operating choice.');
    if (p.enabled && !runtimeGuardrailInputsMatch(state, current)) return reject('NOT_READY', 'The exact model, route or features changed. Install and audit a checker for the current inputs.');
    return;
  }
  if (!profile(p.profile)) return reject('INVALID_COMMAND', 'Choose the balanced or strict runtime profile.');
  if (!runtimeGuardrailResearchReady(state, command.companyId)) return reject('NOT_READY', 'Research Behavior cases (R1A) and Preference tuning (R5) before implementing runtime guardrails.');
  if (pendingRuntimeGuardrail(state, p.productId) || state.queuedCommands.some(item => item.id !== command.id
    && item.payload.kind === 'install_runtime_guardrail' && item.payload.productId === p.productId)) return reject('ALREADY_ACTIVE', 'This product already has a queued or unfinished guardrail rollout. Finish its paid work first.');
  const binding = runtimeGuardrailBinding(state, p.productId);
  if (!binding) return reject('NOT_READY', 'The primary model and any active routed model each need their own exact paid capability and policy-boundary reports.');
  for (const model of [binding.primary, ...(binding.secondary ? [binding.secondary] : [])]) {
    const reason = policyReleaseRejection(state, model.modelId); if (reason) return reason;
    if (!inheritedModelRights(state, model.modelId, content).hosted) return reject('NOT_READY', 'Every checked route must retain hosted-use rights.');
  }
  if (current?.profile === p.profile && current.bindingFingerprint === runtimeGuardrailBindingFingerprint(binding)) return reject('ALREADY_ACTIVE', 'This exact profile and source already have a paid installation. Use its operating toggle.');
  const history = records(state.slices.products);
  if (history.length >= RULES.maximumHistory || history.filter(item => item.productId === product.id).length >= RULES.maximumPerProduct) return reject('CAPACITY_EXCEEDED', 'The retained guardrail history is full: at most eight installations per product and sixteen overall.');
  const primary = state.slices.models.versions[binding.primary.modelId], memory = runtimeGuardrailRolloutMemory(state, binding, p.profile);
  if (!getCompatibleComputePools(state, command.companyId, modelExecutionHints(primary), content).some(pool => pool.memoryMU >= memory
    && (!binding.secondary || poolSupportsWorkload(pool, modelExecutionHints(state.slices.models.versions[binding.secondary.modelId]))))) return reject('MISSING_MEMORY', 'Provide a connected inference-compatible pool for the primary, any routed model, one session, and the checker’s resident workspace.');
}

export function quoteRuntimeGuardrail(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload;
  if (p.kind === 'install_runtime_guardrail') {
    const rule = PROFILES[p.profile];
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${rule.name} runtime guardrails: 2 development CUw and ${usesWorkPointProfiles(state) ? '40 Design points, at most 1 CUw and 20 Design points per week' : '2 ML staff-weeks, at most 1 of each per week'}, including the fixed paired audit. Keep both source routes and ${formatUnits(rule.memoryMU)} MU of checker memory resident. Existing protection continues during replacement; the new profile activates at the boundary after paid work finishes. Each checked request then adds ${(rule.workPerRequestCUw / 1_000_000_000).toFixed(5)} CUw without adding customer tokens. Model, route or feature changes make this binding stale.` };
  }
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Change the latest completed checker next week. Enabled checks consume serving compute and may refuse otherwise useful allowed requests. This does not change model weights, customer token rates, or the model’s commercial admission evidence.' };
}

export function applyRuntimeGuardrail(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const products = structuredClone(state.slices.products), p = command.payload;
  let message = '';
  if (p.kind === 'install_runtime_guardrail') {
    const binding = runtimeGuardrailBinding(state, p.productId)!; const id = `guardrail:${command.id}`;
    products.runtimeGuardrails ??= {};
    products.runtimeGuardrails[id] = { id, companyId: command.companyId, productId: p.productId, protocol: RULES.protocol, profile: p.profile,
      binding, bindingFingerprint: runtimeGuardrailBindingFingerprint(binding), evidenceKey: runtimeGuardrailEvidenceKey(state, command.companyId),
      status: 'building', enabled: true, startedWeek: state.week, completedWeek: null, availableWeek: null,
      requiredWork: RULES.requiredWork, completedWork: 0, physicalWork: 0, memoryMU: runtimeGuardrailRolloutMemory(state, binding, p.profile),
      requiredStaff: RULES.requiredStaff, completedStaff: 0, workReceipts: {}, latestGrant: null,
      staffGrantCount: 0, firstStaffWeek: null, latestStaffGrant: null, audit: null,
      lastBottleneck: usesWorkPointProfiles(state) ? 'Installation needs development compute with the full model workspace and Design points. Each meter can advance independently.' : 'Assign development compute with the full captured resident workspace and ML staff; each meter can progress independently.' };
    message = `${PROFILES[p.profile].name} runtime guardrail rollout started. The fixed paired audit is included in its paid work; any previous matching checker continues until replacement activation.`;
  } else if (p.kind === 'set_runtime_guardrail_enabled') {
    const current = currentRuntimeGuardrail(state, p.productId)!; products.runtimeGuardrails![current.id].enabled = p.enabled;
    message = `Runtime guardrails ${p.enabled ? 'enabled' : 'disabled'} for this product. Model weights and customer token rates are unchanged.`;
  }
  return { updates: { products }, messages: [{ companyId: command.companyId, category: 'project', message }] };
}

export function runtimeGuardrailRequests(state: Readonly<GameState>): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const item of records(state.slices.products)) {
    if (item.status !== 'building' || state.slices.company.companies[item.companyId].arrearsCents) continue;
    if (item.completedWork < item.requiredWork) requests.push({ id: runtimeGuardrailWorkId(item.id, 'compute'), companyId: item.companyId,
      taskId: item.id, category: 'development', normalizedWorkCUw: Math.min(RULES.maximumWeeklyWork, item.requiredWork - item.completedWork),
      memoryMU: item.memoryMU, priority: RULES.requestPriority, poolId: 'auto', ...modelExecutionHints(state.slices.models.versions[item.binding.primary.modelId]) });
    if (item.completedStaff < item.requiredStaff) requests.push({ id: runtimeGuardrailWorkId(item.id, 'ml'), companyId: item.companyId,
      taskId: item.id, category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: RULES.requestPriority, poolId: 'auto',
      staffDemand: [{ role: 'ml', staffWeeks: Math.min(RULES.maximumWeeklyStaff, item.requiredStaff - item.completedStaff) }] });
  }
  return requests;
}

export function runtimeGuardrailReceiptKey(receipt: Pick<RuntimeGuardrailWorkReceipt, 'hardwareId' | 'ownership' | 'multiplierBps' | 'rateCentsPerCUw' | 'facilityTariff'>): string {
  return canonicalStateHash({ hardwareId: receipt.hardwareId, ownership: receipt.ownership, multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw, ...facilityTariffIdentity(receipt) });
}

export function advanceRuntimeGuardrails(state: Readonly<GameState>, products: ProductsSlice, context: ModuleContext): void {
  for (const item of records(products)) {
    if (item.status !== 'building') continue;
    if (state.slices.company.companies[item.companyId].arrearsCents) { item.lastBottleneck = 'Unpaid expenses suspend the remaining rollout.'; continue; }
    const grant = context.resources.computeGrants.find(value => value.requestId === runtimeGuardrailWorkId(item.id, 'compute'));
    if (grant?.hardwareEffectiveCUw) {
      const remaining = item.requiredWork - item.completedWork, requested = Math.min(RULES.maximumWeeklyWork, remaining);
      const pool = getComputePools(state, item.companyId, context.content, context.resources.staffGrants).find(value => value.id === grant.poolId);
      const primary = state.slices.models.versions[item.binding.primary.modelId];
      if (!pool || !poolSupportsWorkload(pool, modelExecutionHints(primary)) || item.binding.secondary
        && !poolSupportsWorkload(pool, modelExecutionHints(state.slices.models.versions[item.binding.secondary.modelId]))
        || grant.hardwareEffectiveCUw > requested || grant.memoryMU !== item.memoryMU || grant.sharedMemoryMU) throw new Error('Runtime guardrail rollout lost its exact model workspace, compatible hardware, or bounded request.');
      const multiplierBps = getPoolMultiplierBps(pool, 'development', usesCrossRackTraining(pool, 'development', grant.physicalCUw, item.memoryMU), context.content, 'inference');
      if (grant.physicalCUw <= 0 || grant.hardwareEffectiveCUw !== Math.min(requested, mulDiv(grant.physicalCUw, multiplierBps, 10000))) throw new Error('Runtime guardrail rollout has no matching physical GPU grant.');
      const facilityBinding = facilityTariffBinding(pool, { category: 'development', workloadKind: 'inference' });
      const rateCentsPerCUw = pool.ownership === 'cloud' ? context.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, { category: 'development', workloadKind: 'inference' });
      const key = runtimeGuardrailReceiptKey({ hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw, ...facilityBinding });
      const receipt = item.workReceipts[key] ??= { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw, ...facilityBinding,
        physicalCUw: 0, effectiveCUw: 0, conversionRemainder: 0, grants: 0, firstWeek: context.week, lastWeek: context.week };
      const remainder = checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grant.hardwareEffectiveCUw) * BigInt(10000)));
      receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw); receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grant.hardwareEffectiveCUw);
      receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder, remainder); receipt.grants += 1; receipt.lastWeek = context.week;
      item.completedWork = checkedAdd(item.completedWork, grant.hardwareEffectiveCUw); item.physicalWork = checkedAdd(item.physicalWork, grant.physicalCUw);
      item.latestGrant = { week: context.week, poolId: grant.poolId, receiptKey: key, remainingBefore: remaining, requestedWork: requested,
        effectiveCUw: grant.hardwareEffectiveCUw, physicalCUw: grant.physicalCUw, memoryMU: grant.memoryMU };
    }
    const staff = context.resources.staffGrants.find(value => value.requestId === runtimeGuardrailWorkId(item.id, 'ml'))?.grants.find(value => value.role === 'ml')?.staffWeeks ?? 0;
    const remainingStaff = item.requiredStaff - item.completedStaff;
    if (staff > Math.min(RULES.maximumWeeklyStaff, remainingStaff)) throw new Error('Runtime guardrail rollout exceeded its weekly ML review limit.');
    if (staff > 0) {
      item.latestStaffGrant = { week: context.week, remainingBefore: remainingStaff, grantedStaff: staff };
      item.firstStaffWeek ??= context.week; item.staffGrantCount += 1; item.completedStaff = checkedAdd(item.completedStaff, staff);
    }
    const needsCompute = item.completedWork < item.requiredWork, needsStaff = item.completedStaff < item.requiredStaff;
    item.lastBottleneck = needsCompute && needsStaff ? (usesWorkPointProfiles(state) ? 'Needs development compute with all captured resident models and Design points; at most 1 CUw and 20 Design points each week.' : 'Needs development compute with all captured resident models and ML staff; at most 1 CUw and 1 staff-week each week.')
      : needsCompute ? 'ML work finished; provide development compute and the full resident workspace.'
        : needsStaff ? (usesWorkPointProfiles(state) ? 'GPU work finished; generate Design points, up to 20 each week.' : 'GPU work finished; assign ML staff, up to 1 staff-week each week.') : '';
  }
}

export function resolveRuntimeGuardrails(_state: Readonly<GameState>, products: ProductsSlice, context: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const item of records(products)) if (item.status === 'building' && item.completedWork === item.requiredWork && item.completedStaff === item.requiredStaff) {
    item.status = 'ready'; item.completedWeek = context.week; item.availableWeek = context.week + 1;
    item.lastBottleneck = `Rollout and audit review finished; results and activation become available in Week ${item.availableWeek}.`;
    messages.push({ companyId: item.companyId, category: 'project', message: 'Runtime guardrail rollout and paid audit work finished. Activation and the report arrive at the following weekly boundary.' });
  }
  return messages;
}

export function commitRuntimeGuardrails(state: Readonly<GameState>, products: ProductsSlice, context: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const item of records(products)) if (item.status === 'ready' && item.availableWeek !== null && item.availableWeek <= context.week) {
    for (const previous of records(products)) if (previous.productId === item.productId && previous.id !== item.id && previous.status === 'active') previous.enabled = false;
    item.status = 'active'; item.audit = runtimeGuardrailAudit(state, item);
    const matching = runtimeGuardrailInputsMatch(state, item);
    item.lastBottleneck = matching ? '' : 'The captured model, route or features changed during rollout. The paid report is retained; install a checker for the current inputs before it can affect serving.';
    messages.push({ companyId: item.companyId, category: 'delivery', message: matching
      ? `${PROFILES[item.profile].name} runtime checker is active. Its paired audit is available; actual requests now consume the additional checking work.`
      : 'Runtime guardrail audit is available, but its source changed during rollout. This stale checker provides no serving effect.' });
  }
  return messages;
}

export function getRuntimeGuardrailView(state: Readonly<GameState>, productId: string): RuntimeGuardrailView {
  const product = state.slices.products.offers[productId], current = currentRuntimeGuardrail(state, productId), pending = pendingRuntimeGuardrail(state, productId);
  const installation = current ?? pending, researched = !!product && runtimeGuardrailResearchReady(state, product.companyId);
  const capturedInputsMatch = !!installation && runtimeGuardrailInputsMatch(state, installation), active = product?.status === 'active' && !!activeRuntimeGuardrail(state, productId);
  const last = state.slices.products.lastUsage[productId];
  return { researched, installation, pending, active, capturedInputsMatch,
    status: !researched ? 'Research R1A and R5 before implementing runtime guardrails.' : !installation ? 'Choose a profile and pay for its implementation and paired audit.'
      : installation.status === 'building' ? 'Implementation and audit need development compute and ML staff.'
        : installation.status === 'ready' ? 'Work finished; the report and activation arrive at the next weekly boundary.'
          : !capturedInputsMatch ? 'The model, route or features changed. This checker is stale and has no serving effect; install for the current inputs.'
            : !installation.enabled ? 'The latest completed runtime checker is disabled.'
              : product.status !== 'active' ? 'The checker is ready; the product is not serving.'
                : pending ? 'The current checker continues while a replacement completes its paid rollout.' : 'Runtime checks are active for the exact captured serving configuration.',
    usage: last?.guardrail ?? null, usageWeek: last?.guardrail ? last.week : null };
}

/** Actual-grant tariff estimate, never an extra invoice or a reallocation of settled cents. */
export function runtimeGuardrailTariffEstimateCents(installation: RuntimeGuardrailInstallation): number {
  return Number(Object.values(installation.workReceipts).reduce((sum, item) => sum + BigInt(item.physicalCUw) * BigInt(item.rateCentsPerCUw), BigInt(0)) / BigInt(1_000_000_000));
}

export function runtimeGuardrailBaselineUnsafeBps(state: Readonly<GameState>, binding: RuntimeGuardrailBinding): number { return baselineUnsafe(state, binding); }
