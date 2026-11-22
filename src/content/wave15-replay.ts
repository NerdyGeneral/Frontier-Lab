import type { CapabilityDomain } from '../contracts/wave2-lab';
const U = 1_000_000_000;

/** Authored continual-adaptation rules, not empirical model-training estimates. */
export const REPLAY_RULES = {
  researchId: 'R4C',
  feeCents: 300_000,
  researchWorkCUw: 6 * U,
  researchStaffWeeks: 3,
  sharesBps: [2500, 5000] as readonly number[],
  requiredEvidence: 100 * U,
  maximumPackets: 20,
  capabilitySuiteId: 'expanded-capabilities-1',
} as const;

export const REPLAY_FOCUS_DOMAINS: Readonly<Record<string, readonly CapabilityDomain[]>> = {
  'compact-conversation-adaptation': ['conversation'],
  'document-adaptation': ['documents'],
  'coding-tools-adaptation': ['coding', 'tools'],
};
