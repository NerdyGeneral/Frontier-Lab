import type { AdvancedDomain } from '../contracts/advanced-skills';
import type { DataCatalogItem, EvaluationSuiteId } from '../contracts/wave2-lab';

const U = 1_000_000_000;
export const ADVANCED_DOMAINS = ['reasoning', 'longContext', 'multimodal'] as const;
export const ADVANCED_SKILL_LABELS: Record<AdvancedDomain, string> = {
  reasoning: 'Reasoning', longContext: 'Long context', multimodal: 'Multimodal',
};
export const ADVANCED_SKILL_DESCRIPTIONS: Record<AdvancedDomain, string> = {
  reasoning: 'Connect evidence and solve unfamiliar tasks through several steps.',
  longContext: 'Keep relevant details consistent across long documents and conversations.',
  multimodal: 'Connect visual examples with language, rather than learning from text alone.',
};

const rights = { hosted: true, weights: true, feedback: false };
const specialistFees = { reasoning: 650_000, longContext: 850_000, multimodal: 1_100_000 };
export const ADVANCED_DATA_CATALOG: readonly DataCatalogItem[] = [
  ...ADVANCED_DOMAINS.map(domain => ({
    id: `advanced-${domain}-1`, name: `${ADVANCED_SKILL_LABELS[domain]} examples`,
    feeCents: specialistFees[domain], preparationStaff: 3 * U, rawUnits: 200, qualityBps: 9000,
    coverageBps: { conversation: 2500, documents: 2500, coding: 2500, tools: 2500 },
    advancedCoverageBps: { reasoning: 1000, longContext: 1000, multimodal: 1000, [domain]: 10000 },
    behaviorUnits: 100, broadUnits: 0, rights,
  })),
  ...[1, 2, 3].map(edition => ({
    id: `advanced-broad-${edition}`, name: `Cross-domain corpus · edition ${edition}`,
    feeCents: 1_600_000, preparationStaff: 5 * U, rawUnits: 600, qualityBps: 8500,
    coverageBps: { conversation: 6500, documents: 6500, coding: 6500, tools: 6500 },
    advancedCoverageBps: { reasoning: 6000, longContext: 6000, multimodal: 6000 },
    behaviorUnits: 120, broadUnits: 600, rights,
  })),
];

export const ADVANCED_EVALUATION_SUITE = {
  id: 'advanced-capabilities-1' as EvaluationSuiteId,
  name: 'Reasoning, context & multimodal', cases: 60, workCUw: 6 * U, researchStaff: 2 * U,
  requiredResearch: 'R1',
  description: 'Test 60 unfamiliar cases: 20 reasoning, 20 long-context and 20 multimodal tasks. Compare the three skills separately. This test measures a saved model; it does not train it or replace a release capability test.',
};
