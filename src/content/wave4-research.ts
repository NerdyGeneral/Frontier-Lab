import type { ModelVariantKind, ProductEfficiencyKind, SystemRolloutKind } from '../contracts/wave4-research';
const U = 1_000_000_000;
/** Authored simulation coefficients; these are not real hardware/model benchmarks. */
export const VARIANT_RULES: Record<ModelVariantKind, { name: string; research: string; work: number; staff: number; servingWorkBps: number; memoryBps: number; scorePenaltyBps: number }> = {
  compression: { name: 'Compressed deployment', research: 'R7', work: 2 * U, staff: 2 * U, servingWorkBps: 8000, memoryBps: 10000, scorePenaltyBps: 300 },
  'memory-format': { name: 'Compact memory format', research: 'R7A', work: U, staff: U, servingWorkBps: 10000, memoryBps: 5000, scorePenaltyBps: 500 },
};
export const EFFICIENCY_RULES: Record<ProductEfficiencyKind, { research: string; staff: number; work: number; name: string }> = {
  routing: { research: 'R8', staff: 2 * U, work: 2 * U, name: 'Request routing' },
  'prefix-cache': { research: 'R8A', staff: U, work: U, name: 'Prefix cache' },
  'evidence-links': { research: 'R6A', staff: U, work: U, name: 'Evidence links' },
};
export const SYSTEM_RULES: Record<SystemRolloutKind, { research: string; staff: number; work: number; name: string }> = {
  'run-supervisor': { research: 'R3B', staff: U, work: U, name: 'Run supervisor' },
  'research-assistant': { research: 'R15', staff: 2 * U, work: 2 * U, name: 'Research assistant' },
  deduplication: { research: 'R2A', staff: U, work: U, name: 'Deduplication' },
  'capacity-forecast': { research: 'R12A', staff: U, work: U, name: 'Capacity forecast' },
  'adapter-bank': { research: 'R4B', staff: U, work: U, name: 'Adapter bank' },
  'action-receipts': { research: 'R9A', staff: U, work: U, name: 'Action receipts' },
  'cost-accounting': { research: 'R12A', staff: U, work: U, name: 'Operating cost meter' },
};
export const ROUTING = { easyShareBps: 6000, overheadPerRequest: 20_000 } as const;
export const PREFIX_CACHE = { reusedInputShareBps: 5000, hitWorkBps: 2000, memoryMU: U, tenantMemoryMU: 2_000_000, lifetimeWeeks: 2 } as const;
export const ASSISTANCE = { maximumFte: 4 * U, workPerFte: U / 4, reviewPerFte: U / 10, bonusBps: 2000 } as const;
export const SPARSE_DESIGN = { workBps: 7000, servingWorkBps: 6500, residentMemoryBps: 15000 } as const;
export const WAVE4_APPLIED_RESEARCH_IDS = ['R7', 'R8', 'R13', 'R14', 'R15', 'R16', 'R3B', 'R7A', 'R8A'] as const;
