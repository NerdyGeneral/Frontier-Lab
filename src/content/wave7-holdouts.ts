import { RESOURCE_SCALE as U } from '../contracts/types';

/** Fictional validation protocol. It changes knowledge, never checker accuracy. */
export const INDEPENDENT_HOLDOUT_RULES = {
  suiteId: 'independent-holdouts-1',
  protocol: 'independent-support-v1',
  researchId: 'R10A',
  cases: 100,
  workCUw: 4 * U,
  researchStaff: U,
} as const;

export const INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE = 'Evaluate this exact model on a capability suite before reserving independent outcome cases.';
