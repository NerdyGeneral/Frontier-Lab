import type { ResearchDefinition } from '../contracts/types';

const U = 1_000_000_000;

export const CUSTOMIZATION_RESEARCH_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13'] as const;
export type CustomizationResearchId = typeof CUSTOMIZATION_RESEARCH_IDS[number];

/** Research unlocks a choice in future paid designs; it never upgrades an existing model. */
export const CUSTOMIZATION_RESEARCH: ResearchDefinition[] = [
  { id: 'M1', name: 'Grouped-query attention', requires: ['R3'], feeCents: 180_000, role: 'ml', staffWeeks: 2, workCUw: 4 * U, implemented: true,
    description: 'Unlock grouped-query attention in custom foundations. Share attention work to reduce serving and memory costs, with a tradeoff in model capability.' },
  { id: 'M2', name: 'Sliding-window attention', requires: ['M1', 'R6'], feeCents: 420_000, role: 'ml', staffWeeks: 3, workCUw: 8 * U, implemented: true,
    description: 'Unlock sliding-window attention in custom foundations. Local attention makes serving cheaper, but sacrifices some ability to connect information across long documents.' },
  { id: 'M3', name: 'Hybrid attention', requires: ['M2', 'R12'], feeCents: 1_200_000, role: 'research', staffWeeks: 6, workCUw: 24 * U, implemented: true,
    description: 'Unlock hybrid attention in custom foundations. Combine local and global attention for stronger long-context work, with additional engineering and memory requirements.' },
  { id: 'M4', name: 'Extended context', requires: ['R2', 'R3'], feeCents: 300_000, role: 'data', staffWeeks: 3, workCUw: 6 * U, implemented: true,
    description: 'Unlock an extended context window in custom foundations. Raise long-context potential while paying for a larger training workspace and more expensive inference.' },
  { id: 'M5', name: 'Ultra-long context', requires: ['M4', 'R12'], feeCents: 1_600_000, role: 'research', staffWeeks: 7, workCUw: 32 * U, implemented: true,
    description: 'Unlock an ultra-long context window in custom foundations. Pursue deeper document and long-context capability with substantially larger memory and serving requirements.' },
  { id: 'M6', name: '8-bit weights', requires: ['R7', 'D5'], feeCents: 600_000, role: 'ml', staffWeeks: 4, workCUw: 12 * U, implemented: true,
    description: 'Unlock 8-bit weight precision in custom foundations. Fit a smaller model footprint into service and lower inference work at a modest capability cost.' },
  { id: 'M7', name: '4-bit weights', requires: ['M6', 'R7A'], feeCents: 1_400_000, role: 'ml', staffWeeks: 6, workCUw: 24 * U, implemented: true,
    description: 'Unlock 4-bit weight precision in custom foundations. Push memory and serving costs lower while accepting a larger capability tradeoff than 8-bit weights.' },
  { id: 'M8', name: 'Reasoning curriculum', requires: ['R1', 'R4'], feeCents: 420_000, role: 'research', staffWeeks: 3, workCUw: 8 * U, implemented: true,
    description: 'Unlock the reasoning training objective. Specialize a custom model in reasoning through a deliberate tradeoff against other skills; relevant prepared examples are still required.' },
  { id: 'M9', name: 'Agentic curriculum', requires: ['R9', 'D3'], feeCents: 650_000, role: 'ml', staffWeeks: 4, workCUw: 12 * U, implemented: true,
    description: 'Unlock the agentic training objective. Favor coding and tool use in a custom model, with less emphasis on other skills. This trains a model; agent workflows still need their own configuration.' },
  { id: 'M10', name: 'Grounded curriculum', requires: ['R6', 'D2'], feeCents: 480_000, role: 'data', staffWeeks: 4, workCUw: 10 * U, implemented: true,
    description: 'Unlock the grounded training objective. Prioritize document understanding and long-context evidence while trading away some breadth. Retrieval remains a separate product installation.' },
  { id: 'M11', name: 'Multimodal curriculum', requires: ['R2', 'R4'], feeCents: 800_000, role: 'research', staffWeeks: 5, workCUw: 16 * U, implemented: true,
    description: 'Unlock the multimodal training objective. Favor multimodal examples and capability over a general-purpose balance; prepared multimodal evidence determines the gains you can earn.' },
  { id: 'M12', name: 'Careful responses', requires: ['R1A', 'R5A'], feeCents: 350_000, role: 'research', staffWeeks: 3, workCUw: 6 * U, implemented: true,
    description: 'Unlock careful response behavior for custom training. Reduce confident mistakes at the cost of more false refusals. Training must earn this change with real behavior examples.' },
  { id: 'M13', name: 'Expressive responses', requires: ['R1A', 'D1'], feeCents: 180_000, role: 'ml', staffWeeks: 2, workCUw: 4 * U, implemented: true,
    description: 'Unlock expressive response behavior for custom training. Answer more readily and reduce false refusals, while accepting more confident mistakes. Behavior examples and paid training are required.' },
];

export const CUSTOMIZATION_RESEARCH_GROUPS = [
  { id: 'attention', name: 'Attention architecture', short: 'Attention', ids: ['M1', 'M2', 'M3'] },
  { id: 'context-precision', name: 'Context & precision', short: 'Memory', ids: ['M4', 'M5', 'M6', 'M7'] },
  { id: 'objectives', name: 'Training objectives', short: 'Objectives', ids: ['M8', 'M9', 'M10', 'M11'] },
  { id: 'behavior', name: 'Response behavior', short: 'Behavior', ids: ['M12', 'M13'] },
] as const;

export function isCustomizationResearch(id: string): id is CustomizationResearchId {
  return (CUSTOMIZATION_RESEARCH_IDS as readonly string[]).includes(id);
}
