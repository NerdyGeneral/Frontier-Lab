const U = 1_000_000_000;

/** Fictional release engineering costs, applied only after explicit adoption. */
export const PREPARED_RELEASE_RULES = {
  requiredResearch: 'R12',
  maximumRecordsPerProduct: 8,
  requestPriority: 16,
  weeklyWork: U,
  weeklyStaff: U,
  forwardWork: 2 * U,
  forwardStaff: 2 * U,
  rollbackWork: U,
  rollbackStaff: U,
  rollbackWeeks: 6,
  normalSessionMemory: 20_000_000,
  longSessionMemory: 80_000_000,
} as const;
