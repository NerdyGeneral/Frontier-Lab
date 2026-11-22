/** Authored continual-training choices, not real-world performance estimates. */
export const CURRICULUM_RULES = {
  researchId: 'R4C',
  sharesBps: [5000, 7500] as readonly number[],
  tracks: 2,
  requiredEvidence: 100 * 1_000_000_000,
  maximumPacketsPerTrack: 20,
  capabilitySuiteId: 'expanded-capabilities-1',
} as const;
