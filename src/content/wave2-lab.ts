import { ADVANCED_DATA_CATALOG, ADVANCED_EVALUATION_SUITE } from './advanced-skills';
import { DESIGN_RECIPES, DESIGN_RESEARCH_IDS } from './model-designs';
import { CUSTOMIZATION_RESEARCH_IDS } from './model-customization-research';
import type { DataCatalogItem, EvaluationSuiteId, TrainingProfile, TrainingRecipe } from '../contracts/wave2-lab';
import { MODEL_CHALLENGES } from './model-challenges';
import type { ModelVersion } from '../contracts/types';
import { WAVE4_APPLIED_RESEARCH_IDS } from './wave4-research';
import { POLICY_DATA_RULES, POLICY_HOLDOUT_RULES, POLICY_TRAINING_METHODS } from './wave11-policy';
import { SYNTHETIC_RULES } from './wave26-synthetic';

const U = 1_000_000_000;
const rights = { hosted: true, weights: true, feedback: false };
const coverage = (domain: keyof ModelVersion['capabilityBps']) => ({ conversation: 2000, documents: 2000, coding: 2000, tools: 2000, [domain]: 10000 });

/** Authored game costs from Technical Systems Edition 3.0; these are not real market quotes. */
export const DATA_CATALOG: readonly DataCatalogItem[] = [
  ...(['conversation', 'documents', 'coding', 'tools'] as const).map(domain => ({
    id: `specialist-${domain}-1`, name: `${domain[0].toUpperCase() + domain.slice(1)} specialist pack`,
    feeCents: 600_000, preparationStaff: 2 * U, rawUnits: 120, qualityBps: 9000,
    coverageBps: coverage(domain), behaviorUnits: 100, broadUnits: 0, rights,
  })),
  ...[1, 2, 3].map(edition => ({
    id: `broad-corpus-${edition}`, name: `Broad corpus · edition ${edition}`,
    feeCents: 1_000_000, preparationStaff: 4 * U, rawUnits: 500, qualityBps: 8000,
    coverageBps: { conversation: 6000, documents: 6000, coding: 6000, tools: 6000 },
    behaviorUnits: 0, broadUnits: 500, rights,
  })),
  { id: POLICY_DATA_RULES.id, name: POLICY_DATA_RULES.name, feeCents: POLICY_DATA_RULES.feeCents,
    preparationStaff: POLICY_DATA_RULES.preparationStaff, rawUnits: POLICY_DATA_RULES.rawUnits, qualityBps: POLICY_DATA_RULES.qualityBps,
    coverageBps: { conversation: 0, documents: 0, coding: 0, tools: 0 }, behaviorUnits: 0, broadUnits: 0, rights },
  ...ADVANCED_DATA_CATALOG,
];

