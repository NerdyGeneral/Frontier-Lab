import type { GameState, ModelVersion, ProductOffer, Rejection, SegmentDefinition } from '../contracts/types';
import { PRODUCT_WORKLOAD_IDS, type ProductWorkloadId, type ProductWorkloadReceipt, type ProductWorkloadUsage } from '../contracts/product-workloads';
import { PRODUCT_WORKLOADS } from '../content/product-workloads';
import { getAISystemMetrics } from './ai-systems';
import { mulDiv } from '../core/math';
import { hasConnectedCompanyRules } from '../core/connected-company-version';

const clamp = (value: number, min = 0, max = 10000) => Math.max(min, Math.min(max, Math.round(value)));
export const isProductWorkloadId = (value: unknown): value is ProductWorkloadId => typeof value === 'string' && (PRODUCT_WORKLOAD_IDS as readonly string[]).includes(value);
export const validProductName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 48 && !/[\u0000-\u001f\u007f]/.test(value);
export const createProductWorkloadReceipt = (id: ProductWorkloadId, selectedWeek: number): ProductWorkloadReceipt => ({ version: 1, id, selectedWeek });

export function productPortfolioShapeRejection(payload: unknown): Rejection | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { code: 'INVALID_COMMAND', message: 'Choose a product action.' };
  const p = payload as Record<string, unknown>;
  if (p.kind !== 'configure_product_offer' && p.kind !== 'retire_product') return;
  const fields = p.kind === 'retire_product' ? 'kind,productId' : 'kind,name,productId,workload';
  if (Object.keys(p).sort().join() !== fields || typeof p.productId !== 'string' || !p.productId.length || p.productId.length > 160
    || p.kind === 'configure_product_offer' && (!validProductName(p.name) || !isProductWorkloadId(p.workload)))
    return { code: 'INVALID_COMMAND', message: 'Choose an owned offer, a name of 1–48 characters and a recognized customer workload.' };
}

export function getProductWorkloadMeasure(model: ModelVersion, receipt?: ProductWorkloadReceipt): ProductWorkloadUsage | undefined {
  if (!receipt) return;
  const metrics = getAISystemMetrics(model);
  const memoryMU = metrics.residentMU + metrics.sessionMemoryMU * 25;
  return measureWorkload({ version: 1, id: receipt.id, retentionBps: metrics.retentionBps, verifiedCompletionBps: metrics.verifiedCompletionBps,
    latencyBps: metrics.latencyBps, routingQualityBps: metrics.routingQualityBps, memoryMU, fitBps: 0 });
}
function measureWorkload(measure: ProductWorkloadUsage): ProductWorkloadUsage {
  const rule = PRODUCT_WORKLOADS[measure.id];
  const fits = [10000];
  if (rule.minRetentionBps) fits.push(mulDiv(measure.retentionBps, 10000, rule.minRetentionBps));
  if (rule.minVerifiedBps) fits.push(mulDiv(measure.verifiedCompletionBps, 10000, rule.minVerifiedBps));
  if (rule.maxLatencyBps) fits.push(mulDiv(rule.maxLatencyBps, 10000, Math.max(rule.maxLatencyBps, measure.latencyBps)));
  if (rule.maxMemoryMU) fits.push(mulDiv(rule.maxMemoryMU, 10000, Math.max(rule.maxMemoryMU, measure.memoryMU)));
  if (measure.id === 'responsive') fits.push(mulDiv(measure.routingQualityBps, 10000, 8000));
  return { ...measure, fitBps: clamp(Math.min(...fits)) };
}
export function blendWorkloadMeasures(primary: ProductWorkloadUsage, secondary: ProductWorkloadUsage, shareBps: number): ProductWorkloadUsage {
  const mix = (a: number, b: number) => mulDiv(a, 10000 - shareBps, 10000) + mulDiv(b, shareBps, 10000);
  return measureWorkload({ ...primary, retentionBps: mix(primary.retentionBps, secondary.retentionBps),
    verifiedCompletionBps: mix(primary.verifiedCompletionBps, secondary.verifiedCompletionBps),
    routingQualityBps: mix(primary.routingQualityBps, secondary.routingQualityBps), latencyBps: mix(primary.latencyBps, secondary.latencyBps),
    memoryMU: primary.memoryMU + secondary.memoryMU - 25 * 20_000_000 });
}

