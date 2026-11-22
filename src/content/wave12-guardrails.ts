import type { RuntimeGuardrailProfile } from '../contracts/wave12-guardrails';

const U = 1_000_000_000;

/** Fixed, fictional operating choices. These are game rules rather than real-world safety estimates. */
export const RUNTIME_GUARDRAIL_RULES = {
  protocol: 'runtime-guardrails-v1',
  researchIds: ['R1A', 'R5'],
  requiredWork: 2 * U,
  requiredStaff: 2 * U,
  maximumWeeklyWork: U,
  maximumWeeklyStaff: U,
  requestPriority: 15,
  cases: 100,
  allowedCases: 50,
  restrictedCases: 50,
  maximumPerProduct: 8,
  maximumHistory: 16,
  maximumReceiptBuckets: 64,
} as const;

export const RUNTIME_GUARDRAIL_PROFILES: Record<RuntimeGuardrailProfile, {
  name: string; workPerRequestCUw: number; memoryMU: number; allowedBlockBps: number; unsafeCatchBps: number;
}> = {
  balanced: { name: 'Balanced', workPerRequestCUw: 20_000, memoryMU: U, allowedBlockBps: 200, unsafeCatchBps: 7000 },
  strict: { name: 'Strict', workPerRequestCUw: 50_000, memoryMU: 2 * U, allowedBlockBps: 800, unsafeCatchBps: 9000 },
};
