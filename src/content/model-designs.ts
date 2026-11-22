import type { ResearchDefinition } from '../contracts/types';
import type { TrainingRecipe, TrainingWorkspace } from '../contracts/wave2-lab';

const U = 1_000_000_000;

export const DESIGN_RESEARCH: ResearchDefinition[] = [
  { id: 'D1', name: 'Support dialogue', requires: [], feeCents: 85_000, role: 'research', staffWeeks: 1, workCUw: 2 * U, implemented: true,
    description: 'Unlock the Support desk blueprint. Its short adaptation favors reliable customer conversations and gives up document and coding range.' },
  { id: 'D2', name: 'Structured extraction', requires: ['R2'], feeCents: 220_000, role: 'data', staffWeeks: 2, workCUw: 4 * U, implemented: true,
    description: 'Unlock the Document extractor blueprint. It targets deeper document understanding and uses more training compute than ordinary document adaptation.' },
  { id: 'D3', name: 'Function calling', requires: ['R9'], feeCents: 420_000, role: 'ml', staffWeeks: 3, workCUw: 8 * U, implemented: true,
    description: 'Unlock the Tool dispatcher blueprint. It prioritizes selecting the right tool, with a lower coding target than coding and tools adaptation.' },
  { id: 'D4', name: 'Compact foundation design', requires: ['R3', 'R4'], feeCents: 550_000, role: 'research', staffWeeks: 4, workCUw: 10 * U, implemented: true,
    description: 'Design an independent compact foundation after two tested releases. A dense model occupies 2 MU in service and has lower skill ceilings than a medium foundation.' },
  { id: 'D5', name: 'Activation recomputation', requires: ['R3'], feeCents: 260_000, role: 'ml', staffWeeks: 2, workCUw: 4 * U, implemented: true,
    description: 'Unlock a low-memory training workspace. Recalculating intermediate results uses 25% less training memory and 25% more update work.' },
  { id: 'D6', name: 'Large-batch training', requires: ['D5', 'R12'], feeCents: 850_000, role: 'ml', staffWeeks: 5, workCUw: 14 * U, implemented: true,
    description: 'Unlock a large-batch workspace for capable labs. Larger batches finish with 15% less update work and require 50% more training memory.' },
];
export const DESIGN_RESEARCH_IDS = DESIGN_RESEARCH.map(item => item.id);

export const DESIGN_RECIPES: TrainingRecipe[] = [
  { id: 'support-desk', name: 'Support desk', kind: 'adaptation', requiredResearch: 'D1', workCUw: 16 * U, feeCents: 50_000, preparationStaff: 0,
    targets: { conversation: 6300, documents: 2700, coding: 1600, tools: 2000 }, relevantUnits: 90, minimumBroadUnits: 0, reliabilityTargetBps: 9600,
    description: 'Build a reliable customer support model. Strong conversation coverage raises its best skill. Document and coding performance can fall.' },
  { id: 'document-extractor', name: 'Document extractor', kind: 'adaptation', requiredResearch: 'D2', workCUw: 32 * U, feeCents: 120_000, preparationStaff: 0,
    targets: { conversation: 3300, documents: 7600, coding: 2100, tools: 4000 }, relevantUnits: 120, minimumBroadUnits: 0, reliabilityTargetBps: 9200,
    description: 'Train for structured document work. It needs 120 relevant units for full evidence and trades conversation range for extraction accuracy.' },
  { id: 'tool-dispatcher', name: 'Tool dispatcher', kind: 'adaptation', requiredResearch: 'D3', workCUw: 40 * U, feeCents: 180_000, preparationStaff: 0,
    targets: { conversation: 3800, documents: 3100, coding: 4100, tools: 7600 }, relevantUnits: 120, minimumBroadUnits: 0, reliabilityTargetBps: 9400,
    description: 'Teach a model to choose tools reliably. Use tool examples for its strongest target. Its coding target is lower than the combined coding and tools recipe.' },
  { id: 'compact-foundation', name: 'Compact foundation', kind: 'foundation', family: 'compact', requiredResearch: 'D4', workCUw: 96 * U, feeCents: 800_000, preparationStaff: 2 * U,
    targets: { conversation: 6800, documents: 6400, coding: 6100, tools: 5700 }, relevantUnits: 120, minimumBroadUnits: 200, reliabilityTargetBps: 9100,
    description: 'Build a compact foundation with two research staff-weeks, 200 general data units, 120 relevant units per skill and 100 behavior examples. Dense training uses 6 MU and the deployed model occupies 2 MU.' },
];

export const TRAINING_WORKSPACES = {
  recompute: { name: 'Recompute activations', researchId: 'D5', memoryBps: 7500, workBps: 12500, detail: '25% less training memory, 25% more update work' },
  'large-batch': { name: 'Large batches', researchId: 'D6', memoryBps: 15000, workBps: 8500, detail: '50% more training memory, 15% less update work' },
} as const satisfies Record<TrainingWorkspace, { name: string; researchId: string; memoryBps: number; workBps: number; detail: string }>;
