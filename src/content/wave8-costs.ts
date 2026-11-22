/** Authored accounting policy, not new prices or additional charges. */
export const COMPUTE_COST_RULES = {
  protocol: 'compute-costs-1',
  researchId: 'R12A',
  rolloutMethod: 'cost-accounting',
  historyWeeks: 8,
  maximumRequestsPerReport: 4096,
  maximumFactsPerReport: 4096,
  maximumPoolsPerReport: 256,
  policy: [
    'Cloud rent is split by the capacity each job reserves, including spare capacity held for serving. Unused rental capacity is a shared company cost.',
    'Owned GPU costs follow the work done and that hardware pool’s rate. When costs are rounded to cents, jobs with the largest leftover fractions get the extra cents; tied jobs use their ID order.',
    'Tiny GPU costs carried from earlier weeks stay in shared costs when they add up to a cent. Fixed upkeep for racks, sites, networks, and upgrades is also shared.',
    'A product’s contribution is its revenue minus its compute cost. Salaries, overhead, penalties, shared compute, and other running costs still need paying. Equipment purchases are listed separately.',
    'Reports show the work and charges recorded that week, using the locations and rates from that time. Viewing a report costs nothing and does not change your game.',
  ],
} as const;