export const TRAINING_RECIPES: readonly TrainingRecipe[] = [
  { id: 'compact-conversation-adaptation', name: 'Conversation adaptation', kind: 'adaptation', workCUw: 12 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 5000, documents: 3200, coding: 2000, tools: 2400 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 9000,
    description: 'Improve a dense model’s conversation skills with prepared data. You can reuse the data, but repeating the same plan will not keep raising its scores.' },
  { id: 'document-adaptation', name: 'Document adaptation', kind: 'adaptation', workCUw: 24 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 4500, documents: 5800, coding: 2200, tools: 3200 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 9000,
    description: 'Teach a model to handle documents. Other skills may get worse, so compare the results before replacing a live model.' },
  { id: 'coding-tools-adaptation', name: 'Coding and tools adaptation', kind: 'adaptation', workCUw: 48 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 4400, documents: 3800, coding: 5600, tools: 5400 },
    relevantUnits: 120, minimumBroadUnits: 0, reliabilityTargetBps: 9000,
    description: 'Teach coding and tool use with relevant prepared data. A coding pack alone provides only limited tool examples.' },
  { id: 'medium-foundation', name: 'Medium foundation', kind: 'foundation', family: 'medium', workCUw: 240 * U,
    feeCents: 2_000_000, preparationStaff: 6 * U, targets: { conversation: 8200, documents: 8000, coding: 7800, tools: 7200 },
    relevantUnits: 250, minimumBroadUnits: 500, reliabilityTargetBps: 9000,
    description: 'Build a new foundation after testing and releasing two models. Design takes six research staff-weeks before training starts. Dense models need 24 MU of workspace; sparse models need 36 MU.' },
  { id: 'large-foundation', name: 'Large foundation', kind: 'foundation', family: 'large', workCUw: 900 * U,
    feeCents: 7_000_000, preparationStaff: 20 * U, targets: { conversation: 9200, documents: 9000, coding: 8800, tools: 8600 },
    relevantUnits: 750, minimumBroadUnits: 1500, reliabilityTargetBps: 9000,
    description: 'Build a large foundation with three different general data editions. Design takes twenty research staff-weeks before training starts. Dense models need 72 MU of workspace; sparse models need 108 MU.' },
  ...DESIGN_RECIPES,
  ...(['foundation', 'adaptation'] as const).map(kind => ({ id: `custom-model-${kind}`, name: kind === 'foundation' ? 'Custom foundation' : 'Custom model training', kind, workCUw: 1_000_000_000, feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 }, relevantUnits: 1, minimumBroadUnits: 0, reliabilityTargetBps: 9000, description: 'Choose size, sparsity, data balance and a compute budget. Model targets are calculated from your engineering choices and earned with prepared evidence.' })),
  { id: 'compact-distillation', name: 'Compact student distillation', kind: 'distillation', family: 'compact', requiredResearch: 'R13', workCUw: 40 * U,
    feeCents: 200_000, preparationStaff: U, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 9000,
    description: 'Use a tested teacher model to teach one skill to a compact student. The teacher must allow model distribution and uses serving compute before student training begins. The student’s target stays below both the teacher’s score and its own family limit.' },
  { id: 'behavior-reliability', name: 'Preference and reliability tuning', kind: 'behavior', requiredResearch: 'R5', workCUw: 16 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 9400,
    description: 'Use 100 behavior cases to aim for reliability 94. Skill scores stay the same. Repeating this plan will not stack reliability gains.' },
  { id: 'calibration-curriculum', name: 'Calibration curriculum', kind: 'calibration', requiredResearch: 'R5A', workCUw: 16 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 0,
    description: 'Aim to halve the model’s original rate of confident mistakes. It asks for clarification instead; it does not gain extra correct answers.' },
  { id: 'planner-curriculum', name: 'Budgeted planner curriculum', kind: 'planning', requiredResearch: 'R11A', workCUw: 16 * U,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 },
    relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 0,
    description: 'Use 100 reviewed behavior cases to aim for 20% fewer unnecessary repeat lookups in jobs with set limits. Required reads, checks, permissions, and answer quality stay the same. Repeating this plan will not stack gains.' },
  { id: 'policy-boundary-discrimination', name: 'Policy boundary discrimination', kind: 'policy', requiredResearch: 'R5', workCUw: POLICY_TRAINING_METHODS['policy-boundary-discrimination'].workCUw,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 }, relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 0,
    description: 'After R5 and R1A, train on allow/refuse examples to aim for 6% acceptance of restricted requests and 3.5% refusal of allowed requests. These targets are fixed; skill scores, reliability, and confidence stay the same. Run a paid policy test before release.' },
  { id: 'policy-conservative-refusal', name: 'Conservative policy refusal', kind: 'policy', requiredResearch: 'R5', workCUw: POLICY_TRAINING_METHODS['policy-conservative-refusal'].workCUw,
    feeCents: 0, preparationStaff: 0, targets: { conversation: 0, documents: 0, coding: 0, tools: 0 }, relevantUnits: 100, minimumBroadUnits: 0, reliabilityTargetBps: 0,
    description: 'After R5 and R1A, train on allow/refuse examples to aim for 3% acceptance of restricted requests, at the cost of refusing 12% of allowed requests. Those refusals can cost you customers. Skill scores, reliability, and confidence stay the same. Run a paid policy test before release.' },
  { id: SYNTHETIC_RULES.recipeId, name: 'Targeted synthetic curriculum', kind: 'synthetic', requiredResearch: 'S2',
    workCUw: SYNTHETIC_RULES.trainingWork, feeCents: SYNTHETIC_RULES.trainingFeeCents, preparationStaff: 0,
    targets: { conversation: 0, documents: 0, coding: 0, tools: 0 }, relevantUnits: SYNTHETIC_RULES.trainingEvidence,
    minimumBroadUnits: 0, reliabilityTargetBps: 0,
    description: 'Use a reviewed synthetic dataset to teach its target skill to a separate student model. The target stays below the teacher’s score; other skills and reliability stay the same. Pay for an independent test afterward.' },
];

