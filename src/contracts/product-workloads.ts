export const PRODUCT_WORKLOAD_IDS = ['general', 'responsive', 'local', 'continuity', 'verified'] as const;
export type ProductWorkloadId = typeof PRODUCT_WORKLOAD_IDS[number];

/** Versioned customer needs. Absence retains the original product/contract rules. */
export interface ProductWorkloadReceipt {
  version: 1;
  id: ProductWorkloadId;
  selectedWeek: number;
}

/** The measured customer outcome is kept with the week that earned the bill. */
export interface ProductWorkloadUsage {
  version: 1;
  id: ProductWorkloadId;
  retentionBps: number;
  verifiedCompletionBps: number;
  latencyBps: number;
  routingQualityBps: number;
  memoryMU: number;
  fitBps: number;
}

export type ProductPortfolioCommand =
  | { kind: 'configure_product_offer'; productId: string; name: string; workload: ProductWorkloadId }
  | { kind: 'retire_product'; productId: string };
