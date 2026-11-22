import type { ProductWorkloadId } from '../contracts/product-workloads';
import type { MarketSegmentId } from '../contracts/wave2-market';

export const PRODUCT_PORTFOLIO_LIMIT = 4;
export const PRODUCT_KIND_LIMIT = 2;
export interface ProductWorkloadDefinition {
  id: ProductWorkloadId;
  name: string;
  description: string;
  promise: string;
  minRetentionBps: number | null;
  minVerifiedBps: number | null;
  maxLatencyBps: number | null;
  maxMemoryMU: number | null;
  privatePriceBps: number;
  audience: Record<MarketSegmentId, number>;
}
const broad = { casual: 10000, regular: 10000, heavy: 10000, professional: 10000, developers: 10000, business: 10000 };
/** Version-one promises remain fixed so accepted business terms can be replayed. */
export const PRODUCT_WORKLOADS: Readonly<Record<ProductWorkloadId, ProductWorkloadDefinition>> = {
  general: { id: 'general', name: 'Everyday assistance', description: 'A broad service competing on skills, price and dependable delivery.', promise: 'Existing skill and service requirements; no extra operating promise.',
    minRetentionBps: null, minVerifiedBps: null, maxLatencyBps: null, maxMemoryMU: null, privatePriceBps: 10000, audience: broad },
  responsive: { id: 'responsive', name: 'Fast interactive work', description: 'Live support and developer tools reward fast answers and dependable expert routing.', promise: 'Response time at most 1.3×. Slow responses and failed expert handoffs reduce useful answers.',
    minRetentionBps: null, minVerifiedBps: null, maxLatencyBps: 13000, maxMemoryMU: null, privatePriceBps: 11000,
    audience: { casual: 11500, regular: 11000, heavy: 10000, professional: 9000, developers: 12000, business: 9500 } },
  local: { id: 'local', name: 'Compact private work', description: 'Small organizations and local applications prefer a model that fits a constrained machine.', promise: 'Model plus 25 sessions at most 4 MU. Smaller footprints improve fit; inference still uses your real compute.',
    minRetentionBps: null, minVerifiedBps: null, maxLatencyBps: 18000, maxMemoryMU: 4_000_000_000, privatePriceBps: 11500,
    audience: { casual: 9500, regular: 10000, heavy: 8000, professional: 10000, developers: 11000, business: 12500 } },
  continuity: { id: 'continuity', name: 'Continuing casework', description: 'Returning customers pay for an assistant that remembers changing facts and prior exceptions.', promise: 'Retain at least 70% of context with response time at most 2×. Earned retention lowers context-related errors and churn.',
    minRetentionBps: 7000, minVerifiedBps: null, maxLatencyBps: 20000, maxMemoryMU: null, privatePriceBps: 12500,
    audience: { casual: 6500, regular: 11000, heavy: 12000, professional: 12500, developers: 8500, business: 13000 } },
  verified: { id: 'verified', name: 'Verified analysis', description: 'Demanding analysis and tool work value completed, checked results over instant responses.', promise: 'Verified completion at least 80%, with response time at most 4×. Completion determines answer errors for this harder workload.',
    minRetentionBps: null, minVerifiedBps: 8000, maxLatencyBps: 40000, maxMemoryMU: null, privatePriceBps: 14000,
    audience: { casual: 5000, regular: 7000, heavy: 11000, professional: 14000, developers: 12000, business: 13000 } },
};