export const FAMILY_DESIGNS = {
  edge: { residentMU: U / 2, servingMultiplierBps: 5000, ceilings: { conversation: 6600, documents: 6200, coding: 6000, tools: 5800 } },
  frontier: { residentMU: 80 * U, servingMultiplierBps: 80000, ceilings: { conversation: 9950, documents: 9950, coding: 9950, tools: 9950 } },
  compact: { residentMU: 2 * U, servingMultiplierBps: 10000, ceilings: { conversation: 7000, documents: 6500, coding: 6500, tools: 6000 } },
  medium: { residentMU: 8 * U, servingMultiplierBps: 20000, ceilings: { conversation: 8500, documents: 8500, coding: 8500, tools: 8000 } },
  large: { residentMU: 24 * U, servingMultiplierBps: 40000, ceilings: { conversation: 9500, documents: 9500, coding: 9500, tools: 9500 } },
} as const;
export const TRAINING_PROFILES: Readonly<Record<TrainingProfile, { name: string; workMultiplierBps: number; targetBonusBps: number; varianceBps: number; description: string }>> = {
  stable: { name: 'Stable', workMultiplierBps: 11000, targetBonusBps: 0, varianceBps: 100, description: 'Uses 10% more training work. The result varies by up to ±1 point and is fixed for a given plan.' },
  balanced: { name: 'Balanced', workMultiplierBps: 10000, targetBonusBps: 0, varianceBps: 300, description: 'Uses normal training work. The result varies by up to ±3 points and is fixed for a given plan.' },
  ambitious: { name: 'Ambitious', workMultiplierBps: 14000, targetBonusBps: 400, varianceBps: 500, description: 'Uses 40% more training work to aim for a higher skill tier, up to the model family’s limits. The result varies by up to ±5 points and is fixed for a given plan.' },
};
export const EVALUATION_SUITES: readonly { id: EvaluationSuiteId; name: string; cases: number; workCUw: number; researchStaff: number; requiredResearch?: string; description: string }[] = [
  { id: 'basic-conversation-1', name: 'Basic conversation', cases: 20, workCUw: 2 * U, researchStaff: U / 2, description: 'Test 20 conversation cases kept out of training. Use the report to check the model’s progress toward launching Basic Chat.' },
  { id: 'expanded-capabilities-1', name: 'Expanded capabilities', cases: 100, workCUw: 4 * U, researchStaff: U, requiredResearch: 'R1', description: 'Test 100 unseen cases, with 25 for each skill. Testing measures the model; it does not improve it.' },
  { id: 'behavior-cases-1', name: 'Behavior cases', cases: 100, workCUw: 4 * U, researchStaff: U, requiredResearch: 'R1A', description: 'Test 90 harmless requests for helpful answers, confident mistakes, unnecessary refusals, and clarification. Another ten refusal checks have fixed results. Use Policy boundary holdouts to test how well the model follows policy.' },
  { id: 'independent-holdouts-1', name: 'Independent outcome holdouts', cases: 100, workCUw: 4 * U, researchStaff: U, requiredResearch: 'R10A', description: 'Test 100 support cases kept out of training. Compare what the model claims to finish with correct results, checker mistakes, and planning within limits. Run a capability test on this model first. This test does not qualify it for release or improve it.' },
  { id: POLICY_HOLDOUT_RULES.suiteId, name: 'Policy boundary holdouts', cases: POLICY_HOLDOUT_RULES.cases, workCUw: POLICY_HOLDOUT_RULES.workCUw, researchStaff: POLICY_HOLDOUT_RULES.researchStaff, requiredResearch: POLICY_HOLDOUT_RULES.researchId,
    description: 'Test 50 allowed and 50 restricted requests under the game’s rules. Compare unnecessary refusals with responses that break those rules. Run a paid capability test on this model first. The test measures this model; it does not improve it or guarantee safety outside these cases.' },
  ADVANCED_EVALUATION_SUITE,
  ...MODEL_CHALLENGES,
];
export const IMPLEMENTED_RESEARCH_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R9', 'R10', 'R11', 'R12', 'R1A', 'R5A', 'R2A', 'R6A', 'R12A', 'R4B', 'R4C', 'R9A', 'R10A', 'R11A', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', ...WAVE4_APPLIED_RESEARCH_IDS, ...DESIGN_RESEARCH_IDS, ...CUSTOMIZATION_RESEARCH_IDS] as const;
