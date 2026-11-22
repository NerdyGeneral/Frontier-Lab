const U = 1_000_000_000;

/** Authored release telemetry choices. The work allowance is not a cash charge. */
export const CANARY_RULES = {
  protocol: 'release-canary-1' as const, requiredResearch: 'S3', setupFeeCents: 100_000,
  shares: [100, 500, 1000] as const, minimumSample: 100, maximumSample: 10000,
  maximumBudgetCUw: 32 * U, maximumObservations: 8, maximumHistory: 24,
  candidatePriority: 5, regressionBps: 500, severeConfidentErrorBps: 2500, severeMinimumSamples: 20,
  minimumFulfillmentBps: 9800, maximumCostRatioBps: 15000,
} as const;