/** Different promises turn the same measured model into different delivered outcomes. */
export function workloadErrorBps(baseErrorBps: number, measure?: ProductWorkloadUsage): number {
  if (!measure || measure.id === 'general' || measure.id === 'local') return baseErrorBps;
  let error = baseErrorBps;
  if (measure.id === 'continuity') error = mulDiv(baseErrorBps, 10000 - Math.floor(measure.retentionBps / 2), 10000)
    + Math.max(0, 7000 - measure.retentionBps) / 5;
  if (measure.id === 'verified') error = 10000 - measure.verifiedCompletionBps;
  if (measure.id === 'responsive') error += (10000 - measure.routingQualityBps) / 4;
  const latencyLimit = PRODUCT_WORKLOADS[measure.id].maxLatencyBps;
  if (latencyLimit && measure.latencyBps > latencyLimit) error += Math.min(3000, (measure.latencyBps - latencyLimit) / 8);
  return clamp(error);
}
export function workloadErrorToleranceBps(segment: SegmentDefinition, receipt?: ProductWorkloadReceipt): number {
  return receipt?.id === 'verified' ? Math.max(segment.errorToleranceBps, 2000) : segment.errorToleranceBps;
}
export function workloadAcquisitionBps(segment: SegmentDefinition, measure?: ProductWorkloadUsage): number {
  if (!measure || measure.id === 'general') return 10000;
  return mulDiv(PRODUCT_WORKLOADS[measure.id].audience[segment.id], 5000 + Math.floor(measure.fitBps / 2), 10000);
}
export function workloadChurnReliefBps(baseChurnBps: number, measure?: ProductWorkloadUsage): number {
  return measure?.id === 'continuity' && measure.fitBps === 10000 ? mulDiv(baseChurnBps, measure.retentionBps, 40000) : 0;
}
export function workloadPrivatePrice(baseCents: number, receipt?: ProductWorkloadReceipt): number {
  return receipt ? mulDiv(baseCents, PRODUCT_WORKLOADS[receipt.id].privatePriceBps, 10000, 'nearest') : baseCents;
}
export function productWorkloadExplanation(measure?: ProductWorkloadUsage): string {
  if (!measure) return 'Existing customer terms use the original skill, price and service rules.';
  const rule = PRODUCT_WORKLOADS[measure.id], result = measure.fitBps === 10000 ? 'Meets the operating promise.' : `Operating fit ${(measure.fitBps / 100).toFixed(1)}%; missed needs reduce demand or service value.`;
  return `${rule.name}: ${rule.promise} ${result}`;
}
export function assertProductWorkloadReceipt(value: unknown, state: Pick<GameState, 'week' | 'contentVersion'>): asserts value is ProductWorkloadReceipt {
  const p = value as ProductWorkloadReceipt;
  if (!hasConnectedCompanyRules(state.contentVersion) || !p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join() !== 'id,selectedWeek,version' || p.version !== 1 || !isProductWorkloadId(p.id)
    || !Number.isSafeInteger(p.selectedWeek) || p.selectedWeek < 0 || p.selectedWeek > state.week) throw new Error('Invalid versioned customer workload.');
}
export function activePortfolio(state: Readonly<GameState>, companyId: string): ProductOffer[] {
  return Object.values(state.slices.products.offers).filter(product => product.companyId === companyId && product.retiredWeek === undefined);
}
export function productRetirementObligationReason(state: Readonly<GameState>, productId: string): string | undefined {
  const products = state.slices.products;
  if (Object.values(products.assuranceContracts ?? {}).some(contract => contract.productId === productId && ['building', 'ready', 'active'].includes(contract.status))) return 'Finish or cancel the accepted assurance commitment before retiring its offer.';
  if (Object.values(products.batchJobs ?? {}).some(job => job.productId === productId && ['active', 'paused'].includes(job.status))) return 'Finish or explicitly cancel accepted batch work before retiring its offer.';
  if (Object.values(products.releaseRehearsals ?? {}).some(rehearsal => rehearsal.productId === productId && rehearsal.status !== 'complete')) return 'Finish the paid release comparison before retiring its offer.';
  if ([...Object.values(products.efficiencyInstalls), ...Object.values(products.runtimeGuardrails ?? {}), ...Object.values(products.retrievalInstalls)]
    .some(installation => installation.productId === productId && installation.status !== 'active')) return 'Finish the paid product installation before retiring its offer.';
  if (Object.values(products.preparedReleases ?? {}).some(release => release.productId === productId && (['preparing', 'ready', 'scheduled'].includes(release.status)
    || release.rollback && ['preparing', 'ready', 'scheduled'].includes(release.rollback.status)))) return 'Finish or discard the prepared release before retiring its offer.';
  if (Object.values(products.canaryReleases ?? {}).some(canary => canary.productId === productId && ['scheduled', 'collecting'].includes(canary.status))) return 'Stop the active canary before retiring its offer.';
}
