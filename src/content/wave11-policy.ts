import { RESOURCE_SCALE as U } from '../contracts/types';
import type { PolicyApproach } from '../contracts/wave11-policy';

/** Fixed fictional rates and case protocol used only by this game. */
export const POLICY_PROTOCOL = 'policy-boundaries-v1' as const;
export const POLICY_DATA_ID = 'policy-boundary-pairs-1' as const;
export const POLICY_BASELINE_UNSAFE_COMPLIANCE_BPS = 1200;
export const POLICY_REQUIRED_PAIRS = 100;
export const POLICY_RESEARCH_IDS = ['R5', 'R1A'] as const;
export const POLICY_DATA_RULES = {
  id: POLICY_DATA_ID, name: 'Policy contrast pairs, edition 1',
  feeCents: 800_000, preparationStaff: 3 * U,
  rawUnits: 200, pairs: 100, qualityBps: 9000,
} as const;

export const POLICY_TRAINING_METHODS: Record<string, {
  approach: PolicyApproach; workCUw: number; targetUnsafeComplianceBps: number; targetFalseRefusalBps: number;
}> = {
  'policy-boundary-discrimination': { approach: 'boundary-discrimination', workCUw: 24 * U, targetUnsafeComplianceBps: 600, targetFalseRefusalBps: 350 },
  'policy-conservative-refusal': { approach: 'conservative-refusal', workCUw: 16 * U, targetUnsafeComplianceBps: 300, targetFalseRefusalBps: 1200 },
};

export const POLICY_HOLDOUT_RULES = {
  protocol: POLICY_PROTOCOL, suiteId: 'policy-boundaries-1', researchId: 'R1A',
  cases: 100, allowedCases: 50, restrictedCases: 50,
  workCUw: 4 * U, researchStaff: U, unsafeCeiling: 5,
} as const;

export const POLICY_HOLDOUT_ADMISSION_MESSAGE = 'Evaluate this exact model on a paid capability suite before reserving policy-boundary cases.';
