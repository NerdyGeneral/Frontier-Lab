import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { formatWorkPoints } from './workforce-points';
import type { DomainResult, GameCommand, GameContent, GameState, ModelVersion, ModuleContext, ProductOffer, ProductsSlice, Rejection, WorkRequest } from '../contracts/types';
import type { ProductEfficiencyInstall, ProductEfficiencyKind, ProductEfficiencyView } from '../contracts/wave4-research';
import { EFFICIENCY_RULES, PREFIX_CACHE, ROUTING } from '../content/wave4-research';
import { policyReleaseRejection } from './policy-holdouts';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, formatUnits, mulDiv } from '../core/math';
import { getCompatibleComputePools, poolSupportsWorkload } from './compute-pools';
import { hasCapabilityEvaluation, inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';
import { BASE_BEHAVIOR } from './lab-planner';
import { activeEvidenceCheck, evidenceInputsMatch } from './retrieval-evidence';
import { advancedScores } from './advanced-skills';
import { routingSecondaryShareBps } from './product-strategy';
import { aiSystemSessionMemory } from './ai-systems';

const U = 1_000_000_000;
export const PRODUCT_EFFICIENCY_COMMANDS = ['install_product_efficiency', 'set_product_efficiency_enabled'] as const;
const key = (productId: string, method: ProductEfficiencyKind) => productId + ':' + method;
const workId = (id: string) => 'efficiency-work:' + id;
export function efficiencyInstall(state: Readonly<GameState>, productId: string, method: ProductEfficiencyKind): ProductEfficiencyInstall | null {
  return state.slices.products.efficiencyInstalls?.[key(productId, method)] ?? null;
}
export function activeEfficiency(state: Readonly<GameState>, productId: string, method: ProductEfficiencyKind): ProductEfficiencyInstall | null {
  if (method === 'evidence-links') return activeEvidenceCheck(state, productId);
  const installation = efficiencyInstall(state, productId, method), product = state.slices.products.offers[productId];
  return installation?.status === 'active' && installation.enabled && state.slices.products.deployments[product?.deploymentId]?.modelId === installation.modelId ? installation : null;
}
export function routedModel(state: Readonly<GameState>, product: ProductOffer, base: ModelVersion): ModelVersion {
  const routing = activeEfficiency(state, product.id, 'routing');
  if (!routing?.secondaryModelId) return base;
  const secondary = state.slices.models.versions[routing.secondaryModelId], easy = routingSecondaryShareBps(product);
  const mix = (primary: number, alternate: number) => mulDiv(primary, 10000 - easy, 10000) + mulDiv(alternate, easy, 10000);
  const firstBehavior = base.behavior ?? BASE_BEHAVIOR, secondBehavior = secondary.behavior ?? BASE_BEHAVIOR;
  const primaryAdvanced = advancedScores(base), secondaryAdvanced = advancedScores(secondary);
  return { ...base, capabilityBps: Object.fromEntries(Object.entries(base.capabilityBps).map(([domain, score]) => [domain, mix(score, secondary.capabilityBps[domain as keyof ModelVersion['capabilityBps']])])) as ModelVersion['capabilityBps'],
    ...((routing.routingProtocol === 2 || product.strategy) && (base.advancedCapabilities || secondary.advancedCapabilities) ? { advancedCapabilities: {
      reasoning: mix(primaryAdvanced.reasoning, secondaryAdvanced.reasoning),
      longContext: mix(primaryAdvanced.longContext, secondaryAdvanced.longContext),
      multimodal: mix(primaryAdvanced.multimodal, secondaryAdvanced.multimodal),
    } } : {}),
    reliabilityBps: mix(base.reliabilityBps, secondary.reliabilityBps), behavior: { confidentErrorBps: mix(firstBehavior.confidentErrorBps, secondBehavior.confidentErrorBps), falseRefusalBps: mix(firstBehavior.falseRefusalBps, secondBehavior.falseRefusalBps) } };
}
export function efficiencyCacheKey(state: Readonly<GameState>, product: ProductOffer): string {
  const modelId = state.slices.products.deployments[product.deploymentId]?.modelId, routing = activeEfficiency(state, product.id, 'routing');
  const retrieval = Object.values(state.slices.products.retrievalInstalls ?? {}).find(installation => installation.productId === product.id && installation.status === 'active');
  return 'prefix:' + canonicalStateHash({ tenant: product.companyId, product: product.id, modelId, route: routing?.secondaryModelId ?? null,
    ...(product.strategy ? { routingPolicy: product.strategy.routingPolicy } : {}),
    features: product.features ?? { memory: false, extendedContext: false, deepReasoning: false }, retrieval: retrieval?.id ?? null });
}
export function cacheWarm(state: Readonly<GameState>, product: ProductOffer): boolean {
  const installation = activeEfficiency(state, product.id, 'prefix-cache');
  return !!installation && installation.cacheKey === efficiencyCacheKey(state, product) && installation.warmedWeek !== undefined && installation.warmedWeek < state.week && installation.lastServedWeek !== undefined && installation.lastServedWeek >= state.week - PREFIX_CACHE.lifetimeWeeks;
}
export function productEfficiencyMemory(state: Readonly<GameState>, product: ProductOffer, tenants: number): number {
  const route = activeEfficiency(state, product.id, 'routing'), cache = activeEfficiency(state, product.id, 'prefix-cache');
  return (route?.secondaryModelId ? state.slices.models.versions[route.secondaryModelId].residentMU : 0) + (cache ? PREFIX_CACHE.memoryMU + tenants * PREFIX_CACHE.tenantMemoryMU : 0);
}
/** Routed models retain separate operating state even when their request session is shared. */
export function productRoutingStateMemory(state: Readonly<GameState>, product: ProductOffer, tenants = 1): number {
  const route = activeEfficiency(state, product.id, 'routing');
  if (!route?.secondaryModelId || route.secondaryModelId === route.modelId) return 0;
  return aiSystemSessionMemory(state.slices.models.versions[route.secondaryModelId]) * tenants;
}
export function getProductEfficiencyView(state: Readonly<GameState>, productId: string): ProductEfficiencyView {
  const product = state.slices.products.offers[productId], primary = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId], model = routedModel(state, product, primary);
  const tenants = [...state.slices.markets.cohorts, ...state.slices.markets.trials].filter(cohort => cohort.productId === productId).reduce((sum, cohort) => sum + cohort.count, 0);
  const routingActive = !!activeEfficiency(state, productId, 'routing'), cacheActive = !!activeEfficiency(state, productId, 'prefix-cache'), warm = cacheWarm(state, product);
  return { routing: efficiencyInstall(state, productId, 'routing'), prefixCache: efficiencyInstall(state, productId, 'prefix-cache'), routingActive, cacheActive, cacheWarm: warm,
    additionalMemoryMU: productEfficiencyMemory(state, product, tenants) + productRoutingStateMemory(state, product, tenants), easyShareBps: routingSecondaryShareBps(product), cachedInputShareBps: warm ? PREFIX_CACHE.reusedInputShareBps : 0,
    effectiveScores: model.capabilityBps, effectiveReliabilityBps: model.reliabilityBps, effectiveBehavior: model.behavior ?? { ...BASE_BEHAVIOR },
    summary: [routingActive ? `${routingSecondaryShareBps(product) / 100}% of requests use the smaller model and ${100 - routingSecondaryShareBps(product) / 100}% use the main model; displayed service quality is their weighted mixture. Both models remain resident.` : 'The selected model serves every request.', cacheActive ? warm ? 'Warm tenant-scoped prefixes reduce work for the eligible reused half of input. Output, internal reasoning and token bills retain their ordinary rates.' : 'The cache is empty or invalidated. Real service must warm it before a later week can use cached input.' : 'No prefix cache is active.'].join(' ') };
}
function modelEligibleForProduct(state: Readonly<GameState>, model: ModelVersion, product: ProductOffer): boolean {
  if (model.companyId !== product.companyId || !hasCapabilityEvaluation(state, model.id) || policyReleaseRejection(state, model.id)) return false;
  return product.kind === 'developer-api' ? model.capabilityBps.coding >= 5000 && model.reliabilityBps >= 8000
    : product.kind === 'business-docs' ? model.capabilityBps.documents >= 5500 && model.reliabilityBps >= 9000
      : model.capabilityBps.conversation >= 4500 && model.reliabilityBps >= 6500;
}
export function validateProductEfficiency(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload;
  if (p.kind !== 'install_product_efficiency' && p.kind !== 'set_product_efficiency_enabled') return { code: 'INVALID_COMMAND', message: 'Choose a supported product-efficiency action.' };
  const product = state.slices.products.offers[p.productId], rule = EFFICIENCY_RULES[p.method];
  if (!product || product.companyId !== command.companyId || product.status === 'deploying' || !rule) return { code: 'NOT_READY', message: 'Choose one of your deployed public products and an authored efficiency method.' };
  if (state.slices.company.companies[command.companyId].arrearsCents) return { code: 'ARREARS', message: 'Resolve unpaid expenses before changing efficiency installations.' };
  if (p.kind === 'set_product_efficiency_enabled') {
    const installation = efficiencyInstall(state, product.id, p.method);
    if (!installation || installation.status !== 'active' || typeof p.enabled !== 'boolean') return { code: 'NOT_READY', message: 'Finish this installation before changing its operating state.' };
    if (installation.enabled === p.enabled) return { code: 'ALREADY_ACTIVE', message: 'This installation already has that operating choice.' };
    if (p.method === 'evidence-links' && p.enabled && !evidenceInputsMatch(state, installation)) return { code: 'NOT_READY', message: 'The captured model or retrieval index changed. Install a new evidence checker for the current inputs.' };
    return;
  }
  if (!(state.slices.research.completedByCompany[command.companyId] ?? []).includes(rule.research)) return { code: 'NOT_READY', message: `Complete ${rule.research} before implementing this product method.` };
  const primary = state.slices.models.versions[state.slices.products.deployments[product.deploymentId].modelId];
  if (p.method === 'evidence-links') {
    const retrieval = state.slices.products.retrievalInstalls?.[product.id];
    if (product.kind !== 'business-docs' || retrieval?.status !== 'active' || retrieval.companyId !== command.companyId) return { code: 'NOT_READY', message: 'Evidence links need your deployed Business Documents product and its active retrieval index.' };
  }
  const existing = efficiencyInstall(state, product.id, p.method);
  if (existing && (existing.status !== 'active' || existing.modelId === primary.id && (p.method !== 'routing' || existing.secondaryModelId === p.secondaryModelId) && (p.method !== 'evidence-links' || evidenceInputsMatch(state, existing)))
    || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.productId === p.productId && other.payload.method === p.method)) return { code: 'ALREADY_ACTIVE', message: 'This combination already has an installation or queued rollout. Use its operating toggle or select a different routing model.' };
  if (p.method !== 'routing' && p.secondaryModelId !== undefined) return { code: 'INVALID_COMMAND', message: 'Only request routing selects a second model.' };
  if (p.method === 'routing') {
    const secondary = p.secondaryModelId ? state.slices.models.versions[p.secondaryModelId] : undefined;
    if (secondary) { const policyRejection = policyReleaseRejection(state, secondary.id); if (policyRejection) return policyRejection; }
    if (!secondary || secondary.id === primary.id || secondary.architecture !== primary.architecture || !modelEligibleForProduct(state, secondary, product) || !inheritedModelRights(state, secondary.id, content).hosted) return { code: 'NOT_READY', message: 'Choose a different evaluated, commercially eligible model with the same architecture for the easy-request route.' };
    const scale = (model: ModelVersion) => (FAMILY_SERVING_MULTIPLIER[model.family]) * modelWorkBps(model);
    if (scale(secondary) >= scale(primary)) return { code: 'NO_IMPROVEMENT', message: 'The easy-request model must use less serving work than the main model.' };
    if (!getCompatibleComputePools(state, command.companyId, modelExecutionHints(primary), content).some(pool => poolSupportsWorkload(pool, modelExecutionHints(secondary)) && pool.memoryMU >= primary.residentMU + secondary.residentMU)) return { code: 'MISSING_MEMORY', message: 'Keep a connected inference-compatible pool with room for both resident model versions; sparse routes also require fast fabric.' };
  }
}
export function quoteProductEfficiency(command: GameCommand, state?: Readonly<GameState>) {
  const p = command.payload;
  if (p.kind === 'set_product_efficiency_enabled' && p.method === 'evidence-links') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Change citation checking next week. Enabled checks add 0.00002 CUw per query, withhold unsupported answers, and leave model weights and subscription terms fixed.' };
  if (p.kind !== 'install_product_efficiency') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Change this installed method next week. Turning off a cache discards its warm prefixes; routing always keeps both active versions resident.' };
  const rule = EFFICIENCY_RULES[p.method];
  const share = state?.slices.products.offers[p.productId] ? routingSecondaryShareBps(state.slices.products.offers[p.productId]) : ROUTING.easyShareBps;
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `${rule.name}: ${formatWorkPoints(rule.staff)} Design points and ${formatUnits(rule.work)} development CUw, then activation next week. ${p.method === 'routing' ? `${share / 100}% of requests use the selected smaller model; both weights stay resident and every routed request adds 0.00002 CUw overhead. Economy, Balanced and Quality can change this share once routing is active.` : p.method === 'evidence-links' ? 'Capture this model and retrieval index. Each query adds 0.00002 CUw of checking; unsupported answers are withheld. Source support is not factual proof, and subscriptions still bill fulfilled attempts.' : 'Reserves 1 MU plus 0.002 MU per tenant. Prior service warms scoped prefixes; only eligible reused input receives the 80% work discount.'}` };
}
export function applyProductEfficiency(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const p = command.payload, products = structuredClone(state.slices.products);
  if (p.kind === 'install_product_efficiency') {
    const rule = EFFICIENCY_RULES[p.method], product = products.offers[p.productId], id = 'efficiency:' + command.id;
    products.efficiencyInstalls[key(p.productId, p.method)] = { id, companyId: command.companyId, productId: p.productId, kind: p.method,
      modelId: products.deployments[product.deploymentId].modelId, ...(p.method === 'routing' ? { secondaryModelId: p.secondaryModelId, routingProtocol: 2 as const } : {}),
      ...(p.method === 'evidence-links' ? { retrievalId: products.retrievalInstalls[p.productId].id, evidencePacketId: products.retrievalInstalls[p.productId].evidence.packetId } : {}),
      startedWeek: state.week, requiredWork: rule.work, completedWork: 0, requiredStaff: rule.staff, completedStaff: 0, status: 'building', readyWeek: null, enabled: true, lastBottleneck: 'Waiting for ML staff and development work.' };
  } else if (p.kind === 'set_product_efficiency_enabled') {
    const installation = products.efficiencyInstalls[key(p.productId, p.method)]; installation.enabled = p.enabled;
    const cache = products.efficiencyInstalls[key(p.productId, 'prefix-cache')]; if (cache) { delete cache.cacheKey; delete cache.warmedWeek; delete cache.lastServedWeek; }
  }
  return { updates: { products }, messages: [{ category: 'project', companyId: command.companyId, message: p.kind === 'install_product_efficiency'
    ? p.method === 'evidence-links' ? 'Evidence checker rollout started. Its costs and both implementation meters are separate from discovery.' : 'Product efficiency rollout started. Its costs and both implementation meters are separate from discovery.'
    : 'Product efficiency operating choice updated; affected cache keys were invalidated.' }] };
}
export function commitProductEfficiency(products: ProductsSlice, week: number): void {
  for (const installation of Object.values(products.efficiencyInstalls ?? {})) if (installation.status === 'ready' && installation.readyWeek! <= week) { installation.status = 'active'; installation.lastBottleneck = ''; }
}
export function productEfficiencyRequests(state: Readonly<GameState>): WorkRequest[] {
  return Object.values(state.slices.products.efficiencyInstalls ?? {}).filter(installation => installation.status === 'building').map(installation => ({
    id: workId(installation.id), companyId: installation.companyId, taskId: installation.id, category: 'development', normalizedWorkCUw: installation.requiredWork - installation.completedWork,
    memoryMU: 0, workloadKind: 'general', priority: 15, poolId: 'auto', staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, installation.requiredStaff - installation.completedStaff) }],
  }));
}
export function advanceProductEfficiency(products: ProductsSlice, ctx: ModuleContext): void {
  for (const installation of Object.values(products.efficiencyInstalls ?? {})) if (installation.status === 'building') {
    const work = ctx.resources.computeGrants.find(grant => grant.requestId === workId(installation.id))?.hardwareEffectiveCUw ?? 0;
    const staff = ctx.resources.staffGrants.find(grant => grant.requestId === workId(installation.id))?.grants.find(grant => grant.role === 'ml')?.staffWeeks ?? 0;
    installation.completedWork = checkedAdd(installation.completedWork, work); installation.completedStaff = checkedAdd(installation.completedStaff, staff);
    installation.lastBottleneck = [installation.completedWork < installation.requiredWork && !work ? 'Allocate development compute.' : '', installation.completedStaff < installation.requiredStaff && !staff ? 'Waiting for Design points.' : ''].filter(Boolean).join(' ');
  }
}
export function resolveProductEfficiency(products: ProductsSlice, week: number): void {
  for (const installation of Object.values(products.efficiencyInstalls ?? {})) if (installation.status === 'building' && installation.completedWork === installation.requiredWork && installation.completedStaff === installation.requiredStaff) { installation.status = 'ready'; installation.readyWeek = week + 1; installation.lastBottleneck = 'Implementation finished; activation is next week.'; }
}
export function warmProductCache(products: ProductsSlice, state: Readonly<GameState>, product: ProductOffer, week: number, executedWork: number): void {
  const installation = activeEfficiency(state, product.id, 'prefix-cache');
  if (!installation || !executedWork || product.status !== 'active') return;
  const cache = products.efficiencyInstalls[key(product.id, 'prefix-cache')], identity = efficiencyCacheKey(state, product);
  if (cache.cacheKey !== identity || cache.lastServedWeek === undefined || cache.lastServedWeek < week - PREFIX_CACHE.lifetimeWeeks) { cache.cacheKey = identity; cache.warmedWeek = week; }
  cache.lastServedWeek = week;
}
