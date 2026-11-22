import type { CommandQuote, DomainResult, GameCommand, GameState, ProductOffer, Rejection, SegmentDefinition } from '../contracts/types';
import type { ProductAudience, RoutingPolicy } from '../contracts/strategic-variety';
import { PRODUCT_AUDIENCES, ROUTING_POLICIES } from '../content/strategic-variety';
import { mulDiv } from '../core/math';

export const PRODUCT_STRATEGY_COMMANDS = ['set_product_strategy'] as const;
export function productAudience(product: ProductOffer): ProductAudience { return product.strategy?.audience ?? 'broad'; }
export function productRoutingPolicy(product: ProductOffer): RoutingPolicy { return product.strategy?.routingPolicy ?? 'balanced'; }
export function routingSecondaryShareBps(product: ProductOffer): number { return ROUTING_POLICIES[productRoutingPolicy(product)].secondaryShareBps; }

/** Positioning changes acquisition among the same finite shoppers. A promise
 * must fit the actual bill, model and recently fulfilled service. */
export function audienceAcquisitionBps(product: ProductOffer, segment: SegmentDefinition, facts: {
  expectedBillCents: number; taskScoreBps: number; reliabilityBps: number; fulfillmentBps: number;
}): number {
  const audience = productAudience(product);
  if (audience === 'broad') return 10000;
  if (audience === 'value') {
    const fit = { casual: 13000, regular: 11500, heavy: 9500, professional: 6500, developers: 12500, business: 8000 }[segment.id];
    return facts.expectedBillCents <= segment.referencePriceCents ? fit : mulDiv(fit, 6000, 10000);
  }
  const fit = { casual: 6500, regular: 9000, heavy: 11500, professional: 14000, developers: 11500, business: 13000 }[segment.id];
  return facts.taskScoreBps >= 7500 && facts.reliabilityBps >= 9000 && facts.fulfillmentBps >= 9500 ? fit : mulDiv(fit, 6000, 10000);
}

export function validateProductStrategy(state: Readonly<GameState>, command: GameCommand): Rejection | undefined {
  const p = command.payload;
  if (p.kind !== 'set_product_strategy') return { code: 'INVALID_COMMAND', message: 'Choose a product strategy.' };
  const product = state.slices.products.offers[p.productId];
  if (!product || product.companyId !== command.companyId || product.status === 'deploying') return { code: 'NOT_READY', message: 'Finish deploying one of your products before choosing its audience and serving policy.' };
  if (!Object.hasOwn(PRODUCT_AUDIENCES, p.audience) || !Object.hasOwn(ROUTING_POLICIES, p.routingPolicy)) return { code: 'INVALID_COMMAND', message: 'Choose a listed audience and routing policy.' };
  if (product.strategy?.audience === p.audience && product.strategy.routingPolicy === p.routingPolicy
    || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.productId === p.productId)) return { code: 'ALREADY_ACTIVE', message: 'This strategy is already selected or a change is queued for the product.' };
  if (p.routingPolicy !== 'balanced') {
    const route = state.slices.products.efficiencyInstalls?.[product.id + ':routing'];
    if (!route || route.status !== 'active' || !route.enabled || route.modelId !== state.slices.products.deployments[product.deploymentId]?.modelId) return { code: 'NOT_READY', message: 'Install and enable routing between two evaluated models before selecting Economy or Quality.' };
  }
}
export function quoteProductStrategy(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload;
  if (p.kind !== 'set_product_strategy') throw new Error('Expected a product strategy choice.');
  const product = state.slices.products.offers[p.productId];
  const routeChange = product && productRoutingPolicy(product) !== p.routingPolicy;
  const hasRoute = !!state.slices.products.efficiencyInstalls?.[p.productId + ':routing'];
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: `${PRODUCT_AUDIENCES[p.audience]?.name ?? p.audience}. ${PRODUCT_AUDIENCES[p.audience]?.description ?? ''} ${hasRoute ? ROUTING_POLICIES[p.routingPolicy]?.description ?? '' : 'The current model serves every request until routing is installed.'} Applies next week. ${routeChange ? 'Changed routing uses different compute and quality; existing runtime audits may need requalification. ' : ''}Current subscription prices stay as quoted.` };
}
export function applyProductStrategy(state: Readonly<GameState>, command: GameCommand): DomainResult {
  const p = command.payload;
  if (p.kind !== 'set_product_strategy') return {};
  const products = structuredClone(state.slices.products), product = products.offers[p.productId];
  product.strategy = { audience: p.audience, routingPolicy: p.routingPolicy, updatedWeek: state.week, commandId: command.id };
  const cache = products.efficiencyInstalls?.[product.id + ':prefix-cache'];
  if (cache) { delete cache.cacheKey; delete cache.warmedWeek; delete cache.lastServedWeek; }
  return { updates: { products }, messages: [{ companyId: command.companyId, category: 'project', message: `${product.name}: ${PRODUCT_AUDIENCES[p.audience].name} audience and ${ROUTING_POLICIES[p.routingPolicy].name.toLowerCase()} routing selected. Existing customer contracts keep their recorded terms.` }] };
}
